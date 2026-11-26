"""The board tool this_weeks_work: this project's slice of Studio's Kanban, in the
same five columns and with the same week rule as the platform Kanban
(app/studio/board/admin_kanban.py). The board API is faked; no server, no MCP."""
import datetime as dt
import importlib.util
import pathlib
import sys
import types

import pytest

from app.studio.board.admin_kanban import sprint_in_week

BOARD_MCP = pathlib.Path(__file__).parents[2] / "board_mcp.py"

SPRINTS = [
    {"id": "s1", "human_id": "FS-S5", "name": "Sprint 5", "start_date": "2026-11-24", "end_date": "2026-12-05"},
    {"id": "s2", "human_id": "FS-S4", "name": "Sprint 4", "start_date": "2026-11-10", "end_date": "2026-11-21"},
    {"id": "s3", "human_id": "FS-S9", "name": "Undated", "start_date": None, "end_date": None},
]
REQS = {
    "s1": [
        {"id": "r1", "human_id": "FS-REQ-1", "title": "A", "status": "NotStarted", "priority": "High", "assignee_id": None},
        {"id": "r2", "human_id": "FS-REQ-2", "title": "B", "status": "ToTest", "priority": "Medium", "assignee_id": "u1"},
        {"id": "r3", "human_id": "FS-REQ-3", "title": "C", "status": "Blocked", "priority": "Low", "assignee_id": None},
    ],
    "s2": [{"id": "r9", "human_id": "FS-REQ-9", "title": "Old", "status": "Done", "priority": "Low", "assignee_id": None}],
}


@pytest.fixture
def board_mcp(monkeypatch):
    class FakeMCP:
        def __init__(self, *_a, **_k):
            pass

        def tool(self, *_a, **_k):
            return lambda fn: fn

    fastmcp = types.ModuleType("mcp.server.fastmcp")
    fastmcp.FastMCP = FakeMCP
    for name in ("mcp", "mcp.server"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    monkeypatch.setitem(sys.modules, "mcp.server.mcpserver", None)
    monkeypatch.setitem(sys.modules, "mcp.server.fastmcp", fastmcp)
    spec = importlib.util.spec_from_file_location("board_mcp_this_week", BOARD_MCP)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls = []

    def call(method, path, body=None):
        calls.append((method, path))
        if path == "/sprints":
            return SPRINTS
        if path.startswith("/requirements?sprint_id="):
            return REQS.get(path.split("=", 1)[1], [])
        raise AssertionError(path)

    module._call = call
    module.calls = calls
    return module


def test_this_week_has_all_five_columns_in_studios_words(board_mcp):
    out = board_mcp.this_weeks_work(week_of="2026-11-25")
    assert (out["week_start"], out["week_end"]) == ("2026-11-23", "2026-11-29")
    assert list(out["columns"]) == ["Not started", "In progress", "To test", "Done", "Blocked"]
    assert [s["human_id"] for s in out["sprints"]] == ["FS-S5"]          # Sprint 4 ended on the 21st; undated never shows
    assert out["columns"]["Not started"]["count"] == 1
    assert out["columns"]["In progress"] == {"status": "InProgress", "count": 0, "requirements": []}
    assert out["columns"]["To test"]["requirements"][0]["human_id"] == "FS-REQ-2"
    assert out["columns"]["Blocked"]["requirements"][0]["sprint"] == "FS-S5"


def test_one_column_on_its_own_by_label_or_status(board_mcp):
    for name in ("To test", "to-test", "ToTest", "totest"):
        out = board_mcp.this_weeks_work(column=name, week_of="2026-11-25")
        assert list(out["columns"]) == ["To test"], name
    assert list(board_mcp.this_weeks_work(column="todo", week_of="2026-11-25")["columns"]) == ["Not started"]


def test_an_unknown_column_names_the_real_ones(board_mcp):
    with pytest.raises(ValueError) as e:
        board_mcp.this_weeks_work(column="Shipped")
    assert "Not started, In progress, To test, Done, Blocked" in str(e.value)


def test_another_week_reads_that_weeks_sprints(board_mcp):
    out = board_mcp.this_weeks_work(week_of="2026-11-18")
    assert [s["human_id"] for s in out["sprints"]] == ["FS-S4"]
    assert out["columns"]["Done"]["requirements"][0]["human_id"] == "FS-REQ-9"


def test_it_only_reads(board_mcp):
    board_mcp.this_weeks_work(week_of="2026-11-25")
    assert {m for m, _ in board_mcp.calls} == {"GET"}


@pytest.mark.parametrize("start,end", [
    ("2026-11-24", "2026-12-05"), ("2026-11-10", "2026-11-21"), ("2026-11-29", None), (None, "2026-11-23"),
    (None, None), ("2026-11-30", "2026-12-10"), ("2026-11-01", "2026-11-22"),
])
def test_the_week_rule_matches_the_platform_kanban(board_mcp, start, end):
    ws, we = dt.date(2026, 11, 23), dt.date(2026, 11, 29)
    expected = sprint_in_week(dt.date.fromisoformat(start) if start else None,
                              dt.date.fromisoformat(end) if end else None, ws, we)
    assert board_mcp._sprint_in_week({"start_date": start, "end_date": end}, ws, we) == expected
