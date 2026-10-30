"""FS-REQ-78: agents (board tokens) attach files to board items.

The suite has no database, so routes are driven with their collaborators
stubbed and a fake session that answers the few scalar lookups they make.
"""
import asyncio
import importlib.util
import inspect
import pathlib
import sys
import types
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.auth.security.scope_context import ScopeContext
from app.studio import common, storage
from app.studio.board import routes
from app.studio.board.models import Attachment
from app.studio.board.schemas import AttachmentRead, AttachmentUploadRequest

BOARD_MCP = pathlib.Path(__file__).parents[2] / "board_mcp.py"
TOKEN = "fsb_test"


def _token_ctx(permissions=("board:read", "board:write", "data:read", "data:write")) -> ScopeContext:
    return ScopeContext(
        user_id=uuid4(), scope_type="account", scope_id=uuid4(), active_roles=["agent"],
        resolved_permissions=set(permissions), board_token_id=uuid4(),
    )


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _Db:
    """Answers each execute() with the next queued scalar."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.added = []

    async def execute(self, _stmt):
        return _Result(self.answers.pop(0) if self.answers else None)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        pass


def _stub_board(monkeypatch):
    async def get_project(*_a, **_k):
        return SimpleNamespace(id=uuid4())

    async def board(*_a, **_k):
        return SimpleNamespace(id=uuid4(), account_id=uuid4())

    async def exists(*_a, **_k):
        return True

    monkeypatch.setattr(routes, "_require_bucket", lambda: None)
    monkeypatch.setattr(routes, "get_project", get_project)
    monkeypatch.setattr(routes, "_board", board)
    monkeypatch.setattr(routes.service, "entity_exists", exists)
    monkeypatch.setattr(routes.storage, "presign_put", lambda key, *_a: f"https://bucket.s3.example/{key}")


def _upload(ctx, db, **over):
    body = dict(entity_type="requirement", entity_id=str(uuid4()), filename="report.html",
                content_type="text/html", size_bytes=1234)
    body.update(over)
    return asyncio.run(routes.request_attachment_upload(uuid4(), AttachmentUploadRequest(**body), ctx=ctx, db=db))


# ── The guard: a board token reaches upload and confirm ──────────────────


def _run_guard(guard, monkeypatch, ctx):
    token = SimpleNamespace(id=ctx.board_token_id, board_id=uuid4())

    async def require_board_token(**_k):
        return ctx, token

    monkeypatch.setattr(common, "require_board_token", require_board_token)
    request = Request({"type": "http", "headers": []})
    return asyncio.run(guard(request=request, authorization=f"Bearer {TOKEN}", db=None))


def test_upload_and_confirm_accept_board_tokens():
    """app.auth's require_any_permission knows only Cognito sessions -- the
    401 agents got. Both routes must use the studio guard instead."""
    for route in (routes.request_attachment_upload, routes.confirm_attachment_upload):
        source = inspect.getsource(route)
        assert 'require_any_studio_permission(["board:write", "feedback:create"])' in source, route.__name__


def test_a_token_with_board_write_passes_the_guard(monkeypatch):
    monkeypatch.setattr(common, "TOKEN_PREFIX", "fsb_")
    ctx = _token_ctx()
    out = _run_guard(common.require_any_studio_permission(["board:write", "feedback:create"]), monkeypatch, ctx)
    assert out is ctx and out.board_token_id is not None


def test_a_token_without_board_write_is_refused_403(monkeypatch):
    monkeypatch.setattr(common, "TOKEN_PREFIX", "fsb_")
    ctx = _token_ctx(permissions=("board:read",))
    with pytest.raises(HTTPException) as err:
        _run_guard(common.require_any_studio_permission(["board:write", "feedback:create"]), monkeypatch, ctx)
    assert err.value.status_code == 403


# ── Upload ───────────────────────────────────────────────────────────────


def test_an_agent_upload_records_the_agents_name(monkeypatch):
    _stub_board(monkeypatch)
    db = _Db("Builder")  # the Agent.name lookup
    ticket = _upload(_token_ctx(), db, description="Test run report")
    [row] = db.added
    assert row.agent_name == "Builder"
    assert row.description == "Test run report"
    assert row.content_type == "text/html"
    assert ticket.headers == {"Content-Type": "text/html"}


def test_a_person_minted_token_records_its_label(monkeypatch):
    _stub_board(monkeypatch)
    db = _Db(None, "Claude on Elliott's laptop")  # no agent row, then the token label
    _upload(_token_ctx(), db)
    assert db.added[0].agent_name == "Claude on Elliott's laptop"


def test_a_persons_upload_has_no_agent_name(monkeypatch):
    _stub_board(monkeypatch)
    ctx = ScopeContext(user_id=uuid4(), scope_type="account", scope_id=uuid4(), resolved_permissions={"board:write"})
    db = _Db()
    _upload(ctx, db, filename="shot.png", content_type="image/png")
    assert db.added[0].agent_name is None


def test_sprints_take_attachments(monkeypatch):
    _stub_board(monkeypatch)
    db = _Db("Builder")
    _upload(_token_ctx(), db, entity_type="sprint", filename="burndown.json", content_type="application/json")
    assert db.added[0].entity_type == "sprint"
    assert "sprint" in Attachment.ENTITY_TYPES


@pytest.mark.parametrize("filename,content_type", [
    ("report.html", "text/html"), ("data.json", "application/json"), ("shot.png", "image/png"),
    ("photo.jpg", "image/jpeg"), ("photo.jpeg", "image/jpeg"), ("spec.pdf", "application/pdf"),
])
def test_the_required_types_are_allowed(monkeypatch, filename, content_type):
    _stub_board(monkeypatch)
    _upload(_token_ctx(), _Db("Builder"), filename=filename, content_type=content_type)


def test_oversize_is_refused_with_the_limit(monkeypatch):
    _stub_board(monkeypatch)
    with pytest.raises(HTTPException) as err:
        _upload(_token_ctx(), _Db(), size_bytes=25 * 1024 * 1024 + 1)
    assert err.value.status_code == 413
    assert "25 MB" in err.value.detail


def test_exactly_25_mb_is_allowed(monkeypatch):
    _stub_board(monkeypatch)
    _upload(_token_ctx(), _Db("Builder"), size_bytes=25 * 1024 * 1024)


def test_another_type_is_refused_naming_what_is_allowed(monkeypatch):
    _stub_board(monkeypatch)
    with pytest.raises(HTTPException) as err:
        _upload(_token_ctx(), _Db(), filename="tool.exe", content_type="application/octet-stream")
    assert err.value.status_code == 422
    assert ".html" in err.value.detail and ".json" in err.value.detail


def test_a_mismatched_type_is_refused(monkeypatch):
    _stub_board(monkeypatch)
    with pytest.raises(HTTPException) as err:
        _upload(_token_ctx(), _Db(), filename="report.html", content_type="image/png")
    assert err.value.status_code == 422


def test_attachment_read_carries_the_uploader():
    assert "agent_name" in AttachmentRead.model_fields
    assert "description" in AttachmentRead.model_fields


# ── Delete stays human ───────────────────────────────────────────────────


def test_an_agent_cannot_delete_an_attachment():
    with pytest.raises(HTTPException) as err:
        asyncio.run(routes.delete_attachment(uuid4(), uuid4(), ctx=_token_ctx(), db=_Db()))
    assert err.value.status_code == 403


# ── Download: attachment by default, inline only on S3's origin ──────────


@pytest.fixture
def signer(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIDEXAMPLE")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setattr(storage, "bucket", lambda: "studio-docs")
    storage._client.cache_clear()
    yield
    storage._client.cache_clear()


def _query(url):
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


def test_download_is_forced_to_attachment(signer):
    q = _query(storage.presign_get("k/report.html", "report.html", 60))
    assert q["response-content-disposition"] == 'attachment; filename="report.html"'
    assert "response-content-type" not in q


def test_open_is_inline_on_the_bucket_host(signer):
    url = storage.presign_get("k/report.html", "report.html", 60, inline_as="text/html")
    q = _query(url)
    assert q["response-content-disposition"] == 'inline; filename="report.html"'
    assert q["response-content-type"] == "text/html"
    assert urlparse(url).hostname.startswith("studio-docs.s3.")


@pytest.mark.parametrize("content_type", ["image/svg+xml", "application/json", "image/png"])
def test_only_html_opens_inline(monkeypatch, content_type):
    """Open is for an HTML report; anything else asked for inline is refused
    rather than served to render on the bucket's host."""
    attachment = SimpleNamespace(status="uploaded", content_type=content_type, s3_key="k/f", filename="f")

    async def fake(*_a, **_k):
        return attachment

    monkeypatch.setattr(routes, "_require_bucket", lambda: None)
    monkeypatch.setattr(routes, "get_project", fake)
    monkeypatch.setattr(routes, "_board", fake)
    monkeypatch.setattr(routes, "_get_attachment", fake)
    monkeypatch.setattr(storage, "presign_get", lambda *a, **k: pytest.fail("presigned a non-HTML inline URL"))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(routes.download_attachment(uuid4(), uuid4(), inline=True, ctx=None, db=None))
    assert exc.value.status_code == 422


