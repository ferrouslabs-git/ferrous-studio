"""The Project Agent chatbot's pure pieces.

The routes themselves need a database and a real (or mocked) Anthropic
call -- exercised live via run-local, not here, matching every other
route-level test in this suite (test_bundle_import.py's own docstring
states the same reasoning). What's tested here is what can be: the
configured() gate, which permission/lock each route asks for, the prompt
and tool-loop wiring, and how a failed Anthropic call or a failed tool
call is handled -- with create_bundle_content itself mocked out, since
it's a real DB-touching function tested on its own terms elsewhere
(test_bundle_import.py).
"""
import inspect
import json
from dataclasses import replace
from types import SimpleNamespace

import anthropic
import pytest

from app.config import get_settings
from app.studio import project_agent as pa
from app.studio.catalog import get_catalog
from app.studio.importing import BundleError, validate_bundle, wrap_bare_envelope

FAKE_PROJECT = SimpleNamespace(name="Test", id="proj-1", account_id="acct-1", repo_full_name=None)


class _FakeCtx:
    """Mirrors ScopeContext.has_permission's real semantics (just the one
    method _tools_for/_run_tool actually call) without needing a real,
    resolved ScopeContext -- matches an account_member (data:write only) or
    account_admin (data:write + board:write), per auth_config.yaml."""

    def __init__(self, permissions: set[str], scope_id: str = "acct-1", user_id: str = "user-1"):
        self._permissions = permissions
        self.scope_id = scope_id
        self.user_id = user_id

    def has_permission(self, perm: str) -> bool:
        return perm in self._permissions


FAKE_CTX_MEMBER = _FakeCtx({"data:write"})
FAKE_CTX_ADMIN = _FakeCtx({"data:write", "board:write"})


@pytest.fixture
def configured(monkeypatch):
    def _configure(model: str = "eu.anthropic.claude-sonnet-5"):
        settings = replace(get_settings(), bedrock_claude_model=model)
        monkeypatch.setattr(pa, "get_settings", lambda: settings)
        return settings

    return _configure


def test_configured_is_true_once_a_model_is_set(configured):
    configured()
    assert pa.configured() is True


def test_configured_is_false_with_no_model(monkeypatch):
    settings = replace(get_settings(), bedrock_claude_model="")
    monkeypatch.setattr(pa, "get_settings", lambda: settings)
    assert pa.configured() is False


def test_list_messages_works_on_a_locked_version():
    """Reading history must not require get_writable_project -- a locked
    version's Project Agent tab should still show what was said, the same
    way GitHub connection reads work on a frozen version."""
    source = inspect.getsource(pa.list_messages)
    assert "get_project(" in source
    assert "get_writable_project(" not in source


def test_send_message_takes_the_project_lock():
    """A locked version is a frozen record, and the agent can now write real
    content via create_bundle, so a conversation against a locked version
    must not proceed."""
    assert "get_writable_project(" in inspect.getsource(pa.send_message)


def test_send_message_checks_the_rate_limit_before_anything_else():
    """A rejected request from an organisation already over its allowance
    should cost nothing more than the rate limiter's own check -- not a DB
    round trip to resolve the project too."""
    source = inspect.getsource(pa.send_message)
    assert source.index("_rate_limiter.is_rate_limited(") < source.index("get_writable_project(")


def test_the_rate_limit_key_is_per_organisation_not_per_project_or_user():
    """The thing to prevent is one organisation's heavy use starving every
    other organisation sharing this one platform-wide Bedrock capacity --
    the key must be built from ctx.scope_id (the organisation), not e.g.
    project_id or ctx.user_id."""
    assert 'f"project-agent:{ctx.scope_id}"' in inspect.getsource(pa.send_message)


def test_the_rate_limiter_is_postgres_backed_not_in_memory():
    """staging/prod may run more than one ECS task; an in-memory counter
    would give each task its own separate allowance for the same
    organisation, silently multiplying the real limit by however many
    tasks happen to be running."""
    from app.auth.services.rate_limiter_service import PostgresRateLimiter

    assert isinstance(pa._rate_limiter, PostgresRateLimiter)


