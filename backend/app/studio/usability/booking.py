"""Booking routes: the study's moderator and bookable times, and the public
booking page a participant's email links to.

* ``/studio/projects/{project_id}/usability/...`` (``data:write``): who may
  moderate, the study's availability windows (each held on the moderator's
  calendar), and re-sending a participant's booking email.
* ``/studio/usability/booking/{booking_token}`` (public): the free slots and
  the participant's booking. As with the session link, holding the link is
  the proof, and the organisation is adopted from the participant's row
  before anything else is read. The booking link is not the session link.

The rules live in ``booking_service``.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext

from ..common import adopt_account_scope, allow_cross_account, get_project
from ..models import utc_now
from . import booking_service as svc
from . import calendar
from . import content as rules
from .models import Availability, Participant, Study
from .routes import BASE, _organisation_name, _participant, _participant_out, _participants, _study
from .schemas import AvailabilityIn, BookingIn

router = APIRouter()
booking_router = APIRouter(prefix="/usability/booking")


def iso(at: datetime | None) -> str | None:
    """Naive UTC out as an unambiguous instant."""
    return None if at is None else at.replace(microsecond=0).isoformat() + "Z"


# ── the organisation's side ─────────────────────────────────────────────────


@router.get(f"{BASE}/moderators")
async def list_usability_moderators(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    """The Studio super admins, any of whom may moderate a study."""
    await get_project(db, project_id, ctx)
    return [{"id": u.id, "name": u.name or "", "email": u.email} for u in await svc.moderators(db)]


async def _availability_out(db: AsyncSession, study: Study) -> dict[str, Any]:
    """The windows, every slot they make (booked, busy or free) and what stops
    booking, for the Slots tab."""
    moderator = await svc.moderator_of(db, study)
    windows = await svc.windows_of(db, study)
    booked = {
        p.booked_start: p for p in await _participants(db, study) if p.booked_start is not None
    }
    every = rules.slots([(w.starts_at, w.ends_at) for w in windows], study.session_minutes or 0, [], utc_now())
    calendar_error = None
    try:
        free = set(await svc.free_slots(db, study, moderator, windows))
    except calendar.CalendarError as e:
        free, calendar_error = set(every), str(e)
    slots = []
    for start in sorted(set(every) | set(booked)):
        who = booked.get(start)
        slots.append({
            "start": iso(start),
            "state": "booked" if who else ("free" if start in free else "busy"),
            "participant": {"id": who.id, "code": who.code, "name": who.name or ""} if who else None,
        })
    return {
        "calendar_connected": calendar.configured(),
        "calendar_error": calendar_error,
        "problems": svc.problems(study, moderator, windows),
        "windows": [
            {
                "id": w.id, "starts_at": iso(w.starts_at), "ends_at": iso(w.ends_at),
                "held": bool(w.google_hold_id), "hold_error": w.hold_error,
            }
            for w in windows
        ],
        "slots": slots,
    }


@router.get(f"{BASE}/studies/{{study_id}}/availability")
async def get_usability_availability(
    project_id: UUID,
    study_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await get_project(db, project_id, ctx)
    return await _availability_out(db, await _study(db, project, study_id))


@router.post(f"{BASE}/studies/{{study_id}}/availability", status_code=status.HTTP_201_CREATED)
async def add_usability_availability(
    project_id: UUID,
    study_id: UUID,
    payload: AvailabilityIn,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """A window participants may book in, held on the moderator's calendar."""
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    if payload.ends_at <= utc_now():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="That time has passed")
    window = Availability(account_id=study.account_id, study_id=study.id, starts_at=payload.starts_at, ends_at=payload.ends_at)
    db.add(window)
    await db.flush()
    await svc.hold(study, window, await svc.moderator_of(db, study))
    await db.flush()
    out = await _availability_out(db, study)
    await db.commit()
    return out


