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
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

from ..models import Base, utc_now
from .statuses import DELIVERY_STATUSES, WORK_STATUSES

__all__ = [
    "utc_now",
    "DELIVERY_STATUSES",
    "WORK_STATUSES",
    "Board",
    "Release",
    "Epic",
    "Feature",
    "Sprint",
    "Requirement",
    "Environment",
    "Feedback",
    "RequirementSprintHistory",
    "Doc",
    "Comment",
    "Event",
    "Attachment",
    "BoardToken",
    "AgentRun",
    "Agent",
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
    feedback_seq = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (UniqueConstraint("account_id", "lineage_id", name="uq_boards_account_lineage"),)


class Release(Base):
    """SMA calls this a "milestone"; renamed per the go-live plan.

    Deliberately carries no date column of its own (ported from
    software-management, 2026-09-07): a release's date is the end of the
    latest sprint filed under it (service.release_dates_map), so "when does
    this land?" is answered by the sprints actually planned to deliver it,
    and moving a sprint moves the release automatically. The prior design
    (an editable date nothing checked against the sprint plan) let the two
    drift apart. See service.py's release_dates_map for the computation.
    """

    __tablename__ = "board_releases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    seq = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)
    deleted_at = Column(DateTime, nullable=True)
    # How far this release has been pushed towards live -- one of
    # statuses.DELIVERY_STATUSES, set by hand and deliberately non-linear:
    # a release may go back to ToTest after DeployedToUAT, and nothing
    # objects. Replaced the standalone "Mark shipped" toggle on 2026-09-14.
    status = Column(String(20), nullable=False, default="NotStarted")
    # When the release first reached DeployedToLive. Stamped by the route,
    # never cleared by going back: the date it went out stays true even if
    # the status later moves on. NULL = has not been live yet.
    shipped_at = Column(DateTime, nullable=True)

    __table_args__ = (UniqueConstraint("board_id", "seq", name="uq_board_releases_seq"),)

    @property
    def human_id(self) -> str:
        return f"REL{self.seq}"


class Epic(Base):
    """An epic carries no status column: its status is rolled up from the
    requirements under it -- direct, or via one of its features -- by
    statuses.roll_up_status, and served read-only (routes.py's
    _epic_status_map). Set 2026-09-14, replacing a hand-advanced
    Readiness/Implementation/ReleasedToUAT/HumanValidation/Done lifecycle
    ported from software-management. That lifecycle was a second, unchecked
    claim about the same work the requirements already described, and the
    two drifted; how far an epic has got is now answered in one place.

    Where the epic has been *deployed* is a different question, and it is
    the release's and the sprint's to answer -- see DELIVERY_STATUSES.
    """

    __tablename__ = "board_epics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    seq = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    summary = Column(Text, nullable=False, default="")
    release_id = Column(UUID(as_uuid=True), ForeignKey("board_releases.id", ondelete="SET NULL"), nullable=True)
    # Who is looking after this epic -- a different question from who is
    # doing each of its requirements, which is often nobody yet.
    assignee_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)
    deleted_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("board_id", "seq", name="uq_board_epics_seq"),
        Index("ix_board_epics_release", "release_id"),
    )

    @property
    def human_id(self) -> str:
        return f"E{self.seq}"


class Feature(Base):
    """Like Epic, carries no status column -- rolled up from its own
    requirements by statuses.roll_up_status and served read-only."""

    __tablename__ = "board_features"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    epic_id = Column(UUID(as_uuid=True), ForeignKey("board_epics.id", ondelete="CASCADE"), nullable=False)
    seq = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    assignee_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)
    deleted_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("board_id", "seq", name="uq_board_features_seq"),
        Index("ix_board_features_epic", "epic_id"),
    )

    @property
    def human_id(self) -> str:
        return f"F{self.seq}"


