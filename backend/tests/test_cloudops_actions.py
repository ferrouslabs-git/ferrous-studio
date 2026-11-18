"""CloudOps actions (INT-REQ-14, phase 3): the rules around starting, stopping and tuning services from the panel.

Studio only ever asks the cloudops-control function to act. These tests cover what Studio itself guarantees: admin
only, off where CloudOps is off, production refused before anything is called, every attempt written to the audit
log (including refusals and failures), and the exact request sent. No database and no AWS."""
import inspect
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.studio import cloudops_actions as act
from app.studio.models import CloudopsAction, utc_now


class FakeDB:
    def __init__(self, rows=None):
        self.added, self.commits, self.rows = [], 0, rows or []

    def add(self, row): self.added.append(row)
    async def commit(self): self.commits += 1

    async def execute(self, stmt):
        rows = self.rows

        class R:
            def scalars(self_inner):
                class S:
                    def all(self_s): return rows
                return S()
        return R()


class Admin:
    id = uuid.uuid4()
    email = "admin@example.com"


@pytest.fixture
def wired(monkeypatch):
    seen = {"admin": [], "invoked": [], "reply": {"ok": True, "changed": True, "before": {"desired": 0}, "after": {"desired": 1}}}

    async def ensure(user, action, db, permission="accounts:manage"):
        seen["admin"].append((action, permission))

    def invoke(payload):
        seen["invoked"].append(payload)
        reply = seen["reply"]
        if isinstance(reply, Exception):
            raise reply
        return reply

    class S:
        cloudops_enabled = True

    monkeypatch.setattr(act, "ensure_platform_admin", ensure)
    monkeypatch.setattr(act, "_invoke_control", invoke)
    monkeypatch.setattr(act, "get_settings", lambda: S)
    seen["settings"] = S
    return seen


ALL = [
    ("start", lambda db: act.start_service("studio-staging", current_user=Admin(), db=db)),
    ("stop", lambda db: act.stop_service("studio-staging", current_user=Admin(), db=db)),
    ("set_autowake", lambda db: act.set_autowake("studio-staging", act.AutoWakeBody(enabled=True, idle_minutes=90), current_user=Admin(), db=db)),
    ("set_keep_awake", lambda db: act.set_keep_awake("studio-staging", act.KeepAwakeBody(until=None), current_user=Admin(), db=db)),
]


# ----------------------------------------------------------------- who, and where
async def test_a_non_admin_is_stopped_before_anything_is_called_or_recorded(wired, monkeypatch):
    async def deny(*a, **k):
        raise HTTPException(403, "no")

    monkeypatch.setattr(act, "ensure_platform_admin", deny)
    for name, call in ALL:
        db = FakeDB()
        with pytest.raises(HTTPException) as e:
            await call(db)
        assert e.value.status_code == 403, name
        assert db.added == [] and wired["invoked"] == [], name


async def test_where_cloudops_is_off_nothing_is_called_or_recorded(wired):
    wired["settings"].cloudops_enabled = False
    for name, call in ALL:
        db = FakeDB()
        with pytest.raises(HTTPException) as e:
            await call(db)
        assert e.value.status_code == 403 and "not enabled" in e.value.detail, name
        assert db.added == [] and wired["invoked"] == [], name


# ----------------------------------------------------------------- production
async def test_the_service_studio_runs_as_is_refused_before_anything_is_called_and_the_attempt_is_on_the_record(wired, monkeypatch):
    monkeypatch.setenv("ECS_SERVICE_NAME", "ferrous-studio-prod")
    service = "ferrous-studio-prod"
    for coro_factory in (
        lambda d: act.start_service(service, current_user=Admin(), db=d),
        lambda d: act.stop_service(service, current_user=Admin(), db=d),
        lambda d: act.set_autowake(service, act.AutoWakeBody(enabled=True), current_user=Admin(), db=d),
        lambda d: act.set_keep_awake(service, act.KeepAwakeBody(until=None), current_user=Admin(), db=d),
    ):
        db = FakeDB()
        with pytest.raises(HTTPException) as e:
            await coro_factory(db)
        assert e.value.status_code == 403 and "AWS console" in e.value.detail
        assert db.commits == 1 and db.added[0].status == "refused" and db.added[0].service == service
    assert wired["invoked"] == []


def test_own_service_falls_back_to_app_name_and_env(monkeypatch):
    monkeypatch.delenv("ECS_SERVICE_NAME", raising=False)
    monkeypatch.setenv("APP_NAME", "ferrous-studio-api")
    monkeypatch.setenv("APP_ENV", "prod")
    assert act.own_service() == "ferrous-studio-prod"


@pytest.mark.parametrize("service", ["ferrous-hub-prod", "processmapper-prod"])
async def test_other_production_services_can_be_started_and_stopped(wired, monkeypatch, service):
    monkeypatch.setenv("ECS_SERVICE_NAME", "ferrous-studio-prod")
    await act.stop_service(service, current_user=Admin(), db=FakeDB())
    await act.start_service(service, current_user=Admin(), db=FakeDB())
    assert [p["action"] for p in wired["invoked"]] == ["stop", "start"]


@pytest.mark.parametrize("service", ["ferrous-hub-prod", "processmapper-prod"])
async def test_auto_wake_is_refused_on_production_and_the_attempt_is_on_the_record(wired, monkeypatch, service):
    monkeypatch.setenv("ECS_SERVICE_NAME", "ferrous-studio-prod")
    for coro_factory in (
        lambda d: act.set_autowake(service, act.AutoWakeBody(enabled=True), current_user=Admin(), db=d),
        lambda d: act.set_keep_awake(service, act.KeepAwakeBody(until=None), current_user=Admin(), db=d),
    ):
        db = FakeDB()
        with pytest.raises(HTTPException) as e:
            await coro_factory(db)
        assert e.value.status_code == 403 and "non-production services only" in e.value.detail
        assert db.added[0].status == "refused"
    assert wired["invoked"] == []


