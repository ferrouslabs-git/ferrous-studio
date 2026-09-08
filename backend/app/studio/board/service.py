"""Board business logic: the algorithms worth preserving from SMA
(Fnai-sma/software-management-app, origin/sma/v0), reimplemented once instead
of duplicated. See alembic/versions/d4f7b2a9c631_board_schema.py for the
schema this operates on and what changed from SMA's shape.

Consolidation, not a literal port: SMA computes "effective epic" and its
status-weighted progress rollup independently in 4-5 places (frontend JS in
three files, plus sma_mcp.py) that could drift from each other. Here it is
one function each, used everywhere.
"""
from __future__ import annotations

import datetime as dt
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Project
from .models import (
    Board,
    Doc,
    Epic,
    Event,
    Feature,
    Release,
    Requirement,
    RequirementSprintHistory,
    Sprint,
    utc_now,
)


# ── Board resolution ─────────────────────────────────────────────────────


async def get_or_create_board(db: AsyncSession, project: Project) -> Board:
    """One board per (account_id, lineage_id) -- not per project row, since a
    project row is one version and versioning deep-copies it (see the
    migration's docstring). Created lazily on first access."""
    board = (
        await db.execute(
            select(Board).where(Board.account_id == project.account_id, Board.lineage_id == project.lineage_id)
        )
    ).scalar_one_or_none()
    if board is not None:
        return board

    board = Board(account_id=project.account_id, lineage_id=project.lineage_id)
    db.add(board)
    await db.flush()
    return board


async def _lock_board(db: AsyncSession, board: Board) -> Board:
    """Re-select the board FOR UPDATE. Same identity-mapped object within one
    session, so mutating the returned row also mutates ``board``."""
    return (await db.execute(select(Board).where(Board.id == board.id).with_for_update())).scalar_one()


async def _next_seq(db: AsyncSession, board: Board, column: str) -> int:
    """Mint the next per-board, per-entity-type human-id number under a row
    lock -- same pattern as wireframes.note_seq/task_seq
    (app/studio/annotations.py), applied to the board row instead. Flat and
    per-board, unlike SMA's global sequences (store.py's epic_id_seq etc,
    which only work because SMA has exactly one board) or its per-epic
    regex-MAX feature numbering (store.py:810-815, which SMA's own comments
    flag as race-fragile against concurrent inserts under the same epic)."""
    locked = await _lock_board(db, board)
    value = getattr(locked, column) + 1
    setattr(locked, column, value)
    return value


# ── Effective epic / release inheritance ─────────────────────────────────
#
# SMA has no function named effectiveRelease() or effort.js -- confirmed by
# exhaustive search of its history. The real logic (sma_mcp.py:93-101,
# static/js/features.js:22-24) is: a requirement's effective epic is its own
# epic_id if set, else its feature's epic_id; its effective release is its
# own release_id if set, else its effective epic's release_id. Kept here as
# one function instead of duplicated per caller.


async def _epic_release_map(db: AsyncSession, board_id: UUID) -> dict[UUID, UUID | None]:
    rows = (
        await db.execute(
            select(Epic.id, Epic.release_id).where(Epic.board_id == board_id, Epic.deleted_at.is_(None))
        )
    ).all()
    return {epic_id: release_id for epic_id, release_id in rows}


async def _feature_epic_map(db: AsyncSession, board_id: UUID) -> dict[UUID, UUID]:
    rows = (
        await db.execute(
            select(Feature.id, Feature.epic_id).where(Feature.board_id == board_id, Feature.deleted_at.is_(None))
        )
    ).all()
    return {feature_id: epic_id for feature_id, epic_id in rows}


def effective_epic_id(requirement: Requirement, feature_epic: dict[UUID, UUID]) -> UUID | None:
    if requirement.epic_id is not None:
        return requirement.epic_id
    if requirement.feature_id is not None:
        return feature_epic.get(requirement.feature_id)
    return None


def effective_release_id(
    requirement: Requirement, feature_epic: dict[UUID, UUID], epic_release: dict[UUID, UUID | None]
) -> UUID | None:
    if requirement.release_id is not None:
        return requirement.release_id
    eff_epic = effective_epic_id(requirement, feature_epic)
    return epic_release.get(eff_epic) if eff_epic is not None else None


