"""High-fidelity designs (docs/high-fidelity-design.md).

Studio authors the brief and mirrors the result; it never edits a design. The
rules pinned here are the ones that would fail open: a board token reaching
another project's designs, a revision being rewritten after the fact, a sync
that mints a revision when nothing changed, a locked version accepting a
write, and a read-only role being able to make one.

The suite has no database, so routes are called directly with a fake session
that answers the lookups they make, and with S3 stubbed (the approach
test_agent_attachments.py takes).
"""
import asyncio
import inspect
import pathlib
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request
from starlette.routing import Mount

from app.auth.security.scope_context import ScopeContext
from app.auth.services.auth_config_loader import get_auth_config
from app.main import app
from app.studio import common, designs, documents, storage
from app.studio.models import DesignRevision, Project, ProjectDesign
from app.studio.schemas import DesignFigmaUpdate, DesignRevisionCreate, DesignUpdate
from app.studio.versioning import COPIED_TABLES

HASH_A = "a" * 64
HASH_B = "b" * 64
NOW = datetime(2026, 11, 13, 12, 0, 0)

#: The routes the skill uses, i.e. the ones a board token reaches.
TOKEN_ROUTES = (
    designs.list_designs,
    designs.get_design_brief,
    designs.set_design_figma,
    designs.create_design_revision,
    designs.confirm_design_revision,
)

#: Every route in the module that changes something.
WRITE_ROUTES = (
    designs.create_design,
    designs.update_design,
    designs.delete_design,
    designs.set_design_figma,
    designs.create_design_revision,
    designs.confirm_design_revision,
)


# ── Fakes ────────────────────────────────────────────────────────────────


class _Scalars(list):
    def first(self):
        return self[0] if self else None

    def all(self):
        return list(self)


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value

    def scalars(self):
        if self.value is None:
            return _Scalars()
        return _Scalars(self.value if isinstance(self.value, list) else [self.value])


