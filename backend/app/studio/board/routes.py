"""Board routes, mounted at /projects/{project_id}/board/... (studio router
already carries the /studio prefix, so the full path is
/api/studio/projects/{project_id}/board/...).

Every route resolves its project via ``get_project``, never
``get_writable_project``: a locked design version must not freeze the live
board (see test_lock_coverage.py's EXEMPT list, and this module's entries in
it). ``copy_project`` (versioning.py) must never learn the board exists --
it doesn't, since the board keys on (account_id, lineage_id), not
project_id, so nothing about it is in what versioning copies.
"""
from datetime import timedelta
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext
from app.config import get_settings

from .. import storage
from ..common import get_project
from ..documents import ALLOWED_TYPES, sanitise_filename
from ..models import Project, utc_now
from . import service
from .models import Attachment, Board, Comment, Doc, Epic, Event, Feature, Release, Requirement, Sprint
from .schemas import (
    AttachmentDownload,
    AttachmentRead,
    AttachmentUploadRequest,
    AttachmentUploadTicket,
    BoardSummary,
    BurndownRead,
    CommentCreate,
    CommentRead,
    DocCreate,
    DocRead,
    DocUpdate,
    EntityType,
    EpicCreate,
    EpicProgress,
    EpicRead,
    EpicSummary,
    EpicUpdate,
    EventRead,
    FeatureCreate,
    FeatureRead,
    FeatureUpdate,
    ReleaseCreate,
    ReleaseRead,
    ReleaseUpdate,
    RequirementCreate,
    RequirementRead,
    RequirementUpdate,
    SprintCreate,
    SprintRead,
    SprintUpdate,
    SprintUpdateResult,
)

router = APIRouter()

PRESIGN_TTL_SECONDS = 900


async def _board(db: AsyncSession, project: Project) -> Board:
    return await service.get_or_create_board(db, project)


def _jsonable(value):
    return str(value) if isinstance(value, UUID) else value


def _diff(before: dict, after: dict, fields: tuple[str, ...]) -> dict:
    out = {}
    for f in fields:
        if before.get(f) != after.get(f):
            out[f] = {"from": _jsonable(before.get(f)), "to": _jsonable(after.get(f))}
    return out


async def _requirement_read(db: AsyncSession, board: Board, r: Requirement) -> RequirementRead:
    [extra] = await service.annotate_effective(db, board.id, [r])
    return RequirementRead.model_validate({**RequirementRead.model_validate(r).model_dump(), **extra})


_EMPTY_PROGRESS = {"done": 0, "doing": 0, "total": 0, "pct": 0}


async def _release_reads(db: AsyncSession, board: Board, releases: list[Release]) -> list[ReleaseRead]:
    """Batched, not one query per release -- see service.release_dates_map /
    release_progress_map."""
    dates = await service.release_dates_map(db, board.id)
    progress = await service.release_progress_map(db, board.id)
    return [
        ReleaseRead(
            id=r.id,
            human_id=r.human_id,
            title=r.title,
            description=r.description,
            shipped_at=r.shipped_at,
            created_at=r.created_at,
            updated_at=r.updated_at,
            date=dates.get(r.id),
            progress=progress.get(r.id, _EMPTY_PROGRESS),
        )
        for r in releases
    ]


async def _release_read(db: AsyncSession, board: Board, r: Release) -> ReleaseRead:
    [read] = await _release_reads(db, board, [r])
    return read


# ── Releases ─────────────────────────────────────────────────────────────


