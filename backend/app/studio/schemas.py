from datetime import datetime
from typing import Annotated, Any, Literal, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# ``tablet`` is portrait; landscape is its own type rather than a separate
# orientation column, so a wireframe is still described by one value and
# existing tablets keep their (portrait) shape. Mobile is always portrait.
InterfaceType = Literal["desktop", "tablet", "tablet_landscape", "mobile"]
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
    #: What this version is called in the lineage ("Post-review"). Sending it as
    #: null clears the label, leaving the version numbered but unnamed.
    version_label: str | None = Field(None, max_length=255)


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
    version: int  # custom_components concurrency counter, not the version number
    lineage_id: UUID
    parent_project_id: UUID | None
    version_no: int
    version_label: str | None
    locked_at: datetime | None
    locked_by: UUID | None
    # The linked GitHub repository, as last recorded. ``repo_id`` is the
    # identity that survives a rename; the name is a cached label, refreshed
    # from GitHub when it drifts. No branch: that is GitHub's to manage.
    repo_id: int | None
    repo_full_name: str | None
    repo_linked_at: datetime | None
    repo_linked_by: UUID | None
    created_at: datetime
    updated_at: datetime


class ProjectVersionCreate(BaseModel):
    """Body for versioning a whole project.

    Not to be confused with ``VersionCreate`` further down, which snapshots a
    single wireframe. ``key`` makes the copy idempotent: a retry or a
    double-click returns the version the key already created rather than
    forking a second one that then diverges on its own.
    """

    key: str = Field(min_length=8, max_length=64)
    label: str | None = Field(None, max_length=255)
    lock_source: bool = True


class ProjectLineageRead(BaseModel):
    """One version in a project's lineage, for the switcher and the list."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    version_no: int
    version_label: str | None
    parent_project_id: UUID | None
    status: str
    locked_at: datetime | None
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


# ── Datasets ────────────────────────────────────────────────────────────────

# Mirrors the frontend catalogue's DATA_KINDS -- keep them in step.
DataKind = Literal[
    "text", "number", "date", "time", "email", "phone", "currency",
    "percentage", "status", "person", "tags", "image", "boolean", "url", "actions",
]

DatasetValues = Annotated[list[Annotated[str, Field(max_length=500)]], Field(max_length=200)]


class DatasetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    kind: DataKind = "text"
    values: DatasetValues = []
    pos: str | None = Field(None, min_length=1, max_length=64)


class DatasetUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    kind: DataKind | None = None
    values: DatasetValues | None = None
    pos: str | None = Field(None, min_length=1, max_length=64)


class DatasetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    kind: str
    values: list[str]
    pos: str
    created_at: datetime
    updated_at: datetime
    # Platform defaults and project datasets share one listing; the scope says
    # which side a row came from (platform rows are read-only in a project).
    scope: Literal["platform", "project"] = "project"


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
    status: Literal["active", "archived"] | None = None
    pos: str | None = Field(None, min_length=1, max_length=64)
    # Explicit null clears the choice back to the automatic (nav-driven)
    # landing, so the route tells "absent" and "null" apart via fields_set.
    landing_page_id: UUID | None = None


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
    status: str
    pos: str
    landing_page_id: UUID | None
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
    presentation: str | None = None
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
    presentation: Literal["modal", "drawer", "drawer-left"] | None = None
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
    presentation: str | None
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


class VersionPreviewPage(BaseModel):
    """One page of a snapshot, rebuilt into the shape the canvas renders.
    Matches PageRead's readable fields; there is no version to edit against,
    so the write-side columns are absent."""

    id: UUID
    name: str
    route: str | None
    pos: str
    placement: dict[str, Any] | None
    presentation: str | None
    document: dict[str, Any]


class VersionPreview(VersionRead):
    """Everything preview mode needs to render a snapshot without touching
    the wireframe's live pages."""

    wireframe_name: str
    interface_type: InterfaceType
    landing_page_id: UUID | None
    pages: list[VersionPreviewPage]


class VersionCopy(BaseModel):
    """Body of "create as a new wireframe": the copy's name. Everything else
    comes from the snapshot."""

    name: str = Field(min_length=1, max_length=255)


# ── Annotations ─────────────────────────────────────────────────────────────

AnnotationKind = Literal["note", "task"]
AnnotationTargetKind = Literal["region", "cmp", "element"]


class AnnotationCreate(BaseModel):
    page_id: UUID
    kind: AnnotationKind = "note"
    target_kind: AnnotationTargetKind
    # Bare document ids -- the frontend strips its "el:" address prefix.
    target_id: str = Field(min_length=1, max_length=64)
    target_cmp_id: str | None = Field(None, min_length=1, max_length=64)
    target_label: str = Field("", max_length=255)
    text: str = Field(min_length=1, max_length=4000)

    @model_validator(mode="after")
    def _check_target(self) -> "AnnotationCreate":
        if self.target_id.startswith("el:"):
            raise ValueError("target_id must be a bare element id, not an el: address")
        if self.target_kind == "element" and not self.target_cmp_id:
            raise ValueError("element annotations must name their owning component")
        if self.target_kind != "element" and self.target_cmp_id is not None:
            raise ValueError("target_cmp_id is only valid for element annotations")
        return self