async def annotate_effective(db: AsyncSession, board_id: UUID, requirements: list[Requirement]) -> list[dict]:
    """Requirement rows plus their effective_epic_id/effective_release_id, for
    API responses. One query each for the board's epics/features rather than
    N+1 per requirement."""
    feature_epic = await _feature_epic_map(db, board_id)
    epic_release = await _epic_release_map(db, board_id)
    out = []
    for r in requirements:
        out.append({
            "effective_epic_id": effective_epic_id(r, feature_epic),
            "effective_release_id": effective_release_id(r, feature_epic, epic_release),
        })
    return out


# ── Progress rollup ───────────────────────────────────────────────────────
#
# Status-weighted score: 1.0 per Done, 0.5 per Doing, 0 per Todo. SMA
# reimplements this formula independently at roadmap.js:11-23 (epic),
# features.js:124-128 (feature, inline), sprints.js:11-18 (sprint),
# milestones.js:7-24 (release, as a rollup-of-rollups over epics), and again
# in sma_mcp.py's list_milestones(). One implementation here.


def progress_rollup(requirements: list[Requirement]) -> dict:
    total = len(requirements)
    done = sum(1 for r in requirements if r.status == "Done")
    doing = sum(1 for r in requirements if r.status == "Doing")
    score = done + doing * 0.5
    pct = round(100 * score / total) if total else 0
    return {"done": done, "doing": doing, "total": total, "pct": pct}


async def release_dates_map(db: AsyncSession, board_id: UUID) -> dict[UUID, dt.date | None]:
    """A release's date is the end of the latest sprint filed under it --
    ported from software-management's RELEASE_DATE_SQL (store.py). Answers
    "when does this land?" from the sprints actually planned to deliver it,
    so moving a sprint moves the release automatically instead of the two
    drifting apart (the previous design: a plain editable date field)."""
    rows = (
        await db.execute(
            select(Sprint.release_id, func.max(Sprint.end_date))
            .where(Sprint.board_id == board_id, Sprint.deleted_at.is_(None), Sprint.end_date.isnot(None))
            .group_by(Sprint.release_id)
        )
    ).all()
    return {release_id: max_end for release_id, max_end in rows if release_id is not None}


async def release_progress_map(db: AsyncSession, board_id: UUID) -> dict[UUID, dict]:
    """Rolls up a release's whole backlog -- every requirement whose
    *effective* release is this one (effective_release_id, above), whether
    it got there through an epic, a feature under an epic, or by being
    tagged directly. Ported from software-management's releaseProgress
    (static/js/releases.js), which flags the same thing this fixes: walking
    linked epics only misses a requirement tagged straight to the release
    with no epic."""
    requirements = list(
        (await db.execute(select(Requirement).where(Requirement.board_id == board_id))).scalars().all()
    )
    feature_epic = await _feature_epic_map(db, board_id)
    epic_release = await _epic_release_map(db, board_id)
    by_release: dict[UUID, list[Requirement]] = {}
    for r in requirements:
        rid = effective_release_id(r, feature_epic, epic_release)
        if rid is not None:
            by_release.setdefault(rid, []).append(r)
    return {release_id: progress_rollup(reqs) for release_id, reqs in by_release.items()}


async def board_summary(db: AsyncSession, board: Board) -> dict:
    epics = list(
        (
            await db.execute(
                select(Epic).where(Epic.board_id == board.id, Epic.deleted_at.is_(None)).order_by(Epic.seq)
            )
        ).scalars().all()
    )
    requirements = list(
        (
            await db.execute(
                select(Requirement).where(Requirement.board_id == board.id, Requirement.deleted_at.is_(None))
            )
        ).scalars().all()
    )
    feature_epic = await _feature_epic_map(db, board.id)

    by_epic: dict[UUID, list[Requirement]] = {e.id: [] for e in epics}
    status_counts: dict[str, int] = {}
    for r in requirements:
        status_counts[r.status] = status_counts.get(r.status, 0) + 1
        eff_epic = effective_epic_id(r, feature_epic)
        if eff_epic in by_epic:
            by_epic[eff_epic].append(r)

    return {
        "epics": [{"epic": e, "progress": progress_rollup(by_epic[e.id])} for e in epics],
        "status_counts": status_counts,
    }


