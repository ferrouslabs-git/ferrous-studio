#!/usr/bin/env python
"""Seed a complete demonstration organisation and project: Harbourside
Community Trust, a fictional charity replacing its spreadsheets with a
brochure site and an events-and-donations hub.

Every section of the project workspace is filled: details, environments,
personas, the use case model, datasets, five wireframes (brochure site and
hub app, desktop and mobile each, plus one archived concept), six diagrams,
annotations, snapshots, the delivery board (releases, epics, features,
sprints, requirements, docs, comments), feedback reports, project
documents, a board token and a second project version.

API to API, standard library only -- no database access, so it runs the
same way against local, staging and production.

Usage::

    python scripts/seed_demo_charity.py --validate-only        # check the bundle, write nothing
    python scripts/seed_demo_charity.py                        # local verify server (see below)
    STUDIO_URL=https://studio.ferrouslabs.co.uk STUDIO_TOKEN=<cognito access token> \\
        python scripts/seed_demo_charity.py

Identity
    The caller must be a platform administrator (to create the organisation)
    or must pass ``--org-id`` for an organisation they administer. A platform
    admin does not join the organisations they create; the seed still works
    because platform roles may act inside any organisation's scope.

    STUDIO_TOKEN is your own Cognito access token: on the live site, read
    ``localStorage.auth_access_token`` from the browser console. It lasts
    about an hour. Locally, run the verify server from the run-local skill
    (which ignores the token) and leave STUDIO_TOKEN unset.

Re-running
    A second run against the same organisation refuses to create a second
    project of the same name; pass ``--replace`` to archive and delete the
    existing one first (all of its versions), or ``--org-id`` to seed a
    different organisation.
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys
import time
import uuid
import zlib
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

from demo_charity import content as C  # noqa: E402
from demo_charity.client import ApiError, Client  # noqa: E402
from demo_charity.diagrams import all_diagrams  # noqa: E402
from demo_charity.wireframes import DATASETS, POLISH, all_wireframes  # noqa: E402

DEFAULT_URL = "http://127.0.0.1:8081"


def say(msg: str) -> None:
    print(msg, flush=True)


# ── Bundle ───────────────────────────────────────────────────────────────


def build_bundle() -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "source": {
            "repo_full_name": None,
            "commit_sha": None,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "generator": "seed_demo_charity.py",
        },
        "actors": C.ACTORS,
        "useCases": C.USE_CASES,
        "datasets": DATASETS,
        "wireframes": all_wireframes(),
        "diagrams": all_diagrams(),
    }


def validate_locally(bundle: dict[str, Any]) -> list[dict[str, str]] | None:
    """Run the backend's own validator if its code is importable; None if not."""
    backend = REPO / "backend"
    if not (backend / "app" / "studio" / "importing.py").exists():
        return None
    sys.path.insert(0, str(backend))
    try:
        from app.studio.catalog import get_catalog
        from app.studio.importing import validate_bundle
    except Exception as exc:  # noqa: BLE001 -- any import failure means "cannot validate here"
        say(f"  (local validation skipped: {exc.__class__.__name__}: {exc})")
        return None
    return [e.as_dict() for e in validate_bundle(bundle, get_catalog())]


def bundle_counts(bundle: dict[str, Any]) -> str:
    pages = sum(len(w["pages"]) for w in bundle["wireframes"])
    return (
        f"{len(bundle['actors'])} actors, {len(bundle['useCases'])} use cases, {len(bundle['datasets'])} datasets, "
        f"{len(bundle['wireframes'])} wireframes ({pages} pages), {len(bundle['diagrams'])} diagrams"
    )


# ── Small helpers ────────────────────────────────────────────────────────


