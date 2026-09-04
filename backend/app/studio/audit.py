"""Wireframe audit log: who changed what, and when.

An *activity* log, not a tamper-evident compliance trail. Rows are written
inside the same transaction as the change they record, so the log and the
data can never disagree. The log is append-only with one deliberate
exception: repeated canvas edits by the same user on the same page coalesce
into a single ``page_edited`` row per editing session (a gap of
``COALESCE_GAP`` starts a new session), whose ``updated_at`` and
``detail.batches`` are bumped in place -- hundreds of near-identical rows per
session would drown the readable events.

The actor's name and email are snapshotted onto the row at write time so the
trail survives user deletion; ``user_id`` stays for filtering while the user
exists.
"""
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.models.user import User
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext

from .common import get_project, get_wireframe
from .models import Project, Wireframe, WireframeAuditLog, utc_now
from .schemas import AuditEventRead, AuditPage

router = APIRouter()

COALESCE_GAP = timedelta(minutes=30)


def should_coalesce(last_updated_at: datetime | None, now: datetime, gap: timedelta = COALESCE_GAP) -> bool:
    """Is a previous ``page_edited`` row still "this editing session"?

    True when the row exists and its last bump is within ``gap`` of now. A
    future-skewed timestamp also coalesces -- clock skew should not split a
    session into spurious rows.
    """
    if last_updated_at is None:
        return False
    return now - last_updated_at < gap


async def record_event(
    db: AsyncSession,
    *,
    project: Project,
    wireframe: Wireframe | None,
    user_id: UUID | None,
    event: str,
    page_id: UUID | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    """Append one audit row; the calling route's commit lands it atomically
    with the change being audited.

    ``wireframe`` is None for project-level events -- a version created, locked
    or unlocked -- which belong to the project rather than to any one wireframe.
    """
    user = await db.get(User, user_id) if user_id else None
    db.add(
        WireframeAuditLog(
            project_id=project.id,
            wireframe_id=wireframe.id if wireframe else None,
            account_id=project.account_id,
            user_id=user_id,
            user_name=user.name if user else None,
            user_email=user.email if user else None,
            event=event,
            page_id=page_id,
            detail=detail or {},
        )
    )


async def record_page_edit(
    db: AsyncSession,
    *,
    project: Project,
    wireframe: Wireframe,
    user_id: UUID | None,
    page_id: UUID,
    page_name: str,
) -> None:
    """Coalesce this batch into the user's current editing session on the
    page, or start a new session row. Two batches from the same user racing
    can at worst produce an extra session row or lose one ``batches``
    increment -- cosmetic, not worth locking."""
    row = (
        await db.execute(
            select(WireframeAuditLog)
            .where(
                WireframeAuditLog.wireframe_id == wireframe.id,
                WireframeAuditLog.account_id == project.account_id,
                WireframeAuditLog.user_id == user_id,
                WireframeAuditLog.event == "page_edited",
                WireframeAuditLog.page_id == page_id,
            )
            .order_by(WireframeAuditLog.updated_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    now = utc_now()
    if row is not None and should_coalesce(row.updated_at, now):
        row.updated_at = now
        # A new dict, so SQLAlchemy sees the JSONB change.
        row.detail = {
            **(row.detail or {}),
            "batches": int((row.detail or {}).get("batches", 1)) + 1,
            "page_name": page_name,
        }
        return
    await record_event(
        db,
        project=project,
        wireframe=wireframe,
        user_id=user_id,
        event="page_edited",
        page_id=page_id,
        detail={"page_name": page_name, "batches": 1},
    )


@router.get("/projects/{project_id}/wireframes/{wireframe_id}/audit", response_model=AuditPage)
async def list_audit(
    project_id: UUID,
    wireframe_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    before: datetime | None = None,
    ctx: ScopeContext = Depends(require_permission("data:read")),
    db: AsyncSession = Depends(get_db),
) -> AuditPage:
    """Newest first, keyset-paged on ``created_at`` (the session start) so
    cursors stay stable while an open session's ``updated_at`` keeps moving."""
    project = await get_project(db, project_id, ctx)
    wireframe = await get_wireframe(db, project, wireframe_id)
    stmt = (
        select(WireframeAuditLog)
        .where(
            WireframeAuditLog.wireframe_id == wireframe.id,
            WireframeAuditLog.account_id == ctx.scope_id,
        )
        .order_by(WireframeAuditLog.created_at.desc(), WireframeAuditLog.id.desc())
        .limit(limit + 1)
    )
    if before is not None:
        stmt = stmt.where(WireframeAuditLog.created_at < before)
    rows = list((await db.execute(stmt)).scalars().all())
    has_more = len(rows) > limit
    rows = rows[:limit]
    return AuditPage(
        events=[AuditEventRead.model_validate(row) for row in rows],
        has_more=has_more,
        next_before=rows[-1].created_at if rows and has_more else None,
    )
