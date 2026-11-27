"""Usability booking: participants book their own session.

No database, like test_usability.py: these pin the pure rules (which slots
are offered, how email copy is filled in), the request shapes, and the Google
Calendar client against a fake Google (httpx.MockTransport).
"""
import json
import time
from datetime import datetime, timedelta
from urllib.parse import parse_qs

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import ValidationError

from app.auth.services.email_service import _branded_html
from app.studio.usability import agent_routes, booking_service, calendar
from app.studio.usability import content as rules
from app.studio.usability.models import Participant, Study
from app.studio.usability.schemas import (
    AgentParticipantWrite,
    AgentStudyPatch,
    AvailabilityIn,
    BookingIn,
    ParticipantWrite,
    StudyContent,
    StudyUpdate,
)

NOW = datetime(2026, 12, 1, 8, 0)


def at(hour: int, minute: int = 0, day: int = 3) -> datetime:
    return datetime(2026, 12, day, hour, minute)


# ── which slots are offered ─────────────────────────────────────────────────


def test_a_window_is_cut_into_session_long_slots_and_a_short_remainder_is_dropped():
    assert rules.slots([(at(9), at(11, 30))], 60, [], NOW) == [at(9), at(10)]
    assert rules.slots([(at(9), at(10))], 45, [], NOW) == [at(9)]
    assert rules.slots([(at(9), at(10))], 0, [], NOW) == []


def test_a_slot_already_started_or_overlapping_something_busy_is_not_offered():
    window = [(at(9), at(13))]
    assert rules.slots(window, 60, [], at(9, 30)) == [at(10), at(11), at(12)]
    # a booking 10:00-11:00 and a meeting 11:30-11:45 take 10:00 and 11:00
    busy = [(at(10), at(11)), (at(11, 30), at(11, 45))]
    assert rules.slots(window, 60, busy, NOW) == [at(9), at(12)]
    # touching, not overlapping, is free
    assert at(12) in rules.slots(window, 60, [(at(11), at(12))], NOW)


def test_overlapping_windows_offer_each_slot_once_in_order():
    windows = [(at(10), at(12)), (at(9), at(11)), (at(9, day=4), at(10, day=4))]
    assert rules.slots(windows, 60, [], NOW) == [at(9), at(10), at(11), at(9, day=4)]


# ── what an email says ──────────────────────────────────────────────────────


def test_email_copy_fills_known_placeholders_and_leaves_anything_else():
    values = {"name": "Sam", "study": "Pilot", "moderator": "Elliott", "organisation": "Acme", "duration": "an hour"}
    assert rules.render_copy("Hi {name}, {study} with {moderator}", values) == "Hi Sam, Pilot with Elliott"
    assert rules.render_copy("{unknown} {name", values) == "{unknown} {name"
    assert rules.render_copy("Hi {name}", {}) == "Hi "


def test_a_study_made_before_booking_gets_the_default_emails_and_keeps_its_own():
    content = rules.with_defaults({"protocol": ["Welcome."]})
    assert content["emails"]["invite"]["subject"] == rules.DEFAULT_EMAILS["invite"]["subject"]
    own = rules.with_defaults({"emails": {"confirmation": {"subject": "See you soon"}}})
    assert own["emails"]["confirmation"]["subject"] == "See you soon"
    assert own["emails"]["confirmation"]["body"] == rules.DEFAULT_EMAILS["confirmation"]["body"]
    assert StudyContent().emails.invite.body == rules.DEFAULT_EMAILS["invite"]["body"]
    assert rules.default_content("Acme")["emails"]["invite"]["subject"] == rules.DEFAULT_EMAILS["invite"]["subject"]