# ── The board tool ───────────────────────────────────────────────────────


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
    spec = importlib.util.spec_from_file_location("board_mcp_attachments", BOARD_MCP)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    calls, puts = [], []

    def call(method, path, body=None):
        calls.append((method, path, body))
        if path == "/attachments":
            return {"attachment_id": "a1", "upload_url": "https://bucket/put", "headers": {"Content-Type": "text/html"}}
        if path.endswith("/confirm"):
            return {"id": "a1", "filename": "report.html", "content_type": "text/html", "size_bytes": 15, "description": "Run"}
        if path.endswith("/download"):
            return {"url": "https://bucket/get"}
        if path == "/comments":
            return {"id": "c1", "body": body["body"]}
        raise AssertionError(path)

    module._call = call
    module._put_presigned = lambda url, data, headers: puts.append((url, data, headers))
    module.calls, module.puts = calls, puts
    return module


def test_add_attachment_uploads_and_returns_the_link(board_mcp, tmp_path):
    f = tmp_path / "report.html"
    f.write_bytes(b"<h1>Report</h1>")
    out = board_mcp.add_attachment("requirement", "r1", str(f), description="Run")
    assert out == {
        "id": "a1", "filename": "report.html", "content_type": "text/html", "size_bytes": 15,
        "description": "Run", "download_url": "https://bucket/get",
    }
    assert board_mcp.calls[0] == ("POST", "/attachments", {
        "entity_type": "requirement", "entity_id": "r1", "filename": "report.html",
        "content_type": "text/html", "size_bytes": 15, "description": "Run",
    })
    assert board_mcp.puts == [("https://bucket/put", b"<h1>Report</h1>", {"Content-Type": "text/html"})]


