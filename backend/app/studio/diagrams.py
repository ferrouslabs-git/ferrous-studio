"""Diagram routes. A diagram is saved *whole* (its maxGraph XML plus the
derived nodes/edges model) guarded by an integer ``version``: the client sends
the version it loaded, and a stale one gets a 409 with the current version so
it can reload rather than clobber someone else's work."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext

from .common import get_project
from .models import Project, ProjectDiagram, utc_now
from .schemas import DiagramCreate, DiagramRead, DiagramSave, DiagramSummary, DiagramUpdate

router = APIRouter()


async def _diagram(db: AsyncSession, project: Project, diagram_id: UUID) -> ProjectDiagram:
    result = await db.execute(
        select(ProjectDiagram).where(
            ProjectDiagram.id == diagram_id,
            ProjectDiagram.project_id == project.id,
            ProjectDiagram.account_id == project.account_id,
        )
    )
    diagram = result.scalar_one_or_none()
    if diagram is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Diagram not found")
    return diagram


@router.get("/projects/{project_id}/diagrams", response_model=list[DiagramSummary])
async def list_diagrams(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[ProjectDiagram]:
    project = await get_project(db, project_id, ctx)
    result = await db.execute(
        select(ProjectDiagram)
        .where(ProjectDiagram.project_id == project.id, ProjectDiagram.account_id == project.account_id)
        .order_by(ProjectDiagram.updated_at.desc())
    )
    return list(result.scalars().all())


@router.post("/projects/{project_id}/diagrams", response_model=DiagramRead, status_code=status.HTTP_201_CREATED)
async def create_diagram(
    project_id: UUID,
    payload: DiagramCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> ProjectDiagram:
    project = await get_project(db, project_id, ctx)
    diagram = ProjectDiagram(
        project_id=project.id,
        account_id=project.account_id,
        name=payload.name,
        kind=payload.kind,
        xml="",
        model={"nodes": [], "edges": []},
        version=0,
        created_by=ctx.user_id,
    )
    db.add(diagram)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(diagram)
    return diagram


@router.get("/projects/{project_id}/diagrams/{diagram_id}", response_model=DiagramRead)
async def get_diagram(
    project_id: UUID,
    diagram_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> ProjectDiagram:
    project = await get_project(db, project_id, ctx)
    return await _diagram(db, project, diagram_id)


@router.patch("/projects/{project_id}/diagrams/{diagram_id}", response_model=DiagramSummary)
async def update_diagram(
    project_id: UUID,
    diagram_id: UUID,
    payload: DiagramUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> ProjectDiagram:
    """Rename / re-kind without touching the document (no version bump)."""
    project = await get_project(db, project_id, ctx)
    diagram = await _diagram(db, project, diagram_id)
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(diagram, field_name, value)
    await db.commit()
    await db.refresh(diagram)
    return diagram


@router.put("/projects/{project_id}/diagrams/{diagram_id}", response_model=DiagramRead)
async def save_diagram(
    project_id: UUID,
    diagram_id: UUID,
    payload: DiagramSave,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project(db, project_id, ctx)
    diagram = await _diagram(db, project, diagram_id)

    values = {
        "xml": payload.xml,
        "model": payload.model,
        "version": ProjectDiagram.version + 1,
        "updated_at": utc_now(),
    }
    if payload.name is not None:
        values["name"] = payload.name
    if payload.kind is not None:
        values["kind"] = payload.kind

    # Conditional update: only the row still at the client's version changes.
    result = await db.execute(
        update(ProjectDiagram)
        .where(
            ProjectDiagram.id == diagram.id,
            ProjectDiagram.account_id == project.account_id,
            ProjectDiagram.version == payload.version,
        )
        .values(**values)
    )
    if result.rowcount == 0:
        await db.rollback()
        current = await _diagram(db, project, diagram_id)
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "conflict", "version": current.version},
        )
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(diagram)
    return diagram


@router.delete("/projects/{project_id}/diagrams/{diagram_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_diagram(
    project_id: UUID,
    diagram_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_project(db, project_id, ctx)
    diagram = await _diagram(db, project, diagram_id)
    await db.delete(diagram)
    project.updated_at = utc_now()
    await db.commit()
