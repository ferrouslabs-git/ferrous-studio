"""Board request/response schemas."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

EntityType = Literal["release", "epic", "feature", "requirement", "sprint", "doc"]
AttachmentEntityType = Literal["release", "epic", "feature", "requirement", "doc"]

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
    # The exact value the URL was signed with -- S3 rejects the PUT with a
    # 403 if the Content-Type header doesn't match, and the server may have
    # canonicalised it (ALLOWED_TYPES) to something other than what the
    # client sent, so the client can't be trusted to already know it.
    content_type: str
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
