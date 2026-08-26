"""Studio API: projects, pages, op batches, versions.

Every route is scoped to a *space* via X-Scope-Type/X-Scope-ID and guarded
by ``data:read`` / ``data:write``. Every query filters by ``ctx.scope_id``
explicitly, and the tables also carry row-level-security policies keyed on
the same value -- two layers, always.
"""

import hashlib
import json
import secrets
from datetime import timedelta
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext

from .models import Project, ProjectOpBatch, ProjectPage, ProjectVersion, utc_now
from .ops import REGIONS, OpConflict, OpError, PageState, apply_batch, export_page
from .schemas import (
    CustomComponentsUpdate,
    OpBatchRequest,
    OpBatchResponse,
    PageCreate,
    PageRead,
    ProjectCreate,
    ProjectDetail,
    ProjectRead,
    ProjectUpdate,
    VersionCreate,
    VersionDetail,
    VersionRead,
)

router = APIRouter(prefix="/studio", tags=["studio"])

OP_BATCH_RETENTION = timedelta(hours=24)
FIRST_POS = "a0"  # fractional-indexing's first key


def default_page_document() -> dict[str, Any]:
    """A blank regions-mode frame, matching the legacy builder's defaults."""
    return {
        "frames": [
            {
                "id": f"f-{secrets.token_hex(4)}",
                "label": "Default",
                "pos": FIRST_POS,
                "layoutMode": "regions",
                "layout": {
                    "regions": {r: [] for r in REGIONS},
                    "options": {"smartDock": True, "mainFlow": "stack"},
                },
            }
        ]
    }


# ── Helpers ─────────────────────────────────────────────────────────────────


async def _project(db: AsyncSession, project_id: UUID, ctx: ScopeContext) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id, Project.space_id == ctx.scope_id))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def _pages(db: AsyncSession, project: Project) -> list[ProjectPage]:
    result = await db.execute(
        select(ProjectPage)
        .where(ProjectPage.project_id == project.id, ProjectPage.space_id == project.space_id)
        .order_by(ProjectPage.pos.asc())
    )
    return list(result.scalars().all())


def _state_of(page: ProjectPage) -> PageState:
    return PageState(
        name=page.name,
        route=page.route,
        pos=page.pos,
        document=page.document or {},
        entity_versions=page.entity_versions or {},
        version=page.version,
    )


def assemble_export(project: Project, pages: list[ProjectPage]) -> dict[str, Any]:
    """The export envelope the legacy builder produced with Copy JSON."""
    return {
        "schemaVersion": project.schema_version,
        "projectId": str(project.id),
        "projectName": project.name,
        "customComponents": project.custom_components or [],
        "pages": [export_page(str(p.id), _state_of(p)) for p in sorted(pages, key=lambda p: p.pos)],
    }


async def _snapshot(db: AsyncSession, project: Project, reason: str, user_id: UUID, label: str | None = None):
    pages = await _pages(db, project)
    db.add(
        ProjectVersion(
            project_id=project.id,
            space_id=project.space_id,
            snapshot=assemble_export(project, pages),
            label=label,
            reason=reason,
            created_by=user_id,
        )
    )


# ── Projects ────────────────────────────────────────────────────────────────