class Sprint(Base):
    """Several sprints may be active at once (software-management,
    2026-09-04): starting one used to demote every other active sprint back
    to 'planned', but agents are assigned per sprint, so a single live
    sprint would make every agent work the same one. The Scrum constraint
    that actually matters survives -- an agent has a scalar sprint_id, so
    no single worker is ever split across concurrent sprints.

    ``capacity_hours`` stays nullable: NULL means "not set", and the UI
    shows its own default (``?? 80``) rather than the database inventing
    one."""

    __tablename__ = "board_sprints"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    seq = Column(Integer, nullable=False)
    name = Column(String(255), nullable=False)
    goal = Column(Text, nullable=False, default="")
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    # How far the sprint's work has been pushed towards live -- one of
    # statuses.DELIVERY_STATUSES. Purely a label: it is set by hand, is
    # non-linear, and NOTHING keys off it. Replaced the old
    # planned/active/done ``state`` on 2026-09-14, whose values carried
    # side effects (only an "active" sprint could be worked; "done" emptied
    # it) that a freely-settable label must not.
    status = Column(String(20), nullable=False, default="NotStarted")
    # What those side effects moved to: closing a sprint returns its
    # unfinished requirements to the backlog and locks the board; agents
    # work any sprint that is not closed. NULL = open.
    closed_at = Column(DateTime, nullable=True)
    # Which release this sprint is planned to deliver -- also what makes a
    # release's date computable at all (Release's docstring/
    # service.release_dates_map: a release's date is the end of its latest
    # sprint). Ported from software-management, which had this from the
    # start; Ferrous Studio's board port originally missed it entirely.
    release_id = Column(UUID(as_uuid=True), ForeignKey("board_releases.id", ondelete="SET NULL"), nullable=True)
    capacity_hours = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)
    deleted_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("board_id", "seq", name="uq_board_sprints_seq"),
        Index("ix_board_sprints_release", "release_id"),
    )

    @property
    def human_id(self) -> str:
        return f"S{self.seq}"


class Requirement(Base):
    """The one thing on the board that carries a work status of its own:
    everything above it (features, epics) rolls its status up from these.

    ``Blocked`` is a flag, not a stage on the normal NotStarted ->
    InProgress -> ToTest -> Done path -- a requirement can be blocked from
    any of the three in-flight stages. ``blocked_from`` records which one,
    so unblocking returns it there rather than losing that context; it is
    computed automatically on the status transition (routes.py's
    update_requirement), never set directly by a client. Ported from
    software-management (store.py, static/js/reqpane.js's rqpStatusPatch);
    the values were renamed from Todo/Doing/Review on 2026-09-14."""

    STATUSES = WORK_STATUSES
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
    status = Column(String(20), nullable=False, default="NotStarted")
    blocked_from = Column(String(20), nullable=True)
    priority = Column(String(10), nullable=False, default="Medium")
    assignee_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    release_id = Column(UUID(as_uuid=True), ForeignKey("board_releases.id", ondelete="SET NULL"), nullable=True)
    sprint_id = Column(UUID(as_uuid=True), ForeignKey("board_sprints.id", ondelete="SET NULL"), nullable=True)
    # Effort estimate, in HOURS. Nullable on purpose: NULL means "not estimated
    # yet", which is a real state and must never be conflated with zero.
    # ``Float`` (double precision), deliberately not ``Numeric``: psycopg maps
    # numeric to decimal.Decimal, which is not JSON-serialisable and would
    # break every response that carries a requirement.
    #
    # Carried over from software-management, whose effort rollups and
    # capacity-vs-committed sprint lane are built on it. Nothing in this app
    # surfaces it yet -- it exists so estimates survive the import rather than
    # being silently dropped.
    estimate_hours = Column(Float, nullable=True)
    # Work order within the requirement's sprint -- what an agent picks
    # work by, and the sprint board's row order. NULL = not ordered (sorts
    # last). Scoped to a sprint, so it is cleared whenever the requirement
    # leaves one (routes.py's update_requirement/delete_sprint and
    # service.close_sprint). Ported from software-management.
    queue_position = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)
    deleted_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("board_id", "seq", name="uq_board_requirements_seq"),
        Index("ix_board_requirements_epic", "epic_id"),
        Index("ix_board_requirements_feature", "feature_id"),
        Index("ix_board_requirements_sprint", "sprint_id"),
        Index("ix_board_requirements_release", "release_id"),
        Index("ix_board_requirements_status", "status"),
        Index(
            "ix_board_requirements_queue",
            "sprint_id",
            "queue_position",
            postgresql_where=text("queue_position IS NOT NULL"),
        ),
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


