"""The moderator's Google calendar, for booked sessions and the times offered.

A Google Cloud service account with domain-wide delegation acts as the
moderator (``sub``): Studio creates each booked session on the moderator's own
calendar, with the participant as a guest and a Meet link, so Google sends the
participant the invite. Each window of time offered for booking is held on
that calendar as a busy event, so nothing else is booked over it, and the
calendar is read before a time is offered, so a time the moderator is busy
for is never offered.

Configured by ``GOOGLE_SERVICE_ACCOUNT_JSON`` (the service account's JSON key).
Without it every call here is skipped (``configured()`` is False): booking
still works, with no calendar event and no calendar check.

No Google client library: the JWT assertion is signed with python-jose and
the REST calls go through httpx, both already dependencies. Tests swap the
transport (``set_transport``).
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from jose import jwt

logger = logging.getLogger(__name__)

SCOPE = "https://www.googleapis.com/auth/calendar.events"
API = "https://www.googleapis.com/calendar/v3"
#: Private extended property on every event Studio writes: "hold" or "session".
TAG = "ferrous_usability"

_transport: httpx.AsyncBaseTransport | None = None
_tokens: dict[str, tuple[str, float]] = {}


class CalendarError(Exception):
    """A calendar call failed; the message is fit to show a person."""


@dataclass
class Session:
    event_id: str
    meet_url: str


def set_transport(transport: httpx.AsyncBaseTransport | None) -> None:
    """For tests: send every request to this transport instead of Google."""
    global _transport
    _transport = transport
    _tokens.clear()


def _key() -> dict[str, Any] | None:
    raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        return None
    try:
        key = json.loads(raw)
    except ValueError:
        logger.error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON")
        return None
    return key if key.get("client_email") and key.get("private_key") else None


def configured() -> bool:
    return _key() is not None


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=_transport, timeout=20.0)


async def _token(subject: str) -> str:
    """An access token acting as ``subject`` (the moderator), cached until
    a minute before it expires."""
    cached = _tokens.get(subject)
    if cached and cached[1] > time.time():
        return cached[0]
    key = _key()
    if key is None:
        raise CalendarError("Google Calendar is not connected")
    token_uri = key.get("token_uri") or "https://oauth2.googleapis.com/token"
    now = int(time.time())
    assertion = jwt.encode(
        {"iss": key["client_email"], "sub": subject, "scope": SCOPE, "aud": token_uri, "iat": now, "exp": now + 3600},
        key["private_key"],
        algorithm="RS256",
        headers={"kid": key.get("private_key_id", "")},
    )
    async with _client() as client:
        response = await client.post(
            token_uri,
            data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        )
    if response.status_code != 200:
        logger.error("Google token exchange failed", extra={"status": response.status_code, "body": response.text[:500]})
        raise CalendarError(
            f"Google refused to act as {subject} -- check the service account's domain-wide delegation "
            "and that the moderator is a user in that Google Workspace"
        )
    body = response.json()
    _tokens[subject] = (body["access_token"], time.time() + int(body.get("expires_in", 3600)) - 60)
    return body["access_token"]


async def _call(subject: str, method: str, path: str, *, params: dict | None = None, body: dict | None = None) -> dict:
    token = await _token(subject)
    async with _client() as client:
        response = await client.request(
            method, f"{API}{path}", params=params, json=body, headers={"Authorization": f"Bearer {token}"}
        )
    if method == "DELETE" and response.status_code in (404, 410):
        return {}  # already gone
    if response.status_code >= 400:
        logger.error(
            "Google Calendar call failed",
            extra={"method": method, "path": path, "status": response.status_code, "body": response.text[:500]},
        )
        raise CalendarError(f"Google Calendar refused the change ({response.status_code})")
    return response.json() if response.content else {}


def _rfc3339(at: datetime) -> str:
    """Naive UTC to RFC 3339."""
    return at.replace(microsecond=0).isoformat() + "Z"


def _parse(value: dict) -> datetime:
    """An event's start or end as naive UTC. An all-day event's date is taken
    as midnight UTC."""
    if "dateTime" in value:
        at = datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00"))
        return at.astimezone(timezone.utc).replace(tzinfo=None) if at.tzinfo else at
    return datetime.fromisoformat(value["date"])


def _counts_as_busy(event: dict, subject: str, ignore: set[str]) -> bool:
    if event.get("id") in ignore or event.get("status") == "cancelled":
        return False
    if event.get("transparency") == "transparent":
        return False  # marked "free"
    if (event.get("extendedProperties") or {}).get("private", {}).get(TAG) == "hold":
        return False  # Studio's own hold on offered times
    for attendee in event.get("attendees") or []:
        if (attendee.get("self") or attendee.get("email", "").lower() == subject.lower()) and (
            attendee.get("responseStatus") == "declined"
        ):
            return False
    return True


async def busy(subject: str, start: datetime, end: datetime, *, ignore: set[str] | None = None) -> list[tuple[datetime, datetime]]:
    """When the moderator is busy between ``start`` and ``end`` (naive UTC):
    every event on their primary calendar except ones marked free, ones
    they declined, Studio's holds, and the event ids in ``ignore``."""
    ignore = ignore or set()
    out: list[tuple[datetime, datetime]] = []
    page: str | None = None
    while True:
        params = {
            "timeMin": _rfc3339(start), "timeMax": _rfc3339(end), "singleEvents": "true",
            "maxResults": "2500", "orderBy": "startTime",
        }
        if page:
            params["pageToken"] = page
        body = await _call(subject, "GET", "/calendars/primary/events", params=params)
        for event in body.get("items", []):
            if _counts_as_busy(event, subject, ignore) and event.get("start") and event.get("end"):
                out.append((_parse(event["start"]), _parse(event["end"])))
        page = body.get("nextPageToken")
        if not page:
            return out


