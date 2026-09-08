"""Board ORM models (phase 3): the live delivery board hanging off a project
lineage. See alembic/versions/d4f7b2a9c631_board_schema.py for the schema
rationale and what was deliberately not ported from SMA.

One ``boards`` row per (account_id, lineage_id) -- not per ``projects`` row,
because a project row *is* one version and versioning deep-copies it. The
board is live operational state; the versioned project rows are the design
record. Human ids (E3, REQ-12, S1, ...) are minted from the per-entity
counter columns on ``boards`` under a row lock -- the same pattern
wireframes.note_seq/task_seq already uses -- and are never stored on the
entity rows themselves, only the raw ``seq`` int; the API layer formats it.
"""
from datetime import datetime, UTC, date
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

from ..models import Base, utc_now

__all__ = [
    "utc_now",
    "Board",
    "Release",
    "Epic",
    "Feature",
    "Sprint",
    "Requirement",
    "RequirementSprintHistory",
    "Doc",
    "Comment",
    "Event",
    "Attachment",
    "BoardToken",
    "AgentRun",
]


class Board(Base):
    __tablename__ = "boards"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    account_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    lineage_id = Column(UUID(as_uuid=True), nullable=False)
    release_seq = Column(Integer, nullable=False, default=0)
    epic_seq = Column(Integer, nullable=False, default=0)
    feature_seq = Column(Integer, nullable=False, default=0)
    requirement_seq = Column(Integer, nullable=False, default=0)
    sprint_seq = Column(Integer, nullable=False, default=0)
    doc_seq = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (UniqueConstraint("account_id", "lineage_id", name="uq_boards_account_lineage"),)


class Release(Base):
    """SMA calls this a "milestone"; renamed per the go-live plan."""

    __tablename__ = "board_releases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    seq = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    release_date = Column(Date, nullable=True)
    description = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (UniqueConstraint("board_id", "seq", name="uq_board_releases_seq"),)

    @property
    def human_id(self) -> str:
        return f"REL{self.seq}"


class Epic(Base):
    PHASES = ("Now", "Next", "Later")

    __tablename__ = "board_epics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    seq = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    summary = Column(Text, nullable=False, default="")
    phase = Column(String(10), nullable=False, default="Later")
    release_id = Column(UUID(as_uuid=True), ForeignKey("board_releases.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("board_id", "seq", name="uq_board_epics_seq"),
        Index("ix_board_epics_release", "release_id"),
    )

    @property
    def human_id(self) -> str:
        return f"E{self.seq}"


class Feature(Base):
    __tablename__ = "board_features"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    epic_id = Column(UUID(as_uuid=True), ForeignKey("board_epics.id", ondelete="CASCADE"), nullable=False)
    seq = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("board_id", "seq", name="uq_board_features_seq"),
        Index("ix_board_features_epic", "epic_id"),
    )

    @property
    def human_id(self) -> str:
        return f"F{self.seq}"


class Sprint(Base):
    STATES = ("planned", "active", "done")

    __tablename__ = "board_sprints"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    seq = Column(Integer, nullable=False)
    name = Column(String(255), nullable=False)
    goal = Column(Text, nullable=False, default="")
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    state = Column(String(10), nullable=False, default="planned")
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (UniqueConstraint("board_id", "seq", name="uq_board_sprints_seq"),)

    @property
    def human_id(self) -> str:
        return f"S{self.seq}"