# ── Entity existence (for comments/attachments' polymorphic entity_id) ────
#
# Not FK-constrained -- validity is an application-level probe, mirroring
# SMA's own comments.entity_id (store.py:288-294, 583-595: a UNION ALL over
# every commentable table). A real polymorphic FK would need a constraint
# trigger; SMA never needed one and neither do we.

_ENTITY_TABLES = {
    "release": Release,
    "epic": Epic,
    "feature": Feature,
    "requirement": Requirement,
    "sprint": Sprint,
    "doc": Doc,
}


async def entity_exists(db: AsyncSession, board_id: UUID, entity_type: str, entity_id: UUID) -> bool:
    model = _ENTITY_TABLES.get(entity_type)
    if model is None:
        return False
    result = await db.execute(
        select(model.id).where(model.board_id == board_id, model.id == entity_id, model.deleted_at.is_(None))
    )
    return result.scalar_one_or_none() is not None


# ── Events ────────────────────────────────────────────────────────────────


async def write_event(
    db: AsyncSession,
    board: Board,
    actor_id: UUID | None,
    action: str,
    entity_type: str,
    entity_id: UUID,
    detail: dict | None = None,
) -> None:
    db.add(Event(
        board_id=board.id,
        account_id=board.account_id,
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        detail=detail or {},
    ))


# ── Sprint membership history (burndown input) ───────────────────────────
#
# Written on create (initial sprint, even NULL/backlog) and on update only
# when sprint_id actually changes. Ported invariant -- SMA store.py:878-881,
# 894-900: a naive "log on transition to non-null" port would silently break
# the "born in the backlog" case burndown's total_start depends on.


async def record_sprint_history(db: AsyncSession, board: Board, requirement: Requirement) -> None:
    db.add(RequirementSprintHistory(
        board_id=board.id,
        account_id=board.account_id,
        requirement_id=requirement.id,
        sprint_id=requirement.sprint_id,
    ))


# ── Sprint state transition side effects ─────────────────────────────────
#
# Ported near-as-is from SMA's update_sprint (store.py:1071-1113): (1) only
# one active sprint per board at a time -- promoting one demotes any other
# active sprint; (2) completing a sprint (-> 'done', only on that exact
# transition) returns every non-Done requirement in it to the backlog
# (sprint_id = NULL), Done ones keep their sprint tag. Enforced here in
# Python rather than a DB constraint, matching SMA's own choice.


async def apply_sprint_state_transition(db: AsyncSession, board: Board, sprint: Sprint, new_state: str) -> int:
    """Call BEFORE setting sprint.state = new_state. Returns the count of
    requirements returned to the backlog (0 unless this is a ->'done' move)."""
    if new_state == "active" and sprint.state != "active":
        others = (
            await db.execute(
                select(Sprint).where(Sprint.board_id == board.id, Sprint.id != sprint.id, Sprint.state == "active")
            )
        ).scalars().all()
        for other in others:
            other.state = "planned"

    returned_to_backlog = 0
    if new_state == "done" and sprint.state != "done":
        requirements = (
            await db.execute(
                select(Requirement).where(
                    Requirement.board_id == board.id,
                    Requirement.sprint_id == sprint.id,
                    Requirement.status != "Done",
                )
            )
        ).scalars().all()
        for r in requirements:
            r.sprint_id = None
            r.updated_at = utc_now()
            await record_sprint_history(db, board, r)
        returned_to_backlog = len(requirements)

    return returned_to_backlog


# ── Claim (atomic SELECT ... FOR UPDATE) ─────────────────────────────────
#
# Ported near-as-is from SMA's claim_requirement (store.py:907-936). The
# invariant: two concurrent claimants racing the same Todo requirement must
# not both believe they won. FOR UPDATE serialises them on the row; the
# status check happens AFTER the lock, so the second caller (which blocked)
# sees the already-Doing status and correctly loses, instead of a bare
# UPDATE ... WHERE status='Todo' letting both callers believe success.


class ClaimResult:
    NOT_FOUND = "not_found"
    NOT_CLAIMABLE = "not_claimable"


