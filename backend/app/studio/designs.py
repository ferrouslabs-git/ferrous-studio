"""High-fidelity design routes. See docs/high-fidelity-design.md.

Studio authors one thing here -- the brief: which wireframe, a name, the
aesthetics text and the reference images. It never edits a design. The
prototype lives in a Figma Make file, which is the single source of truth, and
is put there by a Claude Code skill on the user's own machine. There is no LLM
call in this module, and no queue or worker behind it.

What Studio keeps is a read-only mirror: each sync uploads one self-contained
HTML file as a *revision*, by the same ticket -> direct PUT -> confirm path
documents use, and the page shows it in a sandboxed iframe from the bucket's
origin.

Two groups of routes:

* Session routes (``require_permission``) file the design: create, rename,
  edit the brief, archive, restore, delete once archived, and read. None of
  them can change a design's content.
* Board-token routes (``require_studio_permission``) are the skill's: list,
  read the brief, record where the Make file is, and submit a revision. A
  person's login reaches them too; the token is confined to its own project
  by ``get_project``.
"""
import re
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext
from app.config import get_settings

from . import storage
from .catalog import catalogue_reference
from .common import get_project, get_wireframe, get_writable_project, next_pos, require_studio_permission
from .models import DesignRevision, Project, ProjectDesign, ProjectDocument, utc_now
from .schemas import (
    DesignCreate,
    DesignFigmaUpdate,
    DesignRead,
    DesignRevisionCreate,
    DesignRevisionRead,
    DesignRevisionTicket,
    DesignRevisionView,
    DesignUpdate,
    UploadTicket,
)
from .wireframes import (
    _linked_personas,
    assemble_wireframe_export,
    dataset_export_payload,
    linked_actors,
    wireframe_pages,
)

router = APIRouter()

REFERENCE_PURPOSE = "design_reference"

HTML_TYPE = "text/html"
ZIP_TYPE = "application/zip"
HTML_FILENAME = "prototype.html"
SOURCE_FILENAME = "source.zip"

#: How long the URL the iframe loads stays valid. The file is self-contained,
#: so it is fetched once; anything longer only widens who a leaked URL serves.
VIEW_TTL_SECONDS = 300

#: Where a design may claim to live. The URLs are shown as links and may one
#: day be framed, so they are held to Figma's own hosts.
FIGMA_HOSTS = ("figma.com", "figma.site")

_HTML_START = re.compile(rb"^(?:\xef\xbb\xbf)?\s*<(?:!doctype\s+html|html)[\s>]", re.I)


# ── Helpers ─────────────────────────────────────────────────────────────────


def _not_configured() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Document storage is not configured (DOCUMENTS_BUCKET)",
    )


def revision_keys(account_id: UUID, project_id: UUID, design_id: UUID, revision_id: UUID) -> tuple[str, str]:
    """The S3 keys of a revision's HTML and source archive."""
    prefix = f"{account_id}/{project_id}/designs/{design_id}/{revision_id}"
    return f"{prefix}/{HTML_FILENAME}", f"{prefix}/{SOURCE_FILENAME}"


def figma_url_or_422(raw: str | None, field: str) -> str | None:
    """``raw`` as an https URL on one of Figma's hosts, or None when blank."""
    value = (raw or "").strip()
    if not value:
        return None
    parts = urlsplit(value)
    host = (parts.hostname or "").lower()
    on_figma = any(host == allowed or host.endswith(f".{allowed}") for allowed in FIGMA_HOSTS)
    if parts.scheme != "https" or not on_figma or parts.username or parts.password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field} must be an https link to figma.com or figma.site",
        )
    return value


async def _design(db: AsyncSession, project: Project, design_id: UUID, lock: bool = False) -> ProjectDesign:
    stmt = select(ProjectDesign).where(
        ProjectDesign.id == design_id,
        ProjectDesign.project_id == project.id,
        ProjectDesign.account_id == project.account_id,
    )
    if lock:
        # Two syncs racing would otherwise mint the same revision number.
        stmt = stmt.with_for_update(key_share=True)
    design = (await db.execute(stmt)).scalar_one_or_none()
    if design is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Design not found")
    return design


