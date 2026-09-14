"""Ferrous Studio MCP server -- lets an AI coding agent read and update one
project's board (releases, epics, features, sprints, requirements, docs,
comments) AND its wireframes/diagrams, over the real REST API,
authenticated as a board token rather than a human login.

Runs over stdio; add it to a project's .mcp.json. Deliberately isolated
from the main app's dependencies -- `mcp` is not a backend/requirements.txt
entry, so agents launch this with its own throwaway environment and never
touch what FastAPI/pydantic/starlette versions the server itself runs:

    uv run --with mcp python board_mcp.py

Env:
  FERROUS_STUDIO_URL     base URL, e.g. https://studio.ferrouslabs.co.uk
  FERROUS_STUDIO_PROJECT the project's UUID (from its URL in the app) --
                         optional; if left unset, it's resolved once via
                         the whoami() tool the first time it's needed and
                         cached from then on (only works for a token
                         minted after this existed -- see BoardToken's
                         own docstring in app/studio/board/models.py)
  FERROUS_BOARD_TOKEN    a board token minted via
                         POST /api/studio/projects/{project_id}/board/tokens
                         (account_admin only) -- shown once at creation

Deliberately no delete tools: an agent creates, updates, and comments;
deleting stays a human action in the UI.

Ids here are real UUIDs, not the human-readable REL1/E3/REQ-12 form shown
in the app -- Ferrous Studio's REST routes take the UUID, the human_id is
display-only. Every list/get result carries both, so map from one to the
other by reading a list first rather than guessing.

Board tools ported from software-management's sma_mcp.py, adapted to
Ferrous Studio's REST shapes: a requirement's inherited epic/release
already comes back pre-computed as effective_epic_id/effective_release_id
(app/studio/board/service.py), so these tools don't recompute that
inheritance client-side the way SMA's do.

Wireframe/diagram tools (below the board ones) exist because a board token
now reaches data:read/data:write too, not just board:read/board:write --
see app/studio/board/agents.py and app/studio/common.py's
require_studio_permission -- added specifically so this server can do
everything the in-app "Project Agent" chat could (docs/project-agent-
implementation-plan.md's 2026-09-14 pivot: remove that chat, rely on this
instead).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

try:                                            # mcp SDK >= 2.0
    from mcp.server.mcpserver import MCPServer as FastMCP
except ImportError:                             # mcp SDK 1.x
    from mcp.server.fastmcp import FastMCP

BASE = os.environ.get("FERROUS_STUDIO_URL", "").rstrip("/")
#: May be empty -- resolved lazily via whoami() the first time a project-
#: scoped call actually needs it, and cached here for the rest of this
#: process's run. FERROUS_STUDIO_PROJECT still wins when it is set (no
#: network round trip needed); this only covers a token whose .mcp.json
#: never had it filled in, or lost it.
_PROJECT_ID = os.environ.get("FERROUS_STUDIO_PROJECT", "")
TOKEN = os.environ.get("FERROUS_BOARD_TOKEN", "")

mcp = FastMCP("ferrous-studio-board")


def _request(method: str, url: str, body: dict | None = None):
    if not BASE or not TOKEN:
        raise RuntimeError("FERROUS_STUDIO_URL and FERROUS_BOARD_TOKEN must both be set")
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Content-Type", "application/json")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            payload = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        raise RuntimeError(f"{method} {url} -> HTTP {e.code}: {detail}") from None
    return json.loads(payload) if payload else None


def _project_id() -> str:
    """FERROUS_STUDIO_PROJECT if it was set; otherwise resolved once via
    GET /board/whoami (the one endpoint that needs no project id of its
    own) and cached for every call after. Raises the same RuntimeError
    whoami() itself would if the token has no known project."""
    global _PROJECT_ID
    if not _PROJECT_ID:
        _PROJECT_ID = _request("GET", f"{BASE}/api/studio/board/whoami")["project_id"]
    return _PROJECT_ID


def _call(method: str, path: str, body: dict | None = None):
    """A board endpoint: .../projects/{project_id}/board<path>."""
    return _request(method, f"{BASE}/api/studio/projects/{_project_id()}/board{path}", body)


def _studio_call(method: str, path: str, body: dict | None = None):
    """A non-board studio endpoint (wireframes, diagrams, import):
    .../projects/{project_id}<path> -- no /board segment, since these
    predate the board feature and were never nested under it."""
    return _request(method, f"{BASE}/api/studio/projects/{_project_id()}{path}", body)


def _patch_of(**kwargs) -> dict:
    return {k: v for k, v in kwargs.items() if v is not None}


# ── Overview ──────────────────────────────────────────────────────────────


@mcp.tool()
def whoami() -> dict:
    """Which project this board token is for -- {project_id, project_name}.
    Only needed to check explicitly if FERROUS_STUDIO_PROJECT was never
    set in this connection's config: every other tool already resolves and
    caches this automatically the first time it's needed. Fails if the
    token predates this feature (no project recorded at mint time)."""
    return _request("GET", f"{BASE}/api/studio/board/whoami")


@mcp.tool()
def board_summary() -> dict:
    """Every epic with its lifecycle status and requirement progress
    (total/done/doing/review/pct, plus hours/hours_done summed from the
    estimates that exist and estimated/unestimated/coverage saying how
    complete those are -- including requirements organised under one of
    its features, not just directly-attached ones), plus requirement counts
    by status across the whole board. Start here."""
    return _call("GET", "/summary")


@mcp.tool()
def recent_activity(limit: int = 30, entity_type: str | None = None, entity_id: str | None = None) -> dict:
    """The board's audit feed, newest first: who changed what, when."""
    params = f"?limit={limit}"
    if entity_type:
        params += f"&entity_type={entity_type}"
    if entity_id:
        params += f"&entity_id={entity_id}"
    return {"events": _call("GET", f"/events{params}")}


