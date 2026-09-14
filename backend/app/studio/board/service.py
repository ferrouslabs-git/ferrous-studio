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

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Project
from .models import (
    Agent,
    Board,
    Comment,
    Doc,
    Epic,
    Event,
    Feature,
    Feedback,
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
    migration's docstring). Created lazily on first access.

    A project's first visit fires several board panels' requests in
    parallel (epics, releases, docs, sprints, ...), each reaching here with
    no board yet -- so the plain select-then-insert below is a real race,
    not a hypothetical one: two requests can both see "none" and both try
    to insert, and the loser hits ``uq_boards_account_lineage`` and 500s
    (seen live on staging, project's board panels all failing at once on
    first load). The insert runs inside a savepoint so only it rolls back
    on conflict -- the request's own transaction, and anything already done
    in it, is untouched -- and the loser then just re-selects the winner's
    row instead of raising.
    """
    board = (
        await db.execute(
            select(Board).where(Board.account_id == project.account_id, Board.lineage_id == project.lineage_id)
        )
    ).scalar_one_or_none()
    if board is not None:
        return board

    try:
        async with db.begin_nested():
            board = Board(account_id=project.account_id, lineage_id=project.lineage_id)
            db.add(board)
            await db.flush()
    except IntegrityError:
        board = (
            await db.execute(
                select(Board).where(Board.account_id == project.account_id, Board.lineage_id == project.lineage_id)
            )
        ).scalar_one()
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
    regex-MAX feature numbering (store.py's create_feature, computed under
    the epic's row lock so a soft-deleted feature's number is never
    reused)."""
    locked = await _lock_board(db, board)
    value = getattr(locked, column) + 1
    setattr(locked, column, value)
    return value


# ── Effective epic / release inheritance ─────────────────────────────────
#
# The two OR-inheritance rules, ported from the reference's
# static/js/effort.js effectiveEpic()/effectiveRelease(): a requirement's
# effective epic is its own epic_id if set, else its feature's; its
# effective release is its own release_id if set, else its effective
# epic's. Kept here as one function each instead of duplicated per caller.


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
# Status-weighted score: Done = 1, Review = 0.75, Doing = 0.5, anything else
# 0 -- the exact weights of the reference's effort.js rollup(), which the
# front-end (features/project/board/effort.ts) ports verbatim, so the
# server-computed figure on a release card and the client-computed one on a
# sprint card never disagree. The same weights apply to hours: ``hours_done``
# is every existing estimate multiplied by its status weight, not the Done
# estimates alone. SMA used to reimplement the older two-weight formula in
# five places (roadmap.js, features.js, sprints.js, milestones.js,
# sma_mcp.py); effort.js consolidated those client-side, and this is the one
# server-side twin.


STATUS_WEIGHTS = {"Done": 1.0, "Review": 0.75, "Doing": 0.5}


def status_weight(status: str) -> float:
    return STATUS_WEIGHTS.get(status, 0.0)


def progress_rollup(requirements: list[Requirement]) -> dict:
    """The full EpicProgress shape (schemas.py). ``hours`` sums only the
    estimates that exist -- an unestimated requirement adds nothing, which
    is only honest alongside ``unestimated``/``coverage``, so all three
    ship together. ``hours_done`` is those same estimates weighted by
    status_weight (a 4 h requirement in Review contributes 3 h), exactly as
    effort.ts's rollup() credits them. ``coverage`` is 1.0 for an empty
    set: nothing is missing an estimate."""
    total = len(requirements)
    done = sum(1 for r in requirements if r.status == "Done")
    doing = sum(1 for r in requirements if r.status == "Doing")
    review = sum(1 for r in requirements if r.status == "Review")
    score = sum(status_weight(r.status) for r in requirements)
    estimated = [r for r in requirements if r.estimate_hours is not None]
    hours = sum(r.estimate_hours for r in estimated)
    hours_done = sum(r.estimate_hours * status_weight(r.status) for r in estimated)
    return {
        "total": total,
        "done": done,
        "doing": doing,
        "review": review,
        "pct": round(100 * score / total) if total else 0,
        "hours": hours,
        "hours_done": hours_done,
        "estimated": len(estimated),
        "unestimated": total - len(estimated),
        "coverage": len(estimated) / total if total else 1.0,
    }


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
# SMA's own comments.entity_id (store.py's _entity_exists_tx: a UNION ALL
# over every commentable table). A real polymorphic FK would need a constraint
# trigger; SMA never needed one and neither do we.

_ENTITY_TABLES = {
    "release": Release,
    "epic": Epic,
    "feature": Feature,
    "requirement": Requirement,
    "sprint": Sprint,
    "doc": Doc,
    # Attachments only -- Comment.ENTITY_TYPES does not list feedback, and its
    # own CHECK constraint would refuse it. Missing this entry makes every
    # screenshot upload 422 with "Attachment target does not exist", however
    # right the CHECK constraint is.
    "feedback": Feedback,
}


async def unresolved_requirement_ids(db: AsyncSession, board_id: UUID, epic_id: UUID) -> list[UUID]:
    """Requirement ids under this epic (direct, or via one of its features)
    that aren't Done yet -- gates the epic status transition into 'Done'
    (routes.py's update_epic). Same direct-or-via-feature membership the
    board uses everywhere else (board_summary, effective_epic_id). Ported
    from software-management's _unresolved_requirements."""
    feature_ids = (
        await db.execute(
            select(Feature.id).where(
                Feature.board_id == board_id, Feature.epic_id == epic_id, Feature.deleted_at.is_(None)
            )
        )
    ).scalars().all()
    rows = (
        await db.execute(
            select(Requirement.id).where(
                Requirement.board_id == board_id,
                Requirement.status != "Done",
                Requirement.deleted_at.is_(None),
                (Requirement.epic_id == epic_id) | (Requirement.feature_id.in_(feature_ids)),
            )
        )
    ).scalars().all()
    return list(rows)


async def entity_exists(db: AsyncSession, board_id: UUID, entity_type: str, entity_id: UUID) -> bool:
    model = _ENTITY_TABLES.get(entity_type)
    if model is None:
        return False
    conditions = [model.board_id == board_id, model.id == entity_id]
    # Not every entity here is soft-deletable -- Feedback isn't (see
    # _ENTITY_TABLES's own comment on why it's in this dict at all).
    if hasattr(model, "deleted_at"):
        conditions.append(model.deleted_at.is_(None))
    result = await db.execute(select(model.id).where(*conditions))
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
# when sprint_id actually changes. Ported invariant -- SMA store.py's
# create_requirement and update_requirement: a naive "log on transition to
# non-null" port would silently break the "born in the backlog" case
# burndown's total_start depends on.


async def record_sprint_history(db: AsyncSession, board: Board, requirement: Requirement) -> None:
    db.add(RequirementSprintHistory(
        board_id=board.id,
        account_id=board.account_id,
        requirement_id=requirement.id,
        sprint_id=requirement.sprint_id,
    ))


# ── Sprint state transition side effects ─────────────────────────────────
#
# Ported from SMA's update_sprint (store.py). Several sprints may be active
# at once (SMA, 2026-09-04): starting one used to demote every other active
# sprint back to 'planned', but agents are assigned per sprint, so a single
# live sprint would make every agent work the same one -- that rule is
# gone, here as there. What remains: completing a sprint (-> 'done', only
# on that exact transition) returns every non-Done requirement in it to the
# backlog (sprint_id = NULL) and clears its queue_position -- a position is
# scoped to the sprint, and a requirement back in the backlog must not
# still carry "3rd in a sprint that no longer holds it". Done ones keep
# their sprint tag. Enforced in Python rather than a DB constraint,
# matching SMA's own choice.


async def apply_sprint_state_transition(db: AsyncSession, board: Board, sprint: Sprint, new_state: str) -> int:
    """Call BEFORE setting sprint.state = new_state. Returns the count of
    requirements returned to the backlog (0 unless this is a ->'done' move)."""
    returned_to_backlog = 0
    if new_state == "done" and sprint.state != "done":
        requirements = (
            await db.execute(
                select(Requirement).where(
                    Requirement.board_id == board.id,
                    Requirement.sprint_id == sprint.id,
                    Requirement.status != "Done",
                    Requirement.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        for r in requirements:
            r.sprint_id = None
            r.queue_position = None
            r.updated_at = utc_now()
            await record_sprint_history(db, board, r)
        returned_to_backlog = len(requirements)

    return returned_to_backlog


# ── Claim (atomic SELECT ... FOR UPDATE) ─────────────────────────────────
#
# Ported near-as-is from SMA's claim_requirement (store.py). The
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
    # The same event a PATCH would write, not a bespoke "claimed" action:
    # sprint_burndown reconstructs status history from requirement.updated
    # rows, and the activity feed renders one shape for a status move.
    await write_event(
        db, board, actor_id, "requirement.updated", "requirement", row.id,
        {"status": {"from": "Todo", "to": "Doing"}},
    )
    return row


# ── Sprint burndown ───────────────────────────────────────────────────────
#
# Ported near-as-is from SMA's get_sprint_burndown (store.py). Membership is
# reconstructed from board_requirement_sprint_history and status from
# requirement.updated events, not from current state. Known limitation
# carried over deliberately (the requirement_sprint_history backfill in SMA
# store.py's _SCHEMA): a requirement whose sprint-history predates this
# table's existence has only one synthetic row, so burndown for very old
# sprints assumes constant membership since
# creation -- real historical membership can't be recovered, and "fixing"
# this silently would misrepresent old sprints as more precisely tracked
# than they are. One more honest caveat from the reference: estimates are
# CURRENT-state values while the rest is history, so editing an estimate
# mid-sprint retroactively rewrites every earlier day of the hours series.

#: Every early return spreads this, so the client reads every key
#: unconditionally instead of guarding each one.
_EMPTY_BURNDOWN = {
    "dates": [], "remaining": [], "ideal": [], "total": 0,
    "remaining_hours": [], "ideal_hours": [], "total_hours": 0.0,
    "scope": [], "scope_hours": [],
    "estimated_count": 0, "unestimated_count": 0,
}


def burndown_series(
    sprint_id: UUID,
    days: list[dt.date],
    requirement_ids: list[UUID],
    membership_by_req: dict[UUID, list[tuple[dt.date, UUID | None]]],
    status_by_req: dict[UUID, list[tuple[dt.date, str]]],
    estimates: dict[UUID, float | None],
    today: dt.date,
) -> dict:
    """The arithmetic, separated from the queries so it can be tested
    without a database. ``membership_by_req`` holds (day, sprint_id) rows
    per requirement, ``status_by_req`` (day, status) rows; on any day the
    latest row dated on or before it applies.

    Returns BOTH series: ``remaining``/``total`` count requirements,
    ``remaining_hours``/``total_hours`` sum estimates. ``scope``/
    ``scope_hours`` are the sprint's whole membership on each day, done or
    not -- a rising scope line is work added after the sprint started.
    Actual series stop at ``today`` (None after it); the ideal lines run
    the whole sprint. ``estimated_count``/``unestimated_count`` are over
    the sprint's CURRENT membership -- the set a reader is looking at --
    not everything that ever passed through, so the client can fall back
    from hours to counts when coverage is incomplete."""

    def membership_on(rid: UUID, day: dt.date) -> UUID | None:
        applicable = [sid for d, sid in membership_by_req.get(rid, []) if d <= day]
        return applicable[-1] if applicable else None

    def done_on(rid: UUID, day: dt.date) -> bool:
        applicable = [s for d, s in status_by_req.get(rid, []) if d <= day]
        return bool(applicable) and applicable[-1] == "Done"

    # An unestimated requirement contributes 0 to the hours series -- only
    # honest alongside unestimated_count, which is why both ship.
    def hours(rid: UUID) -> float:
        return estimates.get(rid) or 0.0

    start, end = days[0], days[-1]
    n = len(days)
    in_at_start = [rid for rid in requirement_ids if membership_on(rid, start) == sprint_id]
    total = len(in_at_start)
    total_hours = sum(hours(rid) for rid in in_at_start)

    current = [rid for rid in requirement_ids if membership_on(rid, min(today, end)) == sprint_id]
    estimated_count = sum(1 for rid in current if estimates.get(rid) is not None)

    remaining: list[int | None] = []
    remaining_hours: list[float | None] = []
    scope: list[int | None] = []
    scope_hours: list[float | None] = []
    ideal: list[float] = []
    ideal_hours: list[float] = []
    for i, day in enumerate(days):
        if day > today:
            remaining.append(None)
            remaining_hours.append(None)
            scope.append(None)
            scope_hours.append(None)
        else:
            members = [rid for rid in requirement_ids if membership_on(rid, day) == sprint_id]
            open_ = [rid for rid in members if not done_on(rid, day)]
            remaining.append(len(open_))
            remaining_hours.append(round(sum(hours(rid) for rid in open_), 2))
            scope.append(len(members))
            scope_hours.append(round(sum(hours(rid) for rid in members), 2))
        f = (1 - i / (n - 1)) if n > 1 else 0
        ideal.append(round(total * f, 1))
        ideal_hours.append(round(total_hours * f, 1))

    return {
        "sprint_id": sprint_id,
        "note": None,
        "dates": list(days),
        "remaining": remaining,
        "ideal": ideal,
        "total": total,
        "remaining_hours": remaining_hours,
        "ideal_hours": ideal_hours,
        "total_hours": round(total_hours, 2),
        "scope": scope,
        "scope_hours": scope_hours,
        "estimated_count": estimated_count,
        "unestimated_count": len(current) - estimated_count,
    }


async def sprint_burndown(db: AsyncSession, board: Board, sprint: Sprint) -> dict:
    if sprint.start_date is None or sprint.end_date is None:
        return {
            **_EMPTY_BURNDOWN,
            "sprint_id": sprint.id,
            "note": "Set both a start and end date on this sprint to see a burndown.",
        }

    start, end = sprint.start_date, sprint.end_date
    if end < start:
        start, end = end, start
    days = [start + dt.timedelta(days=i) for i in range((end - start).days + 1)]

    requirement_ids = list(
        (
            await db.execute(
                select(RequirementSprintHistory.requirement_id)
                .where(RequirementSprintHistory.sprint_id == sprint.id)
                .distinct()
            )
        ).scalars().all()
    )
    if not requirement_ids:
        n = len(days)
        return {
            **_EMPTY_BURNDOWN,
            "sprint_id": sprint.id,
            "note": None,
            "dates": days,
            "remaining": [0] * n,
            "ideal": [0.0] * n,
            "remaining_hours": [0.0] * n,
            "ideal_hours": [0.0] * n,
            "scope": [0] * n,
            "scope_hours": [0.0] * n,
        }

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

    estimate_rows = (
        await db.execute(
            select(Requirement.id, Requirement.estimate_hours).where(Requirement.id.in_(requirement_ids))
        )
    ).all()

    membership_by_req: dict[UUID, list[tuple[dt.date, UUID | None]]] = {}
    for rid, sid, started_at in membership_rows:
        membership_by_req.setdefault(rid, []).append((started_at.date(), sid))

    status_by_req: dict[UUID, list[tuple[dt.date, str]]] = {}
    for rid, detail, created_at in status_rows:
        status_change = (detail or {}).get("status")
        if not status_change:
            continue
        status_by_req.setdefault(rid, []).append((created_at.date(), status_change.get("to")))

    estimates = {rid: estimate for rid, estimate in estimate_rows}

    return burndown_series(
        sprint.id, days, requirement_ids, membership_by_req, status_by_req, estimates, utc_now().date()
    )


# ── Sprint activity (the sprint board's poll) ────────────────────────────
#
# Ported from SMA's get_sprint_activity (store.py). A question is not a
# table -- it is the convention the pick-and-code skill follows: the agent
# posts a comment starting "Question:" and sets the requirement Blocked. So
# a question here is "a Blocked requirement in this sprint whose latest
# live comment came from one of this sprint's agents, or reads like a
# question". Answering is likewise convention: a comment plus a flip back
# to Todo, which the board does and which wakes the agent through
# routes.py's update_requirement.


def detect_questions(
    requirements: list[Requirement],
    latest_comment_by_requirement: dict[UUID, Comment],
    agent_ids: list[UUID],
) -> list[tuple[Requirement, Comment]]:
    """Pure, so the rule is testable without a database. SMA matches the
    comment's free-text author against the agent ids; here that is the
    Comment.agent_id column (see its docstring)."""
    agents = set(agent_ids)
    out: list[tuple[Requirement, Comment]] = []
    for r in requirements:
        if r.status != "Blocked":
            continue
        c = latest_comment_by_requirement.get(r.id)
        if c is None:
            continue
        if (c.agent_id is not None and c.agent_id in agents) or c.body.lstrip().lower().startswith("question"):
            out.append((r, c))
    return out


async def sprint_activity(db: AsyncSession, board: Board, sprint: Sprint, limit: int = 100) -> dict:
    """The sprint, its live requirements in queue order (unordered ones
    last, then by number), the agents assigned to it, the newest events
    touching the sprint, those requirements or those agents, and the open
    questions (detect_questions). One read per poll rather than five."""
    requirements = list(
        (
            await db.execute(
                select(Requirement)
                .where(
                    Requirement.board_id == board.id,
                    Requirement.sprint_id == sprint.id,
                    Requirement.deleted_at.is_(None),
                )
                .order_by(Requirement.queue_position.asc().nulls_last(), Requirement.seq)
            )
        ).scalars().all()
    )
    agents = list(
        (
            await db.execute(
                select(Agent)
                .where(Agent.board_id == board.id, Agent.sprint_id == sprint.id)
                .order_by(Agent.created_at)
            )
        ).scalars().all()
    )
    rids = [r.id for r in requirements]
    aids = [a.id for a in agents]
    events = list(
        (
            await db.execute(
                select(Event)
                .where(
                    Event.board_id == board.id,
                    or_(Event.entity_id == sprint.id, Event.entity_id.in_(rids), Event.entity_id.in_(aids)),
                )
                .order_by(Event.created_at.desc())
                .limit(limit)
            )
        ).scalars().all()
    )

    blocked = [r for r in requirements if r.status == "Blocked"]
    latest: dict[UUID, Comment] = {}
    if blocked:
        rows = (
            await db.execute(
                select(Comment)
                .where(
                    Comment.board_id == board.id,
                    Comment.entity_type == "requirement",
                    Comment.entity_id.in_([r.id for r in blocked]),
                    Comment.deleted_at.is_(None),
                )
                .order_by(Comment.created_at.asc())
            )
        ).scalars().all()
        for c in rows:
            latest[c.entity_id] = c  # ascending order, so the last write wins

    return {
        "sprint": sprint,
        "requirements": requirements,
        "agents": agents,
        "events": events,
        "questions": detect_questions(blocked, latest, aids),
    }
