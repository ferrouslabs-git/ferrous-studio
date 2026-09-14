# Reverse-engineering a repository into the Studio — plan

Written 2026-09-08. How an existing codebase (FinAI's software management
app, Growth Gorilla, later a client's) becomes wireframes, a data-model
diagram and an architecture diagram inside a Studio project, without anyone
drawing them by hand.

Status: **proposal.** Nothing here is built. The GitHub connection this
builds on is its own plan (`docs/github-repository.md`) and is out of scope;
this plan only reads what that one stores.

```
1. Catalogue mirror + validator → 2. Import endpoint → 3. Import UI
   → 4. Skill → 5. Run on FinAI → 6. Run on Growth Gorilla → (later) 7. In-product run
```

## The recommendation

Split the feature along the line between what needs judgement and what
needs to be deterministic:

| Half | Where it lives | Why |
|---|---|---|
| **Reading the codebase and deciding what the pages, components, entities and services are** | A **Claude Code skill** run against a local clone, producing a JSON bundle | This is open-ended agentic work over a filesystem. Claude Code already is the harness for that: full tool loop, a human watching, no per-organisation API key, no hosted runner. Building a second such harness inside the product for two repositories is the unreliable path, not the reliable one |
| **Turning that bundle into wireframes, diagrams and use cases in a project** | A **real product feature**: a validated import endpoint, an Import action on the project, provenance in the audit log | The bundle format is the contract. It is exact, testable and reusable: the same importer serves a pasted export, a wireframe moved between environments, and, later, an agent running in ECS |

So: **the analysis is a one-off per repository, run through a reusable
skill; the import is a permanent feature.** When the agent runner from
`go-live-and-merge-boards.md` phase 5 and the per-organisation Anthropic
key from `live-session.md` phase 0 exist, the in-product "Reverse-engineer
from repository" button is the skill's prompt running in that runner and
posting to this importer (§ Phase 7). Nothing built here is thrown away
when that happens, and nothing here waits for it.

Why not the in-product route first:

- **Reliability is the stated goal.** The output quality of reverse
  engineering depends on iterating: look at a route, look at the component,
  check the mapping, adjust. A hosted job gives one shot with no eyes on it,
  and every failure mode (partial results, a hallucinated component type, a
  60-minute run) needs product handling. A skill run gives the same model the
  same rules with a reviewer in the loop, and the validator catches the rest.
- **The infrastructure it needs does not exist yet.** Per-organisation
  Anthropic credentials, a job runner, a way to get a repository's contents
  into a container (the GitHub App has *Contents: read*, so a tarball fetch
  is available, but nothing consumes it). All three are already planned
  elsewhere; this plan should not build them a second time.
- **Two repositories.** FinAI and Growth Gorilla are the whole known
  workload. A skill that takes an afternoon per repository is cheaper than a
  feature that takes a fortnight and then runs twice.

## Decisions this plan makes

| Decision | Choice | Why |
|---|---|---|
| Unit of exchange | A **project import bundle**: the inverse of `GET /projects/{id}/export`, with a `source` block for provenance | `export_page` / `import_page` are already tested inverses; the wireframe envelope already exists. Making the bundle the export's mirror means Export → Import round-trips, which is the test |
| Page ids in a bundle | **Any string**, reminted to UUIDs on import via `remap_page_ids` | The generator can write `page-users-list`; readable ids make the bundle reviewable and the mapping report legible. The copy route already remints |
| Vocabulary enforcement | **Reject** unknown component, element, shape, layout and data-kind values with every error listed | The catalogue is the contract between design and engineering; an importer that lets `hero` back in undoes the retirement in `e1c4a7f2b930`. Listing every error at once is what makes the generator converge |
| Where the catalogue lives for the backend | `backend/app/studio/catalog.json`, **emitted from `catalog.ts`** and pinned by a test | The catalogue is TypeScript and must stay so (it drives the canvas). A generated mirror with a drift test is the same pattern as `DataKind` in `schemas.py`, made mechanical |
| Diagram positions | The bundle carries **x/y/w/h per node**; the importer fills gaps with a simple grid; the editor materialises cells from `model` when `xml` is empty | `DiagramModel` nodes already have geometry. No layout engine is needed for v1, and the "empty xml, non-empty model" signal needs no migration. The live-session plan's `HierarchicalLayout` renderer extends the same `applyModel.ts` later |
| Use cases | Imported as **rows** (actors + use cases by name); the use-case diagram is the existing tab's rendering | The Studio already draws that diagram from the rows |
| Personas | **Not generated.** The bundle may name existing personas; it does not create them | Personas are product decisions, not something in the code |
| Provenance | `source: {repo_full_name, commit_sha, generated_at, generator}` recorded via `record_event("imported")` on each wireframe and at project level | Someone opening the wireframe later must be able to see it was derived, from which commit |
| Repository mismatch | If the project is linked to a repository and `source.repo_full_name` differs, **warn in the result, do not reject** | The link is filing; a bundle from a fork or a mirror is still useful |
| Locked versions | Import refuses with **423** through `get_writable_project` | Import is content, exactly like restore |
| Permission | `data:write` | Same as creating a wireframe by hand |
| Who runs the skill | Elliott, locally, on a Claude Code subscription | No API cost, no credential storage, no runner |

---

# What already exists

Read this before touching anything.

### Backend

| Piece | File | Notes |
|---|---|---|
| Page export/import | `backend/app/studio/ops.py` `export_page` / `import_page` | Tested inverses. Import assigns fresh `pos` keys from array order |
| Id remapping | `ops.py` `remap_page_ids`, `remap_dataset_ids` | Rewrites links, placements and dataset bindings; strips links to pages outside the mapping |
| Wireframe envelope | `wireframes.py` `assemble_wireframe_export` | `schemaVersion, projectId, projectName, wireframeId, wireframeName, interfaceType, landingPageId, personas, userTypes, customComponents, datasets, pages` |
| Project envelope | `projects.py` `export_project` | Adds `description, rationale, personas, diagrams[{id,name,kind,model}], wireframes[]` |
| Whole-wireframe creation from pages | `wireframes.py` `copy_version_to_wireframe` | The closest thing to an importer: remints ids, `import_page`, `_set_actors` via `_live_ids`, landing remap, `record_event`. The importer generalises this from "a snapshot" to "a bundle" |
| Snapshots | `wireframes.py` `_snapshot(db, project, wireframe, reason, user_id, label)` | An `imported` snapshot is the restore point |
| Audit | `audit.py` `record_event` | `wireframe=None` writes a project-level event; the wireframe log is the only reader today |
| Diagrams | `diagrams.py`, `ProjectDiagram(xml, model, version)` | `create_diagram` stores `xml=""`, `model={"nodes":[],"edges":[]}` |
| GitHub | `github_client.py` `latest_commit`, `get_repository_by_id`; `Project.repo_id/repo_full_name` | Enough for the mismatch warning and, later, a tarball fetch (`Contents: read` is granted) |
| Lock | `get_writable_project` → 423 | |

### Frontend

| Piece | File |
|---|---|
| Catalogue | `features/studio/catalog.ts`: `COMPONENTS` (navbar, list, form, graph, canvas, calendar), shapes, layouts, element metas with `dataFields`/`max`, `DATA_KINDS`, `RETIRED_TYPES`, `PATTERNS` |
| Document types | `features/studio/model/types.ts`: `PageDocument`, `RegionNode`, `SplitNode`, `ComponentNode`, `ElementNode`, `LinkTarget`, `PagePlacement`, `PagePresentation` |
| Diagram model | `features/project/diagrams/diagramsApi.ts` `DiagramModel`; nodes carry `id, type, label, x, y, w, h, stereotype?, text?, parentId?`; edges `id, type, label, source, target` |
| Diagram vocabulary | `features/diagrams/graph/umlTypes.ts` `UmlNodeType` (actor, usecase, class, entity, rect, cylinder, cloud, hexagon, …), `UmlEdgeType`; `userObject.ts` `createUserObject(type, attrs)` |
| Diagram load | `DiagramEditorPage.tsx` line 52: `if (data.xml) importXml(...)` — an empty `xml` renders an empty graph today |
| Wireframes list | `features/project/wireframes/WireframesPage.tsx` already has Export (`getWireframeExport`) and no Import |
| Shared list chrome | `ListToolbar`, `ConfirmationDrawer`, `Drawer` (`shared-list-system`) |

### Tooling

- Project skills live in `.claude/skills/<name>/` (`run-local` is the model:
  `SKILL.md` plus helper scripts).
- Backend tests are pure-function tests over `ops.py` and friends
  (`tests/test_ops.py`, `tests/test_page_copy.py`); no database fixture.
- Vitest runs the frontend tests; `vite-node` ships with it and can run a
  TypeScript script.

---

# The bundle

The inverse of `GET /projects/{id}/export`, minus the ids the server owns.
Every section is optional; an empty bundle is a 422.

```json
{
  "schemaVersion": "1.0",
  "source": {
    "repo_full_name": "Fnai-sma/software-management-app",
    "commit_sha": "9f3c…",
    "generated_at": "2026-09-09T10:12:00Z",
    "generator": "reverse-engineer-repo skill v1"
  },
  "actors":   [{ "name": "Administrator", "description": "…" }],
  "useCases": [{ "name": "Approve a change request", "description": "…", "actors": ["Administrator"] }],
  "datasets": [{ "id": "ds-status", "name": "Request status", "values": ["Draft", "Submitted", "Approved"] }],
  "wireframes": [{
    "name": "Management app",
    "interfaceType": "desktop",
    "landingPageId": "page-dashboard",
    "userTypes": ["Administrator", "Engineer"],
    "personas": [],
    "pages": [ …export_page shape, ids any string… ]
  }],
  "diagrams": [{
    "name": "Data model",
    "kind": "class",
    "model": { "nodes": [ { "id": "n-project", "type": "entity", "label": "Project",
                            "text": "id\nname\nstatus", "x": 40, "y": 40, "w": 180, "h": 120 } ],
               "edges": [ { "id": "e1", "type": "association", "label": "1..*",
                            "source": "n-project", "target": "n-requirement" } ] }
  }]
}
```

Differences from the export, all deliberate:

- `userTypes` and `useCases[].actors` are **names**, resolved against the
  project's actors (case-folded) and created when missing. The export carries
  ids because it describes rows; a bundle describes intent.
- `personas` are names too, and only ever resolve to existing rows.
- `datasets[].id` is bundle-local; `data.dataset` on a column, dropdown or
  filter refers to it, or to an existing project/platform dataset id.
  Datasets are created by name when no project dataset has that name, then
  `remap_dataset_ids` rewrites the pages.
- `diagrams[].model` nodes may omit `x/y/w/h`; the importer's `grid_layout`
  fills them (default size per node type, nodes in columns by type order:
  actors and external systems left, then the rest in rows of six).
- `customComponents` is accepted and ignored in v1 (no generator emits them).

A bare wireframe export envelope (`schemaVersion` + `pages` at the top
level) is accepted too and wrapped as `{"wireframes": [it]}`, so Export →
Import round-trips a single wireframe.

### Validation

`backend/app/studio/importing.py::validate_bundle(bundle, catalog) ->
list[BundleError]` is pure and returns **every** error as `{path, message}`,
e.g. `wireframes[0].pages[3].layout.children[1].components[0].type: unknown
component type "hero" (retired)`. A 422 carries the whole list.

| Check | Rule |
|---|---|
| Pages | 1–200 per wireframe; ids unique within the wireframe; `name` non-empty; `route` string or absent |
| Layout tree | `split` has ≥ 2 children and `dir` in row/col; `size` is `"auto"`, an int > 0, or `{fr: > 0}`; region ids unique within the page; region `dir` in row/col/free |
| Components | `type` in the catalogue and not retired; `shape` in that component's shapes and `layout` in its layouts when present; `props.links[].pageId` resolves to a page in this wireframe or `@back`; `props.size` in the known values |
| Elements | `type` in the host component's element list; `max` respected; `data` keys ⊆ the element's `dataFields` keys (plus `shape`/`fill` where `shapeable`/`fillable`, `x`/`y` in a canvas); `data.kind` in `DATA_KINDS` for a column, in the input kinds for a text input; `data.dataset` resolves |
| Placement | `placement.page_id` is a page in the same wireframe, `region_id` a region in that page's tree; no cycles; the target is not itself an overlay |
| Presentation | in `PRESENTATIONS` |
| Wireframe | `interfaceType` in `InterfaceType`; `landingPageId` is a page id |
| Diagrams | `kind` in `DiagramKind`; node `type` in `UmlNodeType`, edge `type` in `UmlEdgeType`; edge endpoints and `parentId` resolve; `w/h > 0` when given |
| Use cases | every actor name appears in `actors` or the project |
| Size | request body ≤ 4 MB |

The same function is what the skill runs locally before anyone uploads
anything (§ Phase 4), so a bundle that reaches the server is one the
generator has already been told is clean.

---

# Phase 1 — Catalogue mirror and validator

### 1.1 Emit the catalogue

`frontend/app/web/scripts/emit-catalog.ts`, run as `npm run catalog:emit`
(`vite-node scripts/emit-catalog.ts`), writes
`backend/app/studio/catalog.json`:

```json
{
  "dataKinds": ["text", "number", …],
  "inputKinds": ["text", "email", "number", "password", "phone", "url"],
  "presentations": ["modal", "drawer", "drawer-left"],
  "retired": ["hero", "detail", "empty", "main", "modal", "footer"],
  "components": {
    "navbar": { "shapes": ["plain","tabs","icons","breadcrumb","grouped"],
                "layouts": ["horizontal","vertical"],
                "elements": { "brand": { "fields": ["logo"], "max": 1, "shapeable": false, "fillable": false }, … } },
    …
  }
}
```

Only what the validator needs: no labels, descriptions or seeds. A vitest
test (`catalog.mirror.test.ts`) derives the same object from `catalog.ts`
and deep-equals it with the JSON, so editing the catalogue without
re-emitting fails the frontend tests. `backend/app/studio/catalog.py` loads
it once (`lru_cache`) and exposes typed accessors.

### 1.2 Validator

`importing.py::validate_bundle` as specified above, plus `grid_layout(model)`
and `wrap_bare_envelope(body)`. Pure; no database.

### 1.3 Tests

`tests/test_bundle_validation.py`:

- a minimal valid bundle passes with no errors;
- every rule in the table has one failing fixture and the error path is
  asserted, not just the count;
- **round-trip:** an `export_page` of a stored document, wrapped as a
  bundle, validates clean (this is the test that keeps the importer honest
  against what the Studio itself produces);
- a retired type is rejected with the word "retired" in the message.

Size: about a day.

---

# Phase 2 — Import endpoint

### 2.1 Route

```
POST /studio/projects/{project_id}/import          data:write, 423 on a locked version
  body: bundle (or a bare wireframe envelope)
  200: { "wireframes": [{id, name, pages}], "diagrams": [{id, name}],
         "actors": {created, matched}, "use_cases": {created, matched},
         "datasets": {created, matched}, "warnings": [ "…" ] }
  422: { "errors": [{path, message}] }
```

In `backend/app/studio/importing.py` (router mounted from `router.py` beside
the others). One transaction: any failure rolls the whole bundle back, so
half an import never lands.

### 2.2 Order of operations

1. `validate_bundle`; 422 on any error.
2. **Actors**: case-folded name match against the project's `UseCaseActor`
   rows; create the rest (`pos` via `next_pos`).
3. **Use cases**: match by name, create the rest with `actor_ids` resolved.
   A matched use case is left untouched (no overwrite of hand-edited
   descriptions).
4. **Datasets**: match by name against project datasets, create the rest;
   build the bundle-id → row-id mapping.
5. **Wireframes**, each: create the `Wireframe` (`interface_type`, `pos`,
   `created_by`), `_set_actors` from the resolved names, personas from
   matched names only; `mapping = {bundle page id: uuid4()}`;
   `remap_page_ids` then `remap_dataset_ids`; `import_page` per page and
   insert `ProjectPage` rows exactly as `copy_version_to_wireframe` does;
   landing page through the mapping; `_snapshot(reason="imported")`;
   `record_event(event="imported", detail=source + counts)`.
6. **Diagrams**: `grid_layout` for nodes without geometry; insert
   `ProjectDiagram(xml="", model=model, version=0)`.
7. `record_event(project=…, wireframe=None, event="bundle_imported",
   detail={source, counts})`; `project.updated_at = utc_now()`; commit.

Refactor the page-insertion loop out of `copy_version_to_wireframe` into a
helper both routes call (`insert_pages(db, project, wireframe, pages_data,
mapping)`), rather than copying it a third time.

### 2.3 Warnings, not errors

- Linked repository differs from `source.repo_full_name`.
- A persona name that matched nothing (dropped).
- A diagram node that had no geometry (placed by the grid).

### 2.4 Diagrams from a model

`features/diagrams/graph/applyModel.ts::buildFromModel(graph, model)`:
for each node, `createUserObject(type, {label, stereotype, text})` and
`graph.insertVertex` at the model's geometry, parents first (`parentId`);
for each edge, `insertEdge` with the edge type's style from `umlStyles.ts`.
In `DiagramEditorPage`, when `data.xml` is empty and `data.model.nodes` is
non-empty: build, then save immediately through the existing `PUT` (version
0 → 1), so the XML exists from the first open and every later open is the
ordinary path. This is the seed of the live-session plan's renderer; that
plan adds diffing and `HierarchicalLayout` on top.

### 2.5 Tests

`tests/test_bundle_import.py` as pure tests over the helpers
(`resolve_by_name`, `grid_layout`, the page mapping) in the style of
`test_page_copy.py`; `tests/test_lock_coverage.py` gains the import route in
the locked set; `tests/test_role_permissions.py` sweeps it under
`PROJECT_ROUTES`. Frontend: `applyModel.test.ts` builds a two-node model and
asserts `deriveModel(plainCellsOf(graph))` returns it (geometry and all).

Size: one to two days.

---

# Phase 3 — Import UI

- **Project details** gains an "Import…" action beside Export; the
  **wireframes list** `ListToolbar` gains the same action (it is the page
  someone looks at when they want a wireframe to appear).
- `features/project/ImportBundleDrawer.tsx`: a file input (`.json`), a
  read-only summary once parsed (n wireframes, n pages, n diagrams, n
  actors, n use cases, source repository and commit when present), Import.
  On 422, the error list rendered as rows (`path` in monospace, message
  beside it). On 200, the counts and warnings, and a link to the first
  imported wireframe.
- Copy states facts and stops, per CLAUDE.md: "3 wireframes, 41 pages"; "The
  bundle was generated from acme/app at 9f3c1a2, which is not this project's
  linked repository."
- `features/project/importApi.ts` with `importBundle(projectId, body)`.

Size: half a day to a day.

---

# Phase 4 — The skill

`.claude/skills/reverse-engineer-repo/`:

```
SKILL.md                 the procedure
references/
  bundle.md              the format (§ The bundle) with a complete small example
  catalogue.md           the six components, their shapes, layouts and elements, with what each is FOR
  mapping-rules.md       code → Studio rules, per framework (below)
  diagrams.md            which diagrams to produce and the node/edge vocabulary
scripts/
  validate.py            runs validate_bundle from the backend venv against a file; prints every error
  merge.py               merges pages/*.json + diagrams/*.json + actors.json into one bundle
```

### 4.1 Procedure (SKILL.md)

1. **Pin the source.** Work on a local clone at a named commit; write
   `source.commit_sha` from `git rev-parse HEAD`. Never analyse a dirty tree.
2. **Inventory pass** (read only, no output yet): framework and router;
   the layout shell(s); the list of routes with the component each renders;
   auth roles; ORM models; deployment description (Dockerfiles, compose,
   Terraform, env var names). Write `inventory.md`: one table of routes,
   one of entities, one of services. This is the document a reviewer checks
   first, and it is what the mapping pass works from, so a mistake is caught
   before it becomes forty pages.
3. **Mapping pass, one page per file.** For each route, write
   `out/pages/<slug>.json` in `export_page` shape. Small files mean one bad
   page does not corrupt the rest and a reviewer can diff one page.
4. **Shell and links.** Write the shell page(s) last, because their nav
   items link to everything else. Check every link resolves.
5. **Diagrams and use cases.** `out/diagrams/*.json`, `out/actors.json`,
   `out/use-cases.json`.
6. `merge.py` → `out/<repo>.bundle.json`; `validate.py` on it; fix and
   repeat until clean.
7. Write `out/REPORT.md`: each route → page, what was approximated, what was
   skipped and why. This goes to whoever reviews the imported wireframe.
8. Hand over. Import happens through the UI (Phase 3) by a signed-in user.
   The skill never needs a token.

### 4.2 Mapping rules (references/mapping-rules.md)

The Studio's model was built from the same ideas as a web app's routing, so
most of the mapping is direct.

| In the code | In the Studio |
|---|---|
| A route (`<Route path>`, Next `app/**/page.tsx`, Django `urls.py`, Rails `routes.rb`) | A **page** with `route` set to the path; name from the route's title, heading or component name |
| The layout shell (`<Outlet>`, Next `layout.tsx`, a base template with `{% block content %}`) | A **shell page** whose tree splits into a nav region (fixed width for a side rail, `auto` for a top bar), an optional header region, and a `{fr: 1}` content region. Regions are labelled the way the Studio names them: `Nav`, `Header`, `Content` |
| A nested route rendered inside the shell | A **child page** with `placement: {page_id: shell, region_id: content}` |
| A nested layout inside a nested route | A child page that is itself a shell for its children (the outlet model nests) |
| Sidebar / top nav links | A `navbar` component (`layout: vertical` for a rail) of `nav-item` elements, each with `props.links: [{pageId}]`; `brand` from the logo; `avatar` when there is a user menu; `shape: grouped` when items sit under headings |
| A table (`<table>`, a data grid, TanStack, MUI DataGrid) | `list` with `shape: table`; a `column` per column definition, `label` from the header, `data.kind` from the accessor's type (date → `date`, enum → `status` with the enum's values as `samples`, money → `currency`, a user → `person`, an actions cell → `actions`); `row-action` per row button; `search`, `filter` and `pagination` when present |
| A card grid | `list` with `shape: cards`, `layout: grid` |
| A feed / activity list | `list` with `shape: feed` |
| A form (`<form>`, react-hook-form, Formik, a Django `Form`) | `form`; `text-input` per input with `data.kind` from the input type, `select` with `data.options` from the enum, `checkbox`, `toggle`, `text-area`, `date-picker`, `file-upload`; `section-heading` per fieldset (`shape: sections`); `step` per wizard step (`shape: wizard`); the submit and cancel `button`s last, with `@back` on cancel |
| A chart (Recharts, Chart.js, ECharts) | `graph` with `shape` from the chart type; a `series` per series, `category-axis` / `value-axis` from the axis config |
| KPI tiles | `graph` with `shape: stats` and a `stat` per tile |
| A calendar or scheduler | `calendar` with the matching shape |
| A modal or drawer that is its own view (a form in a dialog, a detail drawer) | Its own page with `presentation: modal` or `drawer`, linked from the trigger |
| Anything else (a hero, prose, a detail panel of labelled values, a dashboard section) | `canvas` with `heading`, `text`, `label`, `badge`, `image`, `box` and `button` elements; a labelled-values detail becomes `label` + `text` pairs |
| An enum used across several screens | A `dataset`, bound via `data.dataset` on every column, dropdown and filter that uses it |
| Auth roles | An **actor** each |
| A route × role that does something | A **use case**, named as a verb phrase, linked to the roles that may do it |
| Mobile-first layout, a React Native or Ionic app | `interfaceType: mobile`; otherwise `desktop` |