# ── Releases ─────────────────────────────────────────────────────────────


@mcp.tool()
def list_releases() -> dict:
    """Every release, with its derived date (the end of its latest sprint,
    not something anyone sets directly), shipped status, and progress over
    every requirement whose effective release is this one -- total/done/
    doing/review/pct, hours/hours_done from the estimates that exist, and
    estimated/unestimated/coverage saying how complete those are."""
    return {"releases": _call("GET", "/releases")}


@mcp.tool()
def get_release(release_id: str) -> dict:
    return _call("GET", f"/releases/{release_id}")


@mcp.tool()
def create_release(title: str, description: str = "") -> dict:
    return _call("POST", "/releases", {"title": title, "description": description})


@mcp.tool()
def update_release(release_id: str, title: str | None = None, description: str | None = None, shipped: bool | None = None) -> dict:
    """Set shipped=true/false to mark a release shipped or not -- a human
    judgement call, never computed. Everything else is a plain field edit."""
    return _call("PATCH", f"/releases/{release_id}", _patch_of(title=title, description=description, shipped=shipped))


# ── Epics ────────────────────────────────────────────────────────────────


@mcp.tool()
def list_epics() -> dict:
    """Every epic -- title, summary, lifecycle status (Readiness ->
    Implementation -> ReleasedToUAT -> HumanValidation -> Done), release."""
    return {"epics": _call("GET", "/epics")}


@mcp.tool()
def get_epic(epic_id: str) -> dict:
    return _call("GET", f"/epics/{epic_id}")


@mcp.tool()
def create_epic(title: str, summary: str = "", release_id: str | None = None) -> dict:
    """New epics always start at status Readiness."""
    return _call("POST", "/epics", _patch_of(title=title, summary=summary, release_id=release_id))


@mcp.tool()
def update_epic(epic_id: str, title: str | None = None, summary: str | None = None, status: str | None = None, release_id: str | None = None) -> dict:
    """status transitions into 'Done' are refused (HTTP 409) unless every
    requirement under the epic -- direct, or via one of its features -- is
    itself Done."""
    return _call("PATCH", f"/epics/{epic_id}", _patch_of(title=title, summary=summary, status=status, release_id=release_id))


# ── Features ─────────────────────────────────────────────────────────────


@mcp.tool()
def list_features(epic_id: str | None = None) -> dict:
    return {"features": _call("GET", f"/features?epic_id={epic_id}" if epic_id else "/features")}


@mcp.tool()
def create_feature(epic_id: str, title: str) -> dict:
    """Organising a requirement into a feature is a human-curated step --
    nothing calls this automatically."""
    return _call("POST", "/features", {"epic_id": epic_id, "title": title})


# ── Sprints ──────────────────────────────────────────────────────────────


@mcp.tool()
def list_sprints() -> dict:
    return {"sprints": _call("GET", "/sprints")}


@mcp.tool()
def get_sprint(sprint_id: str) -> dict:
    return _call("GET", f"/sprints/{sprint_id}")


@mcp.tool()
def get_sprint_burndown(sprint_id: str) -> dict:
    return _call("GET", f"/sprints/{sprint_id}/burndown")


