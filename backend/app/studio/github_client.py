"""Talking to GitHub as a GitHub App.

This is a GitHub *App*, not an OAuth App, and the difference is the whole
reason there is no secret in our database. An OAuth App would hand back a
long-lived user token that we would have to encrypt at rest, rotate and
revoke; an App installation gives us an ``installation_id`` -- which is not a
secret, and is useless without our private key -- and every call mints a fresh
token that GitHub expires an hour later. So the row we store is inert, and a
database dump leaks no access to anyone's code.

Two credentials, in sequence, as GitHub requires:

  1. an *app JWT*, signed here with the App's private key, which identifies
     Ferrous Studio itself and may only read app-level endpoints;
  2. an *installation token*, bought with that JWT, which is what actually
     reads repositories -- and only the ones the organisation granted.

The network calls block, so everything here is async and goes through httpx.
``GitHubNotConfigured`` mirrors ``storage.StorageNotConfigured``: an
environment with no App set up reports the Repository section as unavailable
rather than raising 500s at the user.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlencode

import httpx
from jose import jwt

from app.config import get_settings

from .models import utc_now

#: Sent on every request. GitHub dates its REST API and warns on unversioned
#: calls; pinning means a future default cannot change a response shape under us.
API_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

#: An app JWT may live at most 10 minutes. Nine leaves room for clock skew at
#: both ends without GitHub rejecting it as expired-on-arrival.
APP_JWT_TTL = timedelta(minutes=9)

#: GitHub's clocks are not ours. Backdating ``iat`` avoids "issued in the
#: future" rejections on a task whose clock runs slightly fast.
CLOCK_SKEW = timedelta(seconds=60)

#: Installation tokens last an hour. Re-mint with five minutes to spare so a
#: token cannot expire midway through a request that already started.
TOKEN_REFRESH_MARGIN = timedelta(minutes=5)

REQUEST_TIMEOUT = httpx.Timeout(10.0, connect=5.0)

#: Repositories are listed a page at a time; this many pages is 1000 repos,
#: far past what a picker can usefully show, and bounds a pathological account.
MAX_REPO_PAGES = 10


class GitHubNotConfigured(RuntimeError):
    """No GitHub App is set up for this deployment."""


class GitHubError(RuntimeError):
    """GitHub answered, but not with what we asked for.

    ``status`` is carried so callers can tell "the installation is gone" (404)
    from "GitHub is having a bad day" (5xx) and say something useful.
    """

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Repository:
    """One repository, flattened to what the picker and the details card need."""

    id: int
    full_name: str
    private: bool
    default_branch: str
    html_url: str
    description: str | None
    pushed_at: str | None


#: Everything the flow needs. The OAuth pair is not optional: the App must have
#: "Request user authorization (OAuth) during installation" turned on, because
#: that is what lets the callback verify the installation it is handed (see
#: ``user_has_installation``). A deployment missing any of these reports the
#: Repository section as unavailable rather than offering a flow that breaks
#: halfway through, on GitHub's side, where we can no longer explain ourselves.
REQUIRED_SETTINGS = (
    "github_app_id",
    "github_app_slug",
    "github_app_private_key",
    "github_client_id",
    "github_client_secret",
)


def missing_settings() -> list[str]:
    settings = get_settings()
    return [name.upper() for name in REQUIRED_SETTINGS if not getattr(settings, name)]


def configured() -> bool:
    return not missing_settings()


def _require_config() -> None:
    if not configured():
        raise GitHubNotConfigured(f"{', '.join(missing_settings())} not set")


def web_base() -> str:
    """Where a browser goes, as opposed to where the API lives.

    github.com and api.github.com are different hosts; GitHub Enterprise
    Server instead hangs its API off ``/api/v3`` of the same host. Deriving
    this from the API base keeps GHES working without a second setting.
    """
    api = get_settings().github_api_base
    if api == "https://api.github.com":
        return "https://github.com"
    return api.removesuffix("/api/v3")


# ── Credentials ─────────────────────────────────────────────────────────────


def _app_jwt() -> str:
    """A short-lived assertion that we are this GitHub App.

    RS256 against the App's private key -- GitHub holds only the public half,
    so this cannot be forged without the key, and it is never stored anywhere.
    """
    _require_config()
    settings = get_settings()
    now = time.time()
    claims = {
        "iat": int(now - CLOCK_SKEW.total_seconds()),
        "exp": int(now + APP_JWT_TTL.total_seconds()),
        "iss": settings.github_app_id,
    }
    try:
        return jwt.encode(claims, settings.github_app_private_key, algorithm="RS256")
    except Exception as exc:  # jose raises several unrelated types for a bad key
        raise GitHubNotConfigured(f"GITHUB_APP_PRIVATE_KEY is not a usable RSA private key: {exc}") from exc


#: installation id -> (token, expiry). Per process, like storage's boto client.
#: Losing it on a deploy costs one extra round trip, so it needs no coordination
#: between tasks; a lock keeps a burst of concurrent requests from each minting
#: their own.
_token_cache: dict[int, tuple[str, datetime]] = {}
_token_locks: dict[int, asyncio.Lock] = {}


async def installation_token(installation_id: int) -> str:
    """A token that can read this installation's repositories, and nothing else."""
    cached = _token_cache.get(installation_id)
    if cached and cached[1] - TOKEN_REFRESH_MARGIN > utc_now():
        return cached[0]

    lock = _token_locks.setdefault(installation_id, asyncio.Lock())
    async with lock:
        # Re-check: another request may have minted one while we waited.
        cached = _token_cache.get(installation_id)
        if cached and cached[1] - TOKEN_REFRESH_MARGIN > utc_now():
            return cached[0]

        base = get_settings().github_api_base
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.post(
                f"{base}/app/installations/{installation_id}/access_tokens",
                headers={**API_HEADERS, "Authorization": f"Bearer {_app_jwt()}"},
            )
        if response.status_code == 404:
            raise GitHubError(
                "This organisation's GitHub installation no longer exists.", status=404
            )
        if response.status_code >= 400:
            raise GitHubError(_detail(response), status=response.status_code)

        body = response.json()
        expires = _parse_time(body.get("expires_at")) or (utc_now() + timedelta(hours=1))
        _token_cache[installation_id] = (body["token"], expires)
        return body["token"]