def test_email_html_escapes_every_value_a_person_or_participant_wrote():
    page = _branded_html(
        subject="<s>", eyebrow="e", heading="<script>alert(1)</script>", paragraphs=["Hi <b>Sam</b>"],
        facts=[("Join", "https://meet.google.com/abc"), ("With", "<i>x</i>")], button=("Go", 'https://x/"y'),
        closing=["<x>"], closing_link="https://x/book/t", footer="<f>", product_name="Studio", legal="<l>",
    )
    assert "<script>" not in page and "<b>Sam</b>" not in page and "<i>x</i>" not in page
    assert 'href="https://x/&quot;y"' in page  # a quote cannot break out of the link
    assert 'href="https://meet.google.com/abc"' in page


def test_session_times_are_written_in_the_studys_time_zone():
    study = Study(name="Pilot", session_minutes=60, timezone="Europe/London")
    assert booking_service.when(study, at(14)) == "Thursday 3 December 2026, 14:00 to 15:00 (GMT)"
    study.timezone = "America/New_York"
    assert booking_service.when(study, at(14)) == "Thursday 3 December 2026, 09:00 to 10:00 (EST)"


# ── what may be sent and set ────────────────────────────────────────────────


def test_a_window_runs_forwards_for_at_most_a_day_and_is_stored_as_utc():
    window = AvailabilityIn(starts_at="2026-12-03T09:00:00+01:00", ends_at="2026-12-03T12:00:00+01:00")
    assert (window.starts_at, window.ends_at) == (at(8), at(11))
    for bad in ({"starts_at": "2026-12-03T10:00:00Z", "ends_at": "2026-12-03T09:00:00Z"},
                {"starts_at": "2026-12-03T09:00:00Z", "ends_at": "2026-12-05T09:00:00Z"}):
        with pytest.raises(ValidationError):
            AvailabilityIn(**bad)
    assert BookingIn(start="2026-12-03T14:00:00Z").start == at(14)


def test_a_study_takes_a_real_time_zone_and_a_sensible_session_length():
    assert StudyUpdate(timezone="Europe/London", session_minutes=60).timezone == "Europe/London"
    for bad in ({"timezone": "Mars/Base"}, {"session_minutes": 0}, {"session_minutes": 1000}):
        with pytest.raises(ValidationError):
            StudyUpdate(**bad)


def test_a_contact_email_is_an_email_address_or_blank():
    assert ParticipantWrite(contact_email=" sam@example.com ").contact_email == "sam@example.com"
    assert ParticipantWrite(contact_email="").contact_email == ""
    with pytest.raises(ValidationError):
        ParticipantWrite(contact_email="not an email")


def test_an_agent_records_who_to_write_to_but_never_writes_the_emails_or_sees_the_booking_link():
    assert AgentParticipantWrite(name="Sam", contact_email="sam@example.com").model_fields_set == {"name", "contact_email"}
    for field in ("emails", "moderator_user_id", "session_minutes", "timezone"):
        assert field not in AgentStudyPatch.model_fields
        with pytest.raises(ValidationError):
            AgentStudyPatch(**{field: None})
    assert "booking_token" in agent_routes.SECRET_PARTICIPANT_FIELDS
    assert "send_invite" not in open(agent_routes.__file__, encoding="utf-8").read()


async def test_an_invite_is_not_sent_until_the_study_can_be_booked():
    study = Study(name="Pilot", content={}, session_minutes=None, timezone="Europe/London")
    participant = Participant(code="P1", token="t", contact_email="sam@example.com")
    assert await booking_service.send_invite(study, participant, None, [], "Acme") is False
    assert participant.invite_error.startswith("Before booking emails can go: choose a moderator, set the session length")
    assert participant.invite_sent_at is None
    nobody = Participant(code="P2", token="u")
    assert await booking_service.send_invite(study, nobody, None, [], "Acme") is False
    assert nobody.invite_error == "No contact email"


def test_the_booking_link_is_its_own_token_not_the_session_link():
    participant = Participant(code="P1", token="session-token")
    url = booking_service.booking_url(participant)
    assert "session-token" not in url and url.endswith("/book/" + participant.booking_token)
    assert booking_service.booking_url(participant) == url  # made once


# ── the moderator's Google calendar ─────────────────────────────────────────


