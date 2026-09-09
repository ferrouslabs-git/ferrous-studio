#!/usr/bin/env python
"""One-off import of a software-management (SMA) board into a Studio project.

API to API -- neither database is touched. SMA's ``GET /api/board`` returns the
whole board as one document and management.fnai.dev is public; Studio's board
API is public and accepts a board token. So this runs from a laptop, which
matters because both databases sit on a private RDS.

Usage (dry run prints what would happen and writes nothing)::

    python scripts/import_sma_board.py
    python scripts/import_sma_board.py --apply

Environment:

    SMA_URL             default https://management.fnai.dev
    SMA_EMAIL           SMA login (or set SMA_TOKEN directly)
    SMA_PASSWORD
    SMA_TOKEN           an existing SMA session token, instead of email/password

    STUDIO_URL          default https://studio.ferrouslabs.co.uk
    STUDIO_PROJECT_ID   the Studio project whose board receives the import
    STUDIO_ORG_ID       the organisation owning it -- both ids are in the
                        project's URL: /orgs/<org>/projects/<project>/details
    STUDIO_TOKEN        either a board token (bt_...) or your own Cognito
                        access token. Board routes accept both (see
                        board/auth.py); a Cognito token additionally needs
                        STUDIO_ORG_ID, because the scope headers are what
                        resolve an organisation for a human caller, whereas a
                        board token already names its board. Read the browser
                        one from the devtools console on the live site:
                            localStorage.auth_access_token
                        It expires in about an hour, which is ample here.

DELIBERATE OMISSIONS
--------------------
* ``queue_position`` -- no equivalent in Studio, and not wanted.
* Events, agents and attachments. Events would all carry the importer as
  actor; attachments live in Postgres on the SMA side and S3 here, so they
  need a separate download/re-upload pass.

WHAT CANNOT BE PRESERVED
------------------------
* **Authorship.** ``CommentCreate``/``DocCreate`` take no author -- the API
  sets it from the caller. Every imported comment and doc becomes the
  importer's. The original author and date are prefixed into the body instead,
  so the provenance is at least visible.
* **Timestamps.** No create schema accepts ``created_at``; everything is dated
  today. Requirements, epics, releases and features have no author column in
  Studio at all, so nothing is lost there.
* **Historical burndown.** ``record_sprint_history`` writes one row per
  requirement at import time, so past sprints cannot be reconstructed.

ORDERING (all three are load-bearing -- see the route code)
-----------------------------------------------------------
* A requirement is created in ONE POST carrying its sprint and status
  together. ``update_requirement`` resets an unfinished status to ``Todo``
  whenever a requirement *enters* a sprint, so POST-then-PATCH would silently
  flatten every in-flight status.
* Sprint states are set BEFORE the requirements, while the sprints are still
  empty. ``SprintCreate`` has no ``state`` field, and moving a sprint to
  ``done`` returns its unfinished work to the backlog -- doing that after the
  requirements landed would quietly empty every finished sprint.
* Epic statuses are set AFTER the requirements: Studio refuses ``Done`` until
  every requirement under the epic is itself Done.

ESTIMATES: ``RequirementCreate`` does not forbid extra fields, so an API
predating the estimate_hours migration accepts the value and throws it away.
--apply therefore checks the published schema first -- but only when the
source board actually carries estimates, since otherwise there is nothing to
lose and the check would just be ceremony.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

SMA_URL = os.environ.get("SMA_URL", "https://management.fnai.dev").rstrip("/")
STUDIO_URL = os.environ.get("STUDIO_URL", "https://studio.ferrouslabs.co.uk").rstrip("/")

# The live board uses Low/Medium/High -- the same vocabulary as Studio, minus
# Urgent -- so those pass through untouched. SMA's core.js still declares
# MoSCoW (Must/Should/Could), which the data does not use; those are mapped
# anyway so an older board would import correctly rather than silently
# flattening to Medium. A dry run against the real board caught this: the
# MoSCoW-only map would have levelled all 348 requirements.
PRIORITY = {
    "Low": "Low", "Medium": "Medium", "High": "High", "Urgent": "Urgent",
    "Must": "High", "Should": "Medium", "Could": "Low",
}

# Statuses and epic/sprint vocabularies are identical on both sides -- SMA's
# four requirement statuses are a subset of Studio's five (Studio adds Review).
FALLBACK_STATUS = "Todo"
FALLBACK_EPIC_STATUS = "Readiness"


class ImportError_(RuntimeError):
    pass


#: Board tokens are self-describing (they name their own board); a Cognito
#: token is not, so it needs the scope headers get_scope_context reads.
STUDIO_ORG_ID = os.environ.get("STUDIO_ORG_ID", "").strip()
BOARD_TOKEN_PREFIX = "bt_"


def _request(url: str, *, token: str, method: str = "GET", body: dict | None = None) -> dict | list:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if STUDIO_ORG_ID and not token.startswith(BOARD_TOKEN_PREFIX) and url.startswith(STUDIO_URL):
        req.add_header("X-Scope-Type", "account")
        req.add_header("X-Scope-ID", STUDIO_ORG_ID)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:500]
        raise ImportError_(f"{method} {url} -> HTTP {exc.code}: {detail}") from None


def sma_login() -> str:
    token = os.environ.get("SMA_TOKEN", "").strip()
    if token:
        return token
    email, password = os.environ.get("SMA_EMAIL", ""), os.environ.get("SMA_PASSWORD", "")
    if not email or not password:
        raise ImportError_("Set SMA_TOKEN, or SMA_EMAIL and SMA_PASSWORD.")
    req = urllib.request.Request(
        f"{SMA_URL}/api/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        method="POST",
    )
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())["token"]


def provenance(author: str | None, created_at: str | None, body: str) -> str:
    """Keep the original author and date visible, since the columns cannot."""
    who = (author or "unknown").strip()
    when = (created_at or "")[:10]
    stamp = f"_Imported from the fn.ai board — originally by {who}"
    stamp += f" on {when}._" if when else "._"
    return f"{stamp}\n\n{body}" if body else stamp


class Importer:
    def __init__(self, board: dict, studio_token: str, project_id: str, apply: bool):
        self.board = board
        self.token = studio_token
        self.base = f"{STUDIO_URL}/api/studio/projects/{project_id}/board"
        self.apply = apply
        self.ids: dict[str, dict[str, str]] = {k: {} for k in ("release", "epic", "feature", "sprint", "requirement", "doc")}
        self.counts: dict[str, int] = {}
        self.warnings: list[str] = []

    def _post(self, path: str, payload: dict, kind: str, source_id: str) -> str | None:
        self.counts[kind] = self.counts.get(kind, 0) + 1
        if not self.apply:
            return None
        created = _request(f"{self.base}{path}", token=self.token, method="POST", body=payload)
        new_id = created["id"]
        self.ids[kind][source_id] = new_id
        return new_id

    def _map(self, kind: str, source_id: str | None) -> str | None:
        if not source_id:
            return None
        return self.ids[kind].get(source_id)

    # ── in dependency order ──────────────────────────────────────────────

    def releases(self) -> None:
        for r in sorted(self.board.get("releases", []), key=lambda x: x["id"]):
            self._post(
                "/releases",
                {"title": r.get("title") or r["id"], "description": r.get("description", "")},
                "release",
                r["id"],
            )

    def epics(self) -> None:
        for e in sorted(self.board.get("epics", []), key=lambda x: x["id"]):
            status = e.get("status") or FALLBACK_EPIC_STATUS
            # Studio refuses status=Done unless every requirement under the epic
            # is Done, and the requirements do not exist yet -- so epics are
            # created at their real status only if it is not Done, and Done ones
            # are set at the end (see finish()).
            payload = {
                "title": e.get("title") or e["id"],
                "summary": e.get("summary", ""),
                "release_id": self._map("release", e.get("release")),
            }
            self._post("/epics", payload, "epic", e["id"])
            if status != FALLBACK_EPIC_STATUS:
                self._deferred_epic_status.append((e["id"], status))

    def features(self) -> None:
        for f in sorted(self.board.get("features", []), key=lambda x: x["id"]):
            epic_id = self._map("epic", f.get("epic"))
            if self.apply and epic_id is None:
                self.warnings.append(f"feature {f['id']} skipped: epic {f.get('epic')!r} not imported")
                continue
            self._post("/features", {"epic_id": epic_id, "title": f.get("title") or f["id"]}, "feature", f["id"])

    def sprints(self) -> None:
        for s in sorted(self.board.get("sprints", []), key=lambda x: x["id"]):
            payload = {
                "name": s.get("name") or s["id"],
                "goal": s.get("goal", ""),
                "start_date": s.get("start") or None,
                "end_date": s.get("end") or None,
                "release_id": None,
            }
            cap = s.get("capacity_hours")
            if cap is not None:
                payload["capacity_hours"] = int(round(float(cap)))  # Studio stores an int
            self._post("/sprints", payload, "sprint", s["id"])
            if (s.get("state") or "planned") != "planned":
                self._deferred_sprint_state.append((s["id"], s["state"]))

    def requirements(self) -> None:
        for r in sorted(self.board.get("requirements", []), key=lambda x: x["id"]):
            status = r.get("status") or FALLBACK_STATUS
            if status not in ("Todo", "Doing", "Review", "Blocked", "Done"):
                self.warnings.append(f"requirement {r['id']}: unknown status {status!r} -> Todo")
                status = FALLBACK_STATUS
            source_priority = r.get("priority")
            priority = PRIORITY.get(source_priority, "Medium")
            if source_priority and source_priority not in PRIORITY:
                self.warnings.append(f"requirement {r['id']}: unknown priority {source_priority!r} -> Medium")
            # One POST carrying sprint AND status: see the module docstring.
            payload = {
                "title": r.get("title") or r["id"],
                "body": r.get("body", ""),
                "epic_id": self._map("epic", r.get("epic")),
                "feature_id": self._map("feature", r.get("feature")),
                "status": status,
                "priority": priority,
                "release_id": self._map("release", r.get("release")),
                "sprint_id": self._map("sprint", r.get("sprint")),
                "estimate_hours": r.get("estimate_hours"),
            }
            self._post("/requirements", payload, "requirement", r["id"])

    def docs(self) -> None:
        for d in sorted(self.board.get("docs", []), key=lambda x: x["id"]):
            self._post(
                "/docs",
                {
                    "title": d.get("title") or d["id"],
                    "body": provenance(d.get("author"), d.get("created_at"), d.get("body", "")),
                    "tags": d.get("tags") or [],
                    "epic_id": self._map("epic", d.get("epic_id") or d.get("epic")),
                },
                "doc",
                d["id"],
            )

    def comments(self) -> None:
        entity_of = {
            "release": self.ids["release"], "epic": self.ids["epic"], "feature": self.ids["feature"],
            "sprint": self.ids["sprint"], "requirement": self.ids["requirement"], "doc": self.ids["doc"],
        }
        for c in sorted(self.board.get("comments", []), key=lambda x: x.get("created_at") or ""):
            # The board API serves this as "entity"; "entity_id" is the column
            # name and appears on older payloads. Reading only entity_id would
            # skip every comment on the live board.
            source_entity = c.get("entity") or c.get("entity_id") or ""
            kind = next((k for k, m in entity_of.items() if source_entity in m), None)
            if kind is None:
                if self.apply:
                    self.warnings.append(f"comment {c['id']} skipped: entity {source_entity!r} not imported")
                    continue
                kind = "requirement"  # dry run: still count it
            self.counts["comment"] = self.counts.get("comment", 0) + 1
            if not self.apply:
                continue
            _request(
                f"{self.base}/comments",
                token=self.token,
                method="POST",
                body={
                    "entity_type": kind,
                    "entity_id": entity_of[kind][source_entity],
                    "body": provenance(c.get("author"), c.get("created_at"), c.get("text", "")),
                },
            )

    def sprint_states(self) -> None:
        """Set sprint states while the sprints are still EMPTY.

        Marking a sprint ``done`` means "complete this sprint", and Studio
        returns any unfinished work in it to the backlog. Doing this after the
        requirements had landed would therefore quietly empty out every
        finished sprint the source board had. Doing it first costs nothing --
        there is no work in them yet to return -- and the requirements then
        land into an already-finished sprint with their real statuses, because
        creating a requirement does not apply the completion rule.
        """
        for source_id, state in self._deferred_sprint_state:
            if not self.apply:
                continue
            new_id = self._map("sprint", source_id)
            if new_id is None:
                continue
            result = _request(f"{self.base}/sprints/{new_id}", token=self.token, method="PATCH", body={"state": state})
            returned = (result or {}).get("returned_to_backlog") or 0
            if returned:
                # Should be zero -- the sprint is empty at this point. If it is
                # not, the ordering assumption above no longer holds.
                self.warnings.append(
                    f"sprint {source_id}: setting {state!r} returned {returned} requirement(s) to the backlog, "
                    "which should not happen before requirements are created"
                )

    def epic_statuses(self) -> None:
        """Epic statuses last: Studio refuses ``Done`` until every requirement
        under the epic is itself Done, so the requirements must exist first."""
        for source_id, status in self._deferred_epic_status:
            if not self.apply:
                continue
            new_id = self._map("epic", source_id)
            if new_id is None:
                continue
            try:
                _request(f"{self.base}/epics/{new_id}", token=self.token, method="PATCH", body={"status": status})
            except ImportError_ as exc:
                self.warnings.append(f"epic {source_id}: could not set status {status!r} ({exc})")

    def run(self) -> None:
        self._deferred_epic_status: list[tuple[str, str]] = []
        self._deferred_sprint_state: list[tuple[str, str]] = []
        self.releases()
        self.epics()
        self.features()
        self.sprints()
        self.sprint_states()  # before requirements -- see the docstring
        self.requirements()
        self.docs()
        self.comments()
        self.epic_statuses()  # after requirements -- see the docstring


def preflight_estimate_hours(token: str, board: dict) -> None:
    """Refuse to run against an API that would silently drop estimates.

    RequirementCreate does not forbid unknown fields, so an older deployment
    accepts estimate_hours and throws it away -- the failure mode being checked
    for is silent data loss, not an error.

    Skipped entirely when the source board has no estimates: there is then
    nothing to lose, and blocking the import on a deploy that buys nothing
    would be pointless ceremony.

    Reads the published schema rather than an existing requirement: the board
    being imported into is empty, so there is nothing to inspect otherwise.
    """
    if not any(r.get("estimate_hours") is not None for r in board.get("requirements", [])):
        return
    try:
        schema = _request(f"{STUDIO_URL}/api/openapi.json", token=token)
    except ImportError_ as exc:
        raise ImportError_(f"Could not read the target API schema to verify estimate_hours: {exc}") from None
    props = (
        schema.get("components", {})
        .get("schemas", {})
        .get("RequirementCreate", {})
        .get("properties", {})
    )
    if not props:
        raise ImportError_("Could not find RequirementCreate in the target API schema.")
    if "estimate_hours" not in props:
        raise ImportError_(
            "The target API has no estimate_hours on RequirementCreate -- deploy the "
            "e2b7d4f9a316 migration first, or every estimate is silently dropped."
        )


def report_source_keys(board: dict) -> list[str]:
    """Dry-run diagnostic: the field names actually present on the source board.

    The mapping below assumes SMA's aliased names (``epic``, ``feature``,
    ``release``, ``sprint``) rather than its column names. A dry run cannot
    catch a mismatch by exercising it -- nothing is written and nothing maps --
    so it reports the real keys instead, and flags the ones being read.
    """
    expected = {
        "releases": ("id", "title", "description"),
        "epics": ("id", "title", "summary", "status", "release"),
        "features": ("id", "title", "epic"),
        "sprints": ("id", "name", "goal", "start", "end", "state", "capacity_hours"),
        "requirements": ("id", "title", "body", "epic", "feature", "status", "priority",
                          "release", "sprint", "estimate_hours"),
        "docs": ("id", "title", "body", "tags", "epic"),
        "comments": ("id", "entity", "author", "text", "created_at"),
    }
    notes = []
    for collection, fields in expected.items():
        rows = board.get(collection) or []
        if not rows:
            notes.append(f"{collection}: empty on the source board")
            continue
        present = set(rows[0].keys())
        missing = [f for f in fields if f not in present]
        if missing:
            notes.append(f"{collection}: source row is MISSING {missing} (present: {sorted(present)})")
    return notes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="actually write; without it this is a dry run")
    args = ap.parse_args()

    project_id = os.environ.get("STUDIO_PROJECT_ID", "").strip()
    studio_token = os.environ.get("STUDIO_TOKEN", "").strip()
    if args.apply and not (project_id and studio_token):
        print("STUDIO_PROJECT_ID and STUDIO_TOKEN are required for --apply.", file=sys.stderr)
        return 1
    if args.apply and not studio_token.startswith(BOARD_TOKEN_PREFIX) and not STUDIO_ORG_ID:
        print(
            "STUDIO_TOKEN looks like a Cognito token, which also needs STUDIO_ORG_ID "
            "(the scope headers a human caller is resolved by). Both ids are in the "
            "project's URL: /orgs/<org>/projects/<project>/details",
            file=sys.stderr,
        )
        return 1

    try:
        board = _request(f"{SMA_URL}/api/board", token=sma_login())
        importer = Importer(board, studio_token, project_id, args.apply)
        if args.apply:
            preflight_estimate_hours(studio_token, board)
        importer.run()
    except ImportError_ as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print("APPLIED" if args.apply else "DRY RUN — nothing written")
    for kind in ("release", "epic", "feature", "sprint", "requirement", "doc", "comment"):
        print(f"  {kind + 's':<14} {importer.counts.get(kind, 0)}")
    estimated = sum(1 for r in board.get("requirements", []) if r.get("estimate_hours") is not None)
    print(f"  (of which {estimated} requirement(s) carry an effort estimate)")

    priorities = sorted({r.get("priority") for r in board.get("requirements", []) if r.get("priority")})
    if priorities:
        print("\nPriority mapping:")
        for p in priorities:
            print(f"  {p:<8} -> {PRIORITY.get(p, 'Medium')}{'' if p in PRIORITY else '   (unrecognised)'}")

    for note in report_source_keys(board):
        importer.warnings.append(note)
    if importer.warnings:
        print("\nWarnings:")
        for w in importer.warnings:
            print(f"  - {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
