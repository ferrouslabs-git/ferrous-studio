"""Participants book their own session: the emails, the slots and the
moderator's calendar.

No routes here (``booking.py`` and ``routes.py`` call these), so a study's
booking rules sit in one place:

* A participant is emailed a thank-you with a link to book (``send_invite``),
  only ever because a person in Studio added or re-sent to them.
* The booking link is the participant's ``booking_token``, never their
  session ``token``: the session link is sent at the start of the call.
* A slot is offered only when it is in one of the study's windows, has not
  started, is not booked by another participant, and the moderator's Google
  calendar is free then (``free_slots``).
* Booking puts a session with a Meet link on the moderator's calendar with
  the participant as guest, and emails the participant what to prepare and
  how to rebook (``book``, ``send_confirmation``). Rebooking moves the same
  event.
* Each window holds its time on the moderator's calendar (``hold``).
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.config import get_settings
from app.auth.models.membership import Membership
from app.auth.models.user import User
from app.auth.security.dependencies import PLATFORM_SCOPE_ID
from app.auth.services.email_service import send_branded_email

from ..models import utc_now
from . import calendar
from . import content as rules
from .models import Availability, Participant, Study

logger = logging.getLogger(__name__)

#: The platform role a moderator must hold: a Studio super admin.
MODERATOR_ROLE = "platform_admin"


# ── who and when ────────────────────────────────────────────────────────────


async def moderators(db: AsyncSession) -> list[User]:
    """Every Studio super admin: who may moderate a study."""
    rows = await db.execute(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(
            Membership.scope_type == "platform",
            Membership.scope_id == PLATFORM_SCOPE_ID,
            Membership.status == "active",
            Membership.role_name == MODERATOR_ROLE,
            User.is_active.is_(True),
        )
        .order_by(User.name.asc(), User.email.asc())
    )
    return list(rows.scalars().unique().all())


async def is_moderator(db: AsyncSession, user_id: UUID) -> bool:
    return any(u.id == user_id for u in await moderators(db))


async def moderator_of(db: AsyncSession, study: Study) -> User | None:
    if study.moderator_user_id is None:
        return None
    return (await db.execute(select(User).where(User.id == study.moderator_user_id))).scalar_one_or_none()


async def windows_of(db: AsyncSession, study: Study) -> list[Availability]:
    rows = await db.execute(
        select(Availability)
        .where(Availability.study_id == study.id, Availability.account_id == study.account_id)
        .order_by(Availability.starts_at.asc())
    )
    return list(rows.scalars().all())


def problems(study: Study, moderator: User | None, windows: list[Availability]) -> list[str]:
    """What stops participants booking this study, in words for a person."""
    out = []
    if moderator is None:
        out.append("choose a moderator")
    if not study.session_minutes:
        out.append("set the session length")
    if not any(w.ends_at > utc_now() for w in windows):
        out.append("add times participants can book")
    return out


def booking_token(participant: Participant) -> str:
    """The participant's booking link token, made the first time it is needed."""
    if not participant.booking_token:
        participant.booking_token = secrets.token_urlsafe(32)
    return participant.booking_token


def booking_url(participant: Participant) -> str:
    return f"{get_settings().frontend_url.rstrip('/')}/book/{booking_token(participant)}"


def local(study: Study, at: datetime) -> datetime:
    """A naive-UTC time in the study's time zone."""
    return at.replace(tzinfo=timezone.utc).astimezone(ZoneInfo(study.timezone or "Europe/London"))


def when(study: Study, start: datetime) -> str:
    """'Tuesday 3 December 2026, 14:00 to 15:00 (GMT)' in the study's time zone."""
    begin = local(study, start)
    end = local(study, start + timedelta(minutes=study.session_minutes or 0))
    return f"{begin:%A} {begin.day} {begin:%B %Y}, {begin:%H:%M} to {end:%H:%M} ({begin.tzname()})"