async def claim_requirement(
    db: AsyncSession, board: Board, requirement_id: UUID, actor_id: UUID
) -> Requirement | str:
    """Returns the updated Requirement, or one of ClaimResult's string
    constants (caller maps NOT_FOUND -> 404, NOT_CLAIMABLE -> 409)."""
    row = (
        await db.execute(
            select(Requirement)
            .where(
                Requirement.id == requirement_id,
                Requirement.board_id == board.id,
                Requirement.deleted_at.is_(None),
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if row is None:
        return ClaimResult.NOT_FOUND
    if row.status != "Todo":
        return ClaimResult.NOT_CLAIMABLE

    row.status = "Doing"
    row.updated_at = utc_now()
    await write_event(db, board, actor_id, "requirement.claimed", "requirement", row.id, {"status": {"to": "Doing"}})
    return row


# ── Sprint burndown ───────────────────────────────────────────────────────
#
# Ported near-as-is from SMA's get_sprint_burndown (store.py:1193-1273).
# Known limitation carried over deliberately (SMA store.py:332-338): a
# requirement whose sprint-history predates this table's existence has only
# one synthetic row, so burndown for very old sprints assumes constant
# membership since creation -- real historical membership can't be
# recovered, and "fixing" this silently would misrepresent old sprints as
# more precisely tracked than they are.


async def sprint_burndown(db: AsyncSession, board: Board, sprint: Sprint) -> dict:
    if sprint.start_date is None or sprint.end_date is None:
        return {
            "sprint_id": sprint.id,
            "note": "Set both a start and end date to see a burndown chart.",
            "total_start": 0,
            "points": [],
        }

    start, end = sprint.start_date, sprint.end_date
    days = [start + dt.timedelta(days=i) for i in range((end - start).days + 1)]

    requirement_ids = (
        await db.execute(
            select(RequirementSprintHistory.requirement_id)
            .where(RequirementSprintHistory.sprint_id == sprint.id)
            .distinct()
        )
    ).scalars().all()
    if not requirement_ids:
        return {"sprint_id": sprint.id, "note": None, "total_start": 0, "points": [
            {"day": d, "remaining": 0, "ideal": 0.0} for d in days
        ]}

    membership_rows = (
        await db.execute(
            select(
                RequirementSprintHistory.requirement_id,
                RequirementSprintHistory.sprint_id,
                RequirementSprintHistory.started_at,
            )
            .where(RequirementSprintHistory.requirement_id.in_(requirement_ids))
            .order_by(RequirementSprintHistory.started_at)
        )
    ).all()

    status_rows = (
        await db.execute(
            select(Event.entity_id, Event.detail, Event.created_at)
            .where(
                Event.board_id == board.id,
                Event.entity_type == "requirement",
                Event.entity_id.in_(requirement_ids),
                Event.action == "requirement.updated",
            )
            .order_by(Event.created_at)
        )
    ).all()

    membership_by_req: dict[UUID, list[tuple[dt.datetime, UUID | None]]] = {}
    for rid, sid, started_at in membership_rows:
        membership_by_req.setdefault(rid, []).append((started_at, sid))

    status_by_req: dict[UUID, list[tuple[dt.datetime, bool]]] = {}
    for rid, detail, created_at in status_rows:
        status_change = (detail or {}).get("status")
        if not status_change:
            continue
        status_by_req.setdefault(rid, []).append((created_at, status_change.get("to") == "Done"))

    def membership_on(rid: UUID, day: dt.date) -> UUID | None:
        latest = None
        for started_at, sid in membership_by_req.get(rid, []):
            if started_at.date() <= day:
                latest = sid
            else:
                break
        return latest

    def done_on(rid: UUID, day: dt.date) -> bool:
        latest = False
        for created_at, is_done in status_by_req.get(rid, []):
            if created_at.date() <= day:
                latest = is_done
            else:
                break
        return latest

    total_start = sum(1 for rid in requirement_ids if membership_on(rid, start) == sprint.id)
    today = utc_now().date()
    n = len(days)

    points = []
    for i, day in enumerate(days):
        # The ideal line is the planned trajectory for the whole sprint,
        # drawn regardless of today; only the actual "remaining" series
        # stops at today (nothing to report for days that haven't happened).
        ideal = round(total_start * (1 - i / (n - 1)), 1) if n > 1 else float(total_start)
        if day > today:
            points.append({"day": day, "remaining": None, "ideal": ideal})
            continue
        remaining = sum(
            1 for rid in requirement_ids if membership_on(rid, day) == sprint.id and not done_on(rid, day)
        )
        points.append({"day": day, "remaining": remaining, "ideal": ideal})

    return {"sprint_id": sprint.id, "note": None, "total_start": total_start, "points": points}