async def test_send_message_rejects_an_organisation_over_its_rate_limit(monkeypatch):
    async def _always_limited(key, limit, window_seconds):
        assert key == "project-agent:acct-1"
        assert limit == pa.RATE_LIMIT_MAX_MESSAGES
        assert window_seconds == pa.RATE_LIMIT_WINDOW_SECONDS
        return True

    monkeypatch.setattr(pa._rate_limiter, "is_rate_limited", _always_limited)
    fake_ctx = SimpleNamespace(scope_id="acct-1")

    with pytest.raises(pa.HTTPException) as excinfo:
        await pa.send_message(project_id="proj-1", payload=pa.ProjectAgentSend(content="hi"), ctx=fake_ctx, db=None)

    assert excinfo.value.status_code == 429
    assert excinfo.value.headers["Retry-After"] == str(pa.RATE_LIMIT_WINDOW_SECONDS)


def test_bedrock_calls_carry_an_explicit_timeout():
    """Without one, a hung call would sit on the SDK's own default for as
    long as it likes, tying up a worker and an open DB transaction the
    whole time -- its own way of starving other organisations even though
    the rate limiter above never saw the request."""
    assert "timeout=BEDROCK_CALL_TIMEOUT_SECONDS" in inspect.getsource(pa._ask_claude)


def test_permissions_match_the_data_routes_convention():
    read_source = inspect.getsource(pa.list_messages)
    write_source = inspect.getsource(pa.send_message)
    assert 'require_permission("data:read")' in read_source
    assert 'require_permission("data:write")' in write_source


def test_the_prompt_tells_the_agent_to_lead_with_the_fact():
    """A soft "mention it somewhere" instruction is easy for a model to bury
    at the end of a long reply. The instruction must say to open with it."""
    assert "Open your reply with the plain fact" in pa.SYSTEM_PROMPT


def test_the_prompt_regenerates_directly_without_waiting_for_confirmation():
    """Ali's answer (Slack, 2026-09-11): "Regenerate just generates a new
    wireframes file... Version is the history" -- don't pause and ask, just
    create the new one and rely on the existing version-snapshot system to
    keep the old one recoverable. This replaced an earlier, stricter
    "wait for their answer before calling create_bundle" instruction."""
    assert "Do not pause to ask permission" in pa.SYSTEM_PROMPT
    assert "wait for confirmation before creating it" in pa.SYSTEM_PROMPT
    assert "do not create anything until they confirm" not in pa.SYSTEM_PROMPT


def test_the_prompt_forbids_claiming_unconfirmed_creation():
    assert "never say you built something you didn't call a tool for" in pa.SYSTEM_PROMPT


def test_send_message_looks_up_existing_content_before_asking():
    """Both counts must actually be queried, not just accepted as parameters
    -- otherwise _ask_claude's defaults (0, 0) silently claim every project
    is empty."""
    source = inspect.getsource(pa.send_message)
    assert "_count(db, Wireframe, project)" in source
    assert "_count(db, ProjectDiagram, project)" in source


def test_catalogue_reference_is_generated_not_hand_written():
    """Proves the reference text actually reflects the real catalogue --
    a hand-written copy could silently drift from what validate_bundle
    accepts; this can't, since it's built from get_catalog() itself."""
    ref = pa._catalogue_reference()
    assert "navbar" in ref
    assert "list" in ref
    assert "canvas" in ref


def test_the_worked_example_in_the_prompt_is_actually_valid():
    """A live run against a real project showed the model needs a concrete
    example to get the shape right -- an element's label is a top-level
    field, not data.label/data.text, among other things (see
    pa._WORKED_EXAMPLE's own comment for the exact failure). If this example
    were ever wrong, it would be actively teaching the model the wrong
    shape, so it must validate cleanly, always."""
    bundle = json.loads(pa._WORKED_EXAMPLE)
    errors = validate_bundle(wrap_bare_envelope(bundle), get_catalog())
    assert errors == []


