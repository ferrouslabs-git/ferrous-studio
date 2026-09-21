"""Exactly which studio routes a board token can reach.

A board token is an agent's credential, not a person's: it carries no Cognito
session, so it only reaches routes whose dependency is
``require_studio_permission`` rather than ``require_permission``. That choice
is per route and invisible at the call site, so the reachable set drifts
silently -- in both directions. It drifted once already: ``/import`` was
writable while nothing returned a page's content, so an agent could replace
every page of a wireframe and never read one back, including the one it had
just written.

Listing the set here makes each addition an argued decision. Adding a name is
granting agents access to that route; removing one is taking it away from a
connected MCP server that may already depend on it.

Source inspection rather than live requests, because the suite has no
database (same approach as test_lock_coverage.py).
"""
import inspect

from starlette.routing import Mount

from app.main import app

#: Every studio route a board token may reach, and why.
BOARD_TOKEN_ROUTES = {
    # Which project this token is for. The only route that answers anything
    # about the token itself, and the only one reachable without already
    # knowing the project id -- which is the point: an agent that still has
    # its token but has lost its .mcp.json can recover the rest from here.
    "board_token_whoami",
    # Reads: find a wireframe, then read what is actually on its pages.
    "list_wireframes",
    "get_wireframe_detail",
    # The only read returning page content. Its shape round-trips through
    # import_into_wireframe unchanged, so it is also "what a write replaces".
    "export_wireframe",
    "list_diagrams",
    "get_diagram",
    # Writes: creating and regenerating content is the point of the token.
    "import_into_wireframe",
    "import_bundle",
    "get_bundle_format_guide",
}


def _studio_endpoints():
    """(name, path) for every route under /api/studio."""

    def walk(application, prefix=""):
        for route in getattr(application, "routes", []):
            if isinstance(route, Mount):
                yield from walk(route.app, prefix + route.path)
            elif hasattr(route, "endpoint"):
                yield prefix + route.path, route.endpoint

    for path, endpoint in walk(app):
        if "/studio/" in path:
            yield path, endpoint


def test_board_tokens_reach_exactly_the_listed_routes():
    reachable = set()
    for _path, endpoint in _studio_endpoints():
        try:
            source = inspect.getsource(endpoint)
        except (OSError, TypeError):  # pragma: no cover - builtins, partials
            continue
        if "require_studio_permission(" in source:
            reachable.add(endpoint.__name__)

    assert reachable == BOARD_TOKEN_ROUTES, (
        "The routes a board token can reach have changed. Update "
        "BOARD_TOKEN_ROUTES with the reason, rather than the other way round.\n"
        f"  newly reachable: {sorted(reachable - BOARD_TOKEN_ROUTES)}\n"
        f"  no longer reachable: {sorted(BOARD_TOKEN_ROUTES - reachable)}"
    )


def test_an_agent_can_read_back_what_it_can_write():
    """The gap that motivated this file: writable but unreadable content."""
    assert "import_into_wireframe" in BOARD_TOKEN_ROUTES
    assert "export_wireframe" in BOARD_TOKEN_ROUTES
