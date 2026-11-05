"""Archiving a requirement (FS-REQ-79).

Archive is the reversible step before delete, as for users and wireframes:
Delete refuses a live requirement (409), an archived one cannot be edited
until it is restored, and an archived requirement drops out of everything
that counts or shows live work -- roll-ups, sprint boards, burndown, the
default list and the board MCP's list_requirements.

No database, like the rest of the suite: the routes run against a stub
session that hands back one in-memory row and records every statement, and
the roll-up queries are checked by compiling what they send.
"""
import datetime as dt
import inspect
import types
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.studio.board import routes, service
from app.studio.board.models import Requirement

BOARD = types.SimpleNamespace(id=uuid.uuid4(), account_id=uuid.uuid4())
CTX = types.SimpleNamespace(user_id=uuid.uuid4(), board_id=None, board_token_id=None)


class FakeResult:
    def __init__(self, rows):
        self.rows = rows

    def scalar_one_or_none(self):
        return self.rows[0] if self.rows else None

    def scalars(self):
        return self

    def all(self):
        return list(self.rows)

    def first(self):
        return self.rows[0] if self.rows else None


class FakeDb:
    """Every query answers with ``rows``; statements and commits are kept."""

    def __init__(self, rows=()):
        self.rows = list(rows)
        self.statements = []
        self.commits = 0

    async def execute(self, stmt):
        self.statements.append(stmt)
        return FakeResult(self.rows)

    async def commit(self):
        self.commits += 1

    async def refresh(self, _obj):
        pass

    def sql(self) -> list[str]:
        return [str(s.compile(dialect=postgresql.dialect())) for s in self.statements]


def make_requirement(**overrides) -> Requirement:
    r = Requirement(
        id=uuid.uuid4(), board_id=BOARD.id, account_id=BOARD.account_id, seq=7, title="Bulk import",
        body="", status="NotStarted", priority="Medium", deleted_at=None, archived_at=None,
    )
    for k, v in overrides.items():
        setattr(r, k, v)
    return r


@pytest.fixture
def stubbed(monkeypatch):
    """Routes resolve the project and board without a database, and events
    are recorded instead of written."""
    events = []

    async def fake_get_project(db, project_id, ctx):
        return types.SimpleNamespace(id=project_id)

    async def fake_board(db, project, ctx):
        return BOARD

    async def fake_write_event(db, board, actor_id, action, entity_type, entity_id, detail=None):
        events.append(action)

    async def fake_read(db, board, r):
        return r

    monkeypatch.setattr(routes, "get_project", fake_get_project)
    monkeypatch.setattr(routes, "_board", fake_board)
    monkeypatch.setattr(routes.service, "write_event", fake_write_event)
    monkeypatch.setattr(routes, "_requirement_read", fake_read)
    return events


# ── Archive, restore, delete ─────────────────────────────────────────────


async def test_deleting_a_live_requirement_is_refused(stubbed):
    r = make_requirement()
    db = FakeDb([r])
    with pytest.raises(HTTPException) as exc:
        await routes.delete_requirement(uuid.uuid4(), r.id, ctx=CTX, db=db)
    assert exc.value.status_code == 409
    assert "Archive it first" in exc.value.detail
    assert r.deleted_at is None and db.commits == 0 and stubbed == []


async def test_an_archived_requirement_can_be_deleted(stubbed):
    r = make_requirement(archived_at=dt.datetime(2026, 11, 1))
    db = FakeDb([r])
    await routes.delete_requirement(uuid.uuid4(), r.id, ctx=CTX, db=db)
    assert r.deleted_at is not None and db.commits == 1
    assert stubbed == ["requirement.deleted"]


async def test_archive_then_restore_is_a_true_undo(stubbed):
    sprint, epic = uuid.uuid4(), uuid.uuid4()
    r = make_requirement(sprint_id=sprint, epic_id=epic, status="InProgress", estimate_hours=3.0)
    db = FakeDb([r])
    await routes.archive_requirement(uuid.uuid4(), r.id, ctx=CTX, db=db)
    assert r.archived_at is not None
    # Archiving keeps every field: restore must put it back where it was.
    assert (r.sprint_id, r.epic_id, r.status, r.estimate_hours) == (sprint, epic, "InProgress", 3.0)
    await routes.restore_requirement(uuid.uuid4(), r.id, ctx=CTX, db=db)
    assert r.archived_at is None
    assert (r.sprint_id, r.epic_id, r.status, r.estimate_hours) == (sprint, epic, "InProgress", 3.0)
    assert stubbed == ["requirement.archived", "requirement.restored"]