async def _revision(db: AsyncSession, design: ProjectDesign, revision_id: UUID) -> DesignRevision:
    revision = (
        await db.execute(
            select(DesignRevision).where(
                DesignRevision.id == revision_id,
                DesignRevision.design_id == design.id,
                DesignRevision.account_id == design.account_id,
            )
        )
    ).scalar_one_or_none()
    if revision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Revision not found")
    return revision


async def _current_revision(db: AsyncSession, design: ProjectDesign) -> DesignRevision | None:
    if design.current_revision_id is None:
        return None
    return (
        await db.execute(
            select(DesignRevision).where(
                DesignRevision.id == design.current_revision_id,
                DesignRevision.design_id == design.id,
                DesignRevision.account_id == design.account_id,
            )
        )
    ).scalar_one_or_none()


async def _reference_documents(db: AsyncSession, project: Project, ids: list[Any]) -> list[ProjectDocument]:
    """The uploaded reference images among ``ids``, in the order given."""
    wanted: list[UUID] = []
    for raw in ids or []:
        try:
            wanted.append(UUID(str(raw)))
        except ValueError:
            continue
    if not wanted:
        return []
    rows = (
        await db.execute(
            select(ProjectDocument).where(
                ProjectDocument.id.in_(wanted),
                ProjectDocument.project_id == project.id,
                ProjectDocument.account_id == project.account_id,
                ProjectDocument.purpose == REFERENCE_PURPOSE,
                ProjectDocument.status == "uploaded",
            )
        )
    ).scalars()
    by_id = {row.id: row for row in rows}
    return [by_id[doc_id] for doc_id in wanted if doc_id in by_id]


async def _checked_reference_ids(db: AsyncSession, project: Project, ids: list[UUID]) -> list[str]:
    """``ids`` as stored, refusing one that is not a reference image of this
    project -- otherwise a brief could be made to presign any document."""
    unique = list(dict.fromkeys(ids))
    found = await _reference_documents(db, project, unique)
    if len(found) != len(unique):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A reference image is missing or has not finished uploading",
        )
    return [str(doc_id) for doc_id in unique]


def _ticket(key: str, content_type: str, size: int, expires: int) -> UploadTicket:
    return UploadTicket(
        upload_url=storage.presign_put(key, content_type, size, expires),
        headers={"Content-Type": content_type},
        expires_in=expires,
    )


def _tickets(design: ProjectDesign, revision: DesignRevision, unchanged: bool = False) -> DesignRevisionTicket:
    expires = get_settings().presign_ttl_seconds
    return DesignRevisionTicket(
        unchanged=unchanged,
        design=DesignRead.model_validate(design),
        revision=DesignRevisionRead.model_validate(revision),
        html_upload=None if unchanged else _ticket(revision.html_key, HTML_TYPE, revision.html_bytes, expires),
        source_upload=(
            None
            if unchanged or revision.source_key is None
            else _ticket(revision.source_key, ZIP_TYPE, revision.source_bytes, expires)
        ),
    )


# ── Filing a design (session) ───────────────────────────────────────────────