class _Db:
    """Answers each execute() with the next queued value, and records writes."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.added, self.deleted, self.commits = [], [], 0

    async def execute(self, _stmt):
        return _Result(self.answers.pop(0) if self.answers else None)

    def add(self, obj):
        self.added.append(obj)

    async def delete(self, obj):
        self.deleted.append(obj)

    async def commit(self):
        self.commits += 1

    async def refresh(self, _obj):
        pass


def _ctx(permissions=("data:read", "data:write"), board_id=None) -> ScopeContext:
    ctx = ScopeContext(
        user_id=uuid4(), scope_type="account", scope_id=uuid4(), active_roles=["x"],
        resolved_permissions=set(permissions),
    )
    ctx.board_id = board_id
    return ctx


def _project(**over) -> Project:
    project_id = uuid4()
    fields = dict(id=project_id, account_id=uuid4(), lineage_id=project_id, name="P", locked_at=None, schema_version=1)
    fields.update(over)
    return Project(**fields)


def _design(project, **over) -> ProjectDesign:
    fields = dict(
        id=uuid4(), project_id=project.id, account_id=project.account_id, wireframe_id=uuid4(),
        name="Checkout", brief="Calm, generous spacing", reference_document_ids=[], figma_url=None,
        published_url=None, current_revision_id=None, status="active", pos="a0", synced_at=None,
        created_at=NOW, updated_at=NOW,
    )
    fields.update(over)
    return ProjectDesign(**fields)


def _revision(design, **over) -> DesignRevision:
    revision_id = uuid4()
    html_key, source_key = designs.revision_keys(design.account_id, design.project_id, design.id, revision_id)
    fields = dict(
        id=revision_id, design_id=design.id, project_id=design.project_id, account_id=design.account_id,
        revision_no=1, html_key=html_key, source_key=source_key, html_bytes=2048, source_bytes=4096,
        source_hash=HASH_A, origin="claude_code", summary="First build", status="uploaded", created_at=NOW,
    )
    fields.update(over)
    return DesignRevision(**fields)


def _payload(**over) -> DesignRevisionCreate:
    body = dict(origin="figma_make", summary="Edited in Make", source_hash=HASH_A, html_bytes=2048, source_bytes=4096)
    body.update(over)
    return DesignRevisionCreate(**body)


@pytest.fixture
def configured(monkeypatch):
    """A bucket to presign against, and the project/design lookups stubbed."""
    settings = SimpleNamespace(documents_bucket="bucket", documents_max_bytes=25 * 1024 * 1024, presign_ttl_seconds=900)
    monkeypatch.setattr(designs, "get_settings", lambda: settings)
    monkeypatch.setattr(designs.storage, "presign_put", lambda key, *_a: f"https://bucket.s3.example/{key}")
    return settings


def _stub_lookups(monkeypatch, project, design, current=None, revision=None):
    async def writable(*_a, **_k):
        return project

    async def find_design(*_a, **_k):
        return design

    async def current_revision(*_a, **_k):
        return current

    async def find_revision(*_a, **_k):
        return revision

    monkeypatch.setattr(designs, "get_writable_project", writable)
    monkeypatch.setattr(designs, "get_project", writable)
    monkeypatch.setattr(designs, "_design", find_design)
    monkeypatch.setattr(designs, "_current_revision", current_revision)
    monkeypatch.setattr(designs, "_revision", find_revision)


def _call(route, ctx, db, **over):
    """Call a design route with plausible arguments for whatever it takes."""
    available = dict(
        project_id=uuid4(), design_id=uuid4(), revision_id=uuid4(), ctx=ctx, db=db, response=Response(),
    )
    bodies = {
        designs.create_design: dict(wireframe_id=uuid4(), name="Checkout"),
        designs.update_design: dict(name="Renamed"),
        designs.set_design_figma: dict(figma_url="https://www.figma.com/make/abc/Checkout"),
        designs.create_design_revision: _payload().model_dump(),
    }
    params = inspect.signature(route).parameters
    kwargs = {name: available[name] for name in params if name in available}
    if "payload" in params:
        kwargs["payload"] = params["payload"].annotation(**bodies[route])
    kwargs.update(over)
    return asyncio.run(route(**kwargs))


def _studio_write_routes():
    def walk(routes, prefix=""):
        for route in routes:
            if isinstance(route, Mount):
                yield from walk(route.routes, prefix + route.path)
            else:
                yield prefix + getattr(route, "path", ""), route

    return [(path, route) for path, route in walk(app.routes) if "/designs" in path]


# ── A board token stays inside its own project ───────────────────────────


def test_the_skills_routes_accept_board_tokens():
    for route in TOKEN_ROUTES:
        assert "require_studio_permission(" in inspect.getsource(route), route.__name__


def test_filing_a_design_is_not_open_to_a_token():
    """Creating, editing, archiving and deleting a design are a person's."""
    for route in (designs.create_design, designs.update_design, designs.delete_design):
        source = inspect.getsource(route)
        assert "require_studio_permission(" not in source and 'require_permission("data:write")' in source


@pytest.mark.parametrize("route", TOKEN_ROUTES, ids=lambda r: r.__name__)
def test_a_token_for_another_project_is_refused(route, configured):
    """The real get_project: the token's board belongs to a different lineage
    than the project in the URL, so nothing about that project is reachable."""
    project = _project()
    other_board = SimpleNamespace(id=uuid4(), lineage_id=uuid4())
    db = _Db(project, other_board)
    with pytest.raises(HTTPException) as exc:
        _call(route, _ctx(board_id=other_board.id), db)
    assert exc.value.status_code == 403
    assert not db.added and not db.commits


def test_a_token_for_this_project_reads_its_designs(configured):
    project = _project()
    board = SimpleNamespace(id=uuid4(), lineage_id=project.lineage_id)
    design = _design(project)
    listed = _call(designs.list_designs, _ctx(board_id=board.id), _Db(project, board, [design]))
    assert listed == [design]


