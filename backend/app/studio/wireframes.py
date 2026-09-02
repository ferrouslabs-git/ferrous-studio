"""Wireframe routes: the studio document (name, interface type, personas,
user types) and
everything that hangs off it -- pages, op batches and version snapshots."""
import hashlib
import json
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

from .common import FIRST_POS, default_page_document, get_project, get_wireframe, next_pos
from .models import (
    Persona,
    Project,
    ProjectOpBatch,
    ProjectPage,
    ProjectVersion,
    UseCaseActor,
    Wireframe,
    WireframeActor,
    WireframePersona,
    utc_now,
)
from .ops import OpConflict, OpError, PageState, apply_batch, export_page, import_page
from .positions import key_after
from .schemas import (
    OpBatchRequest,
    OpBatchResponse,
    PageCreate,
    PageRead,
    VersionCreate,
    VersionDetail,
    VersionRead,
    WireframeActorsUpdate,
    WireframeCreate,
    WireframeDetail,
    WireframePersonasUpdate,
    WireframeRead,
    WireframeUpdate,
)

router = APIRouter()

OP_BATCH_RETENTION = timedelta(hours=24)


# ── Helpers (also used by projects.py for the project-wide export) ───────────


async def wireframe_pages(db: AsyncSession, wireframe: Wireframe) -> list[ProjectPage]:
    result = await db.execute(
        select(ProjectPage)
        .where(ProjectPage.wireframe_id == wireframe.id, ProjectPage.account_id == wireframe.account_id)
        .order_by(ProjectPage.pos.asc())
    )
    return list(result.scalars().all())


async def wireframe_personas(db: AsyncSession, wireframe: Wireframe) -> list[UUID]:
    result = await db.execute(
        select(WireframePersona.persona_id).where(
            WireframePersona.wireframe_id == wireframe.id,
            WireframePersona.account_id == wireframe.account_id,
        )
    )
    return list(result.scalars().all())


async def wireframe_actors(db: AsyncSession, wireframe: Wireframe) -> list[UUID]:
    result = await db.execute(
        select(WireframeActor.actor_id).where(
            WireframeActor.wireframe_id == wireframe.id,
            WireframeActor.account_id == wireframe.account_id,
        )
    )
    return list(result.scalars().all())


async def _links_by_wireframe(db: AsyncSession, project: Project, link_model, target_col) -> dict[UUID, list[UUID]]:
    """One query for every (wireframe, linked id) pair in the project, for the
    list view -- avoids a query per wireframe."""
    result = await db.execute(
        select(link_model.wireframe_id, target_col)
        .join(Wireframe, Wireframe.id == link_model.wireframe_id)
        .where(Wireframe.project_id == project.id, link_model.account_id == project.account_id)
    )
    out: dict[UUID, list[UUID]] = {}
    for wireframe_id, linked_id in result.all():
        out.setdefault(wireframe_id, []).append(linked_id)
    return out


def _read(wireframe: Wireframe, persona_ids: list[UUID], actor_ids: list[UUID]) -> WireframeRead:
    return WireframeRead(
        id=wireframe.id,
        project_id=wireframe.project_id,
        name=wireframe.name,
        interface_type=wireframe.interface_type,
        pos=wireframe.pos,
        persona_ids=persona_ids,
        actor_ids=actor_ids,
        created_at=wireframe.created_at,
        updated_at=wireframe.updated_at,
    )


async def _read_current(db: AsyncSession, wireframe: Wireframe) -> WireframeRead:
    return _read(wireframe, await wireframe_personas(db, wireframe), await wireframe_actors(db, wireframe))


async def list_wireframe_reads(db: AsyncSession, project: Project) -> list[WireframeRead]:
    result = await db.execute(
        select(Wireframe)
        .where(Wireframe.project_id == project.id, Wireframe.account_id == project.account_id)
        .order_by(Wireframe.pos.asc())
    )
    personas = await _links_by_wireframe(db, project, WireframePersona, WireframePersona.persona_id)
    actors = await _links_by_wireframe(db, project, WireframeActor, WireframeActor.actor_id)
    return [_read(w, personas.get(w.id, []), actors.get(w.id, [])) for w in result.scalars().all()]