def forget_installation(installation_id: int) -> None:
    """Drop a cached token, so disconnecting takes effect immediately."""
    _token_cache.pop(installation_id, None)
    _token_locks.pop(installation_id, None)


# ── Requests ────────────────────────────────────────────────────────────────


def _detail(response: httpx.Response) -> str:
    try:
        message = response.json().get("message")
    except ValueError:
        message = None
    return message or f"GitHub returned {response.status_code}"


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        # Naive UTC, to compare against datetime.now() the way the rest of the
        # studio stores times.
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


async def _get(path: str, token: str, params: dict[str, Any] | None = None) -> Any:
    base = get_settings().github_api_base
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.get(
            f"{base}{path}",
            headers={**API_HEADERS, "Authorization": f"Bearer {token}"},
            params=params,
        )
    if response.status_code >= 400:
        raise GitHubError(_detail(response), status=response.status_code)
    return response.json()


def _repository(raw: dict[str, Any]) -> Repository:
    return Repository(
        id=int(raw["id"]),
        full_name=raw["full_name"],
        private=bool(raw.get("private")),
        default_branch=raw.get("default_branch") or "main",
        html_url=raw.get("html_url") or "",
        description=raw.get("description"),
        pushed_at=raw.get("pushed_at"),
    )


async def get_installation(installation_id: int) -> dict[str, Any]:
    """The installation itself: which GitHub account it is on, and how much of
    it we were granted. Read with the app JWT, not an installation token."""
    _require_config()
    return await _get(f"/app/installations/{installation_id}", _app_jwt())