async def test_a_nonsense_service_name_is_refused_too(wired):
    for bad in ("a b", "x;y", "../etc", "a" * 300):
        db = FakeDB()
        with pytest.raises(HTTPException):
            await act.stop_service(bad, current_user=Admin(), db=db)
    assert wired["invoked"] == []


# ----------------------------------------------------------------- what is sent, and what is recorded
async def test_start_sends_exactly_this_and_records_who_and_before_after(wired):
    db = FakeDB()
    r = await act.start_service("studio-staging", current_user=Admin(), db=db)
    assert wired["invoked"] == [{"action": "start", "service": "studio-staging", "requested_by": "admin@example.com"}]
    assert r.ok and r.changed and r.after == {"desired": 1}
    row = db.added[0]
    assert (row.status, row.action, row.service, row.user_email) == ("ok", "start", "studio-staging", "admin@example.com")
    assert row.before == {"desired": 0} and row.after == {"desired": 1} and db.commits == 1
    assert wired["admin"] == [("start a service", "accounts:manage")]


async def test_autowake_and_keep_awake_send_their_fields(wired):
    await act.set_autowake("studio-staging", act.AutoWakeBody(enabled=True, idle_minutes=90), current_user=Admin(), db=FakeDB())
    when = datetime(2026, 11, 21, 18, 0, tzinfo=timezone.utc)
    await act.set_keep_awake("studio-staging", act.KeepAwakeBody(until=when), current_user=Admin(), db=FakeDB())
    await act.set_keep_awake("studio-staging", act.KeepAwakeBody(until=None), current_user=Admin(), db=FakeDB())
    a, b, c = wired["invoked"]
    assert a == {"action": "set_autowake", "service": "studio-staging", "enabled": True, "idle_minutes": 90, "requested_by": "admin@example.com"}
    assert b["until"] == "2026-11-21T18:00:00+00:00" and c["until"] is None


def test_what_a_client_may_send_is_checked_before_any_route_runs():
    for bad in (4, 1441, 0, -5):
        with pytest.raises(ValidationError):
            act.AutoWakeBody(enabled=True, idle_minutes=bad)
    for ok in (5, 60, 1440, None):
        act.AutoWakeBody(enabled=True, idle_minutes=ok)
    with pytest.raises(ValidationError):
        act.AutoWakeBody(enabled="maybe")
    with pytest.raises(ValidationError):
        act.KeepAwakeBody(until="not a time")


# ----------------------------------------------------------------- when it does not work
async def test_a_refusal_from_the_function_is_a_409_with_its_words_and_is_recorded(wired):
    wired["reply"] = {"ok": False, "refused": True, "error": "Start the service first, then turn auto-wake off."}
    db = FakeDB()
    with pytest.raises(HTTPException) as e:
        await act.set_autowake("studio-staging", act.AutoWakeBody(enabled=False), current_user=Admin(), db=db)
    assert e.value.status_code == 409 and "Start the service first" in e.value.detail
    assert db.added[0].status == "refused" and "Start the service first" in db.added[0].message


async def test_a_failure_in_the_function_is_a_502_and_is_recorded(wired):
    wired["reply"] = {"ok": False, "refused": False, "error": "The action failed."}
    db = FakeDB()
    with pytest.raises(HTTPException) as e:
        await act.stop_service("studio-staging", current_user=Admin(), db=db)
    assert e.value.status_code == 502 and db.added[0].status == "error"


async def test_not_being_allowed_to_invoke_the_function_is_explained_and_recorded(wired):
    class AccessDeniedException(Exception):
        pass

    wired["reply"] = AccessDeniedException("not authorized to perform lambda:InvokeFunction")
    db = FakeDB()
    with pytest.raises(HTTPException) as e:
        await act.start_service("studio-staging", current_user=Admin(), db=db)
    assert e.value.status_code == 502 and "permission to invoke the CloudOps control function" in e.value.detail
    assert db.added[0].status == "error" and db.commits == 1


# ----------------------------------------------------------------- the audit log, and what this module can touch
async def test_the_audit_log_is_read_only_admin_checked_and_newest_first(wired):
    row = CloudopsAction(id=uuid.uuid4(), created_at=utc_now(), user_email="admin@example.com", action="stop",
                         service="studio-staging", params={}, before={"desired": 1}, after={"desired": 0}, status="ok", message=None)
    out = await act.list_actions(limit=50, current_user=Admin(), db=FakeDB([row]))
    assert out[0].service == "studio-staging" and out[0].status == "ok" and out[0].after == {"desired": 0}
    assert wired["admin"] == [("view the CloudOps audit log", "accounts:read")]
    assert "desc()" in inspect.getsource(act.list_actions)


def test_the_only_aws_write_this_app_can_make_is_asking_the_control_function():
    """Read from the real source: Studio holds no permission to change services and must contain no such call."""
    src = inspect.getsource(act)
    assert "invoke(" in src
    for verb in ("update_service", "tag_resource", "untag_resource", "modify_rule", "create_service", "delete_service",
                 "stop_task", "start_task", "register_task_definition", "client(\"ecs\"", "client('ecs'"):
        assert verb not in src, verb
