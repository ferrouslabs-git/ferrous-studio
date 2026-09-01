"""Persona routes: plain CRUD, ordered by ``pos``."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext

from .common import get_project, next_pos
from .models import Persona, Project, utc_now
from .schemas import PersonaCreate, PersonaRead, PersonaUpdate

router = APIRouter()


async def _persona(db: AsyncSession, project: Project, persona_id: UUID) -> Persona:
    result = await db.execute(
        select(Persona).where(
            Persona.id == persona_id, Persona.project_id == project.id, Persona.account_id == project.account_id
        )
    )
    persona = result.scalar_one_or_none()
    if persona is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Persona not found")
    return persona


@router.get("/projects/{project_id}/personas", response_model=list[PersonaRead])
async def list_personas(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[Persona]:
    project = await get_project(db, project_id, ctx)
    result = await db.execute(
        select(Persona)
        .where(Persona.project_id == project.id, Persona.account_id == project.account_id)
        .order_by(Persona.pos.asc())
    )
    return list(result.scalars().all())


@router.post("/projects/{project_id}/personas", response_model=PersonaRead, status_code=status.HTTP_201_CREATED)
async def create_persona(
    project_id: UUID,
    payload: PersonaCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> Persona:
    project = await get_project(db, project_id, ctx)
    data = payload.model_dump()
    pos = data.pop("pos") or await next_pos(db, Persona, Persona.project_id == project.id)
    persona = Persona(project_id=project.id, account_id=project.account_id, created_by=ctx.user_id, pos=pos, **data)
    db.add(persona)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(persona)
    return persona


@router.get("/projects/{project_id}/personas/{persona_id}", response_model=PersonaRead)
async def get_persona(
    project_id: UUID,
    persona_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> Persona:
    project = await get_project(db, project_id, ctx)
    return await _persona(db, project, persona_id)


@router.patch("/projects/{project_id}/personas/{persona_id}", response_model=PersonaRead)
async def update_persona(
    project_id: UUID,
    persona_id: UUID,
    payload: PersonaUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> Persona:
    project = await get_project(db, project_id, ctx)
    persona = await _persona(db, project, persona_id)
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        if field_name == "pos" and value is None:
            continue
        setattr(persona, field_name, value)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(persona)
    return persona


@router.delete("/projects/{project_id}/personas/{persona_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_persona(
    project_id: UUID,
    persona_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_project(db, project_id, ctx)
    persona = await _persona(db, project, persona_id)
    await db.delete(persona)
    project.updated_at = utc_now()
    await db.commit()