async def taken(db: AsyncSession, study: Study, *, except_participant: Participant | None = None) -> list[tuple[datetime, datetime]]:
    """The study's booked sessions, less one participant's own (when they rebook)."""
    length = timedelta(minutes=study.session_minutes or 0)
    rows = await db.execute(
        select(Participant.id, Participant.booked_start).where(
            Participant.study_id == study.id,
            Participant.account_id == study.account_id,
            Participant.booked_start.is_not(None),
        )
    )
    return [
        (start, start + length) for pid, start in rows.all()
        if except_participant is None or pid != except_participant.id
    ]


async def free_slots(
    db: AsyncSession, study: Study, moderator: User | None, windows: list[Availability],
    *, participant: Participant | None = None,
) -> list[datetime]:
    """The slot starts a participant may book now (naive UTC). Raises
    CalendarError when the moderator's calendar cannot be read: offering a
    time that may clash is worse than offering none."""
    spans = [(w.starts_at, w.ends_at) for w in windows]
    busy = await taken(db, study, except_participant=participant)
    reach = calendar.range_of(spans)
    if moderator is not None and calendar.configured() and reach:
        own = {participant.google_event_id} if participant and participant.google_event_id else set()
        busy += await calendar.busy(moderator.email, *reach, ignore=own)
    return rules.slots(spans, study.session_minutes or 0, busy, utc_now(), study.slot_gap_minutes or 0)


def booked_in(window: Availability, participants: list[Participant]) -> list[Participant]:
    """Who has a session booked inside a window: such a window cannot change."""
    return [
        p for p in participants
        if p.booked_start is not None and window.starts_at <= p.booked_start < window.ends_at
    ]


# ── emails ──────────────────────────────────────────────────────────────────


def _values(study: Study, participant: Participant, moderator: User | None, organisation: str) -> dict[str, str]:
    return {
        "name": participant.name or "there",
        "study": study.name,
        "moderator": (moderator.name or moderator.email) if moderator else "our team",
        "organisation": organisation,
        "duration": study.duration or (f"{study.session_minutes} minutes" if study.session_minutes else "about an hour"),
    }


def _copy(study: Study, kind: str, values: dict[str, str]) -> tuple[str, list[str]]:
    email = rules.with_defaults(study.content)["emails"][kind]
    return rules.render_copy(email["subject"], values), [rules.render_copy(line, values) for line in email["body"]]


async def send_invite(
    study: Study, participant: Participant, moderator: User | None, windows: list[Availability], organisation: str,
) -> bool:
    """The thank-you with the booking link. Records when it went, or why not,
    on the participant; never raises, so adding a participant never fails on it."""
    if not participant.contact_email:
        participant.invite_error = "No contact email"
        return False
    missing = problems(study, moderator, windows)
    if missing:
        participant.invite_error = "Before booking emails can go: " + ", ".join(missing)
        return False
    values = _values(study, participant, moderator, organisation)
    subject, body = _copy(study, "invite", values)
    result = await send_branded_email(
        participant.contact_email, subject,
        eyebrow="Usability session", heading=study.name, paragraphs=body,
        button=("Choose a time", booking_url(participant)),
        footer=f"You are receiving this because you agreed to take part in research with {organisation}.",
        reply_to=moderator.email if moderator else None,
    )
    if result.sent:
        participant.invite_sent_at, participant.invite_error = utc_now(), None
    else:
        participant.invite_error = result.detail
    return result.sent