async def _detail(db: AsyncSession, wireframe: Wireframe) -> WireframeDetail:
    return WireframeDetail(
        **(await _read_current(db, wireframe)).model_dump(),
        pages=await wireframe_pages(db, wireframe),
    )


def _state_of(page: ProjectPage) -> PageState:
    return PageState(
        name=page.name,
        route=page.route,
        pos=page.pos,
        document=page.document or {},
        entity_versions=page.entity_versions or {},
        version=page.version,
        placement=page.placement,
    )


def assemble_wireframe_export(
    project: Project,
    wireframe: Wireframe,
    personas: list[Persona],
    actors: list[UseCaseActor],
    pages: list[ProjectPage],
) -> dict[str, Any]:
    """The export envelope the legacy builder produced with Copy JSON, plus the
    wireframe's own metadata."""
    return {
        "schemaVersion": project.schema_version,
        "projectId": str(project.id),
        "projectName": project.name,
        "wireframeId": str(wireframe.id),
        "wireframeName": wireframe.name,
        "interfaceType": wireframe.interface_type,
        "personas": [{"id": str(p.id), "name": p.name, "role": p.role} for p in personas],
        "userTypes": [{"id": str(a.id), "name": a.name, "description": a.description} for a in actors],
        "customComponents": project.custom_components or [],
        "pages": [export_page(str(p.id), _state_of(p)) for p in sorted(pages, key=lambda p: p.pos)],
    }


async def _linked_personas(db: AsyncSession, wireframe: Wireframe) -> list[Persona]:
    result = await db.execute(
        select(Persona)
        .join(WireframePersona, WireframePersona.persona_id == Persona.id)
        .where(WireframePersona.wireframe_id == wireframe.id, Persona.account_id == wireframe.account_id)
        .order_by(Persona.pos.asc())
    )
    return list(result.scalars().all())


async def linked_actors(db: AsyncSession, wireframe: Wireframe) -> list[UseCaseActor]:
    result = await db.execute(
        select(UseCaseActor)
        .join(WireframeActor, WireframeActor.actor_id == UseCaseActor.id)
        .where(WireframeActor.wireframe_id == wireframe.id, UseCaseActor.account_id == wireframe.account_id)
        .order_by(UseCaseActor.pos.asc())
    )
    return list(result.scalars().all())


async def _snapshot(
    db: AsyncSession, project: Project, wireframe: Wireframe, reason: str, user_id: UUID, label: str | None = None
) -> None:
    db.add(
        ProjectVersion(
            project_id=project.id,
            wireframe_id=wireframe.id,
            account_id=project.account_id,
            snapshot=assemble_wireframe_export(
                project,
                wireframe,
                await _linked_personas(db, wireframe),
                await linked_actors(db, wireframe),
                await wireframe_pages(db, wireframe),
            ),
            label=label,
            reason=reason,
            created_by=user_id,
        )
    )


async def _set_personas(db: AsyncSession, project: Project, wireframe: Wireframe, persona_ids: list[UUID]) -> None:
    wanted = list(dict.fromkeys(persona_ids))  # de-duplicate, keep order
    if wanted:
        found = set(
            (
                await db.execute(
                    select(Persona.id).where(
                        Persona.id.in_(wanted),
                        Persona.project_id == project.id,
                        Persona.account_id == project.account_id,
                    )
                )
            ).scalars()
        )
        missing = [str(pid) for pid in wanted if pid not in found]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Personas not in this project: {', '.join(missing)}",
            )
    await db.execute(delete(WireframePersona).where(WireframePersona.wireframe_id == wireframe.id))
    for pid in wanted:
        db.add(WireframePersona(wireframe_id=wireframe.id, persona_id=pid, account_id=project.account_id))


