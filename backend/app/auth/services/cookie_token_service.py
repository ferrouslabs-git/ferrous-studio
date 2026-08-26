"""
Cookie-based refresh token service.

Handles setting/clearing the HttpOnly refresh token cookie and proxying
token refresh requests to Cognito on behalf of the frontend.

Security note: Refresh tokens are stored as-is because Cognito requires
the original value for token refresh calls.  The opaque ``cookie_key``
(a random 43-char URL-safe string) is the security boundary — it is
never sent to Cognito and only travels in an HttpOnly/Secure/SameSite
cookie.
"""
import json
from datetime import datetime, timedelta, UTC
import secrets

import httpx
from fastapi import Response
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.refresh_token import RefreshTokenStore

DEFAULT_COOKIE_NAME = "auth_refresh_token"
DEFAULT_CSRF_COOKIE_NAME = "auth_csrf_token"
DEFAULT_COOKIE_PATH = "/auth/token"
COOKIE_MAX_AGE = 30 * 24 * 60 * 60  # 30 days in seconds


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


async def _purge_expired_tokens(db: AsyncSession) -> None:
    now = _utc_now()
    await db.execute(sa_delete(RefreshTokenStore).where(RefreshTokenStore.expires_at <= now))


async def store_refresh_token(db: AsyncSession, refresh_token: str) -> str:
    """Store refresh token server-side and return a short opaque cookie key."""
    key = secrets.token_urlsafe(32)
    expires_at = _utc_now() + timedelta(seconds=COOKIE_MAX_AGE)
    await _purge_expired_tokens(db)
    db.add(
        RefreshTokenStore(
            cookie_key=key,
            refresh_token=refresh_token,
            expires_at=expires_at,
        )
    )
    await db.commit()
    return key


async def get_refresh_token(db: AsyncSession, cookie_key: str) -> str | None:
    """Resolve an opaque cookie key to a live Cognito refresh token."""
    if not cookie_key:
        return None
    await _purge_expired_tokens(db)
    result = await db.execute(
        select(RefreshTokenStore).where(RefreshTokenStore.cookie_key == cookie_key)
    )
    row = result.scalar_one_or_none()
    if not row:
        return None
    return row.refresh_token


async def rotate_refresh_token(db: AsyncSession, cookie_key: str, new_refresh_token: str) -> str:
    """Rotate stored refresh token and return a new cookie key."""
    new_key = await store_refresh_token(db, new_refresh_token)
    await db.execute(
        sa_delete(RefreshTokenStore).where(RefreshTokenStore.cookie_key == cookie_key)
    )
    await db.commit()
    return new_key


async def revoke_refresh_token(db: AsyncSession, cookie_key: str) -> None:
    """Revoke an opaque cookie key from the server-side refresh store."""
    if not cookie_key:
        return
    await db.execute(
        sa_delete(RefreshTokenStore).where(RefreshTokenStore.cookie_key == cookie_key)
    )
    await db.commit()


def set_refresh_cookie(
    response: Response,
    cookie_key: str,
    *,
    secure: bool = True,
    cookie_name: str = DEFAULT_COOKIE_NAME,
    cookie_path: str = DEFAULT_COOKIE_PATH,
) -> None:
    """Attach an HttpOnly opaque refresh-key cookie to a FastAPI response."""
    response.set_cookie(
        key=cookie_name,
        value=cookie_key,
        httponly=True,
        secure=secure,
        samesite="strict",
        path=cookie_path,
        max_age=COOKIE_MAX_AGE,
    )


def clear_refresh_cookie(
    response: Response,
    *,
    secure: bool = True,
    cookie_name: str = DEFAULT_COOKIE_NAME,
    cookie_path: str = DEFAULT_COOKIE_PATH,
) -> None:
    """Expire the refresh-token cookie by setting max_age=0."""
    response.set_cookie(
        key=cookie_name,
        value="",
        httponly=True,
        secure=secure,
        samesite="strict",
        path=cookie_path,
        max_age=0,
    )


def generate_csrf_token() -> str:
    """Return a cryptographically random CSRF token."""
    return secrets.token_urlsafe(32)


def set_csrf_cookie(
    response: Response,
    csrf_token: str,
    *,
    secure: bool = True,
    csrf_cookie_name: str = DEFAULT_CSRF_COOKIE_NAME,
    cookie_path: str = DEFAULT_COOKIE_PATH,
) -> None:
    """Attach a readable (non-HttpOnly) CSRF token cookie to a FastAPI response."""
    response.set_cookie(
        key=csrf_cookie_name,
        value=csrf_token,
        httponly=False,  # JS must be able to read this cookie
        secure=secure,
        samesite="strict",
        path=cookie_path,
        max_age=COOKIE_MAX_AGE,
    )


def clear_csrf_cookie(
    response: Response,
    *,
    secure: bool = True,
    csrf_cookie_name: str = DEFAULT_CSRF_COOKIE_NAME,
    cookie_path: str = DEFAULT_COOKIE_PATH,
) -> None:
    """Expire the CSRF token cookie."""
    response.set_cookie(
        key=csrf_cookie_name,
        value="",
        httponly=False,
        secure=secure,
        samesite="strict",
        path=cookie_path,
        max_age=0,
    )


async def call_cognito_refresh_async(
    refresh_token: str, cognito_domain: str, client_id: str,
) -> dict:
    """Async version — exchange refresh token via httpx.AsyncClient.

    Returns the parsed JSON response dict on success.
    Raises ValueError if Cognito returns an error.
    """
    url = f"{cognito_domain}/oauth2/token"
    data = {
        "grant_type": "refresh_token",
        "client_id": client_id,
        "refresh_token": refresh_token,
    }

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                url,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=10,
            )
        except httpx.HTTPError as exc:
            raise ValueError(f"Cognito token refresh request failed: {exc}") from exc

    if resp.status_code >= 400:
        try:
            err = resp.json()
        except Exception:
            err = {"error": resp.text}
        raise ValueError(
            err.get("error_description") or err.get("error") or "Cognito token refresh failed"
        )

    result = resp.json()
    if "error" in result:
        raise ValueError(
            result.get("error_description") or result.get("error") or "Cognito token refresh failed"
        )

    return result