Rules the skill is told explicitly:

- **Only the six components exist.** There is no hero, footer, modal or
  detail component; those are `canvas`, a `navbar`, a page presentation, and
  a `canvas` respectively. The validator says "retired" for a reason.
- **Prefer fewer, correct pages.** A route that is a redirect, a 404 page or
  an auth callback is not a page. Sign-in pages are one page.
- **Sample data is representative, not real.** Never copy values from
  fixtures, seeds or tests that look like real people; invent plausible
  samples.
- **Do not guess what cannot be seen.** A component behind a feature flag or
  a dynamic import that cannot be resolved is noted in `REPORT.md`, not
  invented.

### 4.3 Diagrams (references/diagrams.md)

Three, all deterministic enough to trust:

| Diagram | Kind | From | Nodes / edges |
|---|---|---|---|
| **Data model** | `class` | ORM models (SQLAlchemy, Prisma, Django, ActiveRecord), or migrations when there is no ORM | `entity` per table with `text` listing the columns; `association` per foreign key labelled with cardinality; `parentId` unused |
| **Containers** | `freeform` | Dockerfiles, compose, Terraform, the task definition, env var names | `rect` per deployable (SPA, API, worker), `cylinder` per database or bucket, `hexagon` per queue, `cloud` per external SaaS (Cognito, Stripe, SES); `dependency` edges labelled with the protocol |
| **System context** | `freeform` | The actors plus the containers diagram collapsed to one box | `actor` per role, one `rect` for the system, `cloud` per external system; `association` edges |