def test_the_prompt_warns_about_the_mistakes_actually_seen_live():
    assert "TOP-LEVEL field" in pa.BUNDLE_FORMAT_GUIDE
    assert "root layout node needs" in pa.BUNDLE_FORMAT_GUIDE


def test_create_bundle_tool_only_exposes_wireframes_and_diagrams():
    """Matches the client's own scope decision for the reverse-engineer-repo
    skill: no actors, use cases or datasets from this tool, ever -- even
    though create_bundle_content would technically accept them if the model
    somehow produced them, the tool schema doesn't invite it."""
    props = pa.CREATE_BUNDLE_TOOL["input_schema"]["properties"]
    assert set(props) == {"wireframes", "diagrams"}


def test_a_member_without_board_write_only_gets_create_bundle():
    """account_member has data:write but not board:write (auth_config.yaml)
    -- the board tools must not even be offered, not offered-then-refused."""
    tools = pa._tools_for(FAKE_CTX_MEMBER)
    assert tools == [pa.CREATE_BUNDLE_TOOL]


def test_an_admin_with_board_write_gets_all_three_tools():
    tools = pa._tools_for(FAKE_CTX_ADMIN)
    assert tools == [pa.CREATE_BUNDLE_TOOL, pa.CREATE_EPIC_TOOL, pa.CREATE_REQUIREMENT_TOOL]


async def test_the_prompt_tells_a_member_board_tools_are_unavailable(configured, monkeypatch):
    configured()
    captured: dict = {}

    async def _create(**kwargs):
        captured.update(kwargs)
        return _FakeMessage(text="noted")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name=None, history=[])
    assert "do NOT have create_epic or create_requirement" in captured["system"]
    assert captured["tools"] == [pa.CREATE_BUNDLE_TOOL]


async def test_the_prompt_tells_an_admin_board_tools_are_available(configured, monkeypatch):
    configured()
    captured: dict = {}

    async def _create(**kwargs):
        captured.update(kwargs)
        return _FakeMessage(text="noted")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_ADMIN, repo_full_name=None, history=[])
    assert "also have create_epic and create_requirement" in captured["system"]
    assert pa.CREATE_EPIC_TOOL in captured["tools"]
    assert pa.CREATE_REQUIREMENT_TOOL in captured["tools"]


async def test_create_epic_tool_call_succeeds_for_an_admin(monkeypatch):
    async def _fake_create_epic_content(db, project, ctx, payload):
        assert payload.title == "Login flow"
        return SimpleNamespace(id="epic-1", title="Login flow", status="Readiness")

    monkeypatch.setattr(pa, "create_epic_content", _fake_create_epic_content)
    tool_use = SimpleNamespace(name="create_epic", input={"title": "Login flow"})

    content, is_error = await pa._run_tool(None, FAKE_PROJECT, FAKE_CTX_ADMIN, tool_use)

    assert is_error is False
    assert json.loads(content) == {"id": "epic-1", "title": "Login flow", "status": "Readiness"}


async def test_create_epic_tool_call_is_refused_for_a_member_even_if_somehow_invoked():
    """Belt and braces: _tools_for already keeps this tool off a member's
    list, but _run_tool must independently refuse to execute it too, in
    case a stale/replayed tool_use ever reached here for a ctx that never
    had board:write."""
    tool_use = SimpleNamespace(name="create_epic", input={"title": "Login flow"})
    content, is_error = await pa._run_tool(None, FAKE_PROJECT, FAKE_CTX_MEMBER, tool_use)
    assert is_error is True
    assert "Unknown tool" in content


