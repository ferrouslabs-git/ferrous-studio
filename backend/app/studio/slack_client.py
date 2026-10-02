"""Talking to Slack as an installed app.

Each organisation installs the Ferrous Studio Slack app into its own workspace
through OAuth and gets its own bot token. Unlike the GitHub App -- where a
database row holds only a public id and every token is minted on demand --
Slack hands back a long-lived bot token, so it has to be stored. It is
encrypted at rest with a Fernet key held in the environment
(``SLACK_TOKEN_KEY``), which means a database dump on its own cannot post to
anyone's workspace.

Three things are checked here and nowhere else:

  * ``verify_request`` -- an interactivity request (the Approve / Reject
    buttons) is only trusted if Slack signed it with our signing secret and it
    is recent enough not to be a replay;
  * ``sign_state`` / ``verify_state`` -- the OAuth round-trip leaves our API and
    returns through the browser's address bar, so the callback is
    unauthenticated and the signed, expiring, browser-bound state is what names
    the organisation (the same shape as the GitHub flow);
  * ``encrypt_token`` / ``decrypt_token``.

Slack answers HTTP 200 with ``{"ok": false, "error": ...}`` for most failures,
so every call goes through ``_call``, which turns that into ``SlackError``.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import secrets
import time
from datetime import timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken

from app.auth.config import get_settings as get_auth_settings
from app.config import get_settings

API_BASE = "https://slack.com/api"
AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize"

#: ``chat:write`` posts as the bot; ``chat:write.public`` lets it post to a
#: public channel it has not been invited to; ``channels:read`` lists the
#: public channels for the picker.
SCOPES = ("chat:write", "chat:write.public", "channels:read")

#: Slack rejects requests whose timestamp is more than five minutes from now,
#: and so do we.
REQUEST_MAX_AGE_SECONDS = 60 * 5

STATE_TTL = timedelta(minutes=15)

REQUIRED_SETTINGS = (
    "slack_client_id",
    "slack_client_secret",
    "slack_signing_secret",
    "slack_token_key",
)


class SlackError(RuntimeError):
    """Slack refused a call, or could not be reached."""


class SlackNotConfigured(SlackError):
    pass


def missing_settings() -> list[str]:
    settings = get_settings()
    return [name.upper() for name in REQUIRED_SETTINGS if not getattr(settings, name)]


def configured() -> bool:
    return not missing_settings()


def _require_config() -> None:
    missing = missing_settings()
    if missing:
        raise SlackNotConfigured(f"Slack is not configured: set {', '.join(missing)}.")


def redirect_uri() -> str:
    """Where Slack returns the browser after the install.

    Must match a Redirect URL registered on the Slack app exactly, which is why
    it is built from one setting rather than from the incoming request.
    """
    return f"{get_auth_settings().frontend_url.rstrip('/')}/api/studio/slack/callback"


# ── Token at rest ───────────────────────────────────────────────────────────


def _fernet() -> Fernet:
    _require_config()
    try:
        return Fernet(get_settings().slack_token_key.encode("ascii"))
    except (ValueError, binascii.Error) as exc:
        raise SlackNotConfigured("SLACK_TOKEN_KEY is not a valid Fernet key.") from exc


def encrypt_token(token: str) -> str:
    return _fernet().encrypt(token.encode("utf-8")).decode("ascii")


def decrypt_token(stored: str) -> str:
    try:
        return _fernet().decrypt(stored.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        # Key rotated or the row was written under another environment's key:
        # the organisation has to reconnect, and the page says so.
        raise SlackError("The stored Slack token cannot be decrypted; reconnect Slack.") from exc


# ── Signed state for the OAuth round-trip ──────────────────────────────────


def _state_key() -> bytes:
    _require_config()
    return hashlib.sha256(get_settings().slack_client_secret.encode("utf-8")).digest()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(raw: str) -> bytes:
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def new_nonce() -> str:
    """Ties one state to one browser; its match lives in an HttpOnly cookie."""
    return secrets.token_urlsafe(32)


def sign_state(*, account_id: str, user_id: str, nonce: str) -> str:
    payload = json.dumps(
        {"a": account_id, "u": user_id, "n": nonce, "e": int(time.time() + STATE_TTL.total_seconds())},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    signature = hmac.new(_state_key(), payload, hashlib.sha256).digest()
    return f"{_b64(payload)}.{_b64(signature)}"


def verify_state(state: str) -> dict[str, Any]:
    """The claims inside ``state``, or a ValueError naming what was wrong."""
    try:
        encoded_payload, encoded_signature = state.split(".", 1)
        payload = _unb64(encoded_payload)
        signature = _unb64(encoded_signature)
    except (AttributeError, ValueError, binascii.Error) as exc:
        raise ValueError("Malformed state") from exc

    expected = hmac.new(_state_key(), payload, hashlib.sha256).digest()
    if not hmac.compare_digest(signature, expected):
        raise ValueError("State signature does not match")

    claims = json.loads(payload)
    if int(claims.get("e", 0)) < time.time():
        raise ValueError("State has expired")
    if not claims.get("n"):
        raise ValueError("State carries no nonce")
    return claims


def nonce_matches(claims: dict[str, Any], cookie_value: str | None) -> bool:
    if not cookie_value or not claims.get("n"):
        return False
    return hmac.compare_digest(str(claims["n"]), cookie_value)


def install_url(state: str) -> str:
    _require_config()
    return AUTHORIZE_URL + "?" + urlencode(
        {
            "client_id": get_settings().slack_client_id,
            "scope": ",".join(SCOPES),
            "redirect_uri": redirect_uri(),
            "state": state,
        }
    )


# ── Verifying a request from Slack ─────────────────────────────────────────


def verify_request(timestamp: str | None, body: bytes, signature: str | None, *, now: float | None = None) -> bool:
    """Whether ``body`` was signed by Slack with our signing secret.

    Slack signs ``v0:<timestamp>:<raw body>`` with HMAC-SHA256. The timestamp
    is part of what is signed, so an old request cannot be replayed with a new
    timestamp -- but it can be replayed as-is, hence the age check.
    """
    secret = get_settings().slack_signing_secret
    if not secret or not timestamp or not signature:
        return False
    try:
        age = abs((now if now is not None else time.time()) - int(timestamp))
    except ValueError:
        return False
    if age > REQUEST_MAX_AGE_SECONDS:
        return False
    basestring = b"v0:" + timestamp.encode("ascii", "ignore") + b":" + body
    expected = "v0=" + hmac.new(secret.encode("utf-8"), basestring, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# ── Calls ──────────────────────────────────────────────────────────────────


async def _call(method: str, *, token: str | None = None, data: dict[str, Any] | None = None, json_body: dict[str, Any] | None = None) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if json_body is not None:
                response = await client.post(f"{API_BASE}/{method}", headers=headers, json=json_body)
            else:
                response = await client.post(f"{API_BASE}/{method}", headers=headers, data=data or {})
    except httpx.HTTPError as exc:
        raise SlackError(f"Could not reach Slack: {exc}") from exc
    if response.status_code == 429:
        raise SlackError("Slack is rate limiting this app; try again shortly.")
    try:
        body = response.json()
    except ValueError as exc:
        raise SlackError(f"Slack returned an unreadable response ({response.status_code}).") from exc
    if not body.get("ok"):
        raise SlackError(str(body.get("error") or "unknown_error"))
    return body


async def exchange_code(code: str) -> dict[str, Any]:
    """Trade the OAuth ``code`` for the bot token and workspace identity."""
    _require_config()
    settings = get_settings()
    return await _call(
        "oauth.v2.access",
        data={
            "code": code,
            "client_id": settings.slack_client_id,
            "client_secret": settings.slack_client_secret,
            "redirect_uri": redirect_uri(),
        },
    )


async def revoke(token: str) -> None:
    """Best-effort: tell Slack the token is no longer wanted."""
    try:
        await _call("auth.revoke", token=token)
    except SlackError:
        pass


async def list_channels(token: str) -> list[dict[str, str]]:
    """Public, unarchived channels as ``{id, name}``, alphabetical."""
    channels: list[dict[str, str]] = []
    cursor = ""
    for _ in range(20):  # 20 pages of 200 is a workspace we should not be paging through
        data: dict[str, Any] = {"types": "public_channel", "exclude_archived": "true", "limit": "200"}
        if cursor:
            data["cursor"] = cursor
        body = await _call("conversations.list", token=token, data=data)
        channels.extend({"id": c["id"], "name": c["name"]} for c in body.get("channels", []))
        cursor = (body.get("response_metadata") or {}).get("next_cursor") or ""
        if not cursor:
            break
    return sorted(channels, key=lambda c: c["name"])


async def post_message(token: str, channel: str, text: str, blocks: list[dict[str, Any]] | None = None) -> str:
    """Post to ``channel``; returns the message ``ts`` (its id within the channel)."""
    payload: dict[str, Any] = {"channel": channel, "text": text, "unfurl_links": False}
    if blocks:
        payload["blocks"] = blocks
    body = await _call("chat.postMessage", token=token, json_body=payload)
    return str(body["ts"])


async def update_message(token: str, channel: str, ts: str, text: str, blocks: list[dict[str, Any]] | None = None) -> None:
    payload: dict[str, Any] = {"channel": channel, "ts": ts, "text": text, "blocks": blocks or []}
    await _call("chat.update", token=token, json_body=payload)