@router.get("/projects/{project_id}/board/releases", response_model=list[ReleaseRead])
async def list_releases(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> list[ReleaseRead]:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    result = await db.execute(
        select(Release)
        .where(Release.board_id == board.id, Release.deleted_at.is_(None))
        .order_by(Release.seq)
    )
    return await _release_reads(db, board, list(result.scalars().all()))


@router.post("/projects/{project_id}/board/releases", response_model=ReleaseRead, status_code=status.HTTP_201_CREATED)
async def create_release(
    project_id: UUID,
    payload: ReleaseCreate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> ReleaseRead:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    seq = await service._next_seq(db, board, "release_seq")
    release = Release(board_id=board.id, account_id=board.account_id, seq=seq, **payload.model_dump())
    db.add(release)
    await db.flush()
    await service.write_event(db, board, ctx.user_id, "release.created", "release", release.id, {})
    await db.commit()
    await db.refresh(release)
    return await _release_read(db, board, release)


async def _get_release(db: AsyncSession, board: Board, release_id: UUID) -> Release:
    release = (
        await db.execute(
            select(Release).where(
                Release.id == release_id, Release.board_id == board.id, Release.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if release is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Release not found")
    return release


@router.get("/projects/{project_id}/board/releases/{release_id}", response_model=ReleaseRead)
async def get_release(
    project_id: UUID,
    release_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> ReleaseRead:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    release = await _get_release(db, board, release_id)
    return await _release_read(db, board, release)


@router.patch("/projects/{project_id}/board/releases/{release_id}", response_model=ReleaseRead)
async def update_release(
    project_id: UUID,
    release_id: UUID,
    payload: ReleaseUpdate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> ReleaseRead:
    """Shipping is a human judgment call, never computed -- a release can go
    out with known gaps. ``shipped`` only sets/clears shipped_at and is
    logged as its own event on an actual transition, distinct from a plain
    field edit (ported from software-management's update_release)."""
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    release = await _get_release(db, board, release_id)
    data = payload.model_dump(exclude_unset=True)
    shipped = data.pop("shipped", None)
    for field, value in data.items():
        setattr(release, field, value)
    if shipped is True and release.shipped_at is None:
        release.shipped_at = utc_now()
        await service.write_event(
            db, board, ctx.user_id, "release.shipped", "release", release.id,
            {"shipped_at": release.shipped_at.isoformat()},
        )
    elif shipped is False and release.shipped_at is not None:
        release.shipped_at = None
        await service.write_event(db, board, ctx.user_id, "release.unshipped", "release", release.id, {})
    release.updated_at = utc_now()
    await db.commit()
    await db.refresh(release)
    return await _release_read(db, board, release)


@router.delete("/projects/{project_id}/board/releases/{release_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_release(
    project_id: UUID,
    release_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft delete. Epics/requirements/sprints tagged to this release get
    release_id explicitly unlinked -- the FK's ON DELETE SET NULL never
    fires now, since the row is never really deleted. Its own comments/
    attachments cascade to soft-deleted, same principle as delete_epic.
    Ported deletion semantics, software-management store.py's
    delete_release."""
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    release = await _get_release(db, board, release_id)
    now = utc_now()
    for model in (Epic, Requirement, Sprint):
        await db.execute(
            model.__table__.update()
            .where(model.board_id == board.id, model.release_id == release.id)
            .values(release_id=None, updated_at=now)
        )
    await db.execute(
        Comment.__table__.update()
        .where(Comment.board_id == board.id, Comment.entity_id == release.id)
        .values(deleted_at=now)
    )
    await db.execute(
        Attachment.__table__.update()
        .where(Attachment.board_id == board.id, Attachment.entity_id == release.id)
        .values(deleted_at=now)
    )
    release.deleted_at = now
    await db.commit()


# ── Epics ────────────────────────────────────────────────────────────────


async def _get_epic(db: AsyncSession, board: Board, epic_id: UUID) -> Epic:
    epic = (
        await db.execute(
            select(Epic).where(Epic.id == epic_id, Epic.board_id == board.id, Epic.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if epic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Epic not found")
    return epic


@router.get("/projects/{project_id}/board/epics", response_model=list[EpicRead])
async def list_epics(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> list[Epic]:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    result = await db.execute(
        select(Epic).where(Epic.board_id == board.id, Epic.deleted_at.is_(None)).order_by(Epic.seq)
    )
    return list(result.scalars().all())


@router.get("/projects/{project_id}/board/summary", response_model=BoardSummary)
async def get_board_summary(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> BoardSummary:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    summary = await service.board_summary(db, board)
    return BoardSummary(
        epics=[EpicSummary(epic=e["epic"], progress=EpicProgress(**e["progress"])) for e in summary["epics"]],
        status_counts=summary["status_counts"],
    )


@router.post("/projects/{project_id}/board/epics", response_model=EpicRead, status_code=status.HTTP_201_CREATED)
async def create_epic(
    project_id: UUID,
    payload: EpicCreate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> Epic:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    if payload.release_id is not None:
        await _get_release(db, board, payload.release_id)
    seq = await service._next_seq(db, board, "epic_seq")
    epic = Epic(board_id=board.id, account_id=board.account_id, seq=seq, **payload.model_dump())
    db.add(epic)
    await db.flush()
    await service.write_event(db, board, ctx.user_id, "epic.created", "epic", epic.id, {})
    await db.commit()
    await db.refresh(epic)
    return epic


@router.get("/projects/{project_id}/board/epics/{epic_id}", response_model=EpicRead)
async def get_epic(
    project_id: UUID,
    epic_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> Epic:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    return await _get_epic(db, board, epic_id)


@router.patch("/projects/{project_id}/board/epics/{epic_id}", response_model=EpicRead)
async def update_epic(
    project_id: UUID,
    epic_id: UUID,
    payload: EpicUpdate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> Epic:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    epic = await _get_epic(db, board, epic_id)
    data = payload.model_dump(exclude_unset=True)
    if data.get("status") == "Done":
        unresolved = await service.unresolved_requirement_ids(db, board.id, epic.id)
        if unresolved:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{len(unresolved)} requirement(s) under this epic are not yet Done",
            )
    clear_release = data.pop("clear_release", False)
    if clear_release:
        epic.release_id = None
    elif data.get("release_id") is not None:
        await _get_release(db, board, data["release_id"])
    for field, value in data.items():
        if field == "release_id" and value is None:
            continue
        setattr(epic, field, value)
    epic.updated_at = utc_now()
    await db.commit()
    await db.refresh(epic)
    return epic


@router.delete("/projects/{project_id}/board/epics/{epic_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_epic(
    project_id: UUID,
    epic_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft delete, cascading to its features (also soft-deleted -- the FK's
    ON DELETE CASCADE never fires now that epics are never really deleted,
    this replaces it explicitly). Requirements under it or its features are
    only unlinked, never deleted -- they carry real workflow state. Comments
    and attachments on the epic and its features cascade to soft-deleted
    too, since those belong to the thing that's gone; a requirement's own
    comments/attachments are untouched, since the requirement isn't going
    anywhere. Ported deletion semantics, software-management store.py's
    delete_epic."""
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    epic = await _get_epic(db, board, epic_id)
    feature_ids = list(
        (await db.execute(select(Feature.id).where(Feature.epic_id == epic.id, Feature.deleted_at.is_(None))))
        .scalars().all()
    )
    requirements = (
        await db.execute(
            select(Requirement).where(
                Requirement.board_id == board.id,
                (Requirement.epic_id == epic.id) | (Requirement.feature_id.in_(feature_ids)),
            )
        )
    ).scalars().all()
    for r in requirements:
        if r.epic_id == epic.id:
            r.epic_id = None
        if r.feature_id in feature_ids:
            r.feature_id = None
        r.updated_at = utc_now()
    now = utc_now()
    doomed_entity_ids = [epic.id, *feature_ids]
    if doomed_entity_ids:
        await db.execute(
            Comment.__table__.update()
            .where(Comment.board_id == board.id, Comment.entity_id.in_(doomed_entity_ids))
            .values(deleted_at=now)
        )
        await db.execute(
            Attachment.__table__.update()
            .where(Attachment.board_id == board.id, Attachment.entity_id.in_(doomed_entity_ids))
            .values(deleted_at=now)
        )
    if feature_ids:
        await db.execute(
            Feature.__table__.update().where(Feature.id.in_(feature_ids)).values(deleted_at=now)
        )
    epic.deleted_at = now
    await db.commit()


# ── Features ─────────────────────────────────────────────────────────────


async def _get_feature(db: AsyncSession, board: Board, feature_id: UUID) -> Feature:
    feature = (
        await db.execute(
            select(Feature).where(
                Feature.id == feature_id, Feature.board_id == board.id, Feature.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if feature is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature not found")
    return feature


@router.get("/projects/{project_id}/board/features", response_model=list[FeatureRead])
async def list_features(
    project_id: UUID,
    epic_id: UUID | None = Query(None),
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> list[Feature]:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    stmt = select(Feature).where(Feature.board_id == board.id, Feature.deleted_at.is_(None))
    if epic_id is not None:
        stmt = stmt.where(Feature.epic_id == epic_id)
    result = await db.execute(stmt.order_by(Feature.seq))
    return list(result.scalars().all())


@router.post("/projects/{project_id}/board/features", response_model=FeatureRead, status_code=status.HTTP_201_CREATED)
async def create_feature(
    project_id: UUID,
    payload: FeatureCreate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> Feature:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    await _get_epic(db, board, payload.epic_id)
    seq = await service._next_seq(db, board, "feature_seq")
    feature = Feature(board_id=board.id, account_id=board.account_id, seq=seq, **payload.model_dump())
    db.add(feature)
    await db.flush()
    await service.write_event(db, board, ctx.user_id, "feature.created", "feature", feature.id, {})
    await db.commit()
    await db.refresh(feature)
    return feature


@router.get("/projects/{project_id}/board/features/{feature_id}", response_model=FeatureRead)
async def get_feature(
    project_id: UUID,
    feature_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> Feature:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    return await _get_feature(db, board, feature_id)


@router.patch("/projects/{project_id}/board/features/{feature_id}", response_model=FeatureRead)
async def update_feature(
    project_id: UUID,
    feature_id: UUID,
    payload: FeatureUpdate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> Feature:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    feature = await _get_feature(db, board, feature_id)
    feature.title = payload.title
    feature.updated_at = utc_now()
    await db.commit()
    await db.refresh(feature)
    return feature


@router.delete("/projects/{project_id}/board/features/{feature_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_feature(
    project_id: UUID,
    feature_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft delete. Requirements under it are only unlinked, never deleted --
    they carry real workflow state, same principle as delete_epic. Their
    comments/attachments aren't touched either, since the requirements
    aren't going anywhere -- only the feature's own comments/attachments
    cascade to soft-deleted. Ported deletion semantics, software-management
    store.py's delete_feature."""
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    feature = await _get_feature(db, board, feature_id)
    requirements = (
        await db.execute(select(Requirement).where(Requirement.feature_id == feature.id))
    ).scalars().all()
    for r in requirements:
        r.feature_id = None
        r.updated_at = utc_now()
    now = utc_now()
    await db.execute(
        Comment.__table__.update()
        .where(Comment.board_id == board.id, Comment.entity_id == feature.id)
        .values(deleted_at=now)
    )
    await db.execute(
        Attachment.__table__.update()
        .where(Attachment.board_id == board.id, Attachment.entity_id == feature.id)
        .values(deleted_at=now)
    )
    feature.deleted_at = now
    await db.commit()


# ── Sprints ──────────────────────────────────────────────────────────────


async def _get_sprint(db: AsyncSession, board: Board, sprint_id: UUID) -> Sprint:
    sprint = (
        await db.execute(
            select(Sprint).where(
                Sprint.id == sprint_id, Sprint.board_id == board.id, Sprint.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if sprint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sprint not found")
    return sprint


@router.get("/projects/{project_id}/board/sprints", response_model=list[SprintRead])
async def list_sprints(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> list[Sprint]:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    result = await db.execute(
        select(Sprint).where(Sprint.board_id == board.id, Sprint.deleted_at.is_(None)).order_by(Sprint.seq)
    )
    return list(result.scalars().all())


@router.post("/projects/{project_id}/board/sprints", response_model=SprintRead, status_code=status.HTTP_201_CREATED)
async def create_sprint(
    project_id: UUID,
    payload: SprintCreate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> Sprint:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    if payload.release_id is not None:
        await _get_release(db, board, payload.release_id)
    seq = await service._next_seq(db, board, "sprint_seq")
    sprint = Sprint(board_id=board.id, account_id=board.account_id, seq=seq, **payload.model_dump())
    db.add(sprint)
    await db.flush()
    await service.write_event(db, board, ctx.user_id, "sprint.created", "sprint", sprint.id, {})
    await db.commit()
    await db.refresh(sprint)
    return sprint


@router.get("/projects/{project_id}/board/sprints/{sprint_id}", response_model=SprintRead)
async def get_sprint(
    project_id: UUID,
    sprint_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> Sprint:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    return await _get_sprint(db, board, sprint_id)


@router.patch("/projects/{project_id}/board/sprints/{sprint_id}", response_model=SprintUpdateResult)
async def update_sprint(
    project_id: UUID,
    sprint_id: UUID,
    payload: SprintUpdate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> SprintUpdateResult:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    sprint = await _get_sprint(db, board, sprint_id)
    data = payload.model_dump(exclude_unset=True)
    new_state = data.get("state")
    returned = 0
    if new_state is not None and new_state != sprint.state:
        returned = await service.apply_sprint_state_transition(db, board, sprint, new_state)
    clear_release = data.pop("clear_release", False)
    if clear_release:
        sprint.release_id = None
    elif data.get("release_id") is not None:
        await _get_release(db, board, data["release_id"])
    for field, value in data.items():
        if field == "release_id" and value is None:
            continue
        setattr(sprint, field, value)
    sprint.updated_at = utc_now()
    await db.commit()
    await db.refresh(sprint)
    return SprintUpdateResult(sprint=sprint, returned_to_backlog=returned)


@router.delete("/projects/{project_id}/board/sprints/{sprint_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sprint(
    project_id: UUID,
    sprint_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Only unlinks its requirements (sprint_id -> NULL, back to backlog),
    same deletion principle as releases/epics/features: a sprint is filing,
    requirements carry the real content."""
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    sprint = await _get_sprint(db, board, sprint_id)
    requirements = (
        await db.execute(select(Requirement).where(Requirement.sprint_id == sprint.id))
    ).scalars().all()
    for r in requirements:
        r.sprint_id = None
        r.updated_at = utc_now()
        await service.record_sprint_history(db, board, r)
    sprint.deleted_at = utc_now()
    await db.commit()


@router.get("/projects/{project_id}/board/sprints/{sprint_id}/burndown", response_model=BurndownRead)
async def get_sprint_burndown(
    project_id: UUID,
    sprint_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> BurndownRead:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    sprint = await _get_sprint(db, board, sprint_id)
    data = await service.sprint_burndown(db, board, sprint)
    return BurndownRead(
        sprint_id=data["sprint_id"],
        note=data["note"],
        total_start=data["total_start"],
        points=[{"day": p["day"], "remaining": p["remaining"], "ideal": p["ideal"]} for p in data["points"]],
    )


# ── Requirements ─────────────────────────────────────────────────────────


async def _get_requirement(db: AsyncSession, board: Board, requirement_id: UUID) -> Requirement:
    r = (
        await db.execute(
            select(Requirement).where(
                Requirement.id == requirement_id,
                Requirement.board_id == board.id,
                Requirement.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if r is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")
    return r


@router.get("/projects/{project_id}/board/requirements", response_model=list[RequirementRead])
async def list_requirements(
    project_id: UUID,
    status_filter: str | None = Query(None, alias="status"),
    epic_id: UUID | None = Query(None),
    feature_id: UUID | None = Query(None),
    sprint_id: UUID | None = Query(None),
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    stmt = select(Requirement).where(Requirement.board_id == board.id, Requirement.deleted_at.is_(None))
    if status_filter is not None:
        stmt = stmt.where(Requirement.status == status_filter)
    if epic_id is not None:
        stmt = stmt.where(Requirement.epic_id == epic_id)
    if feature_id is not None:
        stmt = stmt.where(Requirement.feature_id == feature_id)
    if sprint_id is not None:
        stmt = stmt.where(Requirement.sprint_id == sprint_id)
    requirements = list((await db.execute(stmt.order_by(Requirement.seq))).scalars().all())
    extras = await service.annotate_effective(db, board.id, requirements)
    return [
        {**RequirementRead.model_validate(r).model_dump(), **extra}
        for r, extra in zip(requirements, extras)
    ]


@router.post(
    "/projects/{project_id}/board/requirements", response_model=RequirementRead, status_code=status.HTTP_201_CREATED
)
async def create_requirement(
    project_id: UUID,
    payload: RequirementCreate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    seq = await service._next_seq(db, board, "requirement_seq")
    requirement = Requirement(board_id=board.id, account_id=board.account_id, seq=seq, **payload.model_dump())
    db.add(requirement)
    await db.flush()
    # Initial sprint membership, even NULL/backlog -- see service.record_sprint_history.
    await service.record_sprint_history(db, board, requirement)
    await service.write_event(db, board, ctx.user_id, "requirement.created", "requirement", requirement.id, {})
    await db.commit()
    await db.refresh(requirement)
    return await _requirement_read(db, board, requirement)


@router.get("/projects/{project_id}/board/requirements/{requirement_id}", response_model=RequirementRead)
async def get_requirement(
    project_id: UUID,
    requirement_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    requirement = await _get_requirement(db, board, requirement_id)
    return await _requirement_read(db, board, requirement)


@router.patch("/projects/{project_id}/board/requirements/{requirement_id}", response_model=RequirementRead)
async def update_requirement(
    project_id: UUID,
    requirement_id: UUID,
    payload: RequirementUpdate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    requirement = await _get_requirement(db, board, requirement_id)

    before = {"status": requirement.status, "sprint_id": requirement.sprint_id}
    data = payload.model_dump(exclude_unset=True)
    for clear_field, target in (
        ("clear_epic", "epic_id"), ("clear_feature", "feature_id"),
        ("clear_assignee", "assignee_id"), ("clear_release", "release_id"), ("clear_sprint", "sprint_id"),
    ):
        if data.pop(clear_field, False):
            setattr(requirement, target, None)
            data.pop(target, None)
    for field, value in data.items():
        if value is None and field in ("epic_id", "feature_id", "assignee_id", "release_id", "sprint_id"):
            continue
        setattr(requirement, field, value)
    requirement.updated_at = utc_now()

    after = {"status": requirement.status, "sprint_id": requirement.sprint_id}
    if before["sprint_id"] != after["sprint_id"]:
        # Logged only on an actual change, not every PATCH -- ported invariant,
        # see service.record_sprint_history's docstring.
        await service.record_sprint_history(db, board, requirement)
    changes = _diff(before, after, ("status", "sprint_id"))
    if changes:
        await service.write_event(db, board, ctx.user_id, "requirement.updated", "requirement", requirement.id, changes)

    await db.commit()
    await db.refresh(requirement)
    return await _requirement_read(db, board, requirement)


@router.delete("/projects/{project_id}/board/requirements/{requirement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_requirement(
    project_id: UUID,
    requirement_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft delete -- the only entity with no children of its own to cascade
    beyond its own comments/attachments. Ported deletion semantics,
    software-management store.py's delete_requirement."""
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    requirement = await _get_requirement(db, board, requirement_id)
    now = utc_now()
    await db.execute(
        Comment.__table__.update()
        .where(Comment.board_id == board.id, Comment.entity_id == requirement.id)
        .values(deleted_at=now)
    )
    await db.execute(
        Attachment.__table__.update()
        .where(Attachment.board_id == board.id, Attachment.entity_id == requirement.id)
        .values(deleted_at=now)
    )
    requirement.deleted_at = now
    await db.commit()


@router.post("/projects/{project_id}/board/requirements/{requirement_id}/claim", response_model=RequirementRead)
async def claim_requirement_route(
    project_id: UUID,
    requirement_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    result = await service.claim_requirement(db, board, requirement_id, ctx.user_id)
    if result == service.ClaimResult.NOT_FOUND:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found")
    if result == service.ClaimResult.NOT_CLAIMABLE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Requirement is no longer claimable")
    await db.commit()
    await db.refresh(result)
    return await _requirement_read(db, board, result)


# ── Docs ─────────────────────────────────────────────────────────────────


async def _get_doc(db: AsyncSession, board: Board, doc_id: UUID) -> Doc:
    doc = (
        await db.execute(
            select(Doc).where(Doc.id == doc_id, Doc.board_id == board.id, Doc.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Doc not found")
    return doc


@router.get("/projects/{project_id}/board/docs", response_model=list[DocRead])
async def list_docs(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> list[Doc]:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    result = await db.execute(
        select(Doc).where(Doc.board_id == board.id, Doc.deleted_at.is_(None)).order_by(Doc.seq)
    )
    return list(result.scalars().all())


@router.post("/projects/{project_id}/board/docs", response_model=DocRead, status_code=status.HTTP_201_CREATED)
async def create_doc(
    project_id: UUID,
    payload: DocCreate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> Doc:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    seq = await service._next_seq(db, board, "doc_seq")
    doc = Doc(board_id=board.id, account_id=board.account_id, seq=seq, created_by=ctx.user_id, **payload.model_dump())
    db.add(doc)
    await db.flush()
    await service.write_event(db, board, ctx.user_id, "doc.created", "doc", doc.id, {})
    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("/projects/{project_id}/board/docs/{doc_id}", response_model=DocRead)
async def get_doc(
    project_id: UUID,
    doc_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> Doc:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    return await _get_doc(db, board, doc_id)


@router.patch("/projects/{project_id}/board/docs/{doc_id}", response_model=DocRead)
async def update_doc(
    project_id: UUID,
    doc_id: UUID,
    payload: DocUpdate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> Doc:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    doc = await _get_doc(db, board, doc_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(doc, field, value)
    doc.updated_at = utc_now()
    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/projects/{project_id}/board/docs/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_doc(
    project_id: UUID,
    doc_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    doc = await _get_doc(db, board, doc_id)
    now = utc_now()
    await db.execute(
        Comment.__table__.update()
        .where(Comment.board_id == board.id, Comment.entity_id == doc.id)
        .values(deleted_at=now)
    )
    await db.execute(
        Attachment.__table__.update()
        .where(Attachment.board_id == board.id, Attachment.entity_id == doc.id)
        .values(deleted_at=now)
    )
    doc.deleted_at = now
    await db.commit()


# ── Comments ─────────────────────────────────────────────────────────────


@router.get("/projects/{project_id}/board/comments", response_model=list[CommentRead])
async def list_comments(
    project_id: UUID,
    entity_type: EntityType = Query(...),
    entity_id: UUID = Query(...),
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> list[Comment]:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    result = await db.execute(
        select(Comment)
        .where(
            Comment.board_id == board.id,
            Comment.entity_type == entity_type,
            Comment.entity_id == entity_id,
            Comment.deleted_at.is_(None),
        )
        .order_by(Comment.created_at)
    )
    return list(result.scalars().all())


@router.post("/projects/{project_id}/board/comments", response_model=CommentRead, status_code=status.HTTP_201_CREATED)
async def create_comment(
    project_id: UUID,
    payload: CommentCreate,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> Comment:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    if not await service.entity_exists(db, board.id, payload.entity_type, payload.entity_id):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Comment target does not exist")
    comment = Comment(board_id=board.id, account_id=board.account_id, author_id=ctx.user_id, **payload.model_dump())
    db.add(comment)
    await db.flush()
    await service.write_event(
        db, board, ctx.user_id, "comment.created", payload.entity_type, payload.entity_id, {"comment_id": str(comment.id)}
    )
    await db.commit()
    await db.refresh(comment)
    return comment


@router.delete("/projects/{project_id}/board/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    project_id: UUID,
    comment_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    comment = (
        await db.execute(
            select(Comment).where(
                Comment.id == comment_id, Comment.board_id == board.id, Comment.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if comment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found")
    comment.deleted_at = utc_now()
    await db.commit()


# ── Events (activity feed) ────────────────────────────────────────────────


@router.get("/projects/{project_id}/board/events", response_model=list[EventRead])
async def list_events(
    project_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    entity_type: str | None = Query(None),
    entity_id: UUID | None = Query(None),
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
):
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    stmt = select(Event).where(Event.board_id == board.id)
    if entity_type is not None:
        stmt = stmt.where(Event.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(Event.entity_id == entity_id)
    result = await db.execute(stmt.order_by(Event.created_at.desc()).limit(limit))
    return list(result.scalars().all())


# ── Attachments ──────────────────────────────────────────────────────────
#
# Reuses the same S3 bucket, presign helpers (storage.py) and pending/
# uploaded confirmation flow as project documents (documents.py) -- see that
# module's docstring for the security rationale (extension + MIME allow-list,
# magic-byte verification, random key, download forced as an attachment).


def _attachment_key(account_id: UUID, board_id: UUID, attachment_id: UUID, filename: str) -> str:
    return f"board-attachments/{account_id}/{board_id}/{attachment_id}/{filename}"


async def _get_attachment(db: AsyncSession, board: Board, attachment_id: UUID) -> Attachment:
    a = (
        await db.execute(
            select(Attachment).where(
                Attachment.id == attachment_id, Attachment.board_id == board.id, Attachment.deleted_at.is_(None)
            )
        )
    ).scalar_one_or_none()
    if a is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    return a


@router.get("/projects/{project_id}/board/attachments", response_model=list[AttachmentRead])
async def list_attachments(
    project_id: UUID,
    entity_type: str = Query(...),
    entity_id: UUID = Query(...),
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> list[Attachment]:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    result = await db.execute(
        select(Attachment).where(
            Attachment.board_id == board.id,
            Attachment.entity_type == entity_type,
            Attachment.entity_id == entity_id,
            Attachment.status == "uploaded",
            Attachment.deleted_at.is_(None),
        ).order_by(Attachment.created_at)
    )
    return list(result.scalars().all())


@router.post(
    "/projects/{project_id}/board/attachments",
    response_model=AttachmentUploadTicket,
    status_code=status.HTTP_201_CREATED,
)
async def request_attachment_upload(
    project_id: UUID,
    payload: AttachmentUploadRequest,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> AttachmentUploadTicket:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    if not await service.entity_exists(db, board.id, payload.entity_type, payload.entity_id):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Attachment target does not exist")

    settings = get_settings()
    max_bytes = settings.documents_max_bytes
    if payload.size_bytes > max_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="File too large")

    ext = payload.filename.rsplit(".", 1)[-1].lower() if "." in payload.filename else ""
    canonical = ALLOWED_TYPES.get(ext)
    if canonical is None or payload.content_type not in canonical[1]:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="File type not allowed")

    filename = sanitise_filename(payload.filename)
    attachment_id = uuid4()
    key = _attachment_key(board.account_id, board.id, attachment_id, filename)
    attachment = Attachment(
        id=attachment_id,
        board_id=board.id,
        account_id=board.account_id,
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        filename=filename,
        content_type=canonical[0],
        size_bytes=payload.size_bytes,
        s3_key=key,
        status="pending",
        created_by=ctx.user_id,
    )
    db.add(attachment)
    await db.commit()

    url = storage.presign_put(key, canonical[0], payload.size_bytes, PRESIGN_TTL_SECONDS)
    return AttachmentUploadTicket(attachment_id=attachment_id, upload_url=url, expires_in=PRESIGN_TTL_SECONDS)


@router.post("/projects/{project_id}/board/attachments/{attachment_id}/confirm", response_model=AttachmentRead)
async def confirm_attachment_upload(
    project_id: UUID,
    attachment_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> Attachment:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    attachment = await _get_attachment(db, board, attachment_id)
    try:
        info = await storage.head_object(attachment.s3_key)
    except storage.ObjectMissing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Upload not found in storage")
    if info.size != attachment.size_bytes:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Uploaded size does not match")
    attachment.status = "uploaded"
    attachment.updated_at = utc_now()
    await service.write_event(
        db, board, ctx.user_id, "attachment.uploaded", attachment.entity_type, attachment.entity_id,
        {"attachment_id": str(attachment.id), "filename": attachment.filename},
    )
    await db.commit()
    await db.refresh(attachment)
    return attachment


@router.get("/projects/{project_id}/board/attachments/{attachment_id}/download", response_model=AttachmentDownload)
async def download_attachment(
    project_id: UUID,
    attachment_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:read")),
    db: AsyncSession = Depends(get_db),
) -> AttachmentDownload:
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    attachment = await _get_attachment(db, board, attachment_id)
    if attachment.status != "uploaded":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    url = storage.presign_get(attachment.s3_key, attachment.filename, PRESIGN_TTL_SECONDS)
    return AttachmentDownload(url=url, expires_in=PRESIGN_TTL_SECONDS)


@router.delete("/projects/{project_id}/board/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_attachment(
    project_id: UUID,
    attachment_id: UUID,
    ctx: ScopeContext = Depends(require_permission("board:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft-deletes the row (so it can, in principle, still be reasoned
    about/restored later) but the underlying S3 object is genuinely removed
    immediately -- keeping the file itself around isn't free, and there's no
    restore UI yet to make that trade-off worthwhile."""
    project = await get_project(db, project_id, ctx)
    board = await _board(db, project)
    attachment = await _get_attachment(db, board, attachment_id)
    await storage.delete_object(attachment.s3_key)
    attachment.deleted_at = utc_now()
    await db.commit()