async def test_create_epic_tool_call_with_bad_input_is_a_catchable_error(monkeypatch):
    """title is required (EpicCreate) -- a missing one must come back as a
    normal tool_result error the model can fix and retry, not an uncaught
    pydantic ValidationError crashing the whole request."""
    tool_use = SimpleNamespace(name="create_epic", input={})
    content, is_error = await pa._run_tool(None, FAKE_PROJECT, FAKE_CTX_ADMIN, tool_use)
    assert is_error is True
    assert "errors" in json.loads(content)


async def test_create_requirement_tool_call_succeeds_for_an_admin(monkeypatch):
    async def _fake_create_requirement_content(db, project, ctx, payload):
        assert payload.title == "Add login form"
        return SimpleNamespace(), SimpleNamespace(id="req-1", title="Add login form", status="Todo")

    monkeypatch.setattr(pa, "create_requirement_content", _fake_create_requirement_content)
    tool_use = SimpleNamespace(name="create_requirement", input={"title": "Add login form"})

    content, is_error = await pa._run_tool(None, FAKE_PROJECT, FAKE_CTX_ADMIN, tool_use)

    assert is_error is False
    assert json.loads(content) == {"id": "req-1", "title": "Add login form", "status": "Todo"}


async def test_create_requirement_with_a_bad_epic_id_is_a_catchable_error(monkeypatch):
    """A hallucinated epic_id must not reach the database as a raw foreign-key
    violation -- checked against the real board first, and reported back as
    an ordinary tool_result error the model can retry without it."""

    async def _fake_get_or_create_board(db, project):
        return SimpleNamespace(id="board-1")

    async def _fake_get_epic(db, board, epic_id):
        raise pa.HTTPException(status_code=404, detail="Epic not found")

    monkeypatch.setattr(pa, "get_or_create_board", _fake_get_or_create_board)
    monkeypatch.setattr(pa, "_get_epic", _fake_get_epic)
    tool_use = SimpleNamespace(
        name="create_requirement", input={"title": "Add login form", "epic_id": "11111111-1111-1111-1111-111111111111"}
    )

    content, is_error = await pa._run_tool(None, FAKE_PROJECT, FAKE_CTX_ADMIN, tool_use)

    assert is_error is True
    assert "epic_id" in json.loads(content)["errors"][0]["field"]


async def test_an_admin_can_create_an_epic_then_file_a_requirement_under_it(monkeypatch):
    """The realistic two-step flow the tool description promises: create the
    epic, get its real id back in the tool result, then reference that
    exact id (never an invented one) when creating the requirement."""
    configured_settings = replace(get_settings(), bedrock_claude_model="eu.anthropic.claude-sonnet-5")
    calls = []

    async def _create(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _FakeMessage(tool_use=("call-1", "create_epic", {"title": "Login flow"}))
        if len(calls) == 2:
            return _FakeMessage(
                tool_use=("call-2", "create_requirement", {"title": "Add login form", "epic_id": "11111111-1111-1111-1111-111111111111"})
            )
        return _FakeMessage(text="Created the Login flow epic and one requirement under it.")

    async def _fake_create_epic_content(db, project, ctx, payload):
        return SimpleNamespace(id="11111111-1111-1111-1111-111111111111", title=payload.title, status="Readiness")

    async def _fake_get_or_create_board(db, project):
        return SimpleNamespace(id="board-1")

    async def _fake_get_epic(db, board, epic_id):
        assert str(epic_id) == "11111111-1111-1111-1111-111111111111"
        return SimpleNamespace(id=epic_id)

    async def _fake_create_requirement_content(db, project, ctx, payload):
        assert str(payload.epic_id) == "11111111-1111-1111-1111-111111111111"
        return SimpleNamespace(), SimpleNamespace(id="req-real-id", title=payload.title, status="Todo")

    monkeypatch.setattr(pa, "get_settings", lambda: configured_settings)
    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    monkeypatch.setattr(pa, "create_epic_content", _fake_create_epic_content)
    monkeypatch.setattr(pa, "get_or_create_board", _fake_get_or_create_board)
    monkeypatch.setattr(pa, "_get_epic", _fake_get_epic)
    monkeypatch.setattr(pa, "create_requirement_content", _fake_create_requirement_content)

    reply = await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_ADMIN, repo_full_name=None, history=[])

    assert reply == "Created the Login flow epic and one requirement under it."
    assert len(calls) == 3


