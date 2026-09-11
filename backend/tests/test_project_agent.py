"""The Project Agent chatbot's pure pieces.

The routes themselves need a database and a real (or mocked) Anthropic
call -- exercised live via run-local, not here, matching every other
route-level test in this suite (test_bundle_import.py's own docstring
states the same reasoning). What's tested here is what can be: the
configured() gate, which permission/lock each route asks for, and how a
failed Anthropic call is translated into an HTTP response.
"""
import inspect
from dataclasses import replace

import anthropic
import pytest

from app.config import get_settings
from app.studio import project_agent as pa


@pytest.fixture
def configured(monkeypatch):
    def _configure(key: str = "sk-ant-test"):
        settings = replace(get_settings(), anthropic_api_key=key)
        monkeypatch.setattr(pa, "get_settings", lambda: settings)
        return settings

    return _configure


def test_configured_is_true_once_a_key_is_set(configured):
    configured("sk-ant-test")
    assert pa.configured() is True


def test_configured_is_false_with_no_key(monkeypatch):
    settings = replace(get_settings(), anthropic_api_key="")
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
    """A locked version is a frozen record; Phase 2 will let this route
    change project content, so it takes the lock now rather than later."""
    assert "get_writable_project(" in inspect.getsource(pa.send_message)


def test_permissions_match_the_data_routes_convention():
    read_source = inspect.getsource(pa.list_messages)
    write_source = inspect.getsource(pa.send_message)
    assert 'require_permission("data:read")' in read_source
    assert 'require_permission("data:write")' in write_source


def test_send_message_looks_up_existing_content_before_asking():
    """Both counts must actually be queried, not just accepted as parameters
    -- otherwise _ask_claude's defaults (0, 0) silently claim every project
    is empty."""
    source = inspect.getsource(pa.send_message)
    assert "_count(db, Wireframe, project)" in source
    assert "_count(db, ProjectDiagram, project)" in source


async def test_the_agent_is_told_plainly_when_no_repo_is_connected(configured, monkeypatch):
    """Without this, a request to "build wireframes from my repo" has no way
    to distinguish "no repo connected" from any other kind of not-yet-built
    request -- the reply would be generically unhelpful instead of pointing
    at Project details -> Repository."""
    configured()
    captured: dict = {}

    async def _create(**kwargs):
        captured.update(kwargs)
        return _FakeMessage("noted")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropic", lambda **kw: _FakeClient(_create))
    await pa._ask_claude(project_name="Test", repo_full_name=None, history=[])
    assert "No repository is connected" in captured["system"]


async def test_the_agent_is_told_the_repo_when_one_is_connected(configured, monkeypatch):
    configured()
    captured: dict = {}

    async def _create(**kwargs):
        captured.update(kwargs)
        return _FakeMessage("noted")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropic", lambda **kw: _FakeClient(_create))
    await pa._ask_claude(project_name="Test", repo_full_name="acme/website", history=[])
    assert 'A repository is connected: "acme/website"' in captured["system"]


async def test_the_agent_is_told_plainly_when_nothing_exists_yet(configured, monkeypatch):
    configured()
    captured: dict = {}

    async def _create(**kwargs):
        captured.update(kwargs)
        return _FakeMessage("noted")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropic", lambda **kw: _FakeClient(_create))
    await pa._ask_claude(project_name="Test", repo_full_name=None, history=[])
    assert "no wireframes or diagrams yet" in captured["system"]


async def test_the_agent_is_told_the_real_counts_when_content_already_exists(configured, monkeypatch):
    """Without this, asking the agent to "build wireframes" on a project that
    already has some would get a reply that ignores what's already there,
    instead of surfacing the actual counts and asking whether to add more."""
    configured()
    captured: dict = {}

    async def _create(**kwargs):
        captured.update(kwargs)
        return _FakeMessage("noted")

    monkeypatch.setattr(pa.anthropic, "AsyncAnthropic", lambda **kw: _FakeClient(_create))
    await pa._ask_claude(project_name="Test", repo_full_name=None, wireframe_count=3, diagram_count=2, history=[])
    assert "already has 3 wireframe(s) and 2 diagram(s)" in captured["system"]


async def test_authentication_error_becomes_a_502(monkeypatch):
    async def _raise(*args, **kwargs):
        raise anthropic.AuthenticationError(
            message="bad key", response=_fake_response(401), body=None
        )

    monkeypatch.setattr(pa, "get_settings", lambda: replace(get_settings(), anthropic_api_key="sk-ant-test"))
    monkeypatch.setattr(pa.anthropic, "AsyncAnthropic", lambda **kw: _FakeClient(_raise))

    with pytest.raises(pa.HTTPException) as excinfo:
        await pa._ask_claude(project_name="Test", repo_full_name=None, history=[])
    assert excinfo.value.status_code == 502


async def test_connection_error_becomes_a_502(monkeypatch):
    async def _raise(*args, **kwargs):
        raise anthropic.APIConnectionError(request=_fake_request())

    monkeypatch.setattr(pa, "get_settings", lambda: replace(get_settings(), anthropic_api_key="sk-ant-test"))
    monkeypatch.setattr(pa.anthropic, "AsyncAnthropic", lambda **kw: _FakeClient(_raise))

    with pytest.raises(pa.HTTPException) as excinfo:
        await pa._ask_claude(project_name="Test", repo_full_name=None, history=[])
    assert excinfo.value.status_code == 502


class _FakeBlock:
    def __init__(self, text: str):
        self.type = "text"
        self.text = text


class _FakeMessage:
    def __init__(self, text: str):
        self.content = [_FakeBlock(text)]


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