class AnnotationUpdate(BaseModel):
    text: str | None = Field(None, min_length=1, max_length=4000)
    resolved: bool | None = None


class AnnotationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    wireframe_id: UUID
    page_id: UUID
    kind: str
    seq: int
    target_kind: str
    target_id: str
    target_cmp_id: str | None
    target_label: str
    text: str
    created_by: UUID | None
    author_name: str | None = None
    author_email: str | None = None
    updated_by: UUID | None
    resolved_at: datetime | None
    resolved_by: UUID | None
    resolver_name: str | None = None
    resolver_email: str | None = None
    created_at: datetime
    updated_at: datetime


# ── Audit log ───────────────────────────────────────────────────────────────


class AuditEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    event: str
    user_id: UUID | None
    user_name: str | None
    user_email: str | None
    page_id: UUID | None
    detail: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class AuditPage(BaseModel):
    events: list[AuditEventRead]
    has_more: bool
    next_before: datetime | None


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


# ── GitHub ──────────────────────────────────────────────────────────────────


class GitHubConnectionRead(BaseModel):
    """The organisation's GitHub connection, as the Repository section sees it.

    ``configured`` and ``connected`` are separate on purpose. The first says
    whether this deployment has a GitHub App at all -- an environment without
    one should say so plainly rather than offer a Connect button that cannot
    work. The second says whether this organisation has installed it.
    """

    configured: bool
    connected: bool
    installation_id: int | None = None
    account_login: str | None = None
    account_type: str | None = None
    #: "all" or "selected" -- whether the installation can see every repository
    #: on the account or only the ones that were picked.
    repository_selection: str | None = None
    connected_at: datetime | None = None
    #: Who ran the install flow. No join to a name here -- the page shows the
    #: date alone unless a name lookup is already on hand (see the org audit
    #: log, which does resolve one).
    connected_by: UUID | None = None
    #: GitHub's own page for changing which repositories we may see.
    manage_url: str | None = None


class GitHubConnectStart(BaseModel):
    """Ask for somewhere to send the browser to install the App.

    Empty: the flow always starts on, and returns to, the organisation's
    GitHub page now, so there is nothing left to carry.
    """


class GitHubConnectUrl(BaseModel):
    url: str


class GitHubRepositoryRead(BaseModel):
    """One repository the installation can see."""

    id: int
    full_name: str
    private: bool
    default_branch: str
    html_url: str
    description: str | None = None
    pushed_at: str | None = None


class RepositoryLink(BaseModel):
    """Point a project at a repository.

    ``repo_id`` is the whole payload, and it is what is actually trusted: the
    name is re-read from GitHub when the link is made, so a repository renamed
    since the picker loaded is stored under its current name rather than a
    stale one. No branch -- see ``Project.repo_id`` for why.
    """

    repo_id: int


class RepositoryCommit(BaseModel):
    sha: str
    message: str
    author: str | None = None
    committed_at: str | None = None
    html_url: str | None = None


class ProjectRepositoryRead(BaseModel):
    """The linked repository as the details page shows it, live.

    ``state`` is the whole point of this shape: the stored link and GitHub's
    answer can disagree, and the page has to say which. See ``link_state`` in
    ``github.py`` for what each value means.

    There is no "renamed" state. A rename is invisible here on purpose -- the
    link is held by id, so it survives one, and the cached name is simply
    refreshed to match rather than reported as a problem.
    """

    state: Literal["unlinked", "ok", "unreachable", "disconnected", "unavailable"]
    #: What we have on file, always present once a link exists.
    repo_id: int | None = None
    repo_full_name: str | None = None
    #: What GitHub says now; None when it could not be asked. ``default_branch``
    #: is a live readout, never stored -- branch management lives on GitHub.
    html_url: str | None = None
    description: str | None = None
    private: bool | None = None
    default_branch: str | None = None
    latest_commit: RepositoryCommit | None = None
    #: Plain sentence for the page to show when ``state`` is not "ok".
    message: str | None = None


# ── Project Agent ─────────────────────────────────────────────────────────


class ProjectAgentMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    role: Literal["user", "assistant"]
    content: str
    created_at: datetime


class ProjectAgentSend(BaseModel):
    content: str = Field(min_length=1, max_length=8000)


class ProjectAgentStatus(BaseModel):
    """Whether this deployment has an Anthropic key at all -- same
    configured/connected split as GitHub, but there is nothing to "connect":
    the platform's own key powers every organisation's chat for now."""

    configured: bool
