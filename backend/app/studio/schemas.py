from datetime import datetime
from typing import Annotated, Any, Literal, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

InterfaceType = Literal["desktop", "tablet", "mobile"]
DiagramKind = Literal["usecase", "class", "activity", "sequence", "state", "freeform"]

ShortList = Annotated[list[Annotated[str, Field(max_length=500)]], Field(max_length=50)]


# ── Projects ────────────────────────────────────────────────────────────────


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    rationale: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    rationale: str | None = None
    status: Literal["active", "archived"] | None = None


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    account_id: UUID
    created_by: UUID | None
    name: str
    description: str | None
    rationale: str | None
    status: str
    schema_version: str
    version: int
    created_at: datetime
    updated_at: datetime


class SectionCounts(BaseModel):
    personas: int
    diagrams: int
    wireframes: int
    documents: int


class AdminProjectRead(ProjectRead):
    """A project plus its owning organisation's name, for the platform-wide listing."""

    account_name: str


class CustomComponentsUpdate(BaseModel):
    custom_components: list[Any]


# ── Personas ────────────────────────────────────────────────────────────────


class PersonaCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    role: str | None = Field(None, max_length=255)
    primary_interface: str | None = Field(None, max_length=64)
    traits: ShortList = []
    jobs_to_be_done: ShortList = []
    pain_points: ShortList = []
    feelings: ShortList = []
    notes: str | None = None
    pos: str | None = Field(None, min_length=1, max_length=64)


class PersonaUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    role: str | None = Field(None, max_length=255)
    primary_interface: str | None = Field(None, max_length=64)
    traits: ShortList | None = None
    jobs_to_be_done: ShortList | None = None
    pain_points: ShortList | None = None
    feelings: ShortList | None = None
    notes: str | None = None
    pos: str | None = Field(None, min_length=1, max_length=64)


class PersonaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    name: str
    role: str | None
    primary_interface: str | None
    traits: list[str]
    jobs_to_be_done: list[str]
    pain_points: list[str]
    feelings: list[str]
    notes: str | None
    pos: str
    created_at: datetime
    updated_at: datetime


# ── Use case model ──────────────────────────────────────────────────────────

ActorIds = Annotated[list[UUID], Field(max_length=100)]


class UseCaseActorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    pos: str | None = Field(None, min_length=1, max_length=64)


class UseCaseActorUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    pos: str | None = Field(None, min_length=1, max_length=64)


class UseCaseActorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    name: str
    description: str | None
    pos: str
    created_at: datetime
    updated_at: datetime


class UseCaseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    actor_ids: ActorIds = []
    pos: str | None = Field(None, min_length=1, max_length=64)


class UseCaseUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    actor_ids: ActorIds | None = None
    pos: str | None = Field(None, min_length=1, max_length=64)


class UseCaseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    name: str
    description: str | None
    actor_ids: list[UUID]
    pos: str
    created_at: datetime
    updated_at: datetime


# ── Wireframes ──────────────────────────────────────────────────────────────


class WireframeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    interface_type: InterfaceType = "desktop"
    persona_ids: list[UUID] = []
    actor_ids: ActorIds = []
    pos: str | None = Field(None, min_length=1, max_length=64)


class WireframeUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    interface_type: InterfaceType | None = None
    pos: str | None = Field(None, min_length=1, max_length=64)


class WireframePersonasUpdate(BaseModel):
    persona_ids: list[UUID]


class WireframeActorsUpdate(BaseModel):
    """Replace the user types (use case actors) a wireframe is designed for."""

    actor_ids: ActorIds


class WireframeRead(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    interface_type: InterfaceType
    pos: str
    persona_ids: list[UUID]
    actor_ids: list[UUID]
    created_at: datetime
    updated_at: datetime


class PageSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    route: str | None
    pos: str
    placement: dict[str, Any] | None = None
    version: int


class WireframeDetail(WireframeRead):
    pages: list[PageSummary]


class ProjectDetail(ProjectRead):
    custom_components: list[Any]
    wireframes: list[WireframeRead]
    counts: SectionCounts


# ── Pages ───────────────────────────────────────────────────────────────────


class PagePlacement(BaseModel):
    """Where a child page renders: inside ``region_id`` of page ``page_id``."""

    page_id: UUID
    region_id: str = Field(min_length=1, max_length=64)


class PageCreate(BaseModel):
    id: UUID | None = None
    name: str = Field(min_length=1, max_length=255)
    route: str | None = Field(None, max_length=255)
    pos: str = Field(min_length=1, max_length=64)
    placement: PagePlacement | None = None
    document: dict[str, Any] | None = None


class PageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    wireframe_id: UUID
    name: str
    route: str | None
    pos: str
    placement: dict[str, Any] | None
    document: dict[str, Any]
    entity_versions: dict[str, int]
    version: int
    updated_at: datetime


# ── Ops ─────────────────────────────────────────────────────────────────────


class Target(BaseModel):
    """Empty target = the page itself; cmp = that component."""

    cmp: str | None = None


class SetOp(BaseModel):
    op: Literal["set"]
    target: Target = Field(default_factory=Target)
    path: str = Field(min_length=1, max_length=200)
    value: Any = None


class Into(BaseModel):
    region: str | None = None


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


# ── Diagrams ────────────────────────────────────────────────────────────────

DIAGRAM_XML_MAX_BYTES = 2 * 1024 * 1024


class DiagramCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    kind: DiagramKind = "freeform"


class DiagramUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    kind: DiagramKind | None = None


class DiagramSave(BaseModel):
    version: int = Field(ge=0)
    xml: str = Field(max_length=DIAGRAM_XML_MAX_BYTES)
    model: dict[str, Any]
    name: str | None = Field(None, min_length=1, max_length=255)
    kind: DiagramKind | None = None


class DiagramSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    name: str
    kind: str
    version: int
    created_at: datetime
    updated_at: datetime


class DiagramRead(DiagramSummary):
    xml: str
    model: dict[str, Any]


# ── Documents ───────────────────────────────────────────────────────────────


class DocumentCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=127)
    size_bytes: int = Field(gt=0)


class DocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_id: UUID
    filename: str
    content_type: str
    size_bytes: int
    status: str
    uploaded_by: UUID | None
    created_at: datetime
    confirmed_at: datetime | None


class DocumentUploadTicket(BaseModel):
    document: DocumentRead
    upload_url: str
    method: Literal["PUT"] = "PUT"
    headers: dict[str, str]
    expires_in: int


class DocumentDownload(BaseModel):
    url: str
    expires_in: int