@router.delete(f"{BASE}/studies/{{study_id}}/availability/{{window_id}}")
async def remove_usability_availability(
    project_id: UUID,
    study_id: UUID,
    window_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Stop offering a window and release its hold. Sessions already booked
    in it stand."""
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    window = next((w for w in await svc.windows_of(db, study) if w.id == window_id), None)
    if window is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Window not found")
    await svc.release(window, await svc.moderator_of(db, study))
    await db.delete(window)
    await db.flush()
    out = await _availability_out(db, study)
    await db.commit()
    return out


@router.post(f"{BASE}/studies/{{study_id}}/availability/sync-holds")
async def sync_usability_holds(
    project_id: UUID,
    study_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Hold every window not yet held: ones added before the calendar was
    connected or a moderator chosen, or whose hold failed."""
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    moderator = await svc.moderator_of(db, study)
    for window in await svc.windows_of(db, study):
        if not window.google_hold_id and window.ends_at > utc_now():
            await svc.hold(study, window, moderator)
    await db.flush()
    out = await _availability_out(db, study)
    await db.commit()
    return out


@router.post(f"{BASE}/studies/{{study_id}}/participants/{{participant_id}}/send-booking-email")
async def send_usability_booking_email(
    project_id: UUID,
    study_id: UUID,
    participant_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Send (or send again) the thank-you with the booking link."""
    project = await get_project(db, project_id, ctx)
    study = await _study(db, project, study_id)
    participant = await _participant(db, study, participant_id)
    await svc.send_invite(
        study, participant, await svc.moderator_of(db, study), await svc.windows_of(db, study),
        await _organisation_name(db, study.account_id),
    )
    await db.flush()
    out = _participant_out(study, participant, {})
    await db.commit()
    return out


# ── the participant's side ──────────────────────────────────────────────────


async def _booking(db: AsyncSession, token: str) -> tuple[Participant, Study]:
    """The participant a booking link names, with the transaction confined to
    their organisation (see routes._session). A closed study stops booking."""
    await allow_cross_account(db)
    participant = (
        await db.execute(select(Participant).where(Participant.booking_token == token))
    ).scalar_one_or_none()
    if participant is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This link is not valid")
    await adopt_account_scope(db, participant.account_id)
    study = (
        await db.execute(
            select(Study).where(Study.id == participant.study_id, Study.account_id == participant.account_id)
        )
    ).scalar_one_or_none()
    if study is None or study.status != "open":
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="This study has closed")
    return participant, study


async def _booking_out(db: AsyncSession, participant: Participant, study: Study, slots: list[datetime]) -> dict[str, Any]:
    moderator = await svc.moderator_of(db, study)
    return {
        "title": study.name,
        "organisation": await _organisation_name(db, study.account_id),
        "duration": study.duration or "",
        "session_minutes": study.session_minutes or 0,
        "timezone": study.timezone,
        "moderator": (moderator.name or moderator.email) if moderator else "",
        "name": participant.name or "",
        "slots": [iso(s) for s in slots],
        "booked": (
            {"start": iso(participant.booked_start), "meet_url": participant.meet_url or ""}
            if participant.booked_start else None
        ),
    }


@booking_router.get("/{token}", include_in_schema=False)
async def booking_page(token: str, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    participant, study = await _booking(db, token)
    moderator = await svc.moderator_of(db, study)
    try:
        slots = await svc.free_slots(db, study, moderator, await svc.windows_of(db, study), participant=participant)
    except calendar.CalendarError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="We cannot show the available times right now. Please try again in a few minutes.",
        )
    return await _booking_out(db, participant, study, slots)


@booking_router.post("/{token}", include_in_schema=False)
async def book_session(token: str, payload: BookingIn, db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    """Book, or move a booking to, one of the free slots. The session goes on
    the moderator's calendar first, and the booking stands only if it did; the
    confirmation email follows."""
    participant, study = await _booking(db, token)
    if not participant.contact_email:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Ask the study team to add your email address first")
    moderator = await svc.moderator_of(db, study)
    windows = await svc.windows_of(db, study)
    if participant.booked_start == payload.start:
        return await _booking_out(db, participant, study, [])
    try:
        free = await svc.free_slots(db, study, moderator, windows, participant=participant)
    except calendar.CalendarError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="We cannot book right now. Please try again in a few minutes.")
    if payload.start not in free:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That time is no longer available. Please choose another.")
    organisation = await _organisation_name(db, study.account_id)
    participant.booked_start = payload.start
    participant.scheduled_at = svc.local(study, payload.start).strftime("%Y-%m-%dT%H:%M")
    try:
        await db.flush()  # the unique index refuses a slot booked a moment ago
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That time was just taken. Please choose another.")
    try:
        await svc.place_session(study, participant, moderator, payload.start, organisation)
    except calendar.CalendarError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="We could not add the session to the calendar, so it is not booked. Please try again.",
        )
    failure = await svc.send_confirmation(study, participant, moderator, organisation)
    if failure:
        participant.invite_error = f"Confirmation email failed: {failure}"
    else:
        participant.confirmation_sent_at = utc_now()
    await db.flush()
    out = await _booking_out(db, participant, study, [])
    await db.commit()
    return out