async def test_a_text_only_reply_needs_no_tool_call(configured, monkeypatch):
    configured()
    captured: dict = {}

    async def _create(**kwargs):
        captured.update(kwargs)
        return _FakeMessage(text="noted")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    reply = await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name=None, history=[])
    assert reply == "noted"
    assert captured["tools"] == [pa.CREATE_BUNDLE_TOOL]


async def test_the_agent_is_told_plainly_when_no_repo_is_connected(configured, monkeypatch):
    """Without this, a request to "build wireframes from my repo" has no way
    to distinguish "no repo connected" from any other kind of not-yet-built
    request -- the reply would be generically unhelpful instead of pointing
    at Project details -> Repository."""
    configured()
    captured: dict = {}

    async def _create(**kwargs):
        captured.update(kwargs)
        return _FakeMessage(text="noted")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name=None, history=[])
    assert "No repository is connected" in captured["system"]


async def test_the_agent_is_told_the_repo_when_one_is_connected(configured, monkeypatch):
    configured()
    captured: dict = {}

    async def _create(**kwargs):
        captured.update(kwargs)
        return _FakeMessage(text="noted")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name="acme/website", history=[])
    assert 'A repository is connected: "acme/website"' in captured["system"]


async def test_the_agent_is_told_plainly_when_nothing_exists_yet(configured, monkeypatch):
    configured()
    captured: dict = {}

    async def _create(**kwargs):
        captured.update(kwargs)
        return _FakeMessage(text="noted")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name=None, history=[])
    assert "no wireframes or diagrams yet" in captured["system"]


async def test_the_agent_is_told_the_real_counts_when_content_already_exists(configured, monkeypatch):
    """Without this, asking the agent to "build wireframes" on a project that
    already has some would get a reply that ignores what's already there,
    instead of surfacing the actual counts and asking whether to add more."""
    configured()
    captured: dict = {}

    async def _create(**kwargs):
        captured.update(kwargs)
        return _FakeMessage(text="noted")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    await pa._ask_claude(
        db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name=None, wireframe_count=3, diagram_count=2, history=[]
    )
    assert "already has 3 wireframe(s) and 2 diagram(s)" in captured["system"]


async def test_a_successful_tool_call_creates_content_and_the_model_narrates(configured, monkeypatch):
    """The full round trip: the model calls create_bundle, the tool succeeds,
    and the model's second call gets a clean (non-error) tool_result it can
    narrate from."""
    configured()
    calls = []

    async def _create(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _FakeMessage(tool_use=("call-1", "create_bundle", {"wireframes": [{"name": "Login"}]}))
        return _FakeMessage(text="Done -- I created a wireframe called Login.")

    async def _fake_create_bundle_content(db, project, ctx, payload):
        assert payload == {"wireframes": [{"name": "Login"}]}
        return {"wireframes": [{"id": "w1", "name": "Login", "pages": 1}], "diagrams": []}, []

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    monkeypatch.setattr(pa, "create_bundle_content", _fake_create_bundle_content)

    reply = await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name=None, history=[])

    assert reply == "Done -- I created a wireframe called Login."
    assert len(calls) == 2
    # Second call's messages must carry the tool_result, and it must not be
    # flagged as an error -- a successful create must not look like a failure.
    tool_result_message = calls[1]["messages"][-1]
    assert tool_result_message["role"] == "user"
    assert tool_result_message["content"][0]["tool_use_id"] == "call-1"
    assert "is_error" not in tool_result_message["content"][0]


