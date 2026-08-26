"""Session revocation service functions."""
import hashlib
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.session import Session as AuthSession


def utc_now() -> datetime:
    """Return naive UTC datetime compatible with existing DB DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


def _hash_refresh_token(refresh_token: str) -> str:
    return hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()


async def create_user_session(
    db: AsyncSession,
    user_id: UUID,
    refresh_token: str,
    *,
    user_agent: str | None = None,
    ip_address: str | None = None,
    device_info: str | None = None,
    expires_at: datetime | None = None,
) -> AuthSession:
    """Create and persist a new refresh-token-backed session."""
    auth_session = AuthSession(
        user_id=user_id,
        refresh_token_hash=_hash_refresh_token(refresh_token),
        user_agent=user_agent,
        ip_address=ip_address,
        device_info=device_info,
        expires_at=expires_at,
    )
    db.add(auth_session)
    await db.commit()
    await db.refresh(auth_session)
    return auth_session


async def list_user_sessions(
    db: AsyncSession,
    user_id: UUID,
    *,
    include_revoked: bool = False,
    limit: int = 50,
) -> list[AuthSession]:
    """Return most recent sessions for a user, newest first."""
    stmt = select(AuthSession).where(AuthSession.user_id == user_id)
    if not include_revoked:
        stmt = stmt.where(AuthSession.revoked_at.is_(None))
    stmt = stmt.order_by(AuthSession.created_at.desc()).limit(limit)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def validate_refresh_session(
    db: AsyncSession,
    user_id: UUID,
    session_id: UUID,
    refresh_token: str,
) -> AuthSession | None:
    """Validate refresh token against an active, non-expired session."""
    result = await db.execute(
        select(AuthSession).where(
            AuthSession.id == session_id,
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None),
        )
    )
    auth_session = result.scalar_one_or_none()

    if not auth_session:
        return None

    if auth_session.expires_at and auth_session.expires_at <= utc_now():
        return None

    if auth_session.refresh_token_hash != _hash_refresh_token(refresh_token):
        return None

    return auth_session


async def rotate_user_session(
    db: AsyncSession,
    user_id: UUID,
    session_id: UUID,
    old_refresh_token: str,
    new_refresh_token: str,
    *,
    user_agent: str | None = None,
    ip_address: str | None = None,
    device_info: str | None = None,
    expires_at: datetime | None = None,
) -> AuthSession | None:
    """Rotate refresh token by revoking old session and creating a replacement."""
    existing = await validate_refresh_session(db, user_id, session_id, old_refresh_token)
    if not existing:
        return None

    existing.revoked_at = utc_now()

    replacement = AuthSession(
        user_id=user_id,
        refresh_token_hash=_hash_refresh_token(new_refresh_token),
        user_agent=user_agent or existing.user_agent,
        ip_address=ip_address or existing.ip_address,
        device_info=device_info or existing.device_info,
        expires_at=expires_at or existing.expires_at,
    )
    db.add(replacement)
    await db.commit()
    await db.refresh(replacement)
    return replacement


async def revoke_user_session(db: AsyncSession, user_id: UUID, session_id: UUID) -> AuthSession | None:
    """Revoke a specific session if it belongs to the user and is active."""
    result = await db.execute(
        select(AuthSession).where(
            AuthSession.id == session_id,
            AuthSession.user_id == user_id,
            AuthSession.revoked_at.is_(None),
        )
    )
    auth_session = result.scalar_one_or_none()

    if not auth_session:
        return None

    auth_session.revoked_at = utc_now()
    await db.commit()
    await db.refresh(auth_session)
    return auth_session


async def revoke_all_user_sessions(
    db: AsyncSession,
    user_id: UUID,
    except_session_id: UUID | None = None,
) -> int:
    """Revoke all active sessions for a user and return number revoked."""
    stmt = select(AuthSession).where(
        AuthSession.user_id == user_id,
        AuthSession.revoked_at.is_(None),
    )

    if except_session_id:
        stmt = stmt.where(AuthSession.id != except_session_id)

    result = await db.execute(stmt)
    sessions = result.scalars().all()
    if not sessions:
        return 0

    now = utc_now()
    for auth_session in sessions:
        auth_session.revoked_at = now

    await db.commit()
    return len(sessions)
