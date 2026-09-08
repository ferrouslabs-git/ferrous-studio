"""Inviting someone straight in as a super admin.

A platform invitation has to behave differently at three points or it
quietly becomes either useless or dangerous: accepting it must grant a real
platform-scope Membership (scope_id = PLATFORM_SCOPE_ID) and keep
is_platform_admin in sync with it; minting one must be possible only for a
platform admin and only through the platform route (the organisation routes
read the scope type from the request body, so trusting it there would let an
organisation admin promote themselves); and the email must read sensibly
with no organisation to name.

Pure functions and stubs, no database -- the rest of the suite has none
either.
"""
import inspect
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.routing import Mount

from app.auth.api import route_helpers
from app.auth.models.invitation import Invitation
from app.auth.models.membership import Membership
from app.auth.models.user import User
from app.auth.schemas.invitation import InvitationCreateRequest
from app.auth.security.dependencies import PLATFORM_SCOPE_ID
from app.auth.services import email_service, invitation_service
from app.auth.services.invitation_service import (
    PLATFORM_ROLE,
    PLATFORM_SCOPE,
    accept_invitation,
    utc_now,
)
from app.main import app


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalars(self):
        rows = [self._value] if self._value is not None else []
        return SimpleNamespace(all=lambda: rows)


class FakeSession:
    """No pre-existing membership by default (see `existing`) -- accepting a
    platform invitation now queries for one exactly like an organisation
    invitation does, just scoped to PLATFORM_SCOPE_ID instead of a tenant."""

    def __init__(self, existing: Membership | None = None):
        self.commits = 0
        self.added = []
        self._existing = existing

    async def commit(self):
        self.commits += 1

    async def refresh(self, _obj, **_kw):
        pass

    async def execute(self, _stmt):
        return FakeResult(self._existing)

    def add(self, obj):
        self.added.append(obj)


def make_user(**overrides) -> User:
    user = User(
        id=uuid4(),
        cognito_sub="sub-" + uuid4().hex,
        email="sam@example.com",
        name=None,
        is_active=True,
        is_platform_admin=False,
    )
    for key, value in overrides.items():
        setattr(user, key, value)
    return user


def make_platform_invitation(**overrides) -> Invitation:
    invitation = Invitation(
        id=uuid4(),
        tenant_id=None,
        email="sam@example.com",
        name="Sam Taylor",
        token="x",
        token_hash="x",
        expires_at=utc_now() + timedelta(days=1),
        target_scope_type=PLATFORM_SCOPE,
        target_scope_id=None,
        target_role_name=PLATFORM_ROLE,
    )
    for key, value in overrides.items():
        setattr(invitation, key, value)
    return invitation


# ── accepting grants a real platform membership, and keeps the flag in sync ─


async def test_accepting_grants_a_platform_membership_and_the_flag():
    invitation = make_platform_invitation()
    user = make_user()
    db = FakeSession()

    membership = await accept_invitation(db, invitation, user)

    assert membership is not None
    assert membership.scope_type == PLATFORM_SCOPE
    assert membership.scope_id == PLATFORM_SCOPE_ID
    assert membership.role_name == PLATFORM_ROLE
    assert membership.status == "active"
    assert membership in db.added
    assert user.is_platform_admin is True
    assert invitation.accepted_at is not None
    # Same courtesy as an organisation invitation: the inviter's name fills a blank.
    assert user.name == "Sam Taylor"
    assert db.commits == 1


async def test_accepting_reactivates_an_existing_platform_membership():
    """A previously-revoked platform admin re-invited must be reactivated in
    place, not duplicated -- same rule as an organisation membership."""
    invitation = make_platform_invitation()
    user = make_user()
    existing = Membership(
        user_id=user.id,
        scope_type=PLATFORM_SCOPE,
        scope_id=PLATFORM_SCOPE_ID,
        role_name=PLATFORM_ROLE,
        status="removed",
    )
    db = FakeSession(existing=existing)

    membership = await accept_invitation(db, invitation, user)

    assert membership is existing
    assert membership.status == "active"
    assert db.added == []


async def test_the_usual_guards_run_before_the_flag_is_set():
    """Wrong address, expired, already used: each refuses and leaves the user
    exactly as they were. The flag is the whole prize, so this is the check
    that matters most."""
    for invitation, error in (
        (make_platform_invitation(email="someone-else@example.com"), PermissionError),
        (make_platform_invitation(expires_at=utc_now() - timedelta(minutes=1)), ValueError),
        (make_platform_invitation(accepted_at=utc_now()), ValueError),
    ):
        user = make_user()
        with pytest.raises(error):
            await accept_invitation(FakeSession(), invitation, user)
        assert user.is_platform_admin is False


def test_is_platform_is_the_scope_type_alone():
    assert make_platform_invitation().is_platform is True
    assert make_platform_invitation(target_scope_type="account", tenant_id=uuid4()).is_platform is False


# ── only the platform route, only a platform admin ──────────────────────────


@pytest.fixture
def no_invitation_created(monkeypatch):
    """A refused request must be refused before anything is written."""

    async def must_not_run(*_a, **_kw):
        raise AssertionError("create_invitation reached for a refused platform invitation")

    monkeypatch.setattr(route_helpers, "create_invitation", must_not_run)


def platform_request() -> InvitationCreateRequest:
    return InvitationCreateRequest(email="sam@example.com", target_scope_type=PLATFORM_SCOPE)