def test_a_design_is_looked_up_inside_its_project_and_organisation():
    """_design filters on all three ids, so a design id from another project
    of the same organisation is a 404 rather than a way in."""
    source = inspect.getsource(designs._design)
    assert "ProjectDesign.project_id == project.id" in source
    assert "ProjectDesign.account_id == project.account_id" in source


# ── Revisions are append-only ────────────────────────────────────────────


def test_no_route_updates_or_deletes_a_revision():
    for path, route in _studio_write_routes():
        if "/revisions" not in path:
            continue
        methods = set(route.methods) - {"HEAD", "OPTIONS"}
        assert methods <= {"GET", "POST"}, f"{sorted(methods)} {path}"


def test_only_confirm_writes_to_a_revision():
    """pending -> uploaded, once, is the only change a revision row ever sees."""
    for name, member in inspect.getmembers(designs, inspect.iscoroutinefunction):
        if member.__module__ != designs.__name__ or name == "confirm_design_revision":
            continue
        source = inspect.getsource(member)
        assert "revision.status =" not in source and "revision.html_key =" not in source, name


def test_a_person_cannot_edit_a_designs_content():
    """The session PATCH is filing: no field of it reaches the Figma link, the
    revision on show or anything a revision holds."""
    assert set(DesignUpdate.model_fields) == {"name", "brief", "reference_document_ids", "status", "pos"}


def test_confirming_an_uploaded_revision_changes_nothing(monkeypatch, configured):
    project = _project()
    design = _design(project)
    first = _revision(design)
    design.current_revision_id = first.id
    _stub_lookups(monkeypatch, project, design, revision=first)

    async def untouchable(*_a, **_k):
        raise AssertionError("an uploaded revision must not be re-checked or rewritten")

    monkeypatch.setattr(designs.storage, "head_object", untouchable)
    monkeypatch.setattr(designs.storage, "delete_object", untouchable)
    db = _Db()
    assert _call(designs.confirm_design_revision, _ctx(), db) is design
    assert first.status == "uploaded" and not db.commits and not db.deleted


def test_a_new_revision_is_added_beside_the_old_one(monkeypatch, configured):
    project = _project()
    design = _design(project)
    first = _revision(design)
    design.current_revision_id = first.id
    _stub_lookups(monkeypatch, project, design, current=first)
    db = _Db(None, 1)  # no pending revision to reuse; highest revision_no is 1
    ticket = _call(designs.create_design_revision, _ctx(), db, payload=_payload(source_hash=HASH_B))

    assert ticket.unchanged is False
    [added] = db.added
    assert isinstance(added, DesignRevision) and added.revision_no == 2 and added.status == "pending"
    assert added.html_key != first.html_key and added.source_key != first.source_key
    assert ticket.html_upload.upload_url.endswith(added.html_key)
    assert ticket.source_upload.upload_url.endswith(added.source_key)
    # Not on show until its upload has been checked.
    assert design.current_revision_id == first.id
    assert (first.status, first.revision_no, first.source_hash) == ("uploaded", 1, HASH_A)


def test_confirm_puts_a_checked_revision_on_show(monkeypatch, configured):
    project = _project()
    design = _design(project)
    pending = _revision(design, status="pending", revision_no=2, source_hash=HASH_B)
    _stub_lookups(monkeypatch, project, design, revision=pending)

    async def head(key):
        html = key == pending.html_key
        return storage.ObjectInfo(size=2048 if html else 4096, content_type="text/html" if html else "application/zip")

    async def read(key, _range):
        return b"<!doctype html><html>" if key == pending.html_key else b"PK\x03\x04"

    monkeypatch.setattr(designs.storage, "head_object", head)
    monkeypatch.setattr(designs.storage, "read_object", read)
    _call(designs.confirm_design_revision, _ctx(), _Db())
    assert pending.status == "uploaded"
    assert design.current_revision_id == pending.id and design.synced_at is not None


