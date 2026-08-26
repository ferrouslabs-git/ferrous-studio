"""Persistent audit event model for security-sensitive actions."""
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import JSON, Column, DateTime, String
from sqlalchemy.dialects.postgresql import UUID

from ..database import Base


def utc_now() -> datetime:
    """Return naive UTC datetime compatible with existing DB DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


class AuditEvent(Base):
    """Durable audit event record."""

    __tablename__ = "audit_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    timestamp = Column(DateTime, nullable=False, default=utc_now, index=True)
    actor_user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    tenant_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    action = Column(String(100), nullable=False, index=True)
    target_type = Column(String(100), nullable=True)
    target_id = Column(String(255), nullable=True)
    ip_address = Column(String(64), nullable=True)
    metadata_json = Column(JSON, nullable=False, default=dict)

