"""High-fidelity design routes. See docs/high-fidelity-design.md.

Studio authors one thing here -- the brief: which wireframes (one, several or
all of the project's), a name, the aesthetics text and the reference images. It never edits a design. The
prototype lives in a Figma Make file, which is the single source of truth, and
is put there by a Claude Code skill on the user's own machine. There is no LLM
call in this module, and no queue or worker behind it.

Studio shows the result by framing the site published from the Make file
(``published_url``), so what is on show is always what Make last published.
Nothing is built or uploaded to Studio; the skill keeps the prototype's source
in a repository, for coding agents to read.

Two groups of routes:

* Session routes (``require_permission``) file the design: create, rename,
  edit the brief, archive, restore, delete once archived, and read. None of
  them can change a design's content.
* Board-token routes (``require_studio_permission``) are the skill's: list,
  read the brief, and record where the Make file and its published site are.
  A person's login reaches them too; the token is confined to its own project
  by ``get_project``.
"""
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext
from app.config import get_settings

from . import storage
from .catalog import catalogue_reference
from .common import get_project, get_writable_project, next_pos, require_studio_permission
from .models import Project, ProjectDesign, ProjectDocument, Wireframe, utc_now
from .schemas import DesignCreate, DesignFigmaUpdate, DesignRead, DesignUpdate
from .wireframes import (
    _linked_personas,
    assemble_wireframe_export,
    dataset_export_payload,
    linked_actors,
    wireframe_pages,
)

router = APIRouter()

REFERENCE_PURPOSE = "design_reference"

#: Where a design may claim to live. The published site is framed on the
#: design page (the CSP's frame-src allows https://*.figma.site), so the URLs
#: are held to Figma's own hosts.
FIGMA_HOSTS = ("figma.com", "figma.site")


# ── Helpers ─────────────────────────────────────────────────────────────────


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


async def _design(db: AsyncSession, project: Project, design_id: UUID) -> ProjectDesign:
    stmt = select(ProjectDesign).where(
        ProjectDesign.id == design_id,
        ProjectDesign.project_id == project.id,
        ProjectDesign.account_id == project.account_id,
    )
    design = (await db.execute(stmt)).scalar_one_or_none()
    if design is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Design not found")
    return design


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


async def _checked_wireframe_ids(
    db: AsyncSession, project: Project, all_wireframes: bool, ids: list[UUID]
) -> list[str]:
    """What ``wireframe_ids`` stores for this choice: nothing for "all",
    otherwise the ids given, de-duplicated in order. Each must be a
    wireframe of this project -- otherwise a brief could be made to export
    another project's."""
    if all_wireframes:
        return []
    unique = list(dict.fromkeys(ids))
    if not unique:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose at least one wireframe, or all of them",
        )
    found = set(
        (
            await db.execute(
                select(Wireframe.id).where(
                    Wireframe.id.in_(unique),
                    Wireframe.project_id == project.id,
                    Wireframe.account_id == project.account_id,
                )
            )
        ).scalars()
    )
    if len(found) != len(unique):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wireframe not found")
    return [str(wireframe_id) for wireframe_id in unique]


async def design_wireframes(
    db: AsyncSession, project: Project, design: ProjectDesign
) -> tuple[list[Wireframe], list[str]]:
    """The wireframes a design is for, in order, and the ids of picked ones
    that no longer exist. "All" is every active wireframe as of now, so a
    wireframe added since the design was made is in its next build."""
    scope = (Wireframe.project_id == project.id, Wireframe.account_id == project.account_id)
    if design.all_wireframes:
        rows = (
            await db.execute(
                select(Wireframe).where(*scope, Wireframe.status == "active").order_by(Wireframe.pos.asc())
            )
        ).scalars()
        return list(rows), []
    wanted: list[UUID] = []
    for raw in design.wireframe_ids or []:
        try:
            wanted.append(UUID(str(raw)))
        except ValueError:
            continue
    if not wanted:
        return [], []
    rows = (await db.execute(select(Wireframe).where(*scope, Wireframe.id.in_(wanted)))).scalars()
    by_id = {row.id: row for row in rows}
    return [by_id[w] for w in wanted if w in by_id], [str(w) for w in wanted if w not in by_id]


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
    design = ProjectDesign(
        project_id=project.id,
        account_id=project.account_id,
        all_wireframes=payload.all_wireframes,
        wireframe_ids=await _checked_wireframe_ids(db, project, payload.all_wireframes, payload.wireframe_ids),
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
    """Rename, edit the brief (its wireframes included), archive or restore.
    DesignUpdate has no field that reaches the design's content or its Figma
    links.

    A changed choice of wireframes reaches the prototype at its next build,
    as an edited brief text does."""
    project = await get_writable_project(db, project_id, ctx)
    design = await _design(db, project, design_id)
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("reference_document_ids") is not None:
        design.reference_document_ids = await _checked_reference_ids(db, project, payload.reference_document_ids)
    updates.pop("reference_document_ids", None)
    all_given = updates.pop("all_wireframes", None)
    ids_given = updates.pop("wireframe_ids", None)
    if all_given is not None or ids_given is not None:
        # Naming wireframes means "these", so it turns "all" off unless the
        # same request says otherwise.
        all_wireframes = all_given if all_given is not None else False
        ids = payload.wireframe_ids if ids_given is not None else []
        design.wireframe_ids = await _checked_wireframe_ids(db, project, all_wireframes, ids or [])
        design.all_wireframes = all_wireframes
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
    # The reference images exist only for this brief, so they go with it. The
    # Figma Make file and its site are not Studio's to delete and are left alone.
    references = await _reference_documents(db, project, design.reference_document_ids)
    if get_settings().documents_bucket:
        for document in references:
            await storage.delete_object(document.s3_key)
    for document in references:
        await db.delete(document)
    await db.delete(design)
    project.updated_at = utc_now()
    await db.commit()


# ── The skill's routes (board token or session) ─────────────────────────────


@router.get("/projects/{project_id}/designs/{design_id}/brief")
async def get_design_brief(
    project_id: UUID,
    design_id: UUID,
    ctx: ScopeContext = Depends(require_studio_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Everything needed to build the prototype: the brief, each of its
    wireframes in their export shape (one prototype covers them all; page ids
    are unique across the project, so a link from one wireframe into another
    resolves), the component vocabulary that shape uses, and a download URL
    for each reference image.

    ``missingWireframeIds`` names picked wireframes that have since been
    deleted; the build goes ahead with the rest."""
    project = await get_project(db, project_id, ctx)
    design = await _design(db, project, design_id)
    wireframes, missing = await design_wireframes(db, project, design)
    if not wireframes:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This project has no active wireframes."
                if design.all_wireframes
                else "The wireframes this design was made from no longer exist."
            ),
        )

    settings = get_settings()
    datasets = await dataset_export_payload(db, project)
    references = await _reference_documents(db, project, design.reference_document_ids)
    return {
        "design": DesignRead.model_validate(design).model_dump(mode="json"),
        "brief": design.brief,
        "wireframes": [
            assemble_wireframe_export(
                project,
                wireframe,
                await _linked_personas(db, wireframe),
                await linked_actors(db, wireframe),
                await wireframe_pages(db, wireframe),
                datasets,
            )
            for wireframe in wireframes
        ],
        "missingWireframeIds": missing,
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
    """Record where the design lives in Figma: the Make file, and the site
    published from it, which the design page frames. Not its content -- only
    addresses."""
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
