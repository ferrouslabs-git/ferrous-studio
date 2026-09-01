"""Studio ORM models.

A *project* is an analysis workspace inside an organisation. It owns
personas, UML diagrams, uploaded documents and
wireframes. A *wireframe* is its own studio document: its pages, op batches
and version snapshots hang off the wireframe, while the custom component
library stays on the project so every wireframe shares it.

Wireframe storage is one JSONB row *per page*, not one per wireframe.
Postgres cannot partially update JSONB -- any change rewrites and re-TOASTs
the whole value -- and every committed canvas action saves immediately, so the
unit of storage has to stay small.

Every table carries ``account_id`` -- the owning organisation -- even where it
is derivable (and even on the join table), because the row-level-security
policies (see the migration) and the leading index column both key on it. A
table without the policy reads as *empty*, not as an error.
"""
from datetime import datetime, UTC
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.database import Base


def utc_now() -> datetime:
    """Naive UTC, matching the auth module's DateTime columns."""
    return datetime.now(UTC).replace(tzinfo=None)


# ── Project ─────────────────────────────────────────────────────────────────


class Project(Base):
    """An analysis workspace inside an organisation. Small; changes rarely."""

    __tablename__ = "projects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    account_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    rationale = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="active")
    custom_components = Column(JSONB, nullable=False, default=list)
    schema_version = Column(String(10), nullable=False, default="1.0")
    version = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (Index("ix_projects_account_status", "account_id", "status"),)


# ── Personas ────────────────────────────────────────────────────────────────