async def send_confirmation(study: Study, participant: Participant, moderator: User | None, organisation: str) -> str | None:
    """What to prepare, the session details and how to rebook. Returns the
    failure, if any; the caller records it after its commit."""
    values = _values(study, participant, moderator, organisation)
    subject, body = _copy(study, "confirmation", values)
    facts = [("When", when(study, participant.booked_start)), ("Length", values["duration"])]
    if moderator:
        facts.append(("With", values["moderator"]))
    if participant.meet_url:
        facts.append(("Join", participant.meet_url))
    result = await send_branded_email(
        participant.contact_email, subject,
        eyebrow="Session booked", heading=study.name, paragraphs=body, facts=facts,
        closing=[
            "Need another time? Use the link below to choose a different slot. Your calendar invite "
            "will move with it, so there is no need to tell us.",
        ],
        closing_link=booking_url(participant),
        footer=f"You are receiving this because you booked a usability session with {organisation}.",
        reply_to=moderator.email if moderator else None,
    )
    return None if result.sent else result.detail


# ── calendar ────────────────────────────────────────────────────────────────


async def place_session(study: Study, participant: Participant, moderator: User | None, start: datetime, organisation: str) -> None:
    """Put the booked session on the moderator's calendar, or move it there on
    a rebooking. Raises CalendarError; the caller turns that into a refusal
    so a booking never stands without its event."""
    if moderator is None or not calendar.configured():
        participant.calendar_error = None if moderator else "No moderator"
        return
    end = start + timedelta(minutes=study.session_minutes or 0)
    if participant.google_event_id:
        session = await calendar.move_session(
            moderator.email, participant.google_event_id, start=start, end=end, timezone=study.timezone,
        )
    else:
        who = participant.name or participant.code
        session = await calendar.create_session(
            moderator.email,
            summary=f"Usability session: {study.name} ({who})",
            description=(
                f"Usability session for {study.name} with {organisation}.\n\n"
                f"To change the time, use your booking link: {booking_url(participant)}"
            ),
            start=start, end=end, attendee=participant.contact_email, timezone=study.timezone,
            study_id=str(study.id), participant_id=str(participant.id),
        )
    participant.google_event_id = session.event_id
    participant.meet_url = session.meet_url or participant.meet_url
    participant.calendar_error = None


async def cancel_session(participant: Participant, moderator: User | None) -> None:
    """Take a removed participant's session off the calendar (Google tells
    them). A failure is logged, never raised: removing them must not fail."""
    if not participant.google_event_id or moderator is None or not calendar.configured():
        return
    try:
        await calendar.cancel_session(moderator.email, participant.google_event_id)
    except calendar.CalendarError:
        logger.warning("Could not cancel a removed participant's session", extra={"participant": str(participant.id)})


async def hold(study: Study, window: Availability, moderator: User | None) -> None:
    """Block a window on the moderator's calendar. Records why not, if not."""
    if moderator is None or not calendar.configured():
        window.hold_error = "Calendar not connected" if moderator else "No moderator"
        return
    try:
        window.google_hold_id = await calendar.create_hold(
            moderator.email,
            summary=f"Held for usability sessions: {study.name}",
            description="Studio offers this time for participants to book. Booked sessions appear as their own events.",
            start=window.starts_at, end=window.ends_at, timezone=study.timezone,
            study_id=str(study.id), window_id=str(window.id),
        )
        window.hold_error = None
    except calendar.CalendarError as e:
        window.hold_error = str(e)


async def release(window: Availability, moderator: User | None) -> None:
    if not window.google_hold_id or moderator is None or not calendar.configured():
        return
    try:
        await calendar.delete_hold(moderator.email, window.google_hold_id)
    except calendar.CalendarError:
        logger.warning("Could not delete a window's hold", extra={"window": str(window.id)})


async def rehold_for_new_moderator(db: AsyncSession, study: Study, old: UUID | None) -> None:
    """The study's moderator changed: move each window's hold to the new
    moderator's calendar. Sessions already booked stay where they are."""
    previous = (await db.execute(select(User).where(User.id == old))).scalar_one_or_none() if old else None
    current = await moderator_of(db, study)
    for window in await windows_of(db, study):
        await release(window, previous)
        window.google_hold_id = None
        if window.ends_at > utc_now():
            await hold(study, window, current)
        else:
            window.hold_error = None
