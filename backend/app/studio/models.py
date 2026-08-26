"""Studio ORM models.

Storage is one JSONB row *per page*, not one per project. Postgres cannot
partially update JSONB -- any change rewrites and re-TOASTs the whole value --
and every committed canvas action saves immediately, so the unit of storage
has to stay small. The project row holds only metadata and the custom
component library; the assembled export envelope is built at read time.

Every table carries ``space_id`` even where it is derivable, because the
row-level-security policies (see the migration) and the leading index column
both key on it.
"""
from datetime import datetime, UTC
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base


def utc_now() -> datetime:
    """Naive UTC, matching the auth module's DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


class Project(Base):
    """A wireframing project inside a workspace. Small; changes rarely."""

    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    space_id = Column(UUID(as_uuid=True), ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="active")
    custom_components = Column(JSONB, nullable=False, default=list)
    schema_version = Column(String(10), nullable=False, default="1.0")
    version = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (Index("ix_projects_space_status", "space_id", "status"),)


class ProjectPage(Base):
    """One wireframe page: the hot row. ``document`` holds its frames, regions
    and components; ``entity_versions`` maps entity id -> page version at that
    entity's last change, for per-entity conflict detection."""

    __tablename__ = "project_pages"

    id = Column(UUID(as_uuid=True), primary_key=True)  # client-generated
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    space_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(255), nullable=False)
    route = Column(String(255), nullable=True)
    pos = Column(String(64), nullable=False)  # fractional index; ordering among the project's pages
    document = Column(JSONB, nullable=False, default=dict)
    entity_versions = Column(JSONB, nullable=False, default=dict)
    version = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (Index("ix_project_pages_space_project", "space_id", "project_id"),)


class ProjectVersion(Base):
    """Append-only snapshot of the assembled export envelope."""

    __tablename__ = "project_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    space_id = Column(UUID(as_uuid=True), nullable=False)
    snapshot = Column(JSONB, nullable=False)
    label = Column(String(255), nullable=True)
    reason = Column(String(40), nullable=False)  # manual | before_replay | after_replay | before_conflict
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (Index("ix_project_versions_space_project", "space_id", "project_id", "created_at"),)


class ProjectOpBatch(Base):
    """Idempotency record for one applied op batch. A retry with the same
    ``client_batch_id`` returns the stored result instead of re-applying."""

    __tablename__ = "project_op_batches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    space_id = Column(UUID(as_uuid=True), nullable=False)
    client_batch_id = Column(String(64), nullable=False)
    request_hash = Column(String(64), nullable=False)
    status_code = Column(Integer, nullable=False)
    response = Column(JSONB, nullable=False)
    applied_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("project_id", "client_batch_id", name="uq_project_op_batches_client"),
        Index("ix_project_op_batches_space_applied", "space_id", "applied_at"),
    )
