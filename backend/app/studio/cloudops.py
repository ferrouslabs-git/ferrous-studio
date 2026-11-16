"""CloudOps admin API (INT-REQ-14, phase 1: the Costs report).

Platform administrators only, and only in environments where ``CLOUDOPS_ENABLED`` is on (prod by
default). The task role is shared by staging and prod, so the switch is what stops staging acting on
the account.

Opening the page reads the latest saved report and makes **no** AWS call. Only ``POST .../refresh``
asks Cost Explorer (about a cent a call, a few cents a refresh) and saves the result.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.api.route_helpers import ensure_platform_admin
from app.auth.database import get_db
from app.auth.models.user import User
from app.auth.security import get_current_user
from app.config import get_settings

from .cloudops_report import build_report, fetch_raw
from .models import CloudopsCostSnapshot, utc_now

router = APIRouter()

#: How many saved reports to keep; older ones are removed on each refresh.
KEEP_SNAPSHOTS = 50
#: A refresh within this many seconds of the last one returns the last one, so a double click costs nothing.
MIN_REFRESH_SECONDS = 60


class CostSnapshotRead(BaseModel):
    id: UUID
    created_at: datetime
    created_by: str | None = None
    report: dict[str, Any]


class CostsResponse(BaseModel):
    enabled: bool
    snapshot: CostSnapshotRead | None = None


def _run_report() -> dict[str, Any]:
    """The only place that talks to Cost Explorer. Runs in a worker thread (boto3 blocks)."""
    import boto3

    ce = boto3.client("ce", region_name="us-east-1")   # Cost Explorer is served from us-east-1
    today = datetime.now(timezone.utc).date()
    return build_report(fetch_raw(ce, today), today)


def _read(row: CloudopsCostSnapshot, who: str | None) -> CostSnapshotRead:
    return CostSnapshotRead(id=row.id, created_at=row.created_at, created_by=who, report=row.report)


async def _latest(db: AsyncSession) -> CostSnapshotRead | None:
    result = await db.execute(
        select(CloudopsCostSnapshot, User.email)
        .outerjoin(User, User.id == CloudopsCostSnapshot.created_by)
        .order_by(CloudopsCostSnapshot.created_at.desc())
        .limit(1)
    )
    row = result.first()
    return _read(row[0], row[1]) if row else None


@router.get("/admin/cloudops/costs", response_model=CostsResponse)
async def get_costs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CostsResponse:
    await ensure_platform_admin(current_user, "view the CloudOps costs", db, permission="accounts:read")
    if not get_settings().cloudops_enabled:
        return CostsResponse(enabled=False)
    return CostsResponse(enabled=True, snapshot=await _latest(db))


@router.post("/admin/cloudops/costs/refresh", response_model=CostsResponse)
async def refresh_costs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CostsResponse:
    await ensure_platform_admin(current_user, "refresh the CloudOps costs", db)
    if not get_settings().cloudops_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "CloudOps is not enabled in this environment")

    latest = await _latest(db)
    if latest and (utc_now() - latest.created_at) < timedelta(seconds=MIN_REFRESH_SECONDS):
        return CostsResponse(enabled=True, snapshot=latest)

    try:
        report = await asyncio.to_thread(_run_report)
    except Exception as exc:  # AWS refused, or the call failed: say so plainly, never a bare 500
        name = type(exc).__name__
        denied = "AccessDenied" in name or "AccessDenied" in str(exc)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Cost Explorer refused the request: the Studio task role needs Cost Explorer read permission"
            if denied else f"Could not fetch the AWS cost report ({name})",
        ) from exc

    row = CloudopsCostSnapshot(report=report, created_by=current_user.id)
    db.add(row)
    await db.flush()
    keep = select(CloudopsCostSnapshot.id).order_by(CloudopsCostSnapshot.created_at.desc()).limit(KEEP_SNAPSHOTS)
    await db.execute(delete(CloudopsCostSnapshot).where(CloudopsCostSnapshot.id.not_in(keep)))
    await db.commit()
    await db.refresh(row)
    return CostsResponse(enabled=True, snapshot=_read(row, current_user.email))