def test_add_attachment_refuses_a_type_before_sending(board_mcp, tmp_path):
    f = tmp_path / "tool.exe"
    f.write_bytes(b"MZ")
    with pytest.raises(ValueError, match="Cannot attach .exe"):
        board_mcp.add_attachment("requirement", "r1", str(f))
    assert board_mcp.calls == []


def test_create_comment_attaches_files_to_the_new_comment(board_mcp, tmp_path):
    f = tmp_path / "report.html"
    f.write_bytes(b"<h1>Report</h1>")
    out = board_mcp.create_comment("requirement", "r1", "See the report", file_paths=[str(f)])
    assert board_mcp.calls[0] == ("POST", "/comments", {"entity_type": "requirement", "entity_id": "r1", "body": "See the report"})
    assert board_mcp.calls[1][2]["entity_type"] == "comment" and board_mcp.calls[1][2]["entity_id"] == "c1"
    assert [a["id"] for a in out["attachments"]] == ["a1"]


def test_create_comment_checks_files_before_posting(board_mcp, tmp_path):
    with pytest.raises(ValueError, match="No file"):
        board_mcp.create_comment("requirement", "r1", "See", file_paths=[str(tmp_path / "missing.html")])
    assert board_mcp.calls == []


def test_the_board_tool_has_no_delete_for_attachments(board_mcp):
    assert not [n for n in dir(board_mcp) if n.startswith("delete")]