async def test_a_validation_failure_is_fed_back_as_an_error_tool_result(configured, monkeypatch):
    """The model gets the exact validator errors back and (in a real call)
    would retry -- this test only proves the error is surfaced correctly,
    not that the model successfully fixes it."""
    configured()
    calls = []

    async def _create(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _FakeMessage(tool_use=("call-1", "create_bundle", {"wireframes": [{"name": "Bad"}]}))
        return _FakeMessage(text="Let me fix that.")

    async def _fake_create_bundle_content(db, project, ctx, payload):
        return {}, [BundleError(path="wireframes[0].pages", message="required")]

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    monkeypatch.setattr(pa, "create_bundle_content", _fake_create_bundle_content)

    await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name=None, history=[])

    tool_result = calls[1]["messages"][-1]["content"][0]
    assert tool_result["is_error"] is True
    assert "wireframes[0].pages" in tool_result["content"]


async def test_an_unknown_tool_name_is_reported_as_an_error_without_crashing(configured, monkeypatch):
    """Defensive: nothing should call a tool other than create_bundle today,
    but if the model ever does, the loop must not raise -- it should tell
    the model plainly and let the conversation continue."""
    configured()
    calls = []

    async def _create(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _FakeMessage(tool_use=("call-1", "delete_everything", {}))
        return _FakeMessage(text="I can't do that.")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    reply = await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name=None, history=[])

    assert reply == "I can't do that."
    tool_result = calls[1]["messages"][-1]["content"][0]
    assert tool_result["is_error"] is True


async def test_the_loop_asks_for_one_final_honest_summary_after_max_rounds(configured, monkeypatch):
    """After MAX_TOOL_ROUNDS the loop must not just hand back a canned
    string -- it makes one more call with no tools, forcing a text reply,
    and uses whatever the model says. This is what test_a_partial_success_is_not_reported_as_a_full_failure
    below depends on to be honest about partial success."""
    calls = []

    async def _create(**kwargs):
        calls.append(kwargs)
        return _FakeMessage(tool_use=("call-x", "create_bundle", {"wireframes": []}))

    async def _fake_create_bundle_content(db, project, ctx, payload):
        return {}, [BundleError(path="wireframes", message="empty")]

    configured()
    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    monkeypatch.setattr(pa, "create_bundle_content", _fake_create_bundle_content)

    reply = await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name=None, history=[])

    # MAX_TOOL_ROUNDS tool-bearing calls, plus one final call without tools.
    assert len(calls) == pa.MAX_TOOL_ROUNDS + 1
    assert "tools" not in calls[-1]
    # Every fake response here is a tool_use with no text, so even the final
    # forced-text call yields nothing usable -- the canned string is the
    # correct fallback only in that specific case.
    assert "wasn't able to finish" in reply


async def test_a_partial_success_is_not_reported_as_a_full_failure(configured, monkeypatch):
    """The real bug this fixes: a live run created a real wireframe and
    diagram in an early round, hit trouble in a later round, exhausted
    MAX_TOOL_ROUNDS, and the old canned fallback told the user nothing had
    been created -- while it actually had. The final forced-text call must
    be able to report the truth, since the model's own context already has
    the successful tool_result from the earlier round."""
    calls = []

    async def _create(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _FakeMessage(tool_use=("call-1", "create_bundle", {"wireframes": [{"name": "Login"}]}))
        if len(calls) <= pa.MAX_TOOL_ROUNDS:
            return _FakeMessage(tool_use=("call-x", "create_bundle", {"wireframes": [{"name": "Bad"}]}))
        # The final, tools-less call: the model summarises honestly from
        # what's already in its own context.
        return _FakeMessage(text="I created a Login wireframe, but ran into trouble adding a second one.")

    call_count = [0]

    async def _fake_create_bundle_content(db, project, ctx, payload):
        call_count[0] += 1
        if call_count[0] == 1:
            return {"wireframes": [{"id": "w1", "name": "Login", "pages": 1}], "diagrams": []}, []
        return {}, [BundleError(path="wireframes[0]", message="bad")]

    configured()
    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))
    monkeypatch.setattr(pa, "create_bundle_content", _fake_create_bundle_content)

    reply = await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name=None, history=[])

    assert "I created a Login wireframe" in reply
    assert "wasn't able to finish" not in reply


