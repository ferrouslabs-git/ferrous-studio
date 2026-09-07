"""Archiving a user is the reversible step before deleting one.

Three things have to hold or the two-step removal quietly collapses back into
a one-step one: Delete must refuse a user who was never archived, Archive
must be a true undo (Restore puts back exactly what Archive changed, and
nothing else), and both must be reachable as platform routes.

Pure functions and stubs, no database -- the rest of the suite has none
either. ``get_user_by_id`` is patched to hand back an in-memory ``User``, and
the session is a stub that only records commits.
"""
import inspect
from types import SimpleNamespace
from uuid import uuid4

import pytest
from starlette.routing import Mount

from app.auth.models.user import User
from app.auth.services import user_service
from app.main import app


class FakeSession:
    """The only two things the archive/restore services ask of a session."""

    def __init__(self):
        self.commits = 0

    async def commit(self):
        self.commits += 1

    async def refresh(self, _obj):
        pass


def make_user(**overrides) -> User:
    user = User(
        id=uuid4(),
        cognito_sub="sub-" + uuid4().hex,
        email="someone@example.com",
        is_active=True,
        suspended_at=None,
        archived_at=None,
        is_platform_admin=False,
    )
    for key, value in overrides.items():
        setattr(user, key, value)
    return user


@pytest.fixture
def stubbed(monkeypatch):
    """Route lookups to one in-memory user and record Cognito sign-outs."""
    state = SimpleNamespace(user=None, sign_outs=[])

    async def fake_get_user_by_id(_user_id, _db):
        return state.user

    async def fake_sign_out(email, cognito_sub=None):
        state.sign_outs.append((email, cognito_sub))

    monkeypatch.setattr(user_service, "get_user_by_id", fake_get_user_by_id)
    monkeypatch.setattr(user_service, "cognito_global_sign_out", fake_sign_out)
    return state


# ── delete waits for archive ────────────────────────────────────────────────


async def test_delete_refuses_a_user_who_was_never_archived(stubbed, monkeypatch):
    stubbed.user = make_user()

    # If the guard is missing this would be the next call -- make it loud.
    def must_not_run(*_a, **_kw):
        raise AssertionError("Cognito deletion reached for a user who is not archived")

    monkeypatch.setattr("app.auth.services.cognito_admin_service.admin_delete_user", must_not_run)

    with pytest.raises(user_service.UserNotArchivedError):
        await user_service.delete_user(stubbed.user.id, FakeSession())


def test_not_archived_is_still_a_value_error():
    """The routes map ValueError to 404/400 in bulk; the archive guard must
    stay a subclass so the more specific 409 handler runs first, and nothing
    that catches ValueError today starts leaking a 500."""
    assert issubclass(user_service.UserNotArchivedError, ValueError)


# ── archive / restore are an exact undo pair ────────────────────────────────


async def test_archive_stamps_the_time_and_signs_the_user_out(stubbed):
    stubbed.user = make_user()
    db = FakeSession()

    archived = await user_service.archive_user(stubbed.user.id, db)

    assert archived.archived_at is not None
    assert db.commits == 1
    # Same guarantee as suspend: an open session cannot outlive the archive.
    assert stubbed.sign_outs == [(archived.email, archived.cognito_sub)]
    # Archive is not suspend: the temporary flag is untouched.
    assert archived.is_active is True
    assert archived.suspended_at is None


async def test_archiving_twice_keeps_the_first_date(stubbed):
    stubbed.user = make_user()
    db = FakeSession()

    first = (await user_service.archive_user(stubbed.user.id, db)).archived_at
    second = (await user_service.archive_user(stubbed.user.id, db)).archived_at

    assert second == first
    assert db.commits == 1


async def test_restore_clears_only_the_archive(stubbed):
    """A user suspended and then archived comes back suspended: restoring the
    archive never meant lifting the suspension."""
    suspended_at = user_service.utc_now()
    stubbed.user = make_user(is_active=False, suspended_at=suspended_at, archived_at=user_service.utc_now())

    restored = await user_service.restore_user(stubbed.user.id, FakeSession())

    assert restored.archived_at is None
    assert restored.is_active is False
    assert restored.suspended_at == suspended_at


async def test_missing_user_is_a_value_error(stubbed):
    stubbed.user = None
    with pytest.raises(ValueError):
        await user_service.archive_user(uuid4(), FakeSession())
    with pytest.raises(ValueError):
        await user_service.restore_user(uuid4(), FakeSession())


# ── the routes exist and are wired the same way as suspend ──────────────────


def _routes():
    def walk(routes, prefix=""):
        for route in routes:
            if isinstance(route, Mount):
                yield from walk(route.routes, prefix + route.path)
                continue
            yield prefix + getattr(route, "path", ""), route

    return list(walk(app.routes))


def _route(path, method):
    for route_path, route in _routes():
        if route_path == path and method in (getattr(route, "methods", None) or ()):
            return route
    raise AssertionError(f"no {method} {path}")


@pytest.mark.parametrize("action", ["archive", "restore"])
def test_archive_routes_are_platform_admin_only(action):
    route = _route(f"/api/um/platform/users/{{user_id}}/{action}", "PATCH")
    source = inspect.getsource(route.endpoint)
    assert "ensure_platform_admin(" in source


def test_nobody_archives_themselves():
    """Mirrors suspend: the admin doing it would lose access mid-click."""
    route = _route("/api/um/platform/users/{user_id}/archive", "PATCH")
    assert "ensure_not_self_target(" in inspect.getsource(route.endpoint)


def test_delete_answers_409_when_not_archived():
    route = _route("/api/um/platform/users/{user_id}", "DELETE")
    source = inspect.getsource(route.endpoint)
    assert "except UserNotArchivedError" in source
    assert "HTTP_409_CONFLICT" in source
