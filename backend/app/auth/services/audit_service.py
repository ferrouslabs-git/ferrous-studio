"""
Security/audit event logging utilities.
"""
import json
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.audit_event import AuditEvent

logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    """Return naive UTC datetime compatible with current log payload expectations."""
    return datetime.now(UTC).replace(tzinfo=None)


def _parse_uuid(value: str | UUID | None) -> UUID | None:
    """Safely parse UUID-like values used in audit event payloads."""
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        return None


async def list_audit_events(
    db: AsyncSession,
    *,
    action: str | None = None,
    actor_user_id: str | None = None,
    tenant_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Query audit events with optional filters."""
    stmt = select(AuditEvent)

    if action:
        stmt = stmt.where(AuditEvent.action == action)
    if actor_user_id:
        parsed = _parse_uuid(actor_user_id)
        if parsed:
            stmt = stmt.where(AuditEvent.actor_user_id == parsed)
    if tenant_id:
        parsed = _parse_uuid(tenant_id)
        if parsed:
            stmt = stmt.where(AuditEvent.tenant_id == parsed)

    stmt = stmt.order_by(AuditEvent.timestamp.desc()).offset(offset).limit(limit)
    result = await db.execute(stmt)
    events = result.scalars().all()

    return [
        {
            "id": str(e.id),
            "timestamp": e.timestamp.isoformat() if e.timestamp else None,
            "action": e.action,
            "actor_user_id": str(e.actor_user_id) if e.actor_user_id else None,
            "tenant_id": str(e.tenant_id) if e.tenant_id else None,
            "target_type": e.target_type,
            "target_id": e.target_id,
            "ip_address": e.ip_address,
            "metadata": e.metadata_json or {},
        }
        for e in events
    ]


async def log_audit_event(
    event: str,
    actor_user_id: str | UUID | None = None,
    db: AsyncSession | None = None,
    **details: Any,
) -> None:
    """
    Emit a structured audit log entry and optionally persist it to database.

    Persistence is best-effort so auth flows never fail due to audit storage issues.
    """
    timestamp = utc_now()
    payload = {
        "timestamp": timestamp.isoformat(),
        "event": event,
        "actor_user_id": str(actor_user_id) if actor_user_id else None,
        "details": details,
    }
    logger.info("AUDIT %s", json.dumps(payload, default=str))

    if db is None:
        return

    tenant_id = _parse_uuid(details.get("tenant_id"))
    parsed_actor_user_id = _parse_uuid(actor_user_id)
    target_type = details.get("target_type")
    target_id = details.get("target_id")
    ip_address = details.get("ip_address")

    try:
        db.add(
            AuditEvent(
                timestamp=timestamp,
                actor_user_id=parsed_actor_user_id,
                tenant_id=tenant_id,
                action=event,
                target_type=str(target_type) if target_type else None,
                target_id=str(target_id) if target_id else None,
                ip_address=str(ip_address) if ip_address else None,
                metadata_json=details,
            )
        )
        await db.flush()
    except Exception:
        logger.exception("Failed to persist audit event", extra={"event": event})