def test_confirm_refuses_something_that_is_not_html(monkeypatch, configured):
    project = _project()
    design = _design(project)
    pending = _revision(design, status="pending", source_key=None, source_bytes=None)
    _stub_lookups(monkeypatch, project, design, revision=pending)
    removed = []

    async def head(_key):
        return storage.ObjectInfo(size=2048, content_type="text/html")

    async def read(_key, _range):
        return b"MZ\x90\x00 not a page"

    async def delete(key):
        removed.append(key)

    monkeypatch.setattr(designs.storage, "head_object", head)
    monkeypatch.setattr(designs.storage, "read_object", read)
    monkeypatch.setattr(designs.storage, "delete_object", delete)
    db = _Db()
    with pytest.raises(HTTPException) as exc:
        _call(designs.confirm_design_revision, _ctx(), db)
    assert exc.value.status_code == 422
    assert removed == [pending.html_key] and db.deleted == [pending]
    assert design.current_revision_id is None


def test_confirm_refuses_a_size_that_was_not_declared(monkeypatch, configured):
    project = _project()
    design = _design(project)
    pending = _revision(design, status="pending", source_key=None, source_bytes=None)
    _stub_lookups(monkeypatch, project, design, revision=pending)

    async def head(_key):
        return storage.ObjectInfo(size=9999, content_type="text/html")

    async def delete(_key):
        pass

    monkeypatch.setattr(designs.storage, "head_object", head)
    monkeypatch.setattr(designs.storage, "delete_object", delete)
    with pytest.raises(HTTPException) as exc:
        _call(designs.confirm_design_revision, _ctx(), _Db())
    assert exc.value.status_code == 422


# ── A sync that found nothing new creates nothing ────────────────────────


def test_an_unchanged_source_is_a_no_op(monkeypatch, configured):
    project = _project()
    design = _design(project)
    current = _revision(design)
    design.current_revision_id = current.id
    _stub_lookups(monkeypatch, project, design, current=current)
    db, response = _Db(), Response()
    ticket = _call(designs.create_design_revision, _ctx(), db, payload=_payload(source_hash=HASH_A), response=response)

    assert ticket.unchanged is True and response.status_code == 200
    assert ticket.revision.id == current.id
    assert ticket.html_upload is None and ticket.source_upload is None
    assert not db.added and not db.deleted
    assert design.current_revision_id == current.id


def test_an_unchanged_sync_still_counts_as_synced(monkeypatch, configured):
    """"Last synced" says when the mirror was last checked, not when it last
    changed -- otherwise a design nobody has touched reads as stale."""
    project = _project()
    design = _design(project)
    current = _revision(design)
    design.current_revision_id = current.id
    _stub_lookups(monkeypatch, project, design, current=current)
    _call(designs.create_design_revision, _ctx(), _Db(), payload=_payload(source_hash=HASH_A))
    assert design.synced_at is not None


def test_repeating_an_unfinished_upload_reuses_its_revision(monkeypatch, configured):
    project = _project()
    design = _design(project)
    pending = _revision(design, status="pending", source_hash=HASH_B)
    _stub_lookups(monkeypatch, project, design)
    db, response = _Db(pending), Response()
    ticket = _call(designs.create_design_revision, _ctx(), db, payload=_payload(source_hash=HASH_B), response=response)
    assert ticket.revision.id == pending.id and not db.added and response.status_code == 201


def test_the_first_build_is_revision_one(monkeypatch, configured):
    project = _project()
    design = _design(project)
    _stub_lookups(monkeypatch, project, design)
    db = _Db(None, None)
    _call(designs.create_design_revision, _ctx(), db, payload=_payload(source_bytes=None))
    [added] = db.added
    assert added.revision_no == 1 and added.source_key is None


def test_an_archived_design_takes_no_revision(monkeypatch, configured):
    project = _project()
    _stub_lookups(monkeypatch, project, _design(project, status="archived"))
    with pytest.raises(HTTPException) as exc:
        _call(designs.create_design_revision, _ctx(), _Db())
    assert exc.value.status_code == 409


