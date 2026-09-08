"""Organisation members and viewers read the product; only the admin writes it.

The whole rule lives in two places -- the role definitions in
``app/auth/auth_config.yaml`` and the ``require_permission`` guard on each
route -- and both fail *open* when someone gets them wrong: a stray
``data:write`` on the member role, or a new write route guarded on
``data:read``, hands out edit access with nothing to notice it. These tests
are that backstop, and the place where each of the two deliberate exceptions
has to be argued for in writing.

The exceptions, both belonging to the member role:
  * ``tasks:create`` -- pin a task to a wireframe, and nothing else.
  * ``members:invite`` -- invite a member or a viewer, never an admin.

Source inspection rather than live requests, because the suite has no database.
"""
import inspect
import re

import pytest
from starlette.routing import Mount

from app.auth.api.route_helpers import ensure_invitation_authority
from app.auth.security.scope_context import ScopeContext
from app.auth.services.auth_config_loader import get_auth_config
from app.main import app
from app.studio.annotations import create_annotation
from uuid import UUID, uuid4

ADMIN = "account_admin"
MEMBER = "account_member"
VIEWER = "account_viewer"

PROJECT_ROUTES = "/api/studio/projects/{project_id}"
READ_METHODS = {"GET", "HEAD", "OPTIONS"}

#: Permissions that authorise changing content. A route behind any of these is
#: closed to members and viewers, which is the point.
WRITE_PERMISSIONS = {"data:write", "board:write", "board:tokens"}

#: Studio write routes that deliberately do not sit behind a write permission.
#: Adding a name here widens what a read-only member can do -- it is a product
#: decision, not a way to quiet the test.
EXEMPT = {
    # The one crack in a member's read-only access. The route takes
    # require_any_permission([...]) and then refuses any kind but "task"
    # without data:write -- pinned by the tests further down, because the
    # dependency alone would let a member file notes too.
    "create_annotation",
}


def _permissions(role: str) -> set[str]:
    return get_auth_config().permissions_for_role(role)


# ── The role definitions themselves ─────────────────────────────────────────


def test_the_three_organisation_roles_exist():
    config = get_auth_config()
    assert {r["name"] for r in config.roles_by_layer["account"]} == {ADMIN, MEMBER, VIEWER}


def test_member_and_viewer_hold_no_write_permission():
    """The headline rule. A member's extras are creating tasks and inviting."""
    assert not _permissions(MEMBER) & WRITE_PERMISSIONS
    assert not _permissions(VIEWER) & WRITE_PERMISSIONS


def test_member_adds_exactly_two_things_to_a_viewer():
    """Spelling out the difference stops it drifting a permission at a time."""
    assert _permissions(MEMBER) - _permissions(VIEWER) == {"tasks:create", "members:invite"}


def test_viewer_is_read_only_throughout():
    assert _permissions(VIEWER) == {"account:read", "data:read", "board:read"}


def test_neither_member_nor_viewer_manages_members():
    """Inviting is not managing: no role changes, no removals, no other
    person's invitations."""
    assert "members:manage" not in _permissions(MEMBER)
    assert "members:manage" not in _permissions(VIEWER)


# ── Invite authority (the subset rule in api/route_helpers.py) ──────────────
# create_invitation_response refuses a target role whose permissions are not a
# subset of the inviter's. That single rule is what decides who may invite
# whom, so assert the outcomes rather than trusting it to read correctly.


@pytest.mark.parametrize(
    "inviter,target,allowed",
    [
        (ADMIN, ADMIN, True),
        (ADMIN, MEMBER, True),
        (ADMIN, VIEWER, True),
        (MEMBER, MEMBER, True),
        (MEMBER, VIEWER, True),
        (MEMBER, ADMIN, False),
    ],
)
def test_who_may_invite_whom(inviter, target, allowed):
    assert (_permissions(target) <= _permissions(inviter)) is allowed


def test_admin_holds_every_member_permission():
    """The subset rule cuts both ways: drop tasks:create from the admin and
    admins silently lose the ability to invite members."""
    assert _permissions(MEMBER) <= _permissions(ADMIN)


def test_the_invite_check_resolves_the_legacy_role_field():
    """``{"role": "admin"}`` with no target_role_name must not skip the check.

    create_invitation stores ``target_role_name or LEGACY_TO_V3[role]``, so an
    authority check that only looked at target_role_name would wave through
    exactly the request that escalates.
    """
    source = inspect.getsource(__import__(
        "app.auth.api.route_helpers", fromlist=["create_invitation_response"]
    ).create_invitation_response)
    assert "LEGACY_TO_V3" in source, (
        "the invite authority check must resolve the legacy 'role' field the "
        "same way create_invitation does, or it can be bypassed by omitting "
        "target_role_name"
    )


