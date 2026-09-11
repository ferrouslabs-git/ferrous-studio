"""Board request/response schemas."""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator, model_validator


def _not_a_bool(value: object) -> object:
    """Reject True/False before float coercion sees them.

    ``bool`` is a subclass of ``int``, so pydantic happily reads ``True`` as
    ``1.0`` -- a silent one-hour estimate. Same guard software-management
    applies in its own ``_estimate_hours`` validator, and for the same reason.
    """
    if isinstance(value, bool):
        raise ValueError("must be a number, not a boolean")
    return value


#: Hours. ``None`` means "not estimated", which is distinct from ``0`` -- see
#: the ``estimate_hours`` column in models.py.
#:
#: The constraints sit on the ``float`` member rather than on the union: an
#: ``Annotated[float | None, Field(ge=0)]`` applies ``ge`` to ``None`` too and
#: raises ``TypeError`` (a 500, not a 422) the moment a client sends null to
#: clear the estimate.
EstimateHours = Annotated[
    Annotated[float, Field(ge=0, allow_inf_nan=False)] | None,
    BeforeValidator(_not_a_bool),
]

#: Position in a sprint's work order. ``None`` means "not ordered" (sorts
#: last). Same bool guard as EstimateHours: ``True`` must not read as
#: position 1. Non-negative and within int4 (the column is an Integer), so a
#: negative or oversized position is a 422 rather than a database error; the
#: bounds sit on the ``int`` member for the same reason EstimateHours's do.
QueuePosition = Annotated[
    Annotated[int, Field(ge=0, le=2_147_483_647)] | None,
    BeforeValidator(_not_a_bool),
]

EntityType = Literal["release", "epic", "feature", "requirement", "sprint", "doc"]
AttachmentEntityType = Literal["release", "epic", "feature", "requirement", "doc", "feedback"]
EnvironmentSlug = Literal["uat", "staging", "production"]
FeedbackKind = Literal["feedback", "bug", "requirement"]
FeedbackSeverity = Literal["low", "medium", "high", "critical"]
FeedbackStatus = Literal["New", "Triaged", "Accepted", "Declined", "Done"]

# ── Releases ─────────────────────────────────────────────────────────────


class ReleaseCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = ""


class ReleaseUpdate(BaseModel):
    """No release_date -- it's derived, not settable (see the Release model's
    docstring). ``shipped`` is a virtual field: True/False sets or clears
    shipped_at, translated in the route rather than stored as written."""

    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    shipped: bool | None = None


class ReleaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    human_id: str
    title: str
    date: date | None
    description: str
    shipped_at: datetime | None
    progress: EpicProgress
    created_at: datetime
    updated_at: datetime


# ── Epics ────────────────────────────────────────────────────────────────


EpicStatus = Literal["Readiness", "Implementation", "ReleasedToUAT", "HumanValidation", "Done"]


class EpicCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    summary: str = ""
    status: EpicStatus = "Readiness"
    release_id: UUID | None = None


class EpicUpdate(BaseModel):
    """No ``status: "Done"`` unless every requirement under the epic (direct,
    or via one of its features) is itself Done -- enforced in the route,
    not here (needs a database lookup)."""

    title: str | None = Field(None, min_length=1, max_length=255)
    summary: str | None = None
    status: EpicStatus | None = None
    release_id: UUID | None = None
    clear_release: bool = False


class EpicRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    human_id: str
    title: str
    summary: str
    status: str
    release_id: UUID | None
    created_at: datetime
    updated_at: datetime


class EpicProgress(BaseModel):
    """Status-weighted rollup: Done = 1, Review = 0.75, Doing = 0.5, every
    other status 0 -- mirrors the reference's effort.js rollup(), so the
    server and the client agree on every figure.

    Counts a requirement wherever it sits on the board: for an epic, every
    requirement whose *effective* epic is this one (its own epic_id, or its
    feature's), not just those attached directly. ``hours`` sums only the
    estimates that exist; ``hours_done`` is those same estimates weighted by
    the status weights above (a 4 h requirement in Review contributes 3 h);
    ``estimated``/``unestimated`` say how many carry one, and ``coverage``
    is their share of ``total`` -- 1.0 when there is nothing to estimate.
    """

    total: int
    done: int
    doing: int
    review: int
    pct: int
    hours: float
    hours_done: float
    estimated: int
    unestimated: int
    coverage: float


# ── Features ─────────────────────────────────────────────────────────────