def make_png(width: int = 640, height: int = 400) -> bytes:
    """A plausible 'screenshot': a header band, a search box and some rows.
    Pure Python so the seed needs no imaging library."""
    def px(r: int, g: int, b: int) -> bytes:
        return bytes((r, g, b))

    bg, band, box, line, text = px(246, 247, 249), px(29, 78, 137), px(255, 255, 255), px(225, 228, 233), px(60, 64, 72)
    rows = []
    for y in range(height):
        row = bytearray(b"\x00")
        for x in range(width):
            if y < 56:
                colour = band
            elif 80 <= y < 116 and 24 <= x < width - 24:
                colour = text if (88 <= y < 108 and 40 <= x < 220) else box
            elif y >= 140 and (y - 140) % 44 < 36 and 24 <= x < width - 24:
                colour = text if ((y - 140) % 44 in range(14, 22) and 40 <= x < 40 + 120 + ((y - 140) // 44) * 23 % 90) else box
            elif y >= 140 and (y - 140) % 44 >= 36 and 24 <= x < width - 24:
                colour = line
            else:
                colour = bg
            row += colour
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


class Seeder:
    def __init__(self, api: Client, opts: argparse.Namespace):
        self.api = api
        self.opts = opts
        self.project_id: str = ""
        self.wireframes: dict[str, str] = {}  # name -> id
        self.pages: dict[str, dict[str, str]] = {}  # wireframe name -> page name -> id
        self.ids: dict[str, dict[str, str]] = {k: {} for k in ("release", "epic", "feature", "sprint", "requirement", "doc")}
        self.summary: dict[str, Any] = {}
        self.skipped: list[str] = []

    @property
    def base(self) -> str:
        return f"/api/studio/projects/{self.project_id}"

    # ── organisation and project ─────────────────────────────────────────

    def identify(self) -> dict[str, Any]:
        me = self.api.get("/api/um/me", scoped=False)
        say(f"Signed in as {me.get('email')} ({'platform admin' if me.get('is_platform_admin') else 'organisation user'})")
        return me

    def organisation(self, me: dict[str, Any]) -> str:
        if self.opts.org_id:
            self.api.org_id = self.opts.org_id
            org = self.api.get(f"/api/um/tenants/{self.opts.org_id}", scoped=False)
            say(f"Using organisation {org['name']} ({org['id']})")
            return org["id"]
        if not me.get("is_platform_admin"):
            raise SystemExit("Only a platform administrator can create an organisation; pass --org-id for one you administer.")
        for tenant in self.api.get("/api/um/platform/tenants", scoped=False):
            if tenant["name"].casefold() == C.ORG_NAME.casefold():
                say(f"Reusing organisation {tenant['name']} ({tenant['tenant_id']})")
                self.api.org_id = tenant["tenant_id"]
                return tenant["tenant_id"]
        created = self.api.post("/api/um/tenants", {"name": C.ORG_NAME}, scoped=False)
        org_id = created["tenant_id"]
        say(f"Created organisation {C.ORG_NAME} ({org_id})")
        self.api.org_id = org_id
        return org_id

    def clear_existing_project(self) -> None:
        existing = [p for p in self.api.get("/api/studio/projects") if p["name"] == C.PROJECT_NAME]
        if not existing:
            return
        if not self.opts.replace:
            ids = ", ".join(p["id"] for p in existing)
            raise SystemExit(f'A project called "{C.PROJECT_NAME}" already exists in this organisation ({ids}). Pass --replace to remove it first.')
        # Newest version first: a locked source can only be deleted once nothing depends on it.
        for p in sorted(existing, key=lambda x: -x["version_no"]):
            if p.get("locked_at"):
                self.api.post(f"/api/studio/projects/{p['id']}/unlock")
            self.api.patch(f"/api/studio/projects/{p['id']}", {"status": "archived"})
            self.api.delete(f"/api/studio/projects/{p['id']}")
            say(f"  removed existing project version {p['version_no']} ({p['id']})")

    def project(self) -> None:
        created = self.api.post("/api/studio/projects", C.PROJECT)
        self.project_id = created["id"]
        self.api.patch(self.base, C.PROJECT_DETAILS)
        for slug, url in C.ENVIRONMENTS.items():
            self.api.put(f"{self.base}/board/environments/{slug}", {"url": url})
        say(f"Created project {C.PROJECT_NAME} ({self.project_id}) with details and three environments")

    def personas(self) -> None:
        for persona in C.PERSONAS:
            self.api.post(f"{self.base}/personas", persona)
        say(f"  {len(C.PERSONAS)} personas")

    # ── the bundle: use case model, datasets, wireframes, diagrams ───────

    def import_bundle(self, bundle: dict[str, Any]) -> None:
        try:
            result = self.api.post(f"{self.base}/import", bundle)
        except ApiError as exc:
            body = exc.json()
            if exc.status == 422 and isinstance(body, dict) and isinstance(body.get("detail"), dict):
                for err in body["detail"].get("errors", []):
                    say(f"  {err.get('path')}: {err.get('message')}")
            raise
        for w in result["wireframes"]:
            self.wireframes[w["name"]] = w["id"]
        say(
            f"  imported {len(result['wireframes'])} wireframes, {len(result['diagrams'])} diagrams, "
            f"{result['actors']['created']} actors, {result['use_cases']['created']} use cases, {result['datasets']['created']} datasets"
        )
        for warning in result.get("warnings", []):
            say(f"  warning: {warning}")
        self.summary["wireframes"] = {w["name"]: w["id"] for w in result["wireframes"]}
        self.summary["diagrams"] = {d["name"]: d["id"] for d in result["diagrams"]}

    def page_id(self, wireframe: str, page: str) -> str:
        if wireframe not in self.pages:
            detail = self.api.get(f"{self.base}/wireframes/{self.wireframes[wireframe]}")
            self.pages[wireframe] = {p["name"]: p["id"] for p in detail["pages"]}
        return self.pages[wireframe][page]

    def archive_concept(self) -> None:
        wid = self.wireframes[C.ARCHIVED_WIREFRAME]
        self.api.patch(f"{self.base}/wireframes/{wid}", {"status": "archived"})
        say(f'  archived "{C.ARCHIVED_WIREFRAME}"')

    def polish(self) -> None:
        """Element data the editor stores but the bundle validator refuses
        (nav icons, bar alignment), set through the ops endpoint the way the
        Inspector does: one batch per page, one op per component."""
        for wf, page_name, cmp_id, patches in POLISH:
            wid = self.wireframes[wf]
            pid = self.page_id(wf, page_name)
            page = self.api.get(f"{self.base}/wireframes/{wid}/pages/{pid}")
            for components in page["document"]["regions"].values():
                for cmp in components:
                    if cmp.get("id") != cmp_id:
                        continue
                    elements = []
                    for e in cmp.get("elements", []):
                        e = dict(e)
                        patch = patches.get(e.get("label", ""))
                        if patch:
                            e["data"] = {**(e.get("data") or {}), **patch}
                        elements.append(e)
                    self.api.post(
                        f"{self.base}/wireframes/{wid}/ops",
                        {
                            "client_batch_id": uuid.uuid4().hex[:16],
                            "page_id": pid,
                            "base_version": page["version"],
                            "ops": [{"op": "set", "target": {"cmp": cmp_id}, "path": "elements", "value": elements}],
                        },
                    )
        say(f"  {len(POLISH)} nav bars polished (icons and alignment)")

    def annotations(self) -> None:
        count = 0
        for wf, page_name, kind, target_kind, target_id, target_cmp, label, text, resolved in C.ANNOTATIONS:
            wid = self.wireframes[wf]
            payload = {
                "page_id": self.page_id(wf, page_name),
                "kind": kind,
                "target_kind": target_kind,
                "target_id": target_id,
                "target_label": label,
                "text": text,
            }
            if target_cmp:
                payload["target_cmp_id"] = target_cmp
            created = self.api.post(f"{self.base}/wireframes/{wid}/annotations", payload)
            if resolved:
                self.api.patch(f"{self.base}/wireframes/{wid}/annotations/{created['id']}", {"resolved": True})
            count += 1
        say(f"  {count} annotations (notes and tasks)")

    def snapshots(self) -> None:
        for name in C.SNAPSHOT_WIREFRAMES:
            self.api.post(f"{self.base}/wireframes/{self.wireframes[name]}/versions", {"label": C.SNAPSHOT_LABEL})
        say(f"  {len(C.SNAPSHOT_WIREFRAMES)} snapshots saved")

    # ── board ────────────────────────────────────────────────────────────

    def board(self) -> None:
        b = f"{self.base}/board"
        for key, r in C.RELEASES.items():
            created = self.api.post(f"{b}/releases", {"title": r["title"], "description": r["description"]})
            self.ids["release"][key] = created["id"]
            # Status moves by PATCH, not at creation: the route stamps a
            # release's shipped date the first time it LANDS on DeployedToLive,
            # and a release born there would read as overdue on the roadmap.
            if r["status"] != "NotStarted":
                self.api.patch(f"{b}/releases/{created['id']}", {"status": r["status"]})
        for key, e in C.EPICS.items():
            created = self.api.post(f"{b}/epics", {"title": e["title"], "summary": e["summary"], "release_id": self.ids["release"][e["release"]]})
            self.ids["epic"][key] = created["id"]
        for key, (epic, title) in C.FEATURES.items():
            created = self.api.post(f"{b}/features", {"epic_id": self.ids["epic"][epic], "title": title})
            self.ids["feature"][key] = created["id"]
        for key, s in C.SPRINTS.items():
            created = self.api.post(f"{b}/sprints", {
                "name": s["name"], "goal": s["goal"], "start_date": s["start_date"], "end_date": s["end_date"],
                "release_id": self.ids["release"][s["release"]], "capacity_hours": C.SPRINT_CAPACITY_HOURS, "status": s["status"],
            })
            self.ids["sprint"][key] = created["id"]
        # Close finished sprints while they are still empty -- closing returns
        # unfinished work to the backlog, so it must happen before requirements land.
        for key, s in C.SPRINTS.items():
            if s["closed"]:
                self.api.patch(f"{b}/sprints/{self.ids['sprint'][key]}", {"closed": True})
        # One POST per requirement carrying sprint AND status together: a later
        # PATCH into a sprint resets an unfinished status to NotStarted.
        for key, feature, title, status, priority, sprint, hours, body in C.REQUIREMENTS:
            epic_key = C.FEATURES[feature][0] if feature else None
            payload: dict[str, Any] = {
                "title": title, "body": body, "status": status, "priority": priority,
                "feature_id": self.ids["feature"][feature] if feature else None,
                "epic_id": self.ids["epic"][epic_key] if epic_key else None,
                "release_id": self.ids["release"][C.EPICS[epic_key]["release"]] if epic_key else None,
                "sprint_id": self.ids["sprint"][sprint] if sprint else None,
                "estimate_hours": hours,
            }
            created = self.api.post(f"{b}/requirements", payload)
            self.ids["requirement"][key] = created["id"]
        for doc in C.DOCS:
            created = self.api.post(f"{b}/docs", {
                "title": doc["title"], "body": doc["body"], "tags": doc["tags"],
                "epic_id": self.ids["epic"][doc["epic"]] if doc["epic"] else None,
            })
            self.ids["doc"][doc["title"]] = created["id"]
        for kind, key, body in C.COMMENTS:
            self.api.post(f"{b}/comments", {"entity_type": kind, "entity_id": self.ids[kind][key], "body": body})
        say(
            f"  board: {len(C.RELEASES)} releases, {len(C.EPICS)} epics, {len(C.FEATURES)} features, {len(C.SPRINTS)} sprints, "
            f"{len(C.REQUIREMENTS)} requirements, {len(C.DOCS)} docs, {len(C.COMMENTS)} comments"
        )

    def feedback(self) -> None:
        b = f"{self.base}/board"
        created_ids = []
        for env, kind, severity, title, detail, page_url, status in C.FEEDBACK:
            created = self.api.post(f"{b}/feedback", {
                "environment": env, "kind": kind, "severity": severity, "title": title, "detail": detail, "page_url": page_url,
            })
            if status != "New":
                self.api.patch(f"{b}/feedback/{created['id']}", {"status": status})
            created_ids.append(created["id"])
        say(f"  {len(created_ids)} feedback reports")
        if self.opts.skip_documents:
            return
        png = make_png()
        try:
            ticket = self.api.post(f"{b}/attachments", {
                "entity_type": "feedback", "entity_id": created_ids[C.FEEDBACK_SCREENSHOT_INDEX],
                "filename": "check-in-search.png", "content_type": "image/png", "size_bytes": len(png),
            })
            self.api.put_bytes(ticket["upload_url"], png, ticket["headers"])
            self.api.post(f"{b}/attachments/{ticket['attachment_id']}/confirm")
            say("  screenshot attached to the first report")
        except ApiError as exc:
            self.skipped.append(f"feedback screenshot ({exc.status}: {exc.body[:120]})")

    # ── documents ────────────────────────────────────────────────────────

    def documents(self) -> None:
        if self.opts.skip_documents:
            self.skipped.append("documents (--skip-documents)")
            return
        uploaded = 0
        for filename, content_type, purpose, text in C.DOCUMENTS:
            payload = text.encode("utf-8")
            try:
                ticket = self.api.post(f"{self.base}/documents", {
                    "filename": filename, "content_type": content_type, "size_bytes": len(payload), "purpose": purpose,
                })
                self.api.put_bytes(ticket["upload_url"], payload, ticket["headers"])
                self.api.post(f"{self.base}/documents/{ticket['document']['id']}/confirm")
                uploaded += 1
            except ApiError as exc:
                self.skipped.append(f"document {filename} ({exc.status}: {exc.body[:120]})")
                if exc.status == 503:
                    self.skipped.append("remaining documents: storage is not configured on this environment")
                    break
        say(f"  {uploaded} documents and example data files uploaded")

    def board_token(self) -> None:
        issued = self.api.post(f"{self.base}/board/tokens", {"label": C.BOARD_TOKEN_LABEL})
        # Shown once by the API and never again; the seed does not print it.
        self.summary["board_token_label"] = issued["label"]
        say(f'  board token "{C.BOARD_TOKEN_LABEL}" minted')

    def version(self) -> None:
        if self.opts.no_version:
            return
        self.api.patch(self.base, {"version_label": C.VERSION_LABEL_SOURCE})
        copy = self.api.post(f"{self.base}/versions", {
            "key": f"seed-{uuid.uuid4().hex[:12]}", "label": C.VERSION_LABEL_COPY, "lock_source": True,
        })
        self.summary["version_1"] = self.project_id
        self.summary["version_2"] = copy["id"]
        say(f'  version 1 "{C.VERSION_LABEL_SOURCE}" locked; version 2 "{C.VERSION_LABEL_COPY}" created ({copy["id"]})')
        # Everything from here on lands on the new version. The copy minted
        # fresh wireframe and page ids (component and element ids inside the
        # documents survive), so the name lookups are rebuilt.
        self.project_id = copy["id"]
        self.wireframes = {w["name"]: w["id"] for w in self.api.get(f"{self.base}/wireframes")}
        self.pages = {}

    # ── run ──────────────────────────────────────────────────────────────

    def run(self, bundle: dict[str, Any]) -> None:
        me = self.identify()
        org_id = self.organisation(me)
        self.clear_existing_project()
        self.project()
        self.personas()
        self.import_bundle(bundle)
        self.archive_concept()
        self.polish()
        self.documents()
        # Version before the review: the copy carries pages, annotations and
        # documents but not snapshots or the audit log, and the story is that
        # version 1 is the discovery sign-off and version 2 the reviewed build.
        self.version()
        self.annotations()
        self.snapshots()
        self.board()
        self.feedback()
        self.board_token()

        web = self.opts.web_url or self.api.base
        say("")
        say("Done.")
        say(f"  Organisation: {C.ORG_NAME}  {org_id}")
        say(f"  Project:      {C.PROJECT_NAME}  {self.project_id}")
        say(f"  Open:         {web}/orgs/{org_id}/projects/{self.project_id}/details")
        if self.skipped:
            say("  Skipped:")
            for s in self.skipped:
                say(f"    - {s}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=os.environ.get("STUDIO_URL", DEFAULT_URL), help=f"API origin (default {DEFAULT_URL}, or STUDIO_URL)")
    ap.add_argument("--token", default=os.environ.get("STUDIO_TOKEN", ""), help="Cognito access token (or STUDIO_TOKEN); unused by the local verify server")
    ap.add_argument("--web-url", default=os.environ.get("STUDIO_WEB_URL", ""), help="Origin to print the project link with, when it differs from --url")
    ap.add_argument("--org-id", default="", help="Seed into this existing organisation instead of creating one")
    ap.add_argument("--replace", action="store_true", help="Archive and delete an existing project of the same name first")
    ap.add_argument("--no-version", action="store_true", help="Do not create the second project version")
    ap.add_argument("--skip-documents", action="store_true", help="Skip file uploads (documents, example data, screenshot)")
    ap.add_argument("--validate-only", action="store_true", help="Build and validate the bundle, then stop")
    ap.add_argument("--dump", default="", help="Also write the bundle JSON to this path")
    ap.add_argument("-v", "--verbose", action="store_true", help="Print every request")
    opts = ap.parse_args()

    bundle = build_bundle()
    say(f"Bundle: {bundle_counts(bundle)}")
    if opts.dump:
        Path(opts.dump).write_text(json.dumps(bundle, indent=2), encoding="utf-8")
        say(f"  written to {opts.dump}")
    errors = validate_locally(bundle)
    if errors:
        say(f"Bundle has {len(errors)} validation error(s):")
        for err in errors:
            say(f"  {err['path']}: {err['message']}")
        return 1
    if errors is not None:
        say("  bundle validates cleanly")
    if opts.validate_only:
        return 0

    api = Client(opts.url, opts.token or None, verbose=opts.verbose)
    try:
        Seeder(api, opts).run(bundle)
    except ApiError as exc:
        say(f"\nERROR: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