class Persona(Base):
    """A user archetype the project designs for. The list fields are JSONB
    arrays of short strings so the UI can edit them as chips and the LLM
    export can emit them verbatim."""

    __tablename__ = "personas"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(255), nullable=False)
    role = Column(String(255), nullable=True)
    primary_interface = Column(String(64), nullable=True)
    traits = Column(JSONB, nullable=False, default=list)
    jobs_to_be_done = Column(JSONB, nullable=False, default=list)
    pain_points = Column(JSONB, nullable=False, default=list)
    feelings = Column(JSONB, nullable=False, default=list)
    notes = Column(Text, nullable=True)
    pos = Column(String(64), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (Index("ix_personas_account_project", "account_id", "project_id"),)


# ── Use case model ──────────────────────────────────────────────────────────


class UseCaseActor(Base):
    """A user type (UML actor) for the use case diagram: a role that
    interacts with the system, e.g. "Customer" or "Administrator"."""

    __tablename__ = "use_case_actors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    pos = Column(String(64), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (Index("ix_use_case_actors_account_project", "account_id", "project_id"),)


class UseCase(Base):
    """An action the system offers. ``actor_ids`` is a JSONB array of actor
    UUIDs (as strings) naming who can perform it: the diagram draws one line
    per entry. Deleting an actor scrubs it from every use case (see the
    route) rather than leaving dangling ids."""

    __tablename__ = "use_cases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    actor_ids = Column(JSONB, nullable=False, default=list)
    pos = Column(String(64), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (Index("ix_use_cases_account_project", "account_id", "project_id"),)


# ── Wireframes ──────────────────────────────────────────────────────────────


class Wireframe(Base):
    """One studio document: a named set of pages for an interface type,
    representing one or more personas."""

    __tablename__ = "wireframes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(255), nullable=False)
    interface_type = Column(String(16), nullable=False)  # desktop | tablet | mobile
    pos = Column(String(64), nullable=False)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (Index("ix_wireframes_account_project", "account_id", "project_id"),)


class WireframePersona(Base):
    """Which personas a wireframe represents. Carries ``account_id`` purely so
    the RLS policy can be expressed on it."""

    __tablename__ = "wireframe_personas"

    wireframe_id = Column(UUID(as_uuid=True), ForeignKey("wireframes.id", ondelete="CASCADE"), primary_key=True)
    persona_id = Column(UUID(as_uuid=True), ForeignKey("personas.id", ondelete="CASCADE"), primary_key=True)
    account_id = Column(UUID(as_uuid=True), nullable=False)

    __table_args__ = (Index("ix_wireframe_personas_account_persona", "account_id", "persona_id"),)


class WireframeActor(Base):
    """Which user types (use case diagram actors) a wireframe is designed for.
    Sits alongside ``WireframePersona``: a wireframe can be for one or more
    user types *and* one or more personas. Deleting an actor cascades the link."""

    __tablename__ = "wireframe_actors"

    wireframe_id = Column(UUID(as_uuid=True), ForeignKey("wireframes.id", ondelete="CASCADE"), primary_key=True)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("use_case_actors.id", ondelete="CASCADE"), primary_key=True)
    account_id = Column(UUID(as_uuid=True), nullable=False)

    __table_args__ = (Index("ix_wireframe_actors_account_actor", "account_id", "actor_id"),)


class ProjectPage(Base):
    """One wireframe page: the hot row. ``document`` holds its layout tree and
    components; ``entity_versions`` maps entity id -> page version at that
    entity's last change, for per-entity conflict detection. ``placement``
    (nullable JSONB ``{"page_id", "region_id"}``) makes this a child page that
    renders inside a region of its parent."""

    __tablename__ = "project_pages"

    id = Column(UUID(as_uuid=True), primary_key=True)  # client-generated
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    wireframe_id = Column(UUID(as_uuid=True), ForeignKey("wireframes.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(255), nullable=False)
    route = Column(String(255), nullable=True)
    pos = Column(String(64), nullable=False)  # fractional index; ordering among the wireframe's pages
    placement = Column(JSONB, nullable=True)
    document = Column(JSONB, nullable=False, default=dict)
    entity_versions = Column(JSONB, nullable=False, default=dict)
    version = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (Index("ix_project_pages_account_wireframe", "account_id", "wireframe_id"),)


class ProjectVersion(Base):
    """Append-only snapshot of a wireframe's assembled export envelope."""

    __tablename__ = "project_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    wireframe_id = Column(UUID(as_uuid=True), ForeignKey("wireframes.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    snapshot = Column(JSONB, nullable=False)
    label = Column(String(255), nullable=True)
    reason = Column(String(40), nullable=False)  # manual | before_replay | after_replay | before_conflict
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (
        Index("ix_project_versions_account_wireframe", "account_id", "wireframe_id", "created_at"),
    )


class ProjectOpBatch(Base):
    """Idempotency record for one applied op batch. A retry with the same
    ``client_batch_id`` returns the stored result instead of re-applying."""

    __tablename__ = "project_op_batches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    wireframe_id = Column(UUID(as_uuid=True), ForeignKey("wireframes.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    client_batch_id = Column(String(64), nullable=False)
    request_hash = Column(String(64), nullable=False)
    status_code = Column(Integer, nullable=False)
    response = Column(JSONB, nullable=False)
    applied_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("project_id", "client_batch_id", name="uq_project_op_batches_client"),
        Index("ix_project_op_batches_account_applied", "account_id", "applied_at"),
    )


# ── Diagrams ────────────────────────────────────────────────────────────────


class ProjectDiagram(Base):
    """A free-form UML diagram. ``xml`` is the maxGraph document the editor
    round-trips; ``model`` is the derived nodes/edges JSON the LLM export
    reads. Saved whole, guarded by ``version``."""

    __tablename__ = "project_diagrams"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(255), nullable=False)
    kind = Column(String(24), nullable=False)
    xml = Column(Text, nullable=False, default="")
    model = Column(JSONB, nullable=False, default=dict)
    version = Column(Integer, nullable=False, default=0)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (Index("ix_project_diagrams_account_project", "account_id", "project_id"),)


# ── Documents ───────────────────────────────────────────────────────────────


class ProjectDocument(Base):
    """Metadata for a file held in S3. ``pending`` until the browser's direct
    upload is confirmed against the object."""

    __tablename__ = "project_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    filename = Column(String(255), nullable=False)
    content_type = Column(String(127), nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    s3_key = Column(String(512), nullable=False, unique=True)
    status = Column(String(12), nullable=False, default="pending")  # pending | uploaded
    uploaded_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    confirmed_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_project_documents_account_project", "account_id", "project_id", "created_at"),)
