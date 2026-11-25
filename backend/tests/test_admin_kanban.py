"""The platform admins' cross-project Kanban (FS-REQ-101).

The week arithmetic is pure and called directly; the route's guards are
pinned by source inspection, as test_board_rules.py does, because the suite
has no database.
"""
import datetime as dt
import inspect

from app.studio.board import admin_kanban
from app.studio.board.admin_kanban import sprint_in_week, week_bounds

D = dt.date


def test_week_runs_monday_to_sunday():
    # 2026-11-25 is a Wednesday.
    assert week_bounds(D(2026, 11, 25)) == (D(2026, 11, 23), D(2026, 11, 29))
    assert week_bounds(D(2026, 11, 23)) == (D(2026, 11, 23), D(2026, 11, 29))
    assert week_bounds(D(2026, 11, 29)) == (D(2026, 11, 23), D(2026, 11, 29))


def test_sprint_overlapping_the_week_shows():
    ws, we = D(2026, 11, 23), D(2026, 11, 29)
    assert sprint_in_week(D(2026, 11, 16), D(2026, 11, 27), ws, we)  # started last week
    assert sprint_in_week(D(2026, 11, 27), D(2026, 12, 4), ws, we)  # runs into next week
    assert sprint_in_week(D(2026, 11, 1), D(2026, 12, 31), ws, we)  # spans the week
    assert sprint_in_week(D(2026, 11, 29), D(2026, 11, 29), ws, we)  # the Sunday only
    assert sprint_in_week(D(2026, 11, 9), D(2026, 11, 23), ws, we)  # ends on the Monday


def test_sprint_outside_the_week_does_not():
    ws, we = D(2026, 11, 23), D(2026, 11, 29)
    assert not sprint_in_week(D(2026, 11, 9), D(2026, 11, 22), ws, we)
    assert not sprint_in_week(D(2026, 11, 30), D(2026, 12, 6), ws, we)


def test_sprint_with_one_date_is_that_day_and_with_none_never_shows():
    ws, we = D(2026, 11, 23), D(2026, 11, 29)
    assert sprint_in_week(D(2026, 11, 25), None, ws, we)
    assert sprint_in_week(None, D(2026, 11, 25), ws, we)
    assert not sprint_in_week(D(2026, 12, 2), None, ws, we)
    assert not sprint_in_week(None, None, ws, we)


def test_route_is_platform_admin_only_and_reads_live_work():
    src = inspect.getsource(admin_kanban.kanban_week)
    assert "ensure_platform_admin(" in src
    assert "allow_cross_account(db)" in src
    # Archived and deleted requirements, and deleted sprints, never show.
    assert "Requirement.live()" in src
    assert "Sprint.deleted_at.is_(None)" in src
    # Only the newest version of each project names the card.
    assert "Project.version_no.desc()" in src and "rank == 1" in src


def test_route_never_writes():
    """Moving a card goes through the project's own requirement PATCH, so the
    status rules stay in one place."""
    src = inspect.getsource(admin_kanban)
    assert "@router.get(" in src
    for verb in ("@router.post(", "@router.patch(", "@router.put(", "@router.delete("):
        assert verb not in src