@router.get("/projects", response_model=list[ProjectRead])
async def list_projects(
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[Project]:
    result = await db.execute(
        select(Project).where(Project.space_id == ctx.scope_id).order_by(Project.updated_at.desc())
    )
    return list(result.scalars().all())


@router.post("/projects", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
):
    project = Project(
        space_id=ctx.scope_id,
        created_by=ctx.user_id,
        name=payload.name,
        description=payload.description,
        custom_components=[],
    )
    db.add(project)
    await db.flush()
    page = ProjectPage(
        id=uuid4(),
        project_id=project.id,
        space_id=project.space_id,
        name="Home",
        route="/",
        pos=FIRST_POS,
        document=default_page_document(),
        entity_versions={},
        version=0,
    )
    db.add(page)
    await db.commit()
    await db.refresh(project)
    return ProjectDetail(**ProjectRead.model_validate(project).model_dump(), custom_components=[], pages=[page])


@router.get("/projects/{project_id}", response_model=ProjectDetail)
async def get_project(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
):
    project = await _project(db, project_id, ctx)
    pages = await _pages(db, project)
    return ProjectDetail(
        **ProjectRead.model_validate(project).model_dump(),
        custom_components=project.custom_components or [],
        pages=pages,
    )


@router.patch("/projects/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> Project:
    project = await _project(db, project_id, ctx)
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        setattr(project, field_name, value)
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await _project(db, project_id, ctx)
    await db.delete(project)
    await db.commit()


@router.put("/projects/{project_id}/custom-components", response_model=ProjectRead)
async def replace_custom_components(
    project_id: UUID,
    payload: CustomComponentsUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> Project:
    project = await _project(db, project_id, ctx)
    project.custom_components = payload.custom_components
    project.version += 1
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/projects/{project_id}/export")
async def export_project(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await _project(db, project_id, ctx)
    return assemble_export(project, await _pages(db, project))


# ── Pages ───────────────────────────────────────────────────────────────────


@router.get("/projects/{project_id}/pages/{page_id}", response_model=PageRead)
async def get_page(
    project_id: UUID,
    page_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> ProjectPage:
    result = await db.execute(
        select(ProjectPage).where(
            ProjectPage.id == page_id,
            ProjectPage.project_id == project_id,
            ProjectPage.space_id == ctx.scope_id,
        )
    )
    page = result.scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found")
    return page


@router.post("/projects/{project_id}/pages", response_model=PageRead, status_code=status.HTTP_201_CREATED)
async def create_page(
    project_id: UUID,
    payload: PageCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> ProjectPage:
    project = await _project(db, project_id, ctx)
    page = ProjectPage(
        id=payload.id or uuid4(),
        project_id=project.id,
        space_id=project.space_id,
        name=payload.name,
        route=payload.route,
        pos=payload.pos,
        document=payload.document if payload.document is not None else default_page_document(),
        entity_versions={},
        version=0,
    )
    db.add(page)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(page)
    return page


@router.delete("/projects/{project_id}/pages/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_page(
    project_id: UUID,
    page_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    page = await get_page(project_id, page_id, ctx, db)
    await db.delete(page)
    await db.commit()


# ── Ops ─────────────────────────────────────────────────────────────────────


def _request_hash(payload: OpBatchRequest) -> str:
    body = payload.model_dump(mode="json", exclude={"client_batch_id"})
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@router.post("/projects/{project_id}/ops", response_model=OpBatchResponse)
async def apply_op_batch(
    project_id: UUID,
    payload: OpBatchRequest,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
):
    project = await _project(db, project_id, ctx)
    request_hash = _request_hash(payload)

    # Idempotency: a retry of a batch that already landed (or already failed)
    # gets the stored answer. Same key with a different payload is a client bug.
    existing = (
        await db.execute(
            select(ProjectOpBatch).where(
                ProjectOpBatch.project_id == project.id,
                ProjectOpBatch.client_batch_id == payload.client_batch_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.request_hash != request_hash:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="client_batch_id was already used with a different payload",
            )
        return JSONResponse(status_code=existing.status_code, content=existing.response)

    # Lock the page row for the read-modify-write. FOR NO KEY UPDATE, not
    # FOR UPDATE: no key columns change, and the stronger lock would block
    # unrelated inserts referencing this row.
    page = (
        await db.execute(
            select(ProjectPage)
            .where(
                ProjectPage.id == payload.page_id,
                ProjectPage.project_id == project.id,
                ProjectPage.space_id == ctx.scope_id,
            )
            .with_for_update(key_share=True)
        )
    ).scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found")

    ops = [op.model_dump(mode="json") for op in payload.ops]
    try:
        result = apply_batch(_state_of(page), ops, payload.base_version)
    except OpConflict as conflict:
        response = {
            "detail": "conflict",
            "page_id": str(page.id),
            "version": conflict.version,
            "conflicts": conflict.conflicts,
        }
        await _record_batch(db, project, payload, request_hash, status.HTTP_409_CONFLICT, response)
        await db.commit()
        return JSONResponse(status_code=status.HTTP_409_CONFLICT, content=response)
    except OpError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    new = result.page
    page.name = new.name
    page.route = new.route
    page.pos = new.pos
    page.document = new.document  # new object, so SQLAlchemy sees the change
    page.entity_versions = new.entity_versions
    page.version = new.version
    page.updated_at = utc_now()
    project.updated_at = utc_now()

    response = {"page_id": str(page.id), "version": page.version}
    await _record_batch(db, project, payload, request_hash, status.HTTP_200_OK, response)
    await db.commit()
    return response


async def _record_batch(
    db: AsyncSession,
    project: Project,
    payload: OpBatchRequest,
    request_hash: str,
    status_code: int,
    response: dict[str, Any],
) -> None:
    db.add(
        ProjectOpBatch(
            project_id=project.id,
            space_id=project.space_id,
            client_batch_id=payload.client_batch_id,
            request_hash=request_hash,
            status_code=status_code,
            response=response,
        )
    )
    # Prune this project's records past the retention window; cheap with the
    # (space_id, applied_at) index and keeps the table from growing unbounded.
    await db.execute(
        delete(ProjectOpBatch).where(
            ProjectOpBatch.project_id == project.id,
            ProjectOpBatch.applied_at < utc_now() - OP_BATCH_RETENTION,
        )
    )


# ── Versions ────────────────────────────────────────────────────────────────


@router.get("/projects/{project_id}/versions", response_model=list[VersionRead])
async def list_versions(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectVersion]:
    project = await _project(db, project_id, ctx)
    result = await db.execute(
        select(ProjectVersion)
        .where(ProjectVersion.project_id == project.id, ProjectVersion.space_id == ctx.scope_id)
        .order_by(ProjectVersion.created_at.desc())
        .limit(200)
    )
    return list(result.scalars().all())


@router.post("/projects/{project_id}/versions", response_model=VersionRead, status_code=status.HTTP_201_CREATED)
async def create_version(
    project_id: UUID,
    payload: VersionCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> ProjectVersion:
    project = await _project(db, project_id, ctx)
    await _snapshot(db, project, "manual", ctx.user_id, payload.label)
    await db.commit()
    result = await db.execute(
        select(ProjectVersion)
        .where(ProjectVersion.project_id == project.id)
        .order_by(ProjectVersion.created_at.desc())
        .limit(1)
    )
    return result.scalar_one()


@router.get("/projects/{project_id}/versions/{version_id}", response_model=VersionDetail)
async def get_version(
    project_id: UUID,
    version_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> ProjectVersion:
    result = await db.execute(
        select(ProjectVersion).where(
            ProjectVersion.id == version_id,
            ProjectVersion.project_id == project_id,
            ProjectVersion.space_id == ctx.scope_id,
        )
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    return version
