from datetime import datetime
from typing import Annotated, Any, Literal, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ── Projects ────────────────────────────────────────────────────────────────


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    status: Literal["active", "archived"] | None = None


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    space_id: UUID
    created_by: UUID | None
    name: str
    description: str | None
    status: str
    schema_version: str
    version: int
    created_at: datetime
    updated_at: datetime


class PageSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    route: str | None
    pos: str
    version: int


class ProjectDetail(ProjectRead):
    custom_components: list[Any]
    pages: list[PageSummary]


class CustomComponentsUpdate(BaseModel):
    custom_components: list[Any]


# ── Pages ───────────────────────────────────────────────────────────────────


class PageCreate(BaseModel):
    id: UUID | None = None
    name: str = Field(min_length=1, max_length=255)
    route: str | None = Field(None, max_length=255)
    pos: str = Field(min_length=1, max_length=64)
    document: dict[str, Any] | None = None


class PageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    name: str
    route: str | None
    pos: str
    document: dict[str, Any]
    entity_versions: dict[str, int]
    version: int
    updated_at: datetime


# ── Ops ─────────────────────────────────────────────────────────────────────


class Target(BaseModel):
    """Empty target = the page itself; frame only = that frame; both = a component."""

    frame: str | None = None
    cmp: str | None = None


class SetOp(BaseModel):
    op: Literal["set"]
    target: Target = Field(default_factory=Target)
    path: str = Field(min_length=1, max_length=200)
    value: Any = None


class Into(BaseModel):
    region: str | None = None
    list: Literal["frames", "components"] | None = None


class InsertOp(BaseModel):
    op: Literal["insert"]
    target: Target = Field(default_factory=Target)
    into: Into = Field(default_factory=Into)
    value: dict[str, Any]


class RemoveOp(BaseModel):
    op: Literal["remove"]
    target: Target


class MoveTo(BaseModel):
    region: str | None = None
    pos: str = Field(min_length=1, max_length=64)


class MoveOp(BaseModel):
    op: Literal["move"]
    target: Target
    to: MoveTo


Op = Annotated[Union[SetOp, InsertOp, RemoveOp, MoveOp], Field(discriminator="op")]


class OpBatchRequest(BaseModel):
    client_batch_id: str = Field(min_length=8, max_length=64)
    page_id: UUID
    base_version: int = Field(ge=0)
    ops: list[Op] = Field(min_length=1, max_length=500)


class OpBatchResponse(BaseModel):
    page_id: UUID
    version: int


# ── Versions ────────────────────────────────────────────────────────────────


class VersionCreate(BaseModel):
    label: str | None = Field(None, max_length=255)


class VersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    label: str | None
    reason: str
    created_by: UUID | None
    created_at: datetime


class VersionDetail(VersionRead):
    snapshot: dict[str, Any]