# ── A locked version is frozen ───────────────────────────────────────────


@pytest.mark.parametrize("route", WRITE_ROUTES, ids=lambda r: r.__name__)
def test_a_locked_project_answers_423(route, configured):
    """The real get_writable_project, given a project that has been locked."""
    db = _Db(_project(locked_at=NOW))
    with pytest.raises(HTTPException) as exc:
        _call(route, _ctx(), db)
    assert exc.value.status_code == 423
    assert not db.added and not db.deleted and not db.commits


def test_every_design_write_route_is_in_the_list_above():
    """So a new write route cannot be added without the 423 test covering it."""
    routed = {
        route.endpoint.__name__
        for _path, route in _studio_write_routes()
        if not set(route.methods) <= {"GET", "HEAD", "OPTIONS"}
    }
    assert routed == {route.__name__ for route in WRITE_ROUTES}


def test_a_locked_project_can_still_be_read():
    for route in (designs.list_designs, designs.get_design, designs.list_design_revisions,
                  designs.view_design_revision, designs.get_design_brief):
        assert "get_writable_project(" not in inspect.getsource(route), route.__name__


# ── Members and viewers read; they do not write ──────────────────────────


@pytest.mark.parametrize("role", ["account_member", "account_viewer"])
def test_read_only_roles_hold_no_permission_a_design_write_accepts(role):
    permissions = get_auth_config().permissions_for_role(role)
    assert "data:read" in permissions
    for route in WRITE_ROUTES:
        source = inspect.getsource(route)
        assert '_permission("data:write")' in source, route.__name__
        assert "data:write" not in permissions


@pytest.mark.parametrize("role", ["account_member", "account_viewer"])
def test_the_studio_guard_turns_a_read_only_caller_away(role, monkeypatch):
    """The dual-auth guard, on its human path, with that role's permissions."""
    ctx = _ctx(get_auth_config().permissions_for_role(role))

    async def current_user(**_k):
        return SimpleNamespace(id=ctx.user_id)

    async def scope_context(**_k):
        return ctx

    monkeypatch.setattr(common, "get_current_user", current_user)
    monkeypatch.setattr(common, "get_scope_context", scope_context)
    request = Request({"type": "http", "headers": []})
    guard = common.require_studio_permission("data:write")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(guard(request=request, authorization="Bearer a-session-token", db=None))
    assert exc.value.status_code == 403
    # ...and the same caller may still read.
    assert asyncio.run(
        common.require_studio_permission("data:read")(request=request, authorization="Bearer a-session-token", db=None)
    ) is ctx


def test_a_token_without_data_write_cannot_submit(monkeypatch):
    ctx = _ctx(("board:read", "data:read"))

    async def require_board_token(**_k):
        return ctx, SimpleNamespace(id=uuid4(), board_id=uuid4())

    monkeypatch.setattr(common, "require_board_token", require_board_token)
    request = Request({"type": "http", "headers": []})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            common.require_studio_permission("data:write")(
                request=request, authorization=f"Bearer {common.TOKEN_PREFIX}x", db=None
            )
        )
    assert exc.value.status_code == 403


# ── The Figma link ───────────────────────────────────────────────────────


@pytest.mark.parametrize("url", [
    "https://www.figma.com/make/AbC123/Checkout",
    "https://figma.com/make/AbC123",
    "https://checkout-demo.figma.site/",
])
def test_figma_links_are_accepted(url):
    assert designs.figma_url_or_422(url, "figma_url") == url


@pytest.mark.parametrize("url", [
    "http://www.figma.com/make/AbC123",
    "https://figma.com.evil.example/make/AbC123",
    "https://evilfigma.com/make/AbC123",
    "javascript:alert(1)",
    "https://user:pw@www.figma.com/make/AbC123",
])
def test_anything_else_is_refused(url):
    with pytest.raises(HTTPException) as exc:
        designs.figma_url_or_422(url, "figma_url")
    assert exc.value.status_code == 422


