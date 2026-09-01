"""Project routes: the workspace row itself, its custom component library,
the platform-wide listing and the whole-project export envelope."""
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.api.route_helpers import ensure_platform_admin
from app.auth.database import get_db
from app.auth.models.tenant import Tenant
from app.auth.models.user import User
from app.auth.security import get_current_user, require_permission
from app.auth.security.scope_context import ScopeContext

from .common import allow_cross_account, get_project
from .models import (
    Persona,
    Project,
    ProjectDiagram,
    ProjectDocument,
    Wireframe,
)
from .schemas import (
    AdminProjectRead,
    CustomComponentsUpdate,
    PersonaRead,
    ProjectCreate,
    ProjectDetail,
    ProjectRead,
    ProjectUpdate,
    SectionCounts,
)
from .wireframes import (
    assemble_wireframe_export,
    linked_actors,
    list_wireframe_reads,
    wireframe_pages,
    wireframe_personas,
)

router = APIRouter()


async def _count(db: AsyncSession, model: Any, project: Project, *extra: Any) -> int:
    stmt = (
        select(func.count())
        .select_from(model)
        .where(model.project_id == project.id, model.account_id == project.account_id, *extra)
    )
    return int((await db.execute(stmt)).scalar_one())


async def _detail(db: AsyncSession, project: Project) -> ProjectDetail:
    return ProjectDetail(
        **ProjectRead.model_validate(project).model_dump(),
        custom_components=project.custom_components or [],
        wireframes=await list_wireframe_reads(db, project),
        counts=SectionCounts(
            personas=await _count(db, Persona, project),
            diagrams=await _count(db, ProjectDiagram, project),
            wireframes=await _count(db, Wireframe, project),
            documents=await _count(db, ProjectDocument, project, ProjectDocument.status == "uploaded"),
        ),
    )


@router.get("/projects", response_model=list[ProjectRead])
async def list_projects(
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[Project]:
    result = await db.execute(
        select(Project).where(Project.account_id == ctx.scope_id).order_by(Project.updated_at.desc())
    )
    return list(result.scalars().all())


@router.get("/admin/projects", response_model=list[AdminProjectRead])
async def list_all_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AdminProjectRead]:
    """Every project on the platform, with its organisation (platform admins only).

    Unlike every other route here this one spans organisations, so it carries no
    scope context and cannot lean on ``require_permission``. Two consequences:
    the platform-admin check is explicit, and RLS has to be told to stand aside
    (see ``allow_cross_account`` -- without it the query returns nothing at all
    rather than failing).
    """
    ensure_platform_admin(current_user, "list projects across organisations")
    await allow_cross_account(db)
    result = await db.execute(
        select(Project, Tenant.name)
        .join(Tenant, Project.account_id == Tenant.id)
        .order_by(Project.updated_at.desc())
    )
    return [
        AdminProjectRead(**ProjectRead.model_validate(project).model_dump(), account_name=account_name)
        for project, account_name in result.all()
    ]


@router.post("/projects", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
):
    project = Project(
        account_id=ctx.scope_id,
        created_by=ctx.user_id,
        name=payload.name,
        description=payload.description,
        rationale=payload.rationale,
        custom_components=[],
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return await _detail(db, project)


@router.get("/projects/{project_id}", response_model=ProjectDetail)
async def get_project_detail(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
):
    return await _detail(db, await get_project(db, project_id, ctx))


@router.patch("/projects/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> Project:
    project = await get_project(db, project_id, ctx)
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
    project = await get_project(db, project_id, ctx)
    await db.delete(project)
    await db.commit()


@router.put("/projects/{project_id}/custom-components", response_model=ProjectRead)
async def replace_custom_components(
    project_id: UUID,
    payload: CustomComponentsUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> Project:
    project = await get_project(db, project_id, ctx)
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
    """Everything an LLM needs about the project, in one envelope."""
    project = await get_project(db, project_id, ctx)
    scoped = lambda model: (model.project_id == project.id, model.account_id == project.account_id)  # noqa: E731

    personas = list((await db.execute(select(Persona).where(*scoped(Persona)).order_by(Persona.pos.asc()))).scalars())
    persona_by_id = {p.id: p for p in personas}

    diagrams = list(
        (
            await db.execute(
                select(ProjectDiagram).where(*scoped(ProjectDiagram)).order_by(ProjectDiagram.created_at.asc())
            )
        ).scalars()
    )

    wireframes = list(
        (await db.execute(select(Wireframe).where(*scoped(Wireframe)).order_by(Wireframe.pos.asc()))).scalars()
    )
    wireframe_envelopes = []
    for wireframe in wireframes:
        links = await wireframe_personas(db, wireframe)
        wireframe_envelopes.append(
            assemble_wireframe_export(
                project,
                wireframe,
                [persona_by_id[pid] for pid in links if pid in persona_by_id],
                await linked_actors(db, wireframe),
                await wireframe_pages(db, wireframe),
            )
        )

    return {
        "schemaVersion": project.schema_version,
        "projectId": str(project.id),
        "projectName": project.name,
        "description": project.description,
        "rationale": project.rationale,
        "personas": [PersonaRead.model_validate(p).model_dump(mode="json") for p in personas],
        "diagrams": [{"id": str(d.id), "name": d.name, "kind": d.kind, "model": d.model or {}} for d in diagrams],
        "customComponents": project.custom_components or [],
        "wireframes": wireframe_envelopes,
    }
