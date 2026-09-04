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