def test_an_absent_field_is_left_alone_and_a_null_clears(monkeypatch):
    project = _project()
    design = _design(project, figma_url="https://www.figma.com/make/a", published_url="https://a.figma.site/")
    _stub_lookups(monkeypatch, project, design)
    _call(designs.set_design_figma, _ctx(), _Db(), payload=DesignFigmaUpdate(published_url=None))
    assert design.figma_url == "https://www.figma.com/make/a" and design.published_url is None


# ── Storage, the view URL and the frame it loads in ──────────────────────


def test_the_view_url_is_inline_html_and_short_lived(monkeypatch, configured):
    project = _project()
    design = _design(project)
    revision = _revision(design)
    _stub_lookups(monkeypatch, project, design, revision=revision)
    seen = {}

    def presign_get(key, filename, expires, inline_as=None):
        seen.update(key=key, expires=expires, inline_as=inline_as)
        return "https://bucket.s3.example/signed"

    monkeypatch.setattr(designs.storage, "presign_get", presign_get)
    view = _call(designs.view_design_revision, _ctx(("data:read",)), _Db())
    assert view.url == "https://bucket.s3.example/signed"
    assert seen["key"] == revision.html_key and seen["inline_as"].startswith("text/html")
    assert seen["expires"] == view.expires_in <= 300


def test_a_revision_still_uploading_cannot_be_viewed(monkeypatch, configured):
    project = _project()
    design = _design(project)
    _stub_lookups(monkeypatch, project, design, revision=_revision(design, status="pending"))
    with pytest.raises(HTTPException) as exc:
        _call(designs.view_design_revision, _ctx(("data:read",)), _Db())
    assert exc.value.status_code == 409


def test_the_csp_frames_the_documents_bucket_and_no_figma_host():
    source = (
        pathlib.Path(__file__).parents[1] / "app" / "auth" / "security" / "security_headers_middleware.py"
    ).read_text()
    frame_src = next(line for line in source.splitlines() if '"frame-src' in line)
    connect_src = next(line for line in source.splitlines() if '"connect-src' in line)
    for host in ("https://s3.eu-west-1.amazonaws.com", "https://*.s3.eu-west-1.amazonaws.com"):
        assert host in frame_src and host in connect_src
    assert "figma" not in source.split("Content-Security-Policy", 1)[1].lower()
    # Generated script must never become runnable on Studio's own origin.
    script_src = next(line for line in source.splitlines() if '"script-src' in line)
    assert "amazonaws" not in script_src and "unsafe-inline" not in script_src and "blob:" not in script_src


def test_reference_images_are_images_only():
    assert set(documents.allowed_types("design_reference")) == {"png", "jpg", "jpeg"}
    # ...without narrowing what the Documents tab and example data accept.
    assert "pdf" in documents.allowed_types("document")
    assert "csv" in documents.allowed_types("example_data")


def test_a_brief_cannot_name_another_projects_document():
    source = inspect.getsource(designs._reference_documents)
    assert "ProjectDocument.project_id == project.id" in source
    assert "ProjectDocument.purpose == REFERENCE_PURPOSE" in source


def test_there_is_no_llm_call_queue_or_worker_here():
    source = inspect.getsource(designs)
    code = source.split('"""', 2)[2]  # past the module docstring, which says so in words
    for word in ("anthropic", "openai", "sqs", "celery", "BackgroundTasks", "create_task"):
        assert word not in code, word


def test_versions_carry_designs_and_their_revisions():
    assert {"project_designs", "design_revisions"} <= COPIED_TABLES


# ── The board MCP tools (the skill's hands) ──────────────────────────────