async def test_organisation_routes_cannot_mint_a_super_admin(no_invitation_created):
    """The organisation routes pass a tenant and a scope context; either one
    marks the request as not coming from the platform route."""
    admin = make_user(is_platform_admin=True)
    ctx = SimpleNamespace(scope_type="account", scope_id=uuid4(), is_super_admin=True, role_name="account_admin")

    with pytest.raises(HTTPException) as with_tenant:
        await route_helpers.create_invitation_response(FakeSession(), uuid4(), platform_request(), admin, None)
    with pytest.raises(HTTPException) as with_ctx:
        await route_helpers.create_invitation_response(FakeSession(), None, platform_request(), admin, ctx)

    assert with_tenant.value.status_code == 403
    assert with_ctx.value.status_code == 403


async def test_only_a_platform_admin_sends_one(no_invitation_created):
    with pytest.raises(HTTPException) as refused:
        await route_helpers.create_invitation_response(FakeSession(), None, platform_request(), make_user(), None)
    assert refused.value.status_code == 403


async def test_unknown_scope_types_are_refused(no_invitation_created):
    """Before platform scope meant anything the field was unchecked; now that
    it does, anything but account or platform is a bad request."""
    request = InvitationCreateRequest(email="sam@example.com", target_scope_type="workspace")
    with pytest.raises(HTTPException) as refused:
        await route_helpers.create_invitation_response(FakeSession(), uuid4(), request, make_user(), None)
    assert refused.value.status_code == 400


async def test_a_platform_invitation_carries_no_scope_and_the_platform_role(monkeypatch):
    """Whatever the request said, the row is normalised: no scope id, and the
    role is the platform one, not whatever was typed."""
    seen = {}

    async def fake_create_invitation(**kwargs):
        seen.update(kwargs)
        return make_platform_invitation(), "raw-token"

    async def fake_cognito(_email):
        return {}

    async def fake_email(**kwargs):
        seen["email"] = kwargs
        return SimpleNamespace(sent=True, provider="test", detail=None)

    async def fake_audit(*_a, **_kw):
        pass

    monkeypatch.setattr(route_helpers, "create_invitation", fake_create_invitation)
    monkeypatch.setattr(route_helpers, "create_invited_cognito_user_async", fake_cognito)
    monkeypatch.setattr(route_helpers, "send_invitation_email", fake_email)
    monkeypatch.setattr(route_helpers, "log_audit_event", fake_audit)

    request = InvitationCreateRequest(
        email="sam@example.com", target_scope_type=PLATFORM_SCOPE, target_scope_id=uuid4(), target_role_name="account_admin"
    )
    admin = make_user(is_platform_admin=True)
    admin_membership = Membership(
        user_id=admin.id,
        scope_type=PLATFORM_SCOPE,
        scope_id=PLATFORM_SCOPE_ID,
        role_name=PLATFORM_ROLE,
        status="active",
    )
    response = await route_helpers.create_invitation_response(
        FakeSession(existing=admin_membership), None, request, admin, None
    )

    assert seen["tenant_id"] is None
    assert seen["target_scope_id"] is None
    assert seen["target_role_name"] == PLATFORM_ROLE
    # No organisation to name in the email.
    assert seen["email"]["tenant_name"] is None
    assert response.tenant_id is None
    assert response.target_role_name == PLATFORM_ROLE


# ── the routes exist and are platform-admin-only ────────────────────────────


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


@pytest.mark.parametrize(
    "path, method",
    [
        ("/api/um/platform/invite", "POST"),
        ("/api/um/platform/invitations/{invitation_id}/resend", "POST"),
        ("/api/um/platform/invitations/{invitation_id}", "DELETE"),
    ],
)
def test_platform_invitation_routes_are_platform_admin_only(path, method):
    route = _route(path, method)
    assert "ensure_platform_admin(" in inspect.getsource(route.endpoint)


# ── the email has no organisation to name ───────────────────────────────────


def test_platform_email_names_no_organisation():
    subject = email_service.invitation_email_subject(None, "Ferrous Studio")
    text = email_service._get_invitation_email_text("https://x/invite/t", None, "Ferrous Studio", "legal", "Sam")
    html = email_service._get_invitation_email_html("https://x/invite/t", None, "Ferrous Studio", "legal", "Sam")

    assert subject == "You are invited to administer Ferrous Studio"
    for body in (text, html):
        assert "super admin" in body
        assert "None" not in body
        assert "Hi Sam" in body


def test_organisation_email_is_unchanged():
    subject = email_service.invitation_email_subject("Acme", "Ferrous Studio")
    text = email_service._get_invitation_email_text("https://x/invite/t", "Acme", "Ferrous Studio", "legal")

    assert subject == "You are invited to join Acme on Ferrous Studio"
    assert "Join Acme on Ferrous Studio." in text
    assert "You have been invited to join Acme." in text


def test_html_escapes_the_organisation_name():
    html = email_service._get_invitation_email_html("https://x/invite/t", "<b>Acme</b>", "Ferrous Studio", "legal")
    assert "<b>Acme</b>" not in html
    assert "&lt;b&gt;Acme&lt;/b&gt;" in html


def test_pending_lookup_matches_the_platform_bucket():
    """Re-inviting the same address as a super admin revokes the earlier
    platform invitation, not an organisation one: the service must compare
    against NULL rather than ``= NULL``, which matches nothing."""
    source = inspect.getsource(invitation_service.create_invitation)
    assert "Invitation.tenant_id.is_(None)" in source