async def delete_installation(installation_id: int) -> None:
    """Uninstall the App from this installation.

    Only an app-level credential (the JWT) can do this -- an installation
    token cannot revoke itself. Without this, "disconnecting" only forgets our
    own pointer while the App stays installed on GitHub's side, which makes a
    later reconnect silently no-op instead of showing GitHub's consent screen
    again. A 404 means it is already gone, which is the outcome we wanted, so
    that is treated as success rather than an error.
    """
    _require_config()
    base = get_settings().github_api_base
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.delete(
            f"{base}/app/installations/{installation_id}",
            headers={**API_HEADERS, "Authorization": f"Bearer {_app_jwt()}"},
        )
    if response.status_code in (204, 404):
        return
    raise GitHubError(_detail(response), status=response.status_code)


async def list_repositories(installation_id: int) -> list[Repository]:
    """Every repository this installation can see, most recently pushed first.

    That ordering is the useful one for a picker: the repository someone is
    about to link is almost always one they have touched lately.
    """
    token = await installation_token(installation_id)
    repos: list[Repository] = []
    for page in range(1, MAX_REPO_PAGES + 1):
        body = await _get("/installation/repositories", token, {"per_page": 100, "page": page})
        batch = body.get("repositories") or []
        repos.extend(_repository(raw) for raw in batch)
        if len(batch) < 100:
            break
    repos.sort(key=lambda r: r.pushed_at or "", reverse=True)
    return repos


async def get_repository(installation_id: int, full_name: str) -> Repository:
    token = await installation_token(installation_id)
    return _repository(await _get(f"/repos/{full_name}", token))


async def get_repository_by_id(installation_id: int, repo_id: int) -> Repository:
    """A repository by its numeric id, which is what a link actually stores.

    Looking it up by name would break the moment someone renames or transfers
    the repository -- the name is a label, the id is the thing. Fetching by id
    means a rename shows up as a changed ``full_name`` in the answer rather
    than as a 404 we would have to report as "gone".
    """
    token = await installation_token(installation_id)
    return _repository(await _get(f"/repositories/{repo_id}", token))


async def latest_commit(installation_id: int, full_name: str, branch: str) -> dict[str, Any] | None:
    """The tip of ``branch``, or None if the branch has no commits we can see."""
    token = await installation_token(installation_id)
    body = await _get(f"/repos/{full_name}/commits", token, {"sha": branch, "per_page": 1})
    if not body:
        return None
    head = body[0]
    commit = head.get("commit") or {}
    author = commit.get("author") or {}
    return {
        "sha": head.get("sha", "")[:7],
        "message": (commit.get("message") or "").split("\n", 1)[0][:200],
        "author": author.get("name"),
        "committed_at": author.get("date"),
        "html_url": head.get("html_url"),
    }


# ── The install redirect, and getting safely back ───────────────────────────
#
# Installing is a top-level browser navigation, so the request that comes back
# carries no bearer token and no scope headers -- our whole API contract is
# absent. The ``state`` parameter is therefore the only thing that says who
# started the flow, which makes it a credential: it is signed, it names exactly
# one organisation and user, and it expires.

#: Long enough to install an App (including creating a GitHub organisation
#: mid-flow), short enough that a signed state left in a browser history or a
#: referrer log is worthless by the time anyone finds it.
STATE_TTL = timedelta(minutes=15)


def _state_key() -> bytes:
    """The HMAC key for state signatures, derived from the App's private key.

    Deriving rather than adding a second secret is deliberate: every task in
    the service already has the private key, so every task agrees on this
    without new configuration, and a state signed by one ECS task verifies on
    another. The digest is one-way, so a leaked state reveals nothing about the
    key it came from.
    """
    _require_config()
    return hashlib.sha256(get_settings().github_app_private_key.encode("utf-8")).digest()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(raw: str) -> bytes:
    return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))


def new_nonce() -> str:
    """An unguessable value tying one state to one browser.

    The signature proves a state came from us and names one organisation; it
    cannot prove the browser finishing the install is the browser that started
    it. A state travels in a URL -- browser history, a Referer header, a pasted
    link -- so anyone who obtains one could otherwise complete the flow with
    their own installation and bind it to the organisation named inside. The
    matching half of this lives in a cookie the browser only sends back to us.
    """
    return secrets.token_urlsafe(32)