@pytest.fixture
def board_mcp(monkeypatch):
    import importlib.util
    import sys
    import types

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
    spec = importlib.util.spec_from_file_location(
        "board_mcp_designs", pathlib.Path(__file__).parents[2] / "board_mcp.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.calls, module.puts, module.unchanged = [], [], False

    def studio_call(method, path, body=None):
        module.calls.append((method, path, body))
        if path.endswith("/revisions"):
            revision = {"id": "r2", "revision_no": 2}
            if module.unchanged:
                return {"unchanged": True, "revision": revision, "design": {"synced_at": "now"}}
            return {
                "unchanged": False, "revision": revision, "design": {"synced_at": None},
                "html_upload": {"upload_url": "https://bucket/html", "headers": {"Content-Type": "text/html"}},
                "source_upload": {"upload_url": "https://bucket/zip", "headers": {"Content-Type": "application/zip"}},
            }
        if path.endswith("/confirm"):
            return {"synced_at": "now"}
        raise AssertionError(path)

    module._studio_call = studio_call
    module._put_presigned = lambda url, data, headers: module.puts.append((url, data, headers))
    return module


def _prototype(tmp_path):
    source = tmp_path / "proto"
    (source / "src").mkdir(parents=True)
    (source / "src" / "App.tsx").write_text("export default () => null")
    (source / "package.json").write_text("{}")
    (source / "node_modules" / "react").mkdir(parents=True)
    (source / "node_modules" / "react" / "index.js").write_text("// installed, not source")
    (source / "dist").mkdir()
    html = source / "dist" / "index.html"
    html.write_text("<!doctype html><html></html>")
    return source, html


def test_the_mcp_tool_uploads_html_and_source_then_confirms(board_mcp, tmp_path):
    source, html = _prototype(tmp_path)
    out = board_mcp.submit_design_revision("d1", str(html), "claude_code", source_dir=str(source), summary=" First ")
    method, path, body = board_mcp.calls[0]
    assert (method, path) == ("POST", "/designs/d1/revisions")
    assert body["origin"] == "claude_code" and body["summary"] == "First"
    assert body["html_bytes"] == html.stat().st_size and body["source_bytes"] > 0
    assert DesignRevisionCreate(**body)  # the server accepts exactly what the tool sends
    assert [url for url, _d, _h in board_mcp.puts] == ["https://bucket/html", "https://bucket/zip"]
    assert board_mcp.puts[1][1].startswith(b"PK\x03\x04")
    assert board_mcp.calls[-1][:2] == ("POST", "/designs/d1/revisions/r2/confirm")
    assert out["unchanged"] is False and out["revision_no"] == 2


def test_the_mcp_tool_uploads_nothing_when_unchanged(board_mcp, tmp_path):
    source, html = _prototype(tmp_path)
    board_mcp.unchanged = True
    out = board_mcp.submit_design_revision("d1", str(html), "figma_make", source_dir=str(source))
    assert out["unchanged"] is True
    assert board_mcp.puts == [] and len(board_mcp.calls) == 1


def test_the_source_hash_ignores_what_is_installed_or_built(board_mcp, tmp_path):
    """Otherwise every sync would look like a change and mint a revision."""
    source, html = _prototype(tmp_path)
    before = board_mcp._source_hash(board_mcp._source_files(str(source)))
    (source / "node_modules" / "react" / "index.js").write_text("// reinstalled")
    html.write_text("<!doctype html><html>rebuilt</html>")
    assert board_mcp._source_hash(board_mcp._source_files(str(source))) == before
    (source / "src" / "App.tsx").write_text("export default () => 1")
    assert board_mcp._source_hash(board_mcp._source_files(str(source))) != before


def test_the_mcp_server_has_no_design_delete_or_edit_tool():
    source = (pathlib.Path(__file__).parents[2] / "board_mcp.py").read_text(encoding="utf-8")
    section = source.split("# ── High-fidelity designs", 1)[1]
    tools = [line.split("def ")[1].split("(")[0] for line in section.splitlines() if line.startswith("def ") and not line.startswith("def _")]
    assert tools == ["list_designs", "get_design_brief", "set_design_figma_url", "submit_design_revision"]
    assert '"DELETE"' not in section and '"PATCH"' not in section