# ── Managing an invitation after it is sent ─────────────────────────────────


class _Invitation:
    """Just the field ensure_invitation_authority reads."""

    def __init__(self, created_by):
        self.created_by = created_by


def _ctx(user_id: UUID, role: str) -> ScopeContext:
    return ScopeContext(
        user_id=user_id,
        scope_type="account",
        scope_id=uuid4(),
        active_roles=[role],
        resolved_permissions=_permissions(role),
    )


def test_an_admin_manages_anyone_s_invitation():
    admin, other = uuid4(), uuid4()
    ensure_invitation_authority(_Invitation(other), _ctx(admin, ADMIN))


def test_a_member_manages_their_own_invitation():
    member = uuid4()
    ensure_invitation_authority(_Invitation(member), _ctx(member, MEMBER))


def test_a_member_cannot_touch_someone_else_s_invitation():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        ensure_invitation_authority(_Invitation(uuid4()), _ctx(uuid4(), MEMBER))
    # 404, not 403: someone with no authority over it has no business learning
    # the invitation exists.
    assert exc.value.status_code == 404


def test_a_super_admin_manages_anyone_s_invitation():
    ctx = _ctx(uuid4(), ADMIN)
    ctx.is_super_admin = True
    ctx.resolved_permissions = set()
    ensure_invitation_authority(_Invitation(uuid4()), ctx)


# ── Route coverage ──────────────────────────────────────────────────────────


def _routes():
    def walk(routes, prefix=""):
        for route in routes:
            if isinstance(route, Mount):
                yield from walk(route.routes, prefix + route.path)
                continue
            yield prefix + getattr(route, "path", ""), route

    return list(walk(app.routes))


def write_routes():
    for path, route in _routes():
        methods = set(getattr(route, "methods", []) or [])
        if path.startswith(PROJECT_ROUTES) and not methods <= READ_METHODS:
            yield route


def required_permissions(endpoint) -> set[str]:
    """Permission names named by the endpoint's guard dependency."""
    source = inspect.getsource(endpoint)
    guard = re.search(r"require_(?:any_|all_)?permissions?\((.*?)\)\)", source, re.S)
    return set(re.findall(r"[\"']([a-z_]+:[a-z_]+)[\"']", guard.group(1))) if guard else set()


@pytest.mark.parametrize("route", list(write_routes()), ids=lambda r: r.endpoint.__name__)
def test_write_routes_are_closed_to_members_and_viewers(route):
    name = route.endpoint.__name__
    required = required_permissions(route.endpoint)
    if name in EXEMPT:
        assert not (required and required <= WRITE_PERMISSIONS), (
            f"{name} is listed as exempt but every permission it accepts is a "
            f"write permission after all, so no member can reach it; remove it "
            f"from EXEMPT"
        )
        return
    assert required, f"{name} names no permission at all -- it is open to any member"
    assert required <= WRITE_PERMISSIONS, (
        f"{name} changes a project but is guarded on {sorted(required)}, which "
        f"an organisation member holds. Guard it on a write permission, or add "
        f"{name!r} to EXEMPT with a comment saying why a member may do this."
    )


def test_exempt_names_all_still_exist():
    """A renamed or deleted route must not leave a stale exemption behind."""
    live = {route.endpoint.__name__ for route in write_routes()}
    assert EXEMPT <= live, f"EXEMPT names no longer routed: {sorted(EXEMPT - live)}"


# ── create_annotation's own narrower check ──────────────────────────────────
# It is EXEMPT above because a member may file a task there. Its dependency
# accepts tasks:create, so the route body -- not the guard -- is what keeps
# notes out, and the body is easy to lose in a later edit.


def test_create_annotation_accepts_the_task_permission():
    assert required_permissions(create_annotation) == {"data:write", "tasks:create"}


def test_create_annotation_refuses_a_note_without_data_write():
    source = inspect.getsource(create_annotation)
    assert 'payload.kind != "task"' in source and 'has_permission("data:write")' in source, (
        "create_annotation admits tasks:create, so it must refuse any kind but "
        '"task" to a caller without data:write -- otherwise a member can file '
        "notes as well"
    )


def test_the_other_annotation_routes_stay_behind_data_write():
    """Creating a task is the exception; changing one is not."""
    from app.studio.annotations import delete_annotation, update_annotation

    assert required_permissions(update_annotation) == {"data:write"}
    assert required_permissions(delete_annotation) == {"data:write"}
