"""Board request/response schemas."""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator


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
    """Status-weighted rollup: 1.0 per Done requirement, 0.5 per Doing.

    Consolidates what SMA duplicates across roadmap.js/features.js/
    milestones.js/sma_mcp.py into one server-side implementation -- includes
    every requirement whose *effective* epic is this one (its own epic_id,
    or its feature's), not just requirements attached to the epic directly.
    """

    done: int
    doing: int
    total: int
    pct: int


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
    name: str = Field(min_length=1, max_length=255)
    goal: str = ""
    start_date: date | None = None
    end_date: date | None = None
    release_id: UUID | None = None
    capacity_hours: int | None = Field(None, ge=0)


class SprintUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    goal: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    state: Literal["planned", "active", "done"] | None = None
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
    # SMA store.py:1090-1095).
    returned_to_backlog: int = 0


class BurndownPoint(BaseModel):
    day: date
    remaining: int | None  # None for days after today -- not drawn yet
    ideal: float | None  # None alongside remaining, for the same reason


class BurndownRead(BaseModel):
    sprint_id: UUID
    note: str | None = None
    total_start: int = 0
    points: list[BurndownPoint] = []


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
    status: str
    last_error: str | None
    current_requirement_id: UUID | None
    last_heartbeat: datetime | None
    created_at: datetime
    updated_at: datetime


class AgentRunFinish(BaseModel):
    success: bool
    error: str | None = None


# ── Board summary ────────────────────────────────────────────────────────


class EpicSummary(BaseModel):
    epic: EpicRead
    progress: EpicProgress


class BoardSummary(BaseModel):
    epics: list[EpicSummary]
    status_counts: dict[str, int]