def sign_state(*, account_id: str, user_id: str, nonce: str) -> str:
    payload = json.dumps(
        {
            "a": account_id,
            "u": user_id,
            "n": nonce,
            "e": int(time.time() + STATE_TTL.total_seconds()),
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    signature = hmac.new(_state_key(), payload, hashlib.sha256).digest()
    return f"{_b64(payload)}.{_b64(signature)}"


def verify_state(state: str) -> dict[str, Any]:
    """The claims inside ``state``, or a ValueError naming what was wrong.

    Every failure here means the callback cannot be trusted to say which
    organisation it belongs to, so the caller must refuse rather than guess.
    """
    try:
        encoded_payload, encoded_signature = state.split(".", 1)
        payload = _unb64(encoded_payload)
        signature = _unb64(encoded_signature)
    except (AttributeError, ValueError, binascii.Error) as exc:
        raise ValueError("Malformed state") from exc

    expected = hmac.new(_state_key(), payload, hashlib.sha256).digest()
    # compare_digest, not ==: a short-circuiting comparison leaks how much of a
    # forged signature was right, one byte at a time.
    if not hmac.compare_digest(signature, expected):
        raise ValueError("State signature does not match")

    claims = json.loads(payload)
    if int(claims.get("e", 0)) < time.time():
        raise ValueError("State has expired")
    # Fail closed on a state with no nonce: one could only come from a build
    # that predates the browser binding, and accepting it would reopen the hole.
    if not claims.get("n"):
        raise ValueError("State carries no nonce")
    return claims


def nonce_matches(claims: dict[str, Any], cookie_value: str | None) -> bool:
    """Whether the cookie the browser sent back matches the state it carries."""
    if not cookie_value or not claims.get("n"):
        return False
    return hmac.compare_digest(str(claims["n"]), cookie_value)


def install_url(state: str) -> str:
    """Where the browser goes to choose an account and grant repositories."""
    _require_config()
    slug = get_settings().github_app_slug
    return f"{web_base()}/apps/{slug}/installations/new?{urlencode({'state': state})}"


def settings_url(installation_id: int, account_login: str | None) -> str:
    """Where someone goes to change which repositories we may see.

    Which page that is depends on whether the App was installed on a personal
    account or an organisation, and only the latter has an ``/organizations/``
    path -- so callers pass what they stored and get the right one.
    """
    if account_login:
        return f"{web_base()}/organizations/{account_login}/settings/installations/{installation_id}"
    return f"{web_base()}/settings/installations/{installation_id}"


# ── Proving the caller owns the installation ────────────────────────────────


async def exchange_user_code(code: str) -> str:
    """Trade the callback's ``code`` for a user access token.

    Used once, immediately, and never stored. Its only job is to answer the
    next question: does this person actually have the installation they just
    handed us?
    """
    settings = get_settings()
    if not (settings.github_client_id and settings.github_client_secret):
        raise GitHubNotConfigured("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are not set")

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        response = await client.post(
            f"{web_base()}/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.github_client_id,
                "client_secret": settings.github_client_secret,
                "code": code,
            },
        )
    if response.status_code >= 400:
        raise GitHubError(_detail(response), status=response.status_code)

    body = response.json()
    # GitHub reports OAuth failures as 200 with an error body, so the status
    # code alone is not enough to know this worked.
    token = body.get("access_token")
    if not token:
        raise GitHubError(body.get("error_description") or "GitHub declined the authorisation")
    return token


async def user_has_installation(user_token: str, installation_id: int) -> bool:
    """Whether the authorising user can see this installation themselves.

    This is what stops an installation id being replayed. ``installation_id``
    reaches the callback as a plain query parameter, so on its own it proves
    nothing -- anyone could substitute another organisation's. Asking GitHub
    which installations *this user* has closes that: they can only ever link
    an installation they already have access to.
    """
    for page in range(1, MAX_REPO_PAGES + 1):
        body = await _get("/user/installations", user_token, {"per_page": 100, "page": page})
        installations = body.get("installations") or []
        if any(int(entry.get("id", 0)) == installation_id for entry in installations):
            return True
        if len(installations) < 100:
            return False
    return False