Positions: the skill lays nodes out in a simple grid itself (columns by
kind, 240 px pitch) so the result is readable on first open; the importer's
grid is a fallback for nodes it forgot.

Sequence, activity and state diagrams are not generated: inferring them
from code is where reverse engineering stops being reliable, and they are
the ones a human draws in ten minutes once the data model is on screen.

Size: about a day to write; it is prose plus two thirty-line scripts.

---

# Phase 5 — Run on FinAI

The software management app (`Fnai-sma/software-management-app`,
`origin/sma/v0`) is the first target because the board module was ported
from it: the reviewer already knows what every screen does, so a wrong
mapping is obvious.

1. Clone at a pinned commit; run the skill; review `inventory.md` before
   the mapping pass begins.
2. Import into a fresh project (locally first, via `run-local`).
3. Walk every page in the Studio against the running app. Log each
   discrepancy against a mapping rule, not against the page: the fix goes
   into `mapping-rules.md` so the next repository benefits.
4. Re-run from scratch once the rules are updated, to prove the rules and
   not the hand-fixes carry the result.

What "good" looks like, to be judged rather than measured: every real
screen is a page; the shell is one shell page and the nav links resolve;
tables have the right columns with the right kinds; forms have the right
fields; the data model diagram matches the migrations; nothing had to be
deleted because it was invented.