class Environment(Base):
    """Where a build of this product can be reached: one row per environment
    that has actually been given a URL.

    Lives on the board -- keyed on the lineage -- rather than on the project
    row, because a deployed environment is one address for the whole product,
    not a fact about one frozen design version. Storing it per version would
    hand v1 and v2 different UAT links and leave a locked version unable to
    correct a wrong one.

    An absent row means "not set up yet"; the URL is never blank.
    """

    SLUGS = ("uat", "staging", "production")

    __tablename__ = "board_environments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    slug = Column(String(16), nullable=False)
    url = Column(String(1024), nullable=False)
    updated_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (UniqueConstraint("board_id", "slug", name="uq_board_environments_slug"),)


class Feedback(Base):
    """Something an organisation user noticed in a running environment.

    Deliberately not a Requirement: this is what was reported, in the words of
    whoever reported it, against the environment they saw it in. An admin
    triages it, and only what survives triage becomes board work -- so a report
    carries no epic, sprint or assignee of its own.

    ``raised_by_name``/``raised_by_email`` snapshot the reporter at write time,
    the same way ``WireframeAuditLog`` does, so a report still says who filed
    it after that person leaves the organisation.

    ``severity`` is the reporter's claim about impact, which is why it sits
    beside ``kind`` and not beside ``status``. An admin may correct it exactly
    as they may correct a title; what they may not do is let it stand in for a
    decision. ``status`` remains the only thing triage moves, and
    ``FeedbackCreate`` still refuses to accept one.

    ``page_url`` is the exact page, the environment being only the base. ``''``
    means "not given" -- unlike ``Environment``, where an absent *row* is the
    unset state and the URL is never blank.
    """

    ENVIRONMENTS = ("uat", "staging", "production")
    KINDS = ("feedback", "bug", "requirement")
    SEVERITIES = ("low", "medium", "high", "critical")
    STATUSES = ("New", "Triaged", "Accepted", "Declined", "Done")

    __tablename__ = "board_feedback"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    seq = Column(Integer, nullable=False)
    environment = Column(String(16), nullable=False)
    kind = Column(String(16), nullable=False, default="feedback")
    severity = Column(String(16), nullable=False, default="medium")
    title = Column(String(255), nullable=False)
    detail = Column(Text, nullable=False, default="")
    page_url = Column(String(1024), nullable=False, default="")
    status = Column(String(10), nullable=False, default="New")
    raised_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    raised_by_name = Column(String(255), nullable=True)
    raised_by_email = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (
        UniqueConstraint("board_id", "seq", name="uq_board_feedback_seq"),
        Index("ix_board_feedback_environment", "board_id", "environment"),
        Index("ix_board_feedback_status", "board_id", "status"),
    )

    @property
    def human_id(self) -> str:
        return f"FB-{self.seq}"


class Doc(Base):
    __tablename__ = "board_docs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    seq = Column(Integer, nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False, default="")
    tags = Column(ARRAY(String), nullable=False, default=list)
    # Nullable -- an "unfiled" doc shows on the Overview rather than under
    # any epic. Ported from software-management (added to docs 2026-09-04).
    epic_id = Column(UUID(as_uuid=True), ForeignKey("board_epics.id", ondelete="SET NULL"), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)
    deleted_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("board_id", "seq", name="uq_board_docs_seq"),
        Index("ix_board_docs_epic", "epic_id"),
    )

    @property
    def human_id(self) -> str:
        return f"D{self.seq}"


