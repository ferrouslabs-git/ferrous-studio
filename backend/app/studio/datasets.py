"""Dataset routes: reusable value lists wireframe elements bind to.

Two scopes share one read model. *Platform* datasets are the defaults every
project sees; they are managed by platform admins under ``/admin/datasets``
and are read-only from inside a project. *Project* datasets belong to one
project (and so to its organisation) and are full CRUD under the usual
scoped routes. A project's listing merges both, platform defaults first.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.api.route_helpers import ensure_platform_admin
from app.auth.database import get_db
from app.auth.models.user import User
from app.auth.security import get_current_user, require_permission
from app.auth.security.scope_context import ScopeContext

from .common import get_project, get_writable_project, next_pos
from .models import Dataset, PlatformDataset, Project, utc_now
from .schemas import DatasetCreate, DatasetRead, DatasetUpdate

router = APIRouter()


def _read(row: Dataset | PlatformDataset, scope: str) -> DatasetRead:
    return DatasetRead.model_validate(row).model_copy(update={"scope": scope})


async def _platform_reads(db: AsyncSession) -> list[DatasetRead]:
    result = await db.execute(select(PlatformDataset).order_by(PlatformDataset.pos.asc()))
    return [_read(row, "platform") for row in result.scalars().all()]


async def _project_reads(db: AsyncSession, project: Project) -> list[DatasetRead]:
    result = await db.execute(
        select(Dataset)
        .where(Dataset.project_id == project.id, Dataset.account_id == project.account_id)
        .order_by(Dataset.pos.asc())
    )
    return [_read(row, "project") for row in result.scalars().all()]


async def merged_dataset_reads(db: AsyncSession, project: Project) -> list[DatasetRead]:
    """Everything the project can bind to: platform defaults, then its own.
    Also feeds the export envelope, so exported dataset ids stay resolvable."""
    return [*await _platform_reads(db), *await _project_reads(db, project)]


async def _dataset(db: AsyncSession, project: Project, dataset_id: UUID) -> Dataset:
    result = await db.execute(
        select(Dataset).where(
            Dataset.id == dataset_id,
            Dataset.project_id == project.id,
            Dataset.account_id == project.account_id,
        )
    )
    dataset = result.scalar_one_or_none()
    if dataset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")
    return dataset


# ── Project datasets ────────────────────────────────────────────────────────


@router.get("/projects/{project_id}/datasets", response_model=list[DatasetRead])
async def list_datasets(
    project_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> list[DatasetRead]:
    project = await get_project(db, project_id, ctx)
    return await merged_dataset_reads(db, project)


@router.post("/projects/{project_id}/datasets", response_model=DatasetRead, status_code=status.HTTP_201_CREATED)
async def create_dataset(
    project_id: UUID,
    payload: DatasetCreate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> DatasetRead:
    project = await get_writable_project(db, project_id, ctx)
    data = payload.model_dump()
    pos = data.pop("pos") or await next_pos(db, Dataset, Dataset.project_id == project.id)
    dataset = Dataset(project_id=project.id, account_id=project.account_id, created_by=ctx.user_id, pos=pos, **data)
    db.add(dataset)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(dataset)
    return _read(dataset, "project")


@router.patch("/projects/{project_id}/datasets/{dataset_id}", response_model=DatasetRead)
async def update_dataset(
    project_id: UUID,
    dataset_id: UUID,
    payload: DatasetUpdate,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> DatasetRead:
    project = await get_writable_project(db, project_id, ctx)
    dataset = await _dataset(db, project, dataset_id)
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        setattr(dataset, field_name, value)
    project.updated_at = utc_now()
    await db.commit()
    await db.refresh(dataset)
    return _read(dataset, "project")


@router.delete("/projects/{project_id}/datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(
    project_id: UUID,
    dataset_id: UUID,
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Elements that bound this dataset fall back to their manual values on
    render, so nothing else needs scrubbing."""
    project = await get_writable_project(db, project_id, ctx)
    dataset = await _dataset(db, project, dataset_id)
    await db.delete(dataset)
    project.updated_at = utc_now()
    await db.commit()


# ── Platform datasets (super admin only) ────────────────────────────────────
# Like /admin/projects these span organisations, so they carry no scope
# context and check the platform-admin flag explicitly. platform_datasets has
# no account column and no RLS, so no allow_cross_account is needed.


async def _platform_dataset(db: AsyncSession, dataset_id: UUID) -> PlatformDataset:
    result = await db.execute(select(PlatformDataset).where(PlatformDataset.id == dataset_id))
    dataset = result.scalar_one_or_none()
    if dataset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")
    return dataset


@router.get("/admin/datasets", response_model=list[DatasetRead])
async def list_platform_datasets(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DatasetRead]:
    await ensure_platform_admin(current_user, "list platform datasets", db, permission="accounts:read")
    return await _platform_reads(db)


@router.post("/admin/datasets", response_model=DatasetRead, status_code=status.HTTP_201_CREATED)
async def create_platform_dataset(
    payload: DatasetCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DatasetRead:
    await ensure_platform_admin(current_user, "create platform dataset", db)
    data = payload.model_dump()
    pos = data.pop("pos") or await next_pos(db, PlatformDataset)
    dataset = PlatformDataset(created_by=current_user.id, pos=pos, **data)
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)
    return _read(dataset, "platform")


@router.patch("/admin/datasets/{dataset_id}", response_model=DatasetRead)
async def update_platform_dataset(
    dataset_id: UUID,
    payload: DatasetUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DatasetRead:
    await ensure_platform_admin(current_user, "update platform dataset", db)
    dataset = await _platform_dataset(db, dataset_id)
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        if value is None:
            continue
        setattr(dataset, field_name, value)
    await db.commit()
    await db.refresh(dataset)
    return _read(dataset, "platform")


@router.delete("/admin/datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_platform_dataset(
    dataset_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await ensure_platform_admin(current_user, "delete platform dataset", db)
    dataset = await _platform_dataset(db, dataset_id)
    await db.delete(dataset)
    await db.commit()