Size: one to two days, most of it review.

# Phase 6 — Run on Growth Gorilla

Same procedure. This is the run that shows whether the rules generalise: a
different codebase, probably a different framework. Expect to add a
framework recipe to `mapping-rules.md`. Half a day to a day.

---

# Phase 7 — Later: the in-product run

Out of scope, listed so nothing above forecloses it. When it happens it is
a wrapper, not a rewrite:

| Needs | Comes from |
|---|---|
| Per-organisation Anthropic key | `live-session.md` phase 0 (`account_credentials`, KMS) |
| A place to run an agent | `go-live-and-merge-boards.md` phase 5 (one-shot Fargate task, `agents` table) |
| The repository's contents | `GET /repos/{owner}/{repo}/tarball/{ref}` with the installation token; `Contents: read` is already granted |
| The prompt | `SKILL.md` and `references/`, packaged into the runner image |
| The result | The bundle written to S3 as a `ProjectDocument`, then **the same importer** on the user's confirmation in **the same drawer** (Phase 3), which then reads from the document instead of a file input |
| The button | "Reverse-engineer from repository" on the project's Repository section, enabled when the project is linked and the organisation has a key; `data:write` |

The bundle format, the validator, the importer and the mapping rules are
the reusable parts and are all built by Phase 4. The only new product
surface is the button and a job-status readout.