class FeatureCreate(BaseModel):
    epic_id: UUID
    title: str = Field(min_length=1, max_length=255)


class FeatureUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class FeatureRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    human_id: str
    epic_id: UUID
    title: str
    created_at: datetime
    updated_at: datetime


# ── Sprints ──────────────────────────────────────────────────────────────


class SprintCreate(BaseModel):
    """A sprint must belong to a release: a release's date is the end of its
    latest sprint (see the Release model), so a sprint filed under nothing
    plans nothing. The model validator, not a bare required field, so a
    missing or null release_id reads as the rule it breaks rather than
    "field required"."""

    name: str = Field(min_length=1, max_length=255)
    goal: str = ""
    start_date: date | None = None
    end_date: date | None = None
    release_id: UUID
    capacity_hours: int | None = Field(None, ge=0)

    @model_validator(mode="before")
    @classmethod
    def _requires_release(cls, data: object) -> object:
        if isinstance(data, dict) and data.get("release_id") is None:
            raise ValueError("a sprint must belong to a release")
        return data


class SprintUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    goal: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    state: Literal["planned", "active", "done"] | None = None
    # A sprint may move between releases but never leave one: the route
    # refuses ``clear_release`` and an explicit null ``release_id`` with a
    # 422. Both fields are kept so an older client gets that error rather
    # than a silent no-op from an unknown-field drop.
    release_id: UUID | None = None
    clear_release: bool = False
    capacity_hours: int | None = Field(None, ge=0)


class SprintRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    human_id: str
    name: str
    goal: str
    start_date: date | None
    end_date: date | None
    state: str
    release_id: UUID | None
    capacity_hours: int | None
    created_at: datetime
    updated_at: datetime


class SprintUpdateResult(BaseModel):
    sprint: SprintRead
    # Populated only on a planned/active -> done transition: how many
    # non-Done requirements were returned to the backlog (ported side effect,
    # SMA store.py's update_sprint).
    returned_to_backlog: int = 0


class BurndownRead(BaseModel):
    """Day-by-day burndown, ported from software-management's
    get_sprint_burndown. Parallel series indexed by ``dates``: ``remaining``/
    ``total`` count requirements, ``remaining_hours``/``total_hours`` sum
    estimates, ``scope``/``scope_hours`` are the sprint's whole membership
    on each day (a rising scope line is work added mid-sprint). Actual
    series are ``None`` for days after today; the ideal lines run the full
    sprint. ``estimated_count``/``unestimated_count`` are over the sprint's
    current membership, so the client can fall back from hours to counts
    when coverage is incomplete. Every key is present on every response
    (``note`` set, series empty, when the sprint has no dates)."""

    sprint_id: UUID
    note: str | None = None
    dates: list[date] = []
    remaining: list[int | None] = []
    ideal: list[float] = []
    total: int = 0
    remaining_hours: list[float | None] = []
    ideal_hours: list[float] = []
    total_hours: float = 0.0
    scope: list[int | None] = []
    scope_hours: list[float | None] = []
    estimated_count: int = 0
    unestimated_count: int = 0


# ── Requirements ─────────────────────────────────────────────────────────


RequirementStatus = Literal["Todo", "Doing", "Review", "Blocked", "Done"]


class RequirementCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: str = ""
    epic_id: UUID | None = None
    feature_id: UUID | None = None
    status: RequirementStatus = "Todo"
    priority: Literal["Low", "Medium", "High", "Urgent"] = "Medium"
    assignee_id: UUID | None = None
    release_id: UUID | None = None
    sprint_id: UUID | None = None
    # No UI surfaces this yet; it is accepted so imported estimates are not lost.
    estimate_hours: EstimateHours = None


class RequirementUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    body: str | None = None
    epic_id: UUID | None = None
    clear_epic: bool = False
    feature_id: UUID | None = None
    clear_feature: bool = False
    status: RequirementStatus | None = None
    priority: Literal["Low", "Medium", "High", "Urgent"] | None = None
    assignee_id: UUID | None = None
    clear_assignee: bool = False
    release_id: UUID | None = None
    clear_release: bool = False
    sprint_id: UUID | None = None
    clear_sprint: bool = False
    # Sending null clears the estimate back to "not estimated" -- unlike the id
    # fields above, null is meaningful here, so it needs no clear_ flag.
    estimate_hours: EstimateHours = None
    # Same rule: null clears the position ("not ordered"), so no clear_ flag.
    # Not on RequirementCreate -- a requirement is ordered once it is in a
    # sprint and someone ranks it, never at creation.
    queue_position: QueuePosition = None


class RequirementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    human_id: str
    title: str
    body: str
    epic_id: UUID | None
    feature_id: UUID | None
    status: str
    blocked_from: str | None
    priority: str
    assignee_id: UUID | None
    release_id: UUID | None
    sprint_id: UUID | None
    estimate_hours: float | None = None
    queue_position: int | None = None
    effective_epic_id: UUID | None = None
    effective_release_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


# ── Docs ─────────────────────────────────────────────────────────────────


class DocCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: str = ""
    tags: list[str] = []
    epic_id: UUID | None = None


class DocUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    body: str | None = None
    tags: list[str] | None = None
    epic_id: UUID | None = None
    clear_epic: bool = False


class DocRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    human_id: str
    title: str
    body: str
    tags: list[str]
    epic_id: UUID | None
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime


# ── Comments ─────────────────────────────────────────────────────────────


class CommentCreate(BaseModel):
    entity_type: EntityType
    entity_id: UUID
    body: str = Field(min_length=1)


class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    entity_type: str
    entity_id: UUID
    author_id: UUID
    #: Set when an agent wrote this through its board token (see the Comment
    #: model); None for a human comment.
    agent_id: UUID | None = None
    body: str
    created_at: datetime


# ── Environments ─────────────────────────────────────────────────────────


def http_url(value: str, subject: str) -> str:
    """An optional http(s) address, trimmed. Blank stays blank.

    Shared by an environment's address and a report's page address, which are
    the same rule about the same kind of value -- a second copy is exactly
    where the two would drift.
    """
    url = value.strip()
    if url and not url.startswith(("http://", "https://")):
        raise ValueError(f"{subject} must start with http:// or https://")
    if len(url) > 1024:
        raise ValueError(f"{subject} may be at most 1024 characters")
    return url


class EnvironmentWrite(BaseModel):
    """Setting an environment's address. An empty ``url`` clears it."""

    url: str = ""

    @field_validator("url")
    @classmethod
    def _http_url(cls, value: str) -> str:
        return http_url(value, "An environment address")


class EnvironmentRead(BaseModel):
    """One environment, set or not. Unset ones are returned too, so the client
    always renders the same three rows in the same order."""

    slug: EnvironmentSlug
    label: str
    url: str | None
    updated_at: datetime | None


# ── Feedback ─────────────────────────────────────────────────────────────


class FeedbackCreate(BaseModel):
    """What a reporter may say. Deliberately no ``status``: that is what stops
    a member filing a report as already Accepted, and it is asserted by
    tests/test_role_permissions.py -- do not add one here."""

    environment: EnvironmentSlug
    kind: FeedbackKind = "feedback"
    severity: FeedbackSeverity = "medium"
    title: str = Field(min_length=1, max_length=255)
    detail: str = ""
    page_url: str = ""

    @field_validator("page_url")
    @classmethod
    def _page_url(cls, value: str) -> str:
        return http_url(value, "A page address")


class FeedbackUpdate(BaseModel):
    environment: EnvironmentSlug | None = None
    kind: FeedbackKind | None = None
    severity: FeedbackSeverity | None = None
    title: str | None = Field(None, min_length=1, max_length=255)
    detail: str | None = None
    page_url: str | None = None
    status: FeedbackStatus | None = None

    @field_validator("page_url")
    @classmethod
    def _page_url(cls, value: str | None) -> str | None:
        return None if value is None else http_url(value, "A page address")


class FeedbackRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    human_id: str
    environment: str
    kind: str
    severity: str
    title: str
    detail: str
    page_url: str
    status: str
    raised_by: UUID | None
    raised_by_name: str | None
    raised_by_email: str | None
    #: How many screenshots are attached. The one field here that is not a
    #: straight ORM projection -- list_feedback fills it from a grouped count
    #: rather than leaving each row to fetch its own. Create/update leave it at
    #: 0, which is right for create and stale-by-one-render for update, where
    #: the drawer holds the real list anyway.
    screenshot_count: int = 0
    created_at: datetime
    updated_at: datetime


# ── Events (activity feed) ───────────────────────────────────────────────


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    actor_id: UUID | None
    action: str
    entity_type: str
    entity_id: UUID
    detail: dict
    created_at: datetime


