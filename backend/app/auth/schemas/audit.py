"""Organisation audit log: read shapes for GET /tenants/{id}/audit-events.

``audit_events`` snapshots no actor name -- only ``actor_user_id`` -- so
``actor`` is resolved at read time and is None either when the event had no
actor (a platform action against the organisation) or when the user has
since been hard-deleted; the frontend renders that second case as "Deleted
user" rather than treating it as an error.
"""
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class AuditActor(BaseModel):
    id: UUID
    name: str | None = None
    email: str | None = None


class OrgAuditEventRead(BaseModel):
    id: UUID
    action: str
    actor: AuditActor | None
    target_type: str | None
    target_id: str | None
    metadata: dict[str, Any]
    timestamp: datetime


class OrgAuditPage(BaseModel):
    events: list[OrgAuditEventRead]
    has_more: bool
    next_before: datetime | None