---

# Verify

Backend, from the repo root with the `.venv312` interpreter:

```
.venv312\Scripts\python -m pytest backend/tests/test_bundle_validation.py backend/tests/test_bundle_import.py backend/tests/test_lock_coverage.py backend/tests/test_role_permissions.py backend/tests/test_page_copy.py
```

Frontend, from `frontend/app/web`:

```
npm run catalog:emit && git diff --exit-code ../../../backend/app/studio/catalog.json && npm test
```

In the browser, via the `run-local` skill:

1. Export an existing wireframe (Wireframes › Export), import the file into
   a second project: same pages, same links, same placements, landing page
   preserved, an `imported` snapshot and an `imported` audit row present.
2. Import a bundle with a `hero` component: 422, the error names the path
   and says "retired"; nothing was created.
3. Import a bundle with a diagram whose nodes have no geometry: the diagram
   opens laid out on a grid and, after the first open, has a version of 1.
4. Import a bundle whose `source.repo_full_name` differs from the linked
   repository: the import succeeds and the drawer shows the warning.
5. Lock the version, import: 423, and the drawer says so.
6. As a member: no Import action; `POST /import` → 403.
7. Phase 5's FinAI bundle imports clean and every page opens in the Studio
   and in preview mode with working nav.

---

# Risks