# ── Attachments ──────────────────────────────────────────────────────────


class AttachmentUploadRequest(BaseModel):
    entity_type: AttachmentEntityType
    entity_id: UUID
    filename: str = Field(min_length=1, max_length=255)
    content_type: str
    size_bytes: int = Field(gt=0)


class AttachmentUploadTicket(BaseModel):
    attachment_id: UUID
    upload_url: str
    #: The headers the PUT must carry, as DocumentUploadTicket already returns.
    #: The presign signs the *canonical* content type, which the request's own
    #: content_type need not equal (".jpg" sent as "image/jpeg" is remapped), so
    #: a client left to guess gets a bare 403 from S3. (Independently found and
    #: fixed twice, this session and on Org-users -- same bug, this shape kept
    #: for consistency with DocumentUploadTicket's own headers field.)
    headers: dict[str, str]
    expires_in: int


class AttachmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    entity_type: str
    entity_id: UUID
    filename: str
    content_type: str
    size_bytes: int
    status: str
    created_by: UUID | None
    created_at: datetime


class AttachmentDownload(BaseModel):
    url: str
    expires_in: int


# ── Board tokens (phase 5 scaffolding) ──────────────────────────────────


class BoardTokenCreate(BaseModel):
    label: str = Field(min_length=1, max_length=255)


class BoardTokenRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    label: str
    created_by: UUID | None
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class BoardTokenIssued(BoardTokenRead):
    token: str  # shown once; never returned by any other endpoint


# ── Agent runs (phase 5 scaffolding) ────────────────────────────────────


class AgentRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    requirement_id: UUID
    status: str
    error: str | None
    started_at: datetime | None
    heartbeat_at: datetime | None
    finished_at: datetime | None
    created_at: datetime


class AgentRunQueued(BaseModel):
    run: AgentRunRead
    launch_message: str | None = None


# ── Agents: persistent, named, sprint-scoped workers ─────────────────────
#
# Distinct from AgentRun above (one single attempt at a requirement): an
# Agent is started/stopped repeatedly over its lifetime and works its
# assigned sprint's Todo requirements in queue order. Ported from
# software-management's agents table.

AgentDesiredState = Literal["running", "stopped"]
#: The Agent model's STATUSES, which its CHECK constraint enforces.
AgentStatus = Literal["running", "stopped", "error"]


class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sprint_id: UUID | None = None


class AgentUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    sprint_id: UUID | None = None
    clear_sprint: bool = False
    # Starting (desired_state="running") launches a real task only if
    # AGENT_ECS_CLUSTER/AGENT_TASK_DEFINITION/AGENT_SUBNETS/
    # AGENT_SECURITY_GROUP are all set -- otherwise the route reports
    # exactly that, honestly, rather than pretending to launch anything.
    desired_state: AgentDesiredState | None = None


class AgentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    sprint_id: UUID | None
    desired_state: str
    status: AgentStatus
    last_error: str | None
    current_requirement_id: UUID | None
    last_heartbeat: datetime | None
    created_at: datetime
    updated_at: datetime


class AgentRunFinish(BaseModel):
    success: bool
    error: str | None = None


# ── Sprint activity (the sprint board's poll) ────────────────────────────


class SprintQuestionRequirement(BaseModel):
    """Just enough of a Blocked requirement to render its question card."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    human_id: str
    title: str
    epic_id: UUID | None
    priority: str
    blocked_from: str | None


class SprintQuestion(BaseModel):
    """A Blocked requirement in the sprint whose latest live comment was
    written by one of the sprint's agents, or reads like a question -- see
    service.detect_questions. Answering is a comment plus a flip back to
    Todo, which wakes the agent."""

    requirement: SprintQuestionRequirement
    comment: CommentRead


class SprintActivityRead(BaseModel):
    """One read for the sprint board's 10 s poll, ported from
    software-management's get_sprint_activity: the sprint, its requirements
    in queue order, the agents assigned to it, the newest events touching
    any of those, and the open questions."""

    sprint: SprintRead
    requirements: list[RequirementRead]
    agents: list[AgentRead]
    events: list[EventRead]
    questions: list[SprintQuestion]


# ── Board summary ────────────────────────────────────────────────────────


class EpicSummary(BaseModel):
    epic: EpicRead
    progress: EpicProgress


class BoardSummary(BaseModel):
    epics: list[EpicSummary]
    status_counts: dict[str, int]
