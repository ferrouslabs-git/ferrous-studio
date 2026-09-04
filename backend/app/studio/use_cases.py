"""Use case model routes: actors (user types) and the use cases they can
perform. Plain CRUD ordered by ``pos``; the diagram itself is derived on the
client from these two lists, so there is nothing to store for it."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext

from .common import get_project, get_writable_project, next_pos
from .models import Project, UseCase, UseCaseActor, utc_now
from .schemas import (
    UseCaseActorCreate,
    UseCaseActorRead,
    UseCaseActorUpdate,
    UseCaseCreate,
    UseCaseRead,
    UseCaseUpdate,
)

router = APIRouter()


async def _actor(db: AsyncSession, project: Project, actor_id: UUID) -> UseCaseActor:
    result = await db.execute(
        select(UseCaseActor).where(
            UseCaseActor.id == actor_id,
            UseCaseActor.project_id == project.id,
            UseCaseActor.account_id == project.account_id,
        )
    )
    actor = result.scalar_one_or_none()
    if actor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Actor not found")
    return actor


async def _use_case(db: AsyncSession, project: Project, use_case_id: UUID) -> UseCase:
    result = await db.execute(
        select(UseCase).where(
            UseCase.id == use_case_id, UseCase.project_id == project.id, UseCase.account_id == project.account_id
        )
    )
    use_case = result.scalar_one_or_none()
    if use_case is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Use case not found")
    return use_case


async def _known_actor_ids(db: AsyncSession, project: Project, actor_ids: list[UUID]) -> list[str]:
    """Validate that every id belongs to this project, returning them as the
    strings JSONB stores, de-duplicated and in the order given."""
    if not actor_ids:
        return []
    result = await db.execute(
        select(UseCaseActor.id).where(
            UseCaseActor.project_id == project.id,
            UseCaseActor.account_id == project.account_id,
            UseCaseActor.id.in_(actor_ids),
        )
    )
    known = set(result.scalars().all())
    if any(a not in known for a in actor_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unknown actor in actor_ids")
    return list(dict.fromkeys(str(a) for a in actor_ids))


# ── Actors ──────────────────────────────────────────────────────────────────


@router.get("/projects/{project_id}/use-case-actors", response_model=list[UseCaseActorRead])
async def list_actors(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[UseCaseActor]:
    project = await get_project(db, project_id, ctx)
    result = await db.execute(
        select(UseCaseActor)
        .where(UseCaseActor.project_id == project.id, UseCaseActor.account_id == project.account_id)
        .order_by(UseCaseActor.pos.asc())
    )
    return list(result.scalars().all())


@router.post(
    "/projects/{project_id}/use-case-actors", response_model=UseCaseActorRead, status_code=status.HTTP_201_CREATED
)
async def create_actor(
    project_id: UUID,
    payload: UseCaseActorCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> UseCaseActor:
    project = await get_writable_project(db, project_id, ctx)
    data = payload.model_dump()
    pos = data.pop("pos") or await next_pos(db, UseCaseActor, UseCaseActor.project_id == project.id)
    actor = UseCaseActor(project_id=project.id, account_id=project.account_id, created_by=ctx.user_id, pos=pos, **data)
    db.add(actor)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(actor)
    return actor


@router.patch("/projects/{project_id}/use-case-actors/{actor_id}", response_model=UseCaseActorRead)
async def update_actor(
    project_id: UUID,
    actor_id: UUID,
    payload: UseCaseActorUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> UseCaseActor:
    project = await get_writable_project(db, project_id, ctx)
    actor = await _actor(db, project, actor_id)
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        if field_name == "pos" and value is None:
            continue
        setattr(actor, field_name, value)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(actor)
    return actor


@router.delete("/projects/{project_id}/use-case-actors/{actor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_actor(
    project_id: UUID,
    actor_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_writable_project(db, project_id, ctx)
    actor = await _actor(db, project, actor_id)
    # Scrub the actor from every use case that named it: JSONB arrays have no
    # foreign keys, so this is what keeps the diagram consistent.
    result = await db.execute(
        select(UseCase).where(
            UseCase.project_id == project.id,
            UseCase.account_id == project.account_id,
            UseCase.actor_ids.contains([str(actor.id)]),
        )
    )
    for use_case in result.scalars().all():
        use_case.actor_ids = [a for a in use_case.actor_ids if a != str(actor.id)]
    await db.delete(actor)
    project.updated_at = utc_now()
    await db.commit()


# ── Use cases ───────────────────────────────────────────────────────────────


@router.get("/projects/{project_id}/use-cases", response_model=list[UseCaseRead])
async def list_use_cases(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[UseCase]:
    project = await get_project(db, project_id, ctx)
    result = await db.execute(
        select(UseCase)
        .where(UseCase.project_id == project.id, UseCase.account_id == project.account_id)
        .order_by(UseCase.pos.asc())
    )
    return list(result.scalars().all())


@router.post("/projects/{project_id}/use-cases", response_model=UseCaseRead, status_code=status.HTTP_201_CREATED)
async def create_use_case(
    project_id: UUID,
    payload: UseCaseCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> UseCase:
    project = await get_writable_project(db, project_id, ctx)
    data = payload.model_dump()
    pos = data.pop("pos") or await next_pos(db, UseCase, UseCase.project_id == project.id)
    data["actor_ids"] = await _known_actor_ids(db, project, payload.actor_ids)
    use_case = UseCase(project_id=project.id, account_id=project.account_id, created_by=ctx.user_id, pos=pos, **data)
    db.add(use_case)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(use_case)
    return use_case


@router.patch("/projects/{project_id}/use-cases/{use_case_id}", response_model=UseCaseRead)
async def update_use_case(
    project_id: UUID,
    use_case_id: UUID,
    payload: UseCaseUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> UseCase:
    project = await get_writable_project(db, project_id, ctx)
    use_case = await _use_case(db, project, use_case_id)
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        if field_name == "pos" and value is None:
            continue
        if field_name == "actor_ids":
            value = await _known_actor_ids(db, project, payload.actor_ids or [])
        setattr(use_case, field_name, value)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(use_case)
    return use_case


@router.delete("/projects/{project_id}/use-cases/{use_case_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_use_case(
    project_id: UUID,
    use_case_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_writable_project(db, project_id, ctx)
    use_case = await _use_case(db, project, use_case_id)
    await db.delete(use_case)
    project.updated_at = utc_now()
    await db.commit()
