"""Background cleanup service for expired data.

Removes stale rows that accumulate over time:
- Expired refresh tokens
- Expired/revoked invitations older than 30 days
- Rate-limit hits older than 24 hours
- Audit events older than configurable retention period

Host Integration Contract
-------------------------
- Host owns: DB engine, session factory, scheduling (cron / Celery / CloudWatch)
- Module owns: cleanup query logic
- Caller provides an ``AsyncSession`` — this module never creates one.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete as sa_delete, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.audit_event import AuditEvent
from ..models.invitation import Invitation
from ..models.rate_limit_hit import RateLimitHit
from ..models.refresh_token import RefreshTokenStore

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


@dataclass
class CleanupResult:
    """Summary of rows removed by a single cleanup run."""

    refresh_tokens: int = 0
    invitations: int = 0
    rate_limit_hits: int = 0
    audit_events: int = 0


async def purge_expired_refresh_tokens(db: AsyncSession) -> int:
    """Delete refresh tokens whose ``expires_at`` is in the past."""
    now = _utc_now()
    result = await db.execute(
        sa_delete(RefreshTokenStore).where(RefreshTokenStore.expires_at < now)
    )
    await db.flush()
    return result.rowcount


async def purge_stale_invitations(db: AsyncSession, *, older_than_days: int = 30) -> int:
    """Delete expired or revoked invitations older than *older_than_days*."""
    cutoff = _utc_now() - timedelta(days=older_than_days)
    now = _utc_now()
    result = await db.execute(
        sa_delete(Invitation).where(
            Invitation.created_at < cutoff,
            (Invitation.expires_at < now) | (Invitation.revoked_at.isnot(None)),
        )
    )
    await db.flush()
    return result.rowcount


async def purge_old_rate_limit_hits(db: AsyncSession, *, older_than_hours: int = 24) -> int:
    """Delete rate-limit hit records older than *older_than_hours*."""
    cutoff = _utc_now() - timedelta(hours=older_than_hours)
    result = await db.execute(
        sa_delete(RateLimitHit).where(RateLimitHit.hit_at < cutoff)
    )
    await db.flush()
    return result.rowcount


async def purge_old_audit_events(db: AsyncSession, *, older_than_days: int = 365) -> int:
    """Delete audit events older than *older_than_days*."""
    if older_than_days <= 0:
        return 0
    cutoff = _utc_now() - timedelta(days=older_than_days)
    result = await db.execute(
        sa_delete(AuditEvent).where(AuditEvent.timestamp < cutoff)
    )
    await db.flush()
    return result.rowcount


async def run_cleanup(
    db: AsyncSession,
    *,
    invitation_days: int = 30,
    rate_limit_hours: int = 24,
    audit_retention_days: int = 365,
) -> CleanupResult:
    """Execute all cleanup tasks in a single transaction.

    The caller is responsible for committing or rolling back the session
    afterwards.
    """
    result = CleanupResult(
        refresh_tokens=await purge_expired_refresh_tokens(db),
        invitations=await purge_stale_invitations(db, older_than_days=invitation_days),
        rate_limit_hits=await purge_old_rate_limit_hits(db, older_than_hours=rate_limit_hours),
        audit_events=await purge_old_audit_events(db, older_than_days=audit_retention_days),
    )

    logger.info(
        "Cleanup complete: refresh_tokens=%d, invitations=%d, rate_limit_hits=%d, audit_events=%d",
        result.refresh_tokens,
        result.invitations,
        result.rate_limit_hits,
        result.audit_events,
    )
    return result
