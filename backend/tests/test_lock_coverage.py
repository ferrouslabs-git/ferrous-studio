"""Every studio write route must respect a locked version.

A locked project is a frozen record, and the check lives at the call site --
each write route resolves its project through ``get_writable_project`` instead
of ``get_project``. That is easy to forget when adding a route, and forgetting
it fails *open*: the route keeps working and the freeze quietly stops meaning
anything. This test is the backstop, and it doubles as the place where every
exception has to be argued for in writing.

Source inspection rather than live requests, because the suite has no database.
"""
import inspect

import pytest
from starlette.routing import Mount

from app.main import app
from app.studio.projects import LOCKED_EDITABLE_FIELDS, update_project
from app.studio.schemas import ProjectUpdate

PROJECT_ROUTES = "/api/studio/projects/{project_id}"
READ_METHODS = {"GET", "HEAD", "OPTIONS"}

#: Write routes that deliberately do not take the lock. Adding a name here is a
#: decision about what a frozen version still allows -- not a way to quiet the
#: test.
EXEMPT = {
    # Notes and tasks stay open on a locked version: freezing the design is
    # meant to start the review, not end the conversation about it.
    "create_annotation",
    "update_annotation",
    "delete_annotation",
    # Branching from a frozen version is the entire point of freezing one, and
    # nothing about the source changes except its lock.
    "create_project_version",
    # Otherwise a locked version could never be unlocked.
    "lock_project",
    "unlock_project",
    # Has its own narrower check: a locked version stays renameable and
    # archivable, but its description and rationale are part of what it froze.
    "update_project",
    # Which repository a project is built into is filing, not content: pointing
    # a frozen version at the right repository does not change what it froze,
    # and needing to unlock a version to correct a link would be a poor trade.
    "link_project_repository",
    "unlink_project_repository",
    # The board is live operational state keyed on (account_id, lineage_id),
    # not the project row -- a locked design version must not freeze it, and
    # copy_project must never learn it exists. See
    # docs/go-live-and-merge-boards.md phase 3.3.
    "create_release", "update_release", "delete_release",
    "create_epic", "update_epic", "delete_epic",
    "create_feature", "update_feature", "delete_feature",
    "create_sprint", "update_sprint", "delete_sprint",
    "create_requirement", "update_requirement", "delete_requirement", "claim_requirement_route",
    "create_doc", "update_doc", "delete_doc",
    "create_comment", "delete_comment",
    "set_environment", "create_feedback", "update_feedback", "delete_feedback",
    "request_attachment_upload", "confirm_attachment_upload", "delete_attachment",
    "create_board_token", "revoke_board_token_route", "queue_agent_run_route",
}


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


@pytest.mark.parametrize("route", list(write_routes()), ids=lambda r: r.endpoint.__name__)
def test_write_routes_take_the_project_lock(route):
    name = route.endpoint.__name__
    source = inspect.getsource(route.endpoint)
    # The call, not the word: docstrings name the helper to explain why a route
    # does or does not use it.
    guarded = "await get_writable_project(" in source
    if name in EXEMPT:
        assert not guarded, f"{name} is listed as exempt but takes the lock; remove it from EXEMPT"
    else:
        assert guarded, (
            f"{name} writes to a project but resolves it with get_project, so a locked "
            f"version would still accept the write. Use get_writable_project, or add "
            f"{name!r} to EXEMPT with a comment saying why."
        )


def test_exempt_names_all_still_exist():
    """A renamed or deleted route must not leave a stale exemption behind."""
    live = {route.endpoint.__name__ for route in write_routes()}
    assert EXEMPT <= live, f"EXEMPT names no longer routed: {sorted(EXEMPT - live)}"


# ── update_project's own narrower check ─────────────────────────────────────
# It is EXEMPT above because it does not use get_writable_project; it compares
# the submitted fields against LOCKED_EDITABLE_FIELDS instead. That comparison
# is only as good as the two sets agreeing with ProjectUpdate, so pin both.


def test_locked_editable_fields_are_all_real_fields():
    """A typo here would silently widen or narrow what a frozen version allows."""
    assert LOCKED_EDITABLE_FIELDS <= set(ProjectUpdate.model_fields), (
        f"LOCKED_EDITABLE_FIELDS names fields ProjectUpdate does not have: "
        f"{sorted(LOCKED_EDITABLE_FIELDS - set(ProjectUpdate.model_fields))}"
    )


def test_a_locked_version_stays_filable():
    """Name, label and status are filing, so they survive the freeze.

    The label especially: a frozen version is exactly the one someone later
    wants to call "As signed off", and needing to unlock it to do so would
    defeat the point of freezing it.
    """
    assert {"name", "status", "version_label"} <= LOCKED_EDITABLE_FIELDS


def test_a_locked_version_refuses_the_content_it_froze():
    """The description and rationale are part of what the version recorded."""
    assert not {"description", "rationale"} & LOCKED_EDITABLE_FIELDS


def test_update_project_compares_against_locked_editable_fields():
    """The route must actually consult the set, not re-list the fields inline."""
    source = inspect.getsource(update_project)
    assert "LOCKED_EDITABLE_FIELDS" in source