async def _set_actors(db: AsyncSession, project: Project, wireframe: Wireframe, actor_ids: list[UUID]) -> None:
    """Replace the wireframe's user types. Every id must be an actor of this
    project, otherwise 422 -- the FK alone would only reject ids that don't
    exist anywhere."""
    wanted = list(dict.fromkeys(actor_ids))
    if wanted:
        found = set(
            (
                await db.execute(
                    select(UseCaseActor.id).where(
                        UseCaseActor.id.in_(wanted),
                        UseCaseActor.project_id == project.id,
                        UseCaseActor.account_id == project.account_id,
                    )
                )
            ).scalars()
        )
        missing = [str(aid) for aid in wanted if aid not in found]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"User types not in this project: {', '.join(missing)}",
            )
    await db.execute(delete(WireframeActor).where(WireframeActor.wireframe_id == wireframe.id))
    for aid in wanted:
        db.add(WireframeActor(wireframe_id=wireframe.id, actor_id=aid, account_id=project.account_id))


# ── Wireframes ──────────────────────────────────────────────────────────────


@router.get("/projects/{project_id}/wireframes", response_model=list[WireframeRead])
async def list_wireframes(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project(db, project_id, ctx)
    return await list_wireframe_reads(db, project)


@router.post("/projects/{project_id}/wireframes", response_model=WireframeDetail, status_code=status.HTTP_201_CREATED)
async def create_wireframe(
    project_id: UUID,
    payload: WireframeCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project(db, project_id, ctx)
    wireframe = Wireframe(
        project_id=project.id,
        account_id=project.account_id,
        name=payload.name,
        interface_type=payload.interface_type,
        pos=payload.pos or await next_pos(db, Wireframe, Wireframe.project_id == project.id),
        created_by=ctx.user_id,
    )
    db.add(wireframe)
    await db.flush()
    await _set_personas(db, project, wireframe, payload.persona_ids)
    await _set_actors(db, project, wireframe, payload.actor_ids)
    db.add(
        ProjectPage(
            id=uuid4(),
            project_id=project.id,
            wireframe_id=wireframe.id,
            account_id=project.account_id,
            name="Home",
            route="/",
            pos=FIRST_POS,
            document=default_page_document(),
            entity_versions={},
            version=0,
        )
    )
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(wireframe)
    return await _detail(db, wireframe)


@router.get("/projects/{project_id}/wireframes/{wireframe_id}", response_model=WireframeDetail)
async def get_wireframe_detail(
    project_id: UUID,
    wireframe_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project(db, project_id, ctx)
    return await _detail(db, await get_wireframe(db, project, wireframe_id))


@router.patch("/projects/{project_id}/wireframes/{wireframe_id}", response_model=WireframeRead)
async def update_wireframe(
    project_id: UUID,
    wireframe_id: UUID,
    payload: WireframeUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(wireframe, field_name, value)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(wireframe)
    return await _read_current(db, wireframe)


@router.put("/projects/{project_id}/wireframes/{wireframe_id}/personas", response_model=WireframeRead)
async def replace_wireframe_personas(
    project_id: UUID,
    wireframe_id: UUID,
    payload: WireframePersonasUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    await _set_personas(db, project, wireframe, payload.persona_ids)
    wireframe.updated_at = utc_now()
    await db.commit()
    await db.refresh(wireframe)
    return await _read_current(db, wireframe)


@router.put("/projects/{project_id}/wireframes/{wireframe_id}/actors", response_model=WireframeRead)
async def replace_wireframe_actors(
    project_id: UUID,
    wireframe_id: UUID,
    payload: WireframeActorsUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    await _set_actors(db, project, wireframe, payload.actor_ids)
    wireframe.updated_at = utc_now()
    await db.commit()
    await db.refresh(wireframe)
    return await _read_current(db, wireframe)


@router.delete("/projects/{project_id}/wireframes/{wireframe_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_wireframe(
    project_id: UUID,
    wireframe_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    await db.delete(wireframe)
    project.updated_at = utc_now()
    await db.commit()


@router.get("/projects/{project_id}/wireframes/{wireframe_id}/export")
async def export_wireframe(
    project_id: UUID,
    wireframe_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    return assemble_wireframe_export(
        project,
        wireframe,
        await _linked_personas(db, wireframe),
        await linked_actors(db, wireframe),
        await wireframe_pages(db, wireframe),
    )


# ── Pages ───────────────────────────────────────────────────────────────────


async def _page(
    db: AsyncSession, ctx: ScopeContext, wireframe_id: UUID, page_id: UUID, lock: bool = False
) -> ProjectPage:
    stmt = select(ProjectPage).where(
        ProjectPage.id == page_id,
        ProjectPage.wireframe_id == wireframe_id,
        ProjectPage.account_id == ctx.scope_id,
    )
    if lock:
        # FOR NO KEY UPDATE, not FOR UPDATE: no key columns change, and the
        # stronger lock would block unrelated inserts referencing this row.
        stmt = stmt.with_for_update(key_share=True)
    page = (await db.execute(stmt)).scalar_one_or_none()
    if page is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Page not found")
    return page


@router.get("/projects/{project_id}/wireframes/{wireframe_id}/pages/{page_id}", response_model=PageRead)
async def get_page(
    project_id: UUID,
    wireframe_id: UUID,
    page_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> ProjectPage:
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    return await _page(db, ctx, wireframe.id, page_id)


@router.post(
    "/projects/{project_id}/wireframes/{wireframe_id}/pages",
    response_model=PageRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_page(
    project_id: UUID,
    wireframe_id: UUID,
    payload: PageCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> ProjectPage:
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    page = ProjectPage(
        id=payload.id or uuid4(),
        project_id=project.id,
        wireframe_id=wireframe.id,
        account_id=project.account_id,
        name=payload.name,
        route=payload.route,
        pos=payload.pos,
        placement=payload.placement.model_dump(mode="json") if payload.placement else None,
        document=payload.document if payload.document is not None else default_page_document(),
        entity_versions={},
        version=0,
    )
    db.add(page)
    wireframe.updated_at = utc_now()
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(page)
    return page


@router.delete(
    "/projects/{project_id}/wireframes/{wireframe_id}/pages/{page_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_page(
    project_id: UUID,
    wireframe_id: UUID,
    page_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    page = await _page(db, ctx, wireframe.id, page_id)
    await db.delete(page)
    wireframe.updated_at = utc_now()
    await db.commit()


# ── Ops ─────────────────────────────────────────────────────────────────────


def _request_hash(payload: OpBatchRequest) -> str:
    body = payload.model_dump(mode="json", exclude={"client_batch_id"})
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@router.post("/projects/{project_id}/wireframes/{wireframe_id}/ops", response_model=OpBatchResponse)
async def apply_op_batch(
    project_id: UUID,
    wireframe_id: UUID,
    payload: OpBatchRequest,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
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

    page = await _page(db, ctx, wireframe.id, payload.page_id, lock=True)

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
        await _record_batch(db, project, wireframe, payload, request_hash, status.HTTP_409_CONFLICT, response)
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
    wireframe.updated_at = utc_now()
    project.updated_at = utc_now()

    response = {"page_id": str(page.id), "version": page.version}
    await _record_batch(db, project, wireframe, payload, request_hash, status.HTTP_200_OK, response)
    await db.commit()
    return response


async def _record_batch(
    db: AsyncSession,
    project: Project,
    wireframe: Wireframe,
    payload: OpBatchRequest,
    request_hash: str,
    status_code: int,
    response: dict[str, Any],
) -> None:
    db.add(
        ProjectOpBatch(
            project_id=project.id,
            wireframe_id=wireframe.id,
            account_id=project.account_id,
            client_batch_id=payload.client_batch_id,
            request_hash=request_hash,
            status_code=status_code,
            response=response,
        )
    )
    # Prune this project's records past the retention window; cheap with the
    # (account_id, applied_at) index and keeps the table from growing unbounded.
    await db.execute(
        delete(ProjectOpBatch).where(
            ProjectOpBatch.project_id == project.id,
            ProjectOpBatch.applied_at < utc_now() - OP_BATCH_RETENTION,
        )
    )


# ── Versions ────────────────────────────────────────────────────────────────


@router.get("/projects/{project_id}/wireframes/{wireframe_id}/versions", response_model=list[VersionRead])
async def list_versions(
    project_id: UUID,
    wireframe_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectVersion]:
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    result = await db.execute(
        select(ProjectVersion)
        .where(ProjectVersion.wireframe_id == wireframe.id, ProjectVersion.account_id == ctx.scope_id)
        .order_by(ProjectVersion.created_at.desc())
        .limit(200)
    )
    return list(result.scalars().all())


@router.post(
    "/projects/{project_id}/wireframes/{wireframe_id}/versions",
    response_model=VersionRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_version(
    project_id: UUID,
    wireframe_id: UUID,
    payload: VersionCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> ProjectVersion:
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    await _snapshot(db, project, wireframe, "manual", ctx.user_id, payload.label)
    await db.commit()
    result = await db.execute(
        select(ProjectVersion)
        .where(ProjectVersion.wireframe_id == wireframe.id)
        .order_by(ProjectVersion.created_at.desc())
        .limit(1)
    )
    return result.scalar_one()


async def _version(
    db: AsyncSession, ctx: ScopeContext, project_id: UUID, wireframe_id: UUID, version_id: UUID
) -> ProjectVersion:
    result = await db.execute(
        select(ProjectVersion).where(
            ProjectVersion.id == version_id,
            ProjectVersion.wireframe_id == wireframe_id,
            ProjectVersion.project_id == project_id,
            ProjectVersion.account_id == ctx.scope_id,
        )
    )
    version = result.scalar_one_or_none()
    if version is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
    return version


@router.get(
    "/projects/{project_id}/wireframes/{wireframe_id}/versions/{version_id}", response_model=VersionDetail
)
async def get_version(
    project_id: UUID,
    wireframe_id: UUID,
    version_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> ProjectVersion:
    return await _version(db, ctx, project_id, wireframe_id, version_id)


@router.post(
    "/projects/{project_id}/wireframes/{wireframe_id}/versions/{version_id}/restore",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def restore_version(
    project_id: UUID,
    wireframe_id: UUID,
    version_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Replace the wireframe's pages with the ones in a saved snapshot.

    Pages keep their snapshot ids so element links and child-page placements
    inside the restored documents still resolve. Project-level state the
    snapshot also captured (custom components, personas, user types) is left
    untouched -- it is shared with the rest of the project.
    """
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    version = await _version(db, ctx, project_id, wireframe_id, version_id)
    pages_data = version.snapshot.get("pages") if isinstance(version.snapshot, dict) else None
    if not isinstance(pages_data, list) or not pages_data:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Snapshot has no pages")

    # The current state becomes an automatic snapshot, so a restore is undoable.
    await _snapshot(db, project, wireframe, "before_restore", ctx.user_id)

    for page in await wireframe_pages(db, wireframe):
        await db.delete(page)
    await db.flush()  # deletes must land before pages with the same ids are re-inserted

    pos: str | None = None
    for data in pages_data:
        if not isinstance(data, dict):
            continue
        imported = import_page(data)
        try:
            page_id = UUID(str(data.get("id")))
        except ValueError:
            page_id = uuid4()
        pos = key_after(pos)
        db.add(
            ProjectPage(
                id=page_id,
                project_id=project.id,
                wireframe_id=wireframe.id,
                account_id=project.account_id,
                name=imported["name"],
                route=imported["route"],
                pos=pos,
                placement=imported["placement"],
                document=imported["document"],
                entity_versions={},
                version=0,
            )
        )
    wireframe.updated_at = utc_now()
    project.updated_at = utc_now()
    await db.commit()