class Comment(Base):
    """entity_id is deliberately not FK'd -- see service.py's entity-existence
    check (a UNION ALL probe, mirroring SMA's own comments.entity_id).

    ``agent_id`` records that an agent, not a person, wrote the comment.
    SMA stores the agent's id as the comment's free-text author and its
    sprint board's "Questions from the agent" reads that; here ``author_id``
    is a users FK and a board-token request is attributed to the token's
    creator, so agent authorship has to be recorded explicitly. Set in
    routes.py's create_comment from the board token the request carried;
    NULL for every human comment. ON DELETE SET NULL, so a question stays
    readable after the agent that asked it is deleted."""

    ENTITY_TYPES = ("release", "epic", "feature", "requirement", "sprint", "doc")

    __tablename__ = "board_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    entity_type = Column(String(20), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(UUID(as_uuid=True), ForeignKey("board_agents.id", ondelete="SET NULL"), nullable=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    deleted_at = Column(DateTime, nullable=True)

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
    helpers and documents.py's pending/uploaded confirmation pattern.

    ``feedback`` is the one entity here whose attachments come from an
    untrusted producer: a member may upload a screenshot to a report they
    raised without holding ``board:write``. That is why the routes restrict a
    feedback attachment to PNG/JPEG and why confirm verifies magic bytes."""

    ENTITY_TYPES = ("release", "epic", "feature", "requirement", "doc", "feedback")
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
    deleted_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_board_attachments_entity", "entity_type", "entity_id"),)


class BoardToken(Base):
    """A credential for a non-browser client (an agent) -- shown once at
    creation, stored only as a hash. Resolves to board:read/board:write/
    data:read/data:write, confined to this one project (board_id, checked
    in common.py's get_project), never the platform bypass's full-permission
    shortcut. See app/studio/board/agents.py.

    project_id is the exact project row minting saw (not derivable from
    board_id alone -- a board's lineage_id can match more than one project
    row across versions), recorded purely so a caller holding only the raw
    token can ask "whoami" (agent_routes.py) and learn what to put in
    FERROUS_STUDIO_PROJECT, instead of needing the id handed to it
    separately every time. Nullable: tokens minted before this existed have
    no way to backfill it retroactively."""

    __tablename__ = "board_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True)
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


class Agent(Base):
    """A persistent, named worker -- started and stopped repeatedly over its
    lifetime, unlike AgentRun (one single attempt). Ported from
    software-management (backend/store.py's agents table, added
    incrementally through Sept 2026): an agent is assigned exactly one
    sprint and works its NotStarted requirements in queue order; the older
    per-epic scoping was retired as untrustworthy (two stacked filters).

    Not wired to a real ECS launch unless AGENT_ECS_CLUSTER/
    AGENT_TASK_DEFINITION/AGENT_SUBNETS/AGENT_SECURITY_GROUP are all set
    (app/config.py) -- see agents.py's launch_agent, same honest "not
    configured" rather than faking a launch that AgentRun's docstring
    already established for this codebase.

    ``board_token`` is a real board_tokens row's raw value, kept here in
    the clear (unlike a human-minted token, shown once and only ever
    stored hashed) because the agent's own launched container needs to
    keep re-authenticating with it -- there's no human present to hand it
    a fresh one. Excluded from AgentRead for the same reason SMA's
    AGENT_SELECT excludes it.
    """

    DESIRED_STATES = ("running", "stopped")
    STATUSES = ("running", "stopped", "error")

    __tablename__ = "board_agents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    board_id = Column(UUID(as_uuid=True), ForeignKey("boards.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String(200), nullable=False)
    sprint_id = Column(UUID(as_uuid=True), ForeignKey("board_sprints.id", ondelete="SET NULL"), nullable=True)
    desired_state = Column(String(10), nullable=False, default="stopped")
    status = Column(String(10), nullable=False, default="stopped")
    task_arn = Column(String(512), nullable=True)
    last_error = Column(Text, nullable=True)
    current_requirement_id = Column(UUID(as_uuid=True), ForeignKey("board_requirements.id", ondelete="SET NULL"), nullable=True)
    board_token_id = Column(UUID(as_uuid=True), ForeignKey("board_tokens.id", ondelete="SET NULL"), nullable=True)
    board_token = Column(String(64), nullable=True)
    last_heartbeat = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    __table_args__ = (Index("ix_board_agents_sprint", "sprint_id"),)