@mcp.tool()
def create_sprint(name: str, release_id: str, goal: str = "", start_date: str | None = None, end_date: str | None = None) -> dict:
    """A sprint must belong to a release -- the server refuses one without
    a release_id (HTTP 422). A release's date is the end of the latest
    sprint filed under it, so giving a sprint an end_date is how you move
    that release's date."""
    return _call("POST", "/sprints", _patch_of(name=name, release_id=release_id, goal=goal, start_date=start_date, end_date=end_date))


@mcp.tool()
def update_sprint(sprint_id: str, name: str | None = None, goal: str | None = None, start_date: str | None = None, end_date: str | None = None, state: str | None = None) -> dict:
    """state: planned | active | done. Several sprints may be active at
    once; completing one (-> done) returns its non-Done requirements to the
    backlog and clears their queue positions."""
    return _call("PATCH", f"/sprints/{sprint_id}", _patch_of(name=name, goal=goal, start_date=start_date, end_date=end_date, state=state))


# ── Requirements ─────────────────────────────────────────────────────────


@mcp.tool()
def list_requirements(status: str | None = None, epic_id: str | None = None, feature_id: str | None = None, sprint_id: str | None = None) -> dict:
    """Requirements, optionally filtered by status (Todo | Doing | Review |
    Blocked | Done), epic, feature, or sprint. Each result carries its
    *effective* epic/release (its own value if set, else inherited via its
    feature/epic) as effective_epic_id/effective_release_id -- already
    computed server-side, not something to work out here."""
    params = []
    if status:
        params.append(f"status={status}")
    if epic_id:
        params.append(f"epic_id={epic_id}")
    if feature_id:
        params.append(f"feature_id={feature_id}")
    if sprint_id:
        params.append(f"sprint_id={sprint_id}")
    qs = ("?" + "&".join(params)) if params else ""
    reqs = _call("GET", f"/requirements{qs}")
    return {"count": len(reqs), "requirements": reqs}


@mcp.tool()
def get_requirement(requirement_id: str) -> dict:
    return _call("GET", f"/requirements/{requirement_id}")


@mcp.tool()
def create_requirement(
    title: str, body: str = "", epic_id: str | None = None, feature_id: str | None = None,
    priority: str = "Medium", release_id: str | None = None, sprint_id: str | None = None,
) -> dict:
    return _call("POST", "/requirements", _patch_of(
        title=title, body=body, epic_id=epic_id, feature_id=feature_id,
        priority=priority, release_id=release_id, sprint_id=sprint_id,
    ))


@mcp.tool()
def update_requirement(
    requirement_id: str, title: str | None = None, body: str | None = None,
    status: str | None = None, priority: str | None = None,
    epic_id: str | None = None, feature_id: str | None = None,
    release_id: str | None = None, sprint_id: str | None = None,
    queue_position: int | None = None,
) -> dict:
    """status: Todo | Doing | Review | Blocked | Done. Moving into Blocked
    records which of the three in-flight stages to return to when
    unblocked automatically -- there's nothing to pass for that. Moving a
    requirement into a sprint resets a stale Doing/Review/Blocked back to
    Todo automatically too, unless it's already Done.

    queue_position: the requirement's position within its sprint's work
    order (lower first; unordered ones sort last). It cannot be cleared via
    this tool -- moving the requirement to another sprint clears it."""
    return _call("PATCH", f"/requirements/{requirement_id}", _patch_of(
        title=title, body=body, status=status, priority=priority,
        epic_id=epic_id, feature_id=feature_id, release_id=release_id, sprint_id=sprint_id,
        queue_position=queue_position,
    ))


@mcp.tool()
def claim_requirement(requirement_id: str) -> dict:
    """Atomically move a Todo requirement to Doing. Fails (409) if it's
    already claimed by the time this runs -- the safe way for more than one
    agent to compete for the same queue without both believing they won."""
    return _call("POST", f"/requirements/{requirement_id}/claim")


# ── Docs ─────────────────────────────────────────────────────────────────


@mcp.tool()
def list_docs(epic_id: str | None = None) -> dict:
    """Notes filed under an epic (or unfiled, epic_id omitted). Body is
    markdown; a ```mermaid fence renders as a diagram in the app."""
    return {"docs": _call("GET", f"/docs?epic_id={epic_id}" if epic_id else "/docs")}


@mcp.tool()
def get_doc(doc_id: str) -> dict:
    return _call("GET", f"/docs/{doc_id}")


@mcp.tool()
def create_doc(title: str, body: str = "", epic_id: str | None = None, tags: list[str] | None = None) -> dict:
    return _call("POST", "/docs", _patch_of(title=title, body=body, epic_id=epic_id, tags=tags))