async def test_two_projects_conversations_never_cross_talk_under_real_concurrency(configured, monkeypatch):
    """Not just "two sequential calls, checked afterwards" -- this actually
    runs both conversations at the same time via asyncio.gather, so if
    _ask_claude ever picked up shared/module-level state instead of the
    project it was called with, this is the shape of test that would catch
    it. Each fake reply is built from the project name it was actually
    asked with, so a swap would produce the wrong reply, not just a slower
    one."""
    import asyncio

    configured()
    project_a = SimpleNamespace(name="Alpha", id="proj-a", account_id="acct-a", repo_full_name=None)
    project_b = SimpleNamespace(name="Bravo", id="proj-b", account_id="acct-b", repo_full_name="acme/bravo")

    async def _create(**kwargs):
        # The one place the project's identity is visible to this fake is
        # the system prompt _ask_claude builds -- a real cross-talk bug
        # would show up here as the wrong project's name/repo appearing.
        system = kwargs["system"]
        if "Alpha" in system:
            await asyncio.sleep(0.02)  # resolve out of submission order on purpose
            return _FakeMessage(text="Reply for Alpha")
        assert "Bravo" in system
        assert "acme/bravo" in system
        return _FakeMessage(text="Reply for Bravo")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_create))

    reply_a, reply_b = await asyncio.gather(
        pa._ask_claude(db=None, project=project_a, ctx=FAKE_CTX_MEMBER, repo_full_name=None, history=[]),
        pa._ask_claude(db=None, project=project_b, ctx=FAKE_CTX_MEMBER, repo_full_name="acme/bravo", history=[]),
    )

    assert reply_a == "Reply for Alpha"
    assert reply_b == "Reply for Bravo"


async def test_authentication_error_becomes_a_502(monkeypatch):
    async def _raise(*args, **kwargs):
        raise anthropic.AuthenticationError(message="bad key", response=_fake_response(401), body=None)

    monkeypatch.setattr(
        pa, "get_settings", lambda: replace(get_settings(), bedrock_claude_model="eu.anthropic.claude-sonnet-5")
    )
    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_raise))

    with pytest.raises(pa.HTTPException) as excinfo:
        await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name=None, history=[])
    assert excinfo.value.status_code == 502


async def test_connection_error_becomes_a_502(monkeypatch):
    async def _raise(*args, **kwargs):
        raise anthropic.APIConnectionError(request=_fake_request())

    monkeypatch.setattr(
        pa, "get_settings", lambda: replace(get_settings(), bedrock_claude_model="eu.anthropic.claude-sonnet-5")
    )
    monkeypatch.setattr(pa.anthropic, "AsyncAnthropicBedrock", lambda **kw: _FakeClient(_raise))

    with pytest.raises(pa.HTTPException) as excinfo:
        await pa._ask_claude(db=None, project=FAKE_PROJECT, ctx=FAKE_CTX_MEMBER, repo_full_name=None, history=[])
    assert excinfo.value.status_code == 502


class _FakeTextBlock:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class _FakeToolUseBlock:
    def __init__(self, tool_use_id: str, name: str, input_: dict):
        self.type = "tool_use"
        self.id = tool_use_id
        self.name = name
        self.input = input_


class _FakeMessage:
    def __init__(self, text: str | None = None, tool_use: tuple[str, str, dict] | None = None):
        if tool_use is not None:
            self.content = [_FakeToolUseBlock(*tool_use)]
        else:
            self.content = [_FakeTextBlock(text or "")]


class _FakeMessages:
    def __init__(self, create):
        self.create = create


class _FakeClient:
    def __init__(self, create):
        self.messages = _FakeMessages(create)


def _fake_request():
    import httpx2

    return httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def _fake_response(status_code: int):
    import httpx2

    return httpx2.Response(status_code, request=_fake_request(), json={"error": {"message": "bad key"}})