async def create_session(
    subject: str, *, summary: str, description: str, start: datetime, end: datetime, attendee: str,
    timezone: str, study_id: str, participant_id: str,
) -> Session:
    """A session on the moderator's calendar with the participant as guest and
    a Meet link. Google emails the participant the invite."""
    body = await _call(
        subject, "POST", "/calendars/primary/events",
        params={"conferenceDataVersion": "1", "sendUpdates": "all"},
        body={
            "summary": summary,
            "description": description,
            "start": {"dateTime": _rfc3339(start), "timeZone": timezone},
            "end": {"dateTime": _rfc3339(end), "timeZone": timezone},
            "attendees": [{"email": attendee}],
            "conferenceData": {
                "createRequest": {"requestId": uuid.uuid4().hex, "conferenceSolutionKey": {"type": "hangoutsMeet"}}
            },
            "extendedProperties": {"private": {TAG: "session", "study": study_id, "participant": participant_id}},
            "guestsCanModify": False,
            "guestsCanInviteOthers": False,
        },
    )
    return Session(event_id=body["id"], meet_url=body.get("hangoutLink", ""))


async def move_session(subject: str, event_id: str, *, start: datetime, end: datetime, timezone: str) -> Session:
    """A rebooking: the same event moved, so the guest's invite updates."""
    body = await _call(
        subject, "PATCH", f"/calendars/primary/events/{event_id}",
        params={"sendUpdates": "all"},
        body={
            "start": {"dateTime": _rfc3339(start), "timeZone": timezone},
            "end": {"dateTime": _rfc3339(end), "timeZone": timezone},
        },
    )
    return Session(event_id=body.get("id", event_id), meet_url=body.get("hangoutLink", ""))


async def cancel_session(subject: str, event_id: str) -> None:
    await _call(subject, "DELETE", f"/calendars/primary/events/{event_id}", params={"sendUpdates": "all"})


async def create_hold(
    subject: str, *, summary: str, description: str, start: datetime, end: datetime, timezone: str,
    study_id: str, window_id: str,
) -> str:
    """A busy block on the moderator's calendar for a window offered for
    booking. No guests, so nobody is emailed."""
    body = await _call(
        subject, "POST", "/calendars/primary/events",
        params={"sendUpdates": "none"},
        body={
            "summary": summary,
            "description": description,
            "start": {"dateTime": _rfc3339(start), "timeZone": timezone},
            "end": {"dateTime": _rfc3339(end), "timeZone": timezone},
            "transparency": "opaque",
            "extendedProperties": {"private": {TAG: "hold", "study": study_id, "window": window_id}},
        },
    )
    return body["id"]


async def delete_hold(subject: str, event_id: str) -> None:
    await _call(subject, "DELETE", f"/calendars/primary/events/{event_id}", params={"sendUpdates": "none"})


def range_of(windows: list[tuple[datetime, datetime]]) -> tuple[datetime, datetime] | None:
    """The span a calendar check must cover."""
    if not windows:
        return None
    return min(s for s, _ in windows), max(e for _, e in windows) + timedelta(minutes=1)
