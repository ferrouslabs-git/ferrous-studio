"""The platform admins' cross-project Kanban (FS-REQ-101).

One read: every live requirement, across every organisation's board, whose
sprint runs during a given week (Monday to Sunday). A sprint "runs during"
the week when its [start_date, end_date] overlaps it; a sprint with only one
date set counts as that single day, and one with neither never shows.

Moving a card is NOT done here. The page calls the ordinary requirement PATCH
for the card's project, under that project's organisation scope, so the
status rules (blocked_from bookkeeping, the event feed, waking an agent) live
in exactly one place: ``routes.update_requirement``.

Like ``/admin/projects`` this spans organisations, so it carries no scope
context: the platform-admin check is explicit and RLS is told to stand aside
(``allow_cross_account``).
"""
import datetime as dt
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.api.route_helpers import ensure_platform_admin
from app.auth.database import get_db
from app.auth.models.tenant import Tenant
from app.auth.models.user import User
from app.auth.security import get_current_user

from ..common import allow_cross_account
from ..models import Project
from .models import Board, Requirement, Sprint

router = APIRouter()


def week_bounds(day: dt.date) -> tuple[dt.date, dt.date]:
    """The Monday and Sunday of the week ``day`` falls in."""
    start = day - dt.timedelta(days=day.weekday())
    return start, start + dt.timedelta(days=6)


def sprint_in_week(start: dt.date | None, end: dt.date | None, week_start: dt.date, week_end: dt.date) -> bool:
    """Whether a sprint dated [start, end] overlaps the week. The pure twin of
    the SQL condition in ``kanban_week`` -- keep the two in step."""
    lo = start or end
    hi = end or start
    if lo is None or hi is None:
        return False
    return lo <= week_end and hi >= week_start


class KanbanAssignee(BaseModel):
    id: UUID
    name: str


class KanbanSprint(BaseModel):
    id: UUID
    human_id: str
    name: str
    start_date: dt.date | None
    end_date: dt.date | None


class KanbanItem(BaseModel):
    id: UUID
    human_id: str
    title: str
    status: str
    priority: str
    assignee: KanbanAssignee | None
    #: The project's newest version: the one a card names and opens.
    project_id: UUID
    project_name: str
    #: Shared by every version, so a saved project filter survives a new version.
    lineage_id: UUID
    account_id: UUID
    account_name: str
    sprint: KanbanSprint


class KanbanWeek(BaseModel):
    week_start: dt.date
    week_end: dt.date
    items: list[KanbanItem]


@router.get("/admin/kanban", response_model=KanbanWeek)
async def kanban_week(
    week: dt.date | None = Query(None, description="Any day in the week; defaults to today."),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> KanbanWeek:
    await ensure_platform_admin(current_user, "see work across organisations", db, permission="accounts:read")
    await allow_cross_account(db)
    week_start, week_end = week_bounds(week or dt.date.today())

    # The board is shared by every version of a project; the newest version
    # is the one people open, so it is the one a card names and links to
    # (as slack_notify._project_url does).
    newest = (
        select(
            Project.id.label("project_id"),
            Project.name.label("project_name"),
            Project.account_id,
            Project.lineage_id,
            func.row_number()
            .over(partition_by=(Project.account_id, Project.lineage_id), order_by=Project.version_no.desc())
            .label("rank"),
        )
        .subquery()
    )

    sprint_lo = func.coalesce(Sprint.start_date, Sprint.end_date)
    sprint_hi = func.coalesce(Sprint.end_date, Sprint.start_date)
    stmt = (
        select(Requirement, Sprint, Board, newest.c.project_id, newest.c.project_name, Tenant.name, User)
        .join(Sprint, Sprint.id == Requirement.sprint_id)
        .join(Board, Board.id == Requirement.board_id)
        .join(
            newest,
            and_(
                newest.c.account_id == Board.account_id,
                newest.c.lineage_id == Board.lineage_id,
                newest.c.rank == 1,
            ),
        )
        .join(Tenant, Tenant.id == Board.account_id)
        .outerjoin(User, User.id == Requirement.assignee_id)
        .where(
            Requirement.live(),
            Sprint.deleted_at.is_(None),
            sprint_lo <= week_end,
            sprint_hi >= week_start,
        )
        .order_by(newest.c.project_name, Requirement.seq)
    )
    rows = (await db.execute(stmt)).all()

    items = [
        KanbanItem(
            id=r.id,
            # Board is loaded in the same row, which records its key, so the
            # ids come out prefixed (IA-REQ-5) as everywhere else.
            human_id=r.human_id,
            title=r.title,
            status=r.status,
            priority=r.priority,
            assignee=KanbanAssignee(id=u.id, name=u.name or u.email) if u is not None else None,
            project_id=project_id,
            project_name=project_name,
            lineage_id=board.lineage_id,
            account_id=board.account_id,
            account_name=account_name,
            sprint=KanbanSprint(
                id=s.id, human_id=s.human_id, name=s.name, start_date=s.start_date, end_date=s.end_date
            ),
        )
        for r, s, board, project_id, project_name, account_name, u in rows
    ]
    return KanbanWeek(week_start=week_start, week_end=week_end, items=items)