@pytest.fixture
def google(monkeypatch):
    """A fake Google: records every request; answers from ``replies``."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", json.dumps({
        "client_email": "studio@project.iam.gserviceaccount.com", "private_key": pem, "private_key_id": "k1",
        "token_uri": "https://oauth2.googleapis.com/token",
    }))
    seen: list[httpx.Request] = []
    replies: dict[tuple[str, str], dict] = {}

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        return httpx.Response(200, json=replies.get((request.method, request.url.path), {}))

    calendar.set_transport(httpx.MockTransport(handle))
    yield seen, replies
    calendar.set_transport(None)


def test_without_a_key_the_calendar_is_not_connected(monkeypatch):
    monkeypatch.delenv("GOOGLE_SERVICE_ACCOUNT_JSON", raising=False)
    assert calendar.configured() is False
    monkeypatch.setenv("GOOGLE_SERVICE_ACCOUNT_JSON", "not json")
    assert calendar.configured() is False


async def test_the_calendar_acts_as_the_moderator(google):
    seen, replies = google
    replies[("GET", "/calendar/v3/calendars/primary/events")] = {"items": []}
    await calendar.busy("mod@ferrouslabs.co.uk", at(9), at(17))
    token_request = parse_qs(seen[0].content.decode())
    from jose import jwt as jose_jwt

    claims = jose_jwt.get_unverified_claims(token_request["assertion"][0])
    assert claims["sub"] == "mod@ferrouslabs.co.uk" and claims["scope"] == calendar.SCOPE
    assert claims["exp"] - claims["iat"] == 3600 and abs(claims["iat"] - time.time()) < 60
    assert seen[1].headers["Authorization"] == "Bearer tok"


async def test_busy_counts_real_events_but_not_free_declined_holds_or_the_participants_own(google):
    _seen, replies = google
    def event(eid, start, end, **extra):
        return {"id": eid, "start": {"dateTime": start}, "end": {"dateTime": end}, **extra}
    replies[("GET", "/calendar/v3/calendars/primary/events")] = {"items": [
        event("meeting", "2026-12-03T10:00:00+01:00", "2026-12-03T11:00:00+01:00"),
        event("free", "2026-12-03T12:00:00Z", "2026-12-03T13:00:00Z", transparency="transparent"),
        event("hold", "2026-12-03T09:00:00Z", "2026-12-03T17:00:00Z",
              extendedProperties={"private": {calendar.TAG: "hold"}}),
        event("declined", "2026-12-03T14:00:00Z", "2026-12-03T15:00:00Z",
              attendees=[{"email": "mod@x.com", "self": True, "responseStatus": "declined"}]),
        event("mine", "2026-12-03T15:00:00Z", "2026-12-03T16:00:00Z"),
        event("cancelled", "2026-12-03T16:00:00Z", "2026-12-03T17:00:00Z", status="cancelled"),
    ]}
    busy = await calendar.busy("mod@x.com", at(9), at(17), ignore={"mine"})
    assert busy == [(at(9), at(10))]  # 10:00+01:00 is 09:00 UTC


async def test_a_booked_session_invites_the_participant_with_a_meet_link_and_a_hold_invites_nobody(google):
    seen, replies = google
    replies[("POST", "/calendar/v3/calendars/primary/events")] = {"id": "ev1", "hangoutLink": "https://meet.google.com/x"}
    session = await calendar.create_session(
        "mod@x.com", summary="S", description="D", start=at(14), end=at(15), attendee="sam@example.com",
        timezone="Europe/London", study_id="s", participant_id="p",
    )
    assert (session.event_id, session.meet_url) == ("ev1", "https://meet.google.com/x")
    insert = seen[-1]
    body = json.loads(insert.content)
    assert insert.url.params["sendUpdates"] == "all" and insert.url.params["conferenceDataVersion"] == "1"
    assert body["attendees"] == [{"email": "sam@example.com"}]
    assert body["start"] == {"dateTime": "2026-12-03T14:00:00Z", "timeZone": "Europe/London"}
    assert body["conferenceData"]["createRequest"]["conferenceSolutionKey"] == {"type": "hangoutsMeet"}
    assert body["extendedProperties"]["private"][calendar.TAG] == "session"

    await calendar.create_hold("mod@x.com", summary="H", description="D", start=at(9), end=at(17),
                               timezone="Europe/London", study_id="s", window_id="w")
    hold = seen[-1]
    hold_body = json.loads(hold.content)
    assert hold.url.params["sendUpdates"] == "none" and "attendees" not in hold_body
    assert hold_body["transparency"] == "opaque" and hold_body["extendedProperties"]["private"][calendar.TAG] == "hold"


async def test_a_rebooking_moves_the_same_event_and_tells_the_guest(google):
    seen, replies = google
    replies[("PATCH", "/calendar/v3/calendars/primary/events/ev1")] = {"id": "ev1", "hangoutLink": "https://meet.google.com/x"}
    await calendar.move_session("mod@x.com", "ev1", start=at(10), end=at(11), timezone="Europe/London")
    assert seen[-1].method == "PATCH" and seen[-1].url.params["sendUpdates"] == "all"


async def test_google_refusing_is_a_calendar_error_and_a_missing_event_is_already_gone(monkeypatch, google):
    seen, _ = google

    def handle(request):
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        return httpx.Response(404 if request.method == "DELETE" else 403, json={})

    calendar.set_transport(httpx.MockTransport(handle))
    await calendar.cancel_session("mod@x.com", "gone")  # no error
    with pytest.raises(calendar.CalendarError):
        await calendar.busy("mod@x.com", at(9), at(10))


def test_free_slots_reads_the_moderators_calendar_only_when_connected():
    source = open(booking_service.__file__, encoding="utf-8").read()
    assert "if moderator is not None and calendar.configured() and reach:" in source
    assert timedelta(minutes=1) == calendar.range_of([(at(9), at(10))])[1] - at(10)


def test_deleting_a_study_takes_its_sessions_and_holds_off_the_calendar():
    import inspect

    from app.studio.usability import routes

    source = inspect.getsource(routes.delete_usability_study)
    assert source.index("booking.cancel_session(") < source.index("await db.delete(study)")
    assert source.index("booking.release(") < source.index("await db.delete(study)")


def test_slots_start_at_the_windows_start_and_leave_the_gap_between_them():
    # 14:00 to 17:00, 60-minute sessions
    assert rules.slots([(at(14), at(17))], 60, [], NOW) == [at(14), at(15), at(16)]
    # with a 15-minute gap: 14:00, 15:15; 16:30 would end at 17:30, past the window
    assert rules.slots([(at(14), at(17))], 60, [], NOW, gap=15) == [at(14), at(15, 15)]
    # the last slot needs no gap after it
    assert rules.slots([(at(14), at(16, 15))], 60, [], NOW, gap=15) == [at(14), at(15, 15)]
    # a slot already started is not offered (the Slots preview shows it as past)
    assert rules.slots([(at(14), at(17))], 60, [], at(14, 5)) == [at(15), at(16)]


def test_a_window_with_a_booking_in_it_cannot_change():
    import inspect

    from app.studio.usability import booking

    window = __import__("app.studio.usability.models", fromlist=["Availability"]).Availability(
        starts_at=at(14), ends_at=at(17)
    )
    inside = Participant(code="P1", token="t", booked_start=at(15))
    outside = Participant(code="P2", token="u", booked_start=at(17))
    assert booking_service.booked_in(window, [inside, outside]) == [inside]
    source = inspect.getsource(booking.update_usability_availability)
    assert source.index("svc.booked_in(") < source.index("window.starts_at, window.ends_at =")
    assert source.index("svc.release(") < source.index("svc.hold(")
    assert StudyUpdate(slot_gap_minutes=15).slot_gap_minutes == 15
    with pytest.raises(ValidationError):
        StudyUpdate(slot_gap_minutes=-5)
