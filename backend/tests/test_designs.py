"""High-fidelity designs (docs/high-fidelity-design.md).

Studio authors the brief and frames the site published from the Figma Make
file; it never edits a design. The rules pinned here are the ones that would
fail open: a board token reaching another project's designs, a locked version
accepting a write, a read-only role being able to make one, and a frame
allowed from anywhere but Figma's published sites.

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
from fastapi import HTTPException
from starlette.requests import Request
from starlette.routing import Mount

from app.auth.security.scope_context import ScopeContext
from app.auth.services.auth_config_loader import get_auth_config
from app.main import app
from app.studio import common, designs, documents
from app.studio.models import Project, ProjectDesign, Wireframe
from app.studio.schemas import DesignFigmaUpdate, DesignUpdate
from app.studio.versioning import COPIED_TABLES

NOW = datetime(2026, 11, 13, 12, 0, 0)

#: The routes the skill uses, i.e. the ones a board token reaches.
TOKEN_ROUTES = (
    designs.list_designs,
    designs.get_design_brief,
    designs.set_design_figma,
)

#: Every route in the module that changes something.
WRITE_ROUTES = (
    designs.create_design,
    designs.update_design,
    designs.delete_design,
    designs.set_design_figma,
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
        id=uuid4(), project_id=project.id, account_id=project.account_id,
        all_wireframes=False, wireframe_ids=[str(uuid4())],
        name="Checkout", brief="Calm, generous spacing", reference_document_ids=[], figma_url=None,
        published_url=None, status="active", pos="a0",
        created_at=NOW, updated_at=NOW,
    )
    fields.update(over)
    return ProjectDesign(**fields)


@pytest.fixture
def configured(monkeypatch):
    """A bucket to presign against, and the project/design lookups stubbed."""
    settings = SimpleNamespace(documents_bucket="bucket", documents_max_bytes=25 * 1024 * 1024, presign_ttl_seconds=900)
    monkeypatch.setattr(designs, "get_settings", lambda: settings)
    return settings


def _stub_lookups(monkeypatch, project, design):
    async def writable(*_a, **_k):
        return project

    async def find_design(*_a, **_k):
        return design

    monkeypatch.setattr(designs, "get_writable_project", writable)
    monkeypatch.setattr(designs, "get_project", writable)
    monkeypatch.setattr(designs, "_design", find_design)


def _call(route, ctx, db, **over):
    """Call a design route with plausible arguments for whatever it takes."""
    available = dict(project_id=uuid4(), design_id=uuid4(), ctx=ctx, db=db)
    bodies = {
        designs.create_design: dict(wireframe_ids=[uuid4()], name="Checkout"),
        designs.update_design: dict(name="Renamed"),
        designs.set_design_figma: dict(figma_url="https://www.figma.com/make/abc/Checkout"),
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


# ── Studio never edits a design ──────────────────────────────────────────


def test_a_person_cannot_edit_a_designs_content():
    """The session PATCH is filing: no field of it reaches the Figma links."""
    assert set(DesignUpdate.model_fields) == {
        "name", "brief", "reference_document_ids", "all_wireframes", "wireframe_ids", "status", "pos",
    }


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
    for route in (designs.list_designs, designs.get_design, designs.get_design_brief):
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


# ── The frame the published site loads in ────────────────────────────────


def test_the_csp_frames_figmas_published_sites_and_nothing_built():
    source = (
        pathlib.Path(__file__).parents[1] / "app" / "auth" / "security" / "security_headers_middleware.py"
    ).read_text()
    frame_src = next(line for line in source.splitlines() if '"frame-src' in line)
    assert "https://*.figma.site" in frame_src
    # Studio no longer frames anything from its own bucket.
    assert "amazonaws" not in frame_src
    # Figma's sites are framed, never run as script on Studio's origin.
    script_src = next(line for line in source.splitlines() if '"script-src' in line)
    assert "figma" not in script_src and "unsafe-inline" not in script_src and "blob:" not in script_src


def test_only_figmas_hosts_can_be_recorded_for_the_frame():
    """The page frames published_url, so it is held to the same hosts the CSP
    allows."""
    with pytest.raises(HTTPException):
        designs.figma_url_or_422("https://example.com/", "published_url")
    assert designs.figma_url_or_422("https://memory-drums-1.figma.site", "published_url")


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


# ── Which wireframes a design is for ─────────────────────────────────────


def _wireframe(project, name="W", **over) -> Wireframe:
    fields = dict(id=uuid4(), project_id=project.id, account_id=project.account_id, name=name,
                  interface_type="desktop", status="active", pos="a0")
    fields.update(over)
    return Wireframe(**fields)


def test_all_wireframes_stores_no_ids():
    project = _project()
    assert asyncio.run(designs._checked_wireframe_ids(_Db(), project, True, [uuid4()])) == []


def test_picking_no_wireframe_is_refused():
    with pytest.raises(HTTPException) as err:
        asyncio.run(designs._checked_wireframe_ids(_Db(), _project(), False, []))
    assert err.value.status_code == 422


def test_picked_wireframes_keep_their_order_once_each():
    project = _project()
    a, b = uuid4(), uuid4()
    stored = asyncio.run(designs._checked_wireframe_ids(_Db([b, a]), project, False, [b, a, b]))
    assert stored == [str(b), str(a)]


def test_a_wireframe_of_another_project_is_refused():
    project = _project()
    mine, theirs = uuid4(), uuid4()
    with pytest.raises(HTTPException) as err:
        # The lookup is confined to this project, so only one id comes back.
        asyncio.run(designs._checked_wireframe_ids(_Db([mine]), project, False, [mine, theirs]))
    assert err.value.status_code == 404
    source = inspect.getsource(designs._checked_wireframe_ids)
    assert "Wireframe.project_id == project.id" in source


def test_picked_wireframes_resolve_in_order_and_report_deleted_ones():
    project = _project()
    first, second = _wireframe(project, "First"), _wireframe(project, "Second")
    gone = uuid4()
    design = _design(project, wireframe_ids=[str(second.id), str(gone), str(first.id)])
    found, missing = asyncio.run(designs.design_wireframes(_Db([first, second]), project, design))
    assert [w.name for w in found] == ["Second", "First"]
    assert missing == [str(gone)]


def test_all_wireframes_resolves_to_the_active_ones_now():
    project = _project()
    current = [_wireframe(project, "One"), _wireframe(project, "Two")]
    design = _design(project, all_wireframes=True, wireframe_ids=[])
    found, missing = asyncio.run(designs.design_wireframes(_Db(current), project, design))
    assert found == current and missing == []
    source = inspect.getsource(designs.design_wireframes)
    assert 'Wireframe.status == "active"' in source


def test_a_brief_with_no_wireframe_left_is_a_conflict(monkeypatch):
    project = _project()
    design = _design(project)

    async def fake_project(*_a, **_k):
        return project

    async def fake_design(*_a, **_k):
        return design

    monkeypatch.setattr(designs, "get_project", fake_project)
    monkeypatch.setattr(designs, "_design", fake_design)
    with pytest.raises(HTTPException) as err:
        asyncio.run(designs.get_design_brief(project.id, design.id, ctx=_ctx(), db=_Db([])))
    assert err.value.status_code == 409


def test_naming_wireframes_turns_all_off(monkeypatch):
    project = _project()
    design = _design(project, all_wireframes=True, wireframe_ids=[])
    picked = uuid4()

    async def fake_project(*_a, **_k):
        return project

    async def fake_design(*_a, **_k):
        return design

    monkeypatch.setattr(designs, "get_writable_project", fake_project)
    monkeypatch.setattr(designs, "_design", fake_design)
    asyncio.run(designs.update_design(
        project.id, design.id, DesignUpdate(wireframe_ids=[picked]), ctx=_ctx(), db=_Db([picked]),
    ))
    assert design.all_wireframes is False
    assert design.wireframe_ids == [str(picked)]


def test_versions_carry_designs():
    assert "project_designs" in COPIED_TABLES
    assert "design_revisions" not in COPIED_TABLES


# ── The board MCP tools (the skill's hands) ──────────────────────────────


def test_the_mcp_server_has_no_design_delete_or_edit_tool():
    source = (pathlib.Path(__file__).parents[2] / "board_mcp.py").read_text(encoding="utf-8")
    section = source.split("# ── High-fidelity designs", 1)[1]
    tools = [line.split("def ")[1].split("(")[0] for line in section.splitlines() if line.startswith("def ") and not line.startswith("def _")]
    assert tools == ["list_designs", "get_design_brief", "set_design_figma_url"]
    assert '"DELETE"' not in section and '"PATCH"' not in section