# ── Comments ─────────────────────────────────────────────────────────────


@mcp.tool()
def list_comments(entity_type: str, entity_id: str) -> dict:
    """entity_type: release | epic | feature | requirement | sprint | doc."""
    return {"comments": _call("GET", f"/comments?entity_type={entity_type}&entity_id={entity_id}")}


@mcp.tool()
def create_comment(entity_type: str, entity_id: str, body: str) -> dict:
    return _call("POST", "/comments", {"entity_type": entity_type, "entity_id": entity_id, "body": body})


# ── Wireframes & diagrams ───────────────────────────────────────────────────
#
# The client's v1 direction (2026-09-14) is to remove the in-app "Project
# Agent" chat and rely on a local agent connected here instead -- so this
# section exists to match what that chat could already do: create/update
# wireframes and diagrams, not just board data. wireframe_format_guide()
# fetches the exact same prose Project Agent's own system prompt used to
# teach the bundle format (catalog.py's BUNDLE_FORMAT_GUIDE, served over
# HTTP since this script has no Python import access to that module -- see
# both modules' docstrings). Call it once before create_wireframes_and_
# diagrams/update_wireframe, the same way that chat always had it in
# context -- the shape is intricate enough that guessing at it from field
# names alone is how a live run once put labels under data.label instead of
# as a top-level field.


@mcp.tool()
def wireframe_format_guide() -> str:
    """The exact bundle format wireframes/diagrams/pages/layout/components
    must be shaped as for create_wireframes_and_diagrams and
    update_wireframe -- component vocabulary, a worked example, and the
    mistakes real runs have actually made. Call this once before either of
    those tools; do not guess the shape from their parameter names alone."""
    return _studio_call("GET", "/import/format-guide")["guide"]


@mcp.tool()
def list_wireframes() -> dict:
    """Every wireframe in this project -- id, name, page count. Start here
    before update_wireframe, to find the real id of the one meant."""
    return {"wireframes": _studio_call("GET", "/wireframes")}


@mcp.tool()
def get_wireframe(wireframe_id: str) -> dict:
    """One wireframe's full detail, pages included -- what update_wireframe
    would be replacing, if it's about to be called."""
    return _studio_call("GET", f"/wireframes/{wireframe_id}")


@mcp.tool()
def create_wireframes_and_diagrams(
    wireframes: list[dict] | None = None, diagrams: list[dict] | None = None, source: dict | None = None
) -> dict:
    """Create new wireframes and/or diagrams in this project -- see
    wireframe_format_guide() for the exact shape both must be in. Creates
    exactly what validation accepts; nothing is created if any part fails,
    and the precise errors come back so this can be called again with them
    fixed. Always makes new wireframes, never touches an existing one --
    use update_wireframe for that instead.

    source: optional {repo_full_name, commit_sha, generated_at, generator}
    -- pass the reverse-engineer-repo skill's out/source.json verbatim when
    importing its bundle, so the created content's audit history and the
    "generated from a different repo than this project's own" check both
    see the real provenance, the same as importing through the app's UI
    would."""
    body: dict = {"wireframes": wireframes or [], "diagrams": diagrams or []}
    if source:
        body["source"] = source
    return _studio_call("POST", "/import", body)


@mcp.tool()
def update_wireframe(
    wireframe_id: str,
    pages: list[dict],
    name: str | None = None,
    interfaceType: str | None = None,
    landingPageId: str | None = None,
) -> dict:
    """Replace an EXISTING wireframe's pages with new content -- see
    wireframe_format_guide() for the exact shape. Use this instead of
    create_wireframes_and_diagrams when the request clearly means one of
    the wireframes list_wireframes already showed -- by name, or an
    obvious regenerate/refresh of it (e.g. after reverse-engineering an
    updated repository) -- rather than creating a duplicate. The
    wireframe's current pages are saved to its own version history first
    (Studio's existing Snapshots panel), so this is always undoable.
    Everything is replaced, not merged -- pass the complete new content,
    not just what changed. name/interfaceType/landingPageId are optional;
    omit to keep the current value."""
    payload = _patch_of(name=name, interfaceType=interfaceType, landingPageId=landingPageId)
    payload["pages"] = pages
    return _studio_call("POST", f"/wireframes/{wireframe_id}/import", payload)


@mcp.tool()
def list_diagrams() -> dict:
    return {"diagrams": _studio_call("GET", "/diagrams")}


@mcp.tool()
def get_diagram(diagram_id: str) -> dict:
    return _studio_call("GET", f"/diagrams/{diagram_id}")


if __name__ == "__main__":
    mcp.run()