- **Mapping quality on unfamiliar frameworks.** Mitigated by the inventory
  pass being reviewed before mapping, and by keeping fixes in the rules file
  rather than in the output.
- **Catalogue drift.** The mirror test fails the frontend suite the moment
  `catalog.ts` changes without a re-emit; the cost is one npm script run.
- **Large bundles.** Two hundred pages is the cap; FinAI is far under it.
  The importer inserts in one transaction, which is the same shape as
  restore and copy.
- **Diagram fidelity.** A grid is not a layout; it is readable, and the
  editor is where someone drags things. `HierarchicalLayout` arrives with
  the live-session work.
- **The skill is only as repeatable as its rules.** Two runs of the same
  repository will differ in wording and in canvas choices. That is
  acceptable for a one-off; if runs ever need to be reproducible, the
  in-product phase adds a pinned model and effort level.

# Not in this plan

- Connecting or linking a repository (`docs/github-repository.md`).
- Any hosted agent, job queue or per-organisation credential (Phase 7's
  dependencies, owned elsewhere).
- Generating personas, sequence, activity or state diagrams.
- Custom components in bundles.
- A project-level audit page (the `bundle_imported` row is written but,
  like `version_created`, has no listing yet; see the note at the end of
  `docs/github-repository.md`).
- Updating an already-imported wireframe from a newer commit. A second
  import creates a second wireframe; diffing against the first is a
  separate design.