class Requirement(Base):
    STATUSES = ("Todo", "Doing", "Done")
    PRIORITIES = ("Low", "Medium", "High", "Urgent")

    __tablename__ = "board_requirements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    seq = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False, default="")
    epic_id = Column(UUID(as_uuid=True), ForeignKey("board_epics.id", ondelete="SET NULL"), nullable=True)
    feature_id = Column(UUID(as_uuid=True), ForeignKey("board_features.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(10), nullable=False, default="Todo")
    priority = Column(String(10), nullable=False, default="Medium")
    assignee_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    release_id = Column(UUID(as_uuid=True), ForeignKey("board_releases.id", ondelete="SET NULL"), nullable=True)
    sprint_id = Column(UUID(as_uuid=True), ForeignKey("board_sprints.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("board_id", "seq", name="uq_board_requirements_seq"),
        Index("ix_board_requirements_epic", "epic_id"),
        Index("ix_board_requirements_feature", "feature_id"),
        Index("ix_board_requirements_sprint", "sprint_id"),
        Index("ix_board_requirements_release", "release_id"),
        Index("ix_board_requirements_status", "status"),
    )

    @property
    def human_id(self) -> str:
        return f"REQ-{self.seq}"


class RequirementSprintHistory(Base):
    """One row per sprint-membership change; burndown reconstructs
    as-of-day state from this rather than the requirement's current sprint.
    Written on create (initial sprint, even NULL) and on update only when
    sprint_id actually changes -- see service.py."""

    __tablename__ = "board_requirement_sprint_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    requirement_id = Column(UUID(as_uuid=True), ForeignKey("board_requirements.id", ondelete="CASCADE"), nullable=False)
    sprint_id = Column(UUID(as_uuid=True), ForeignKey("board_sprints.id", ondelete="SET NULL"), nullable=True)
    started_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (
        Index("ix_board_rsh_requirement", "requirement_id", "started_at"),
        Index("ix_board_rsh_sprint", "sprint_id", "started_at"),
    )


class Doc(Base):
    __tablename__ = "board_docs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    seq = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False, default="")
    tags = Column(ARRAY(String), nullable=False, default=list)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (UniqueConstraint("board_id", "seq", name="uq_board_docs_seq"),)

    @property
    def human_id(self) -> str:
        return f"D{self.seq}"


class Comment(Base):
    """entity_id is deliberately not FK'd -- see service.py's entity-existence
    check (a UNION ALL probe, mirroring SMA's own comments.entity_id)."""

    ENTITY_TYPES = ("release", "epic", "feature", "requirement", "sprint", "doc")

    __tablename__ = "board_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    entity_type = Column(String(20), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (Index("ix_board_comments_entity", "entity_type", "entity_id"),)


class Event(Base):
    __tablename__ = "board_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action = Column(String(64), nullable=False)
    entity_type = Column(String(20), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    detail = Column(JSONB, nullable=False, default=dict)
    created_at = Column(DateTime, default=utc_now, nullable=False)

    __table_args__ = (
        Index("ix_board_events_entity", "entity_type", "entity_id"),
        Index("ix_board_events_board_created", "board_id", "created_at"),
    )


class Attachment(Base):
    """Doesn't exist in SMA -- designed fresh, reusing storage.py's S3
    helpers and documents.py's pending/uploaded confirmation pattern."""

    ENTITY_TYPES = ("release", "epic", "feature", "requirement", "doc")
    STATUSES = ("pending", "uploaded")

    __tablename__ = "board_attachments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    entity_type = Column(String(20), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    filename = Column(String(255), nullable=False)
    content_type = Column(String(128), nullable=False)
    size_bytes = Column(BigInteger, nullable=False)
    s3_key = Column(String(512), nullable=False, unique=True)
    status = Column(String(10), nullable=False, default="pending")
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (Index("ix_board_attachments_entity", "entity_type", "entity_id"),)


class BoardToken(Base):
    """A credential for a non-browser client (an agent) -- shown once at
    creation, stored only as a hash. Resolves to board:read/board:write on
    this one board only, never the platform bypass's full-permission
    shortcut. See app/studio/board/agents.py."""

    __tablename__ = "board_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    label = Column(String(255), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    last_used_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)


class AgentRun(Base):
    """One queued/running/finished attempt at a requirement. Not wired to a
    real ECS launch unless AGENT_ECS_CLUSTER/AGENT_TASK_DEFINITION are set
    (app/config.py) -- see agents.py's launch_agent_task."""

    STATUSES = ("queued", "running", "done", "failed", "cancelled")

    __tablename__ = "agent_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    requirement_id = Column(UUID(as_uuid=True), ForeignKey("board_requirements.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(12), nullable=False, default="queued")
    ecs_task_arn = Column(String(512), nullable=True)
    error = Column(Text, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    started_at = Column(DateTime, nullable=True)
    heartbeat_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (
        Index("ix_agent_runs_requirement", "requirement_id"),
        Index("ix_agent_runs_board_status", "board_id", "status"),
    )