@router.get("/projects/{project_id}/designs", response_model=list[DesignRead])
async def list_designs(
    project_id: UUID,
    # Board tokens too: the skill has to find a design before it can read its
    # brief.
    ctx: ScopeContext = Depends(require_studio_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectDesign]:
    project = await get_project(db, project_id, ctx)
    result = await db.execute(
        select(ProjectDesign)
        .where(ProjectDesign.project_id == project.id, ProjectDesign.account_id == project.account_id)
        .order_by(ProjectDesign.pos.asc())
    )
    return list(result.scalars().all())


@router.post("/projects/{project_id}/designs", response_model=DesignRead, status_code=status.HTTP_201_CREATED)
async def create_design(
    project_id: UUID,
    payload: DesignCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> ProjectDesign:
    project = await get_writable_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, payload.wireframe_id)
    design = ProjectDesign(
        project_id=project.id,
        account_id=project.account_id,
        wireframe_id=wireframe.id,
        name=payload.name,
        brief=payload.brief,
        reference_document_ids=await _checked_reference_ids(db, project, payload.reference_document_ids),
        status="active",
        pos=payload.pos or await next_pos(db, ProjectDesign, ProjectDesign.project_id == project.id),
        created_by=ctx.user_id,
    )
    db.add(design)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(design)
    return design


@router.get("/projects/{project_id}/designs/{design_id}", response_model=DesignRead)
async def get_design(
    project_id: UUID,
    design_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> ProjectDesign:
    project = await get_project(db, project_id, ctx)
    return await _design(db, project, design_id)


@router.patch("/projects/{project_id}/designs/{design_id}", response_model=DesignRead)
async def update_design(
    project_id: UUID,
    design_id: UUID,
    payload: DesignUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> ProjectDesign:
    """Rename, edit the brief, archive or restore. DesignUpdate has no field
    that reaches the design's content, its Figma link or its revisions."""
    project = await get_writable_project(db, project_id, ctx)
    design = await _design(db, project, design_id)
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("reference_document_ids") is not None:
        design.reference_document_ids = await _checked_reference_ids(db, project, payload.reference_document_ids)
    updates.pop("reference_document_ids", None)
    for field_name, value in updates.items():
        if value is not None:
            setattr(design, field_name, value)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(design)
    return design


@router.delete("/projects/{project_id}/designs/{design_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_design(
    project_id: UUID,
    design_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_writable_project(db, project_id, ctx)
    design = await _design(db, project, design_id)
    # The same safety latch wireframes have: archive first, then delete.
    if design.status != "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only archived designs can be deleted. Archive it first.",
        )
    revisions = (
        await db.execute(
            select(DesignRevision).where(
                DesignRevision.design_id == design.id, DesignRevision.account_id == design.account_id
            )
        )
    ).scalars()
    keys = [key for revision in revisions for key in (revision.html_key, revision.source_key) if key]
    # The reference images exist only for this brief, so they go with it. The
    # Figma Make file is not Studio's to delete and is left alone.
    references = await _reference_documents(db, project, design.reference_document_ids)
    keys.extend(document.s3_key for document in references)
    if get_settings().documents_bucket:
        for key in keys:
            await storage.delete_object(key)
    for document in references:
        await db.delete(document)
    await db.delete(design)  # revisions follow by ON DELETE CASCADE
    project.updated_at = utc_now()
    await db.commit()


@router.get("/projects/{project_id}/designs/{design_id}/revisions", response_model=list[DesignRevisionRead])
async def list_design_revisions(
    project_id: UUID,
    design_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[DesignRevision]:
    """Newest first. A revision still uploading is not one yet."""
    project = await get_project(db, project_id, ctx)
    design = await _design(db, project, design_id)
    result = await db.execute(
        select(DesignRevision)
        .where(
            DesignRevision.design_id == design.id,
            DesignRevision.account_id == design.account_id,
            DesignRevision.status == "uploaded",
        )
        .order_by(DesignRevision.revision_no.desc())
    )
    return list(result.scalars().all())


@router.get(
    "/projects/{project_id}/designs/{design_id}/revisions/{revision_id}/view", response_model=DesignRevisionView
)
async def view_design_revision(
    project_id: UUID,
    design_id: UUID,
    revision_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> DesignRevisionView:
    """A short-lived URL serving the revision inline as HTML, from the
    bucket's own host -- never Studio's origin. The page frames it in a
    sandbox without allow-same-origin."""
    if not get_settings().documents_bucket:
        raise _not_configured()
    project = await get_project(db, project_id, ctx)
    design = await _design(db, project, design_id)
    revision = await _revision(db, design, revision_id)
    if revision.status != "uploaded":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The upload has not completed")
    return DesignRevisionView(
        url=storage.presign_get(
            revision.html_key, HTML_FILENAME, VIEW_TTL_SECONDS, inline_as=f"{HTML_TYPE}; charset=utf-8"
        ),
        expires_in=VIEW_TTL_SECONDS,
    )


# ── The skill's routes (board token or session) ─────────────────────────────


@router.get("/projects/{project_id}/designs/{design_id}/brief")
async def get_design_brief(
    project_id: UUID,
    design_id: UUID,
    ctx: ScopeContext = Depends(require_studio_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Everything needed to build the prototype: the brief, the wireframe in
    its export shape, the component vocabulary that shape uses, and a
    download URL for each reference image."""
    project = await get_project(db, project_id, ctx)
    design = await _design(db, project, design_id)
    try:
        wireframe = await get_wireframe(db, project, design.wireframe_id)
    except HTTPException:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The wireframe this design was made from no longer exists.",
        ) from None

    settings = get_settings()
    references = await _reference_documents(db, project, design.reference_document_ids)
    current = await _current_revision(db, design)
    return {
        "design": DesignRead.model_validate(design).model_dump(mode="json"),
        "brief": design.brief,
        "currentRevision": (
            DesignRevisionRead.model_validate(current).model_dump(mode="json") if current is not None else None
        ),
        "wireframe": assemble_wireframe_export(
            project,
            wireframe,
            await _linked_personas(db, wireframe),
            await linked_actors(db, wireframe),
            await wireframe_pages(db, wireframe),
            await dataset_export_payload(db, project),
        ),
        "catalogueReference": catalogue_reference(),
        "referenceImages": [
            {
                "id": str(document.id),
                "filename": document.filename,
                "contentType": document.content_type,
                "sizeBytes": document.size_bytes,
                "url": storage.presign_get(document.s3_key, document.filename, settings.presign_ttl_seconds),
            }
            for document in references
        ]
        if settings.documents_bucket
        else [],
    }


@router.put("/projects/{project_id}/designs/{design_id}/figma", response_model=DesignRead)
async def set_design_figma(
    project_id: UUID,
    design_id: UUID,
    payload: DesignFigmaUpdate,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> ProjectDesign:
    """Record where the design lives in Figma. Not its content -- only the
    address of the file that holds it."""
    project = await get_writable_project(db, project_id, ctx)
    design = await _design(db, project, design_id)
    if "figma_url" in payload.model_fields_set:
        design.figma_url = figma_url_or_422(payload.figma_url, "figma_url")
    if "published_url" in payload.model_fields_set:
        design.published_url = figma_url_or_422(payload.published_url, "published_url")
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(design)
    return design


@router.post("/projects/{project_id}/designs/{design_id}/revisions", response_model=DesignRevisionTicket)
async def create_design_revision(
    project_id: UUID,
    design_id: UUID,
    payload: DesignRevisionCreate,
    response: Response,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> DesignRevisionTicket:
    """Offer a build. 200 with ``unchanged`` when its source is what is
    already on show; otherwise 201 with a pending revision and the tickets to
    upload it with.

    Safe to repeat, which is what lets a sync run in a loop: an unchanged
    source creates nothing, and repeating a request whose upload never
    finished reuses that pending revision instead of minting another.
    """
    settings = get_settings()
    if not settings.documents_bucket:
        raise _not_configured()
    project = await get_writable_project(db, project_id, ctx)
    design = await _design(db, project, design_id, lock=True)
    if design.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This design is archived. Restore it first.")

    limit = settings.documents_max_bytes
    if payload.html_bytes > limit or (payload.source_bytes or 0) > limit:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File is larger than {limit // (1024 * 1024)} MB",
        )

    current = await _current_revision(db, design)
    if current is not None and current.source_hash == payload.source_hash:
        # The mirror was checked and is up to date: that is a sync.
        design.synced_at = utc_now()
        await db.commit()
        await db.refresh(design)
        await db.refresh(current)
        response.status_code = status.HTTP_200_OK
        return _tickets(design, current, unchanged=True)

    pending = (
        await db.execute(
            select(DesignRevision)
            .where(
                DesignRevision.design_id == design.id,
                DesignRevision.account_id == design.account_id,
                DesignRevision.status == "pending",
                DesignRevision.source_hash == payload.source_hash,
                DesignRevision.html_bytes == payload.html_bytes,
            )
            .order_by(DesignRevision.revision_no.desc())
        )
    ).scalars().first()
    if pending is not None and pending.source_bytes == payload.source_bytes:
        response.status_code = status.HTTP_201_CREATED
        return _tickets(design, pending)

    highest = (
        await db.execute(
            select(func.max(DesignRevision.revision_no)).where(
                DesignRevision.design_id == design.id, DesignRevision.account_id == design.account_id
            )
        )
    ).scalar_one_or_none()
    revision_id = uuid4()
    html_key, source_key = revision_keys(project.account_id, project.id, design.id, revision_id)
    revision = DesignRevision(
        id=revision_id,
        design_id=design.id,
        project_id=project.id,
        account_id=project.account_id,
        revision_no=int(highest or 0) + 1,
        html_key=html_key,
        source_key=source_key if payload.source_bytes else None,
        html_bytes=payload.html_bytes,
        source_bytes=payload.source_bytes,
        source_hash=payload.source_hash,
        origin=payload.origin,
        summary=payload.summary,
        status="pending",
        created_at=utc_now(),
    )
    db.add(revision)
    await db.commit()
    await db.refresh(revision)
    await db.refresh(design)
    response.status_code = status.HTTP_201_CREATED
    return _tickets(design, revision)


@router.post(
    "/projects/{project_id}/designs/{design_id}/revisions/{revision_id}/confirm", response_model=DesignRead
)
async def confirm_design_revision(
    project_id: UUID,
    design_id: UUID,
    revision_id: UUID,
    ctx: ScopeContext = Depends(require_studio_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> ProjectDesign:
    """Check what was uploaded, then put it on show.

    The only write an uploaded revision ever receives is the one made here,
    from pending to uploaded; after that it is a record. Confirming twice is
    a no-op rather than a second "current".
    """
    settings = get_settings()
    if not settings.documents_bucket:
        raise _not_configured()
    project = await get_writable_project(db, project_id, ctx)
    design = await _design(db, project, design_id, lock=True)
    revision = await _revision(db, design, revision_id)
    if revision.status == "uploaded":
        return design

    uploads = [(revision.html_key, revision.html_bytes, HTML_TYPE)]
    if revision.source_key:
        uploads.append((revision.source_key, revision.source_bytes, ZIP_TYPE))

    async def reject(reason: str) -> None:
        for key, _size, _type in uploads:
            await storage.delete_object(key)
        await db.delete(revision)
        await db.commit()
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=reason)

    for key, size, content_type in uploads:
        try:
            info = await storage.head_object(key)
        except storage.ObjectMissing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The upload has not completed") from None
        if info.size != size or info.size > settings.documents_max_bytes:
            await reject("Uploaded file size does not match")
        if info.content_type and info.content_type.split(";")[0].strip().lower() != content_type:
            await reject("Uploaded file type does not match")

    head = await storage.read_object(revision.html_key, (0, 511))
    if not _HTML_START.match(head):
        await reject("The prototype does not look like an HTML document")
    if revision.source_key:
        magic = await storage.read_object(revision.source_key, (0, 3))
        if not magic.startswith(b"PK\x03\x04"):
            await reject("The source archive does not look like a ZIP file")

    now = utc_now()
    revision.status = "uploaded"
    design.current_revision_id = revision.id
    design.synced_at = now
    project.updated_at = now
    await db.commit()
    await db.refresh(design)
    return design