async def test_archiving_twice_is_a_no_op(stubbed):
    when = dt.datetime(2026, 11, 1)
    r = make_requirement(archived_at=when)
    db = FakeDb([r])
    await routes.archive_requirement(uuid.uuid4(), r.id, ctx=CTX, db=db)
    assert r.archived_at == when and db.commits == 0 and stubbed == []


async def test_an_archived_requirement_is_readable_but_not_editable(stubbed):
    r = make_requirement(archived_at=dt.datetime(2026, 11, 1))
    assert await routes._get_requirement(FakeDb([r]), BOARD, r.id, archived=True) is r
    with pytest.raises(HTTPException) as exc:
        await routes._get_requirement(FakeDb([r]), BOARD, r.id)
    assert exc.value.status_code == 409 and "Restore it first" in exc.value.detail


def test_only_the_read_archive_restore_and_delete_routes_reach_an_archived_requirement():
    for fn in (routes.get_requirement, routes.archive_requirement, routes.restore_requirement, routes.delete_requirement):
        assert "archived=True" in inspect.getsource(fn), fn.__name__
    assert "archived=True" not in inspect.getsource(routes.update_requirement)


def test_the_archive_routes_are_mounted():
    paths = {(r.path, tuple(sorted(r.methods))) for r in routes.router.routes}
    base = "/projects/{project_id}/board/requirements/{requirement_id}"
    assert (f"{base}/archive", ("POST",)) in paths
    assert (f"{base}/restore", ("POST",)) in paths


# ── Archived requirements drop out of live work ──────────────────────────

ARCHIVED_FILTER = "board_requirements.archived_at IS NULL"


def _requirement_queries(db: FakeDb) -> list[str]:
    return [s for s in db.sql() if "FROM board_requirements" in s or "JOIN board_requirements" in s]


async def _list(db, archived):
    return await routes.list_requirements(
        uuid.uuid4(), status_filter=None, epic_id=None, feature_id=None, sprint_id=None,
        archived=archived, ctx=CTX, db=db,
    )


async def test_the_default_list_leaves_archived_out(stubbed):
    db = FakeDb()
    await _list(db, "exclude")
    assert ARCHIVED_FILTER in _requirement_queries(db)[0]


async def test_archived_requirements_are_listed_only_when_asked_for(stubbed):
    db = FakeDb()
    await _list(db, "only")
    assert "board_requirements.archived_at IS NOT NULL" in _requirement_queries(db)[0]
    db = FakeDb()
    await _list(db, "include")
    assert "archived_at" not in _requirement_queries(db)[0].split("WHERE", 1)[1]


@pytest.mark.parametrize(
    "call",
    [
        pytest.param(lambda db: service.work_status_maps(db, BOARD.id), id="epic-and-feature-status"),
        pytest.param(lambda db: service.release_progress_map(db, BOARD.id), id="release-progress"),
        pytest.param(lambda db: service.board_summary(db, BOARD), id="board-summary"),
        pytest.param(
            lambda db: service.sprint_activity(db, BOARD, types.SimpleNamespace(id=uuid.uuid4())), id="sprint-board"
        ),
        pytest.param(
            lambda db: service.sprint_burndown(
                db, BOARD,
                types.SimpleNamespace(id=uuid.uuid4(), start_date=dt.date(2026, 11, 2), end_date=dt.date(2026, 11, 13)),
            ),
            id="burndown",
        ),
        pytest.param(lambda db: service.claim_requirement(db, BOARD, uuid.uuid4(), uuid.uuid4()), id="claim"),
    ],
)
async def test_every_roll_up_and_work_queue_leaves_archived_out(call):
    db = FakeDb()
    await call(db)
    queries = _requirement_queries(db)
    assert queries, "expected a requirement query"
    for q in queries:
        assert ARCHIVED_FILTER in q, q


def test_live_means_neither_deleted_nor_archived():
    sql = str(Requirement.live().compile(dialect=postgresql.dialect()))
    assert "deleted_at IS NULL" in sql and "archived_at IS NULL" in sql


def test_the_agent_queue_refuses_archived_requirements():
    from app.studio.board import agents

    assert "Requirement.live()" in inspect.getsource(agents.queue_agent_run)


def test_the_board_mcp_lists_archived_only_when_asked():
    from pathlib import Path

    source = (Path(__file__).resolve().parents[2] / "board_mcp.py").read_text(encoding="utf-8")
    start = source.index("def list_requirements(")
    body = source[start : source.index("@mcp.tool()", start)]
    assert "include_archived: bool = False" in body
    assert 'params.append("archived=include")' in body
