# High-fidelity design

Plan of record for the project section "High fidelity design". Status: built on
branch `high-fidelity-design`. The first design (Easy Sales AI, "Easy Sales
Design V1") was generated on production on 2026-11-16, which settled spikes 1
and 3. The move from built revisions to framing the published site
(migration `c7e3a9d1f528`) is **not deployed yet**.

## 1. What it is

One, several or all of a project's wireframes plus an aesthetics brief go to
Figma Make as **one** prototype; the result is shown inside Studio.

Studio authors exactly one thing: **the brief** (which wireframes, a name, the
aesthetics text, reference images). It never edits a design and keeps no copy
of it. Changes to a design are made in Figma Make (or in Claude Code via the
skill), and Studio frames the site published from the Make file. **The Figma
Make file is the single source of truth.** The prototype's source is kept in
this repository under `designs/<design-slug>/`, for coding agents to read.

## 2. Constraints that shaped it

- Figma Make and Claude Design have no API a backend can call. Figma's MCP
  write tool `send_code_to_figma` imports a local project ("in a Figma Make
  file, the project becomes the file's code") and only works from allow-listed
  MCP clients such as Claude Code.
- Unpublished Make files cannot be framed; **published sites can**: a
  `https://<name>.figma.site` site sends no `X-Frame-Options` and no CSP
  `frame-ancestors` (checked 2026-11-16).
- A Claude subscription cannot power a server-side feature (see
  `docs/live-session.md` section 2.1) but does power Claude Code on the user's
  own machine.

So the generator is not Studio's backend. It is a **Claude Code skill**
(`.claude/skills/studio-design/`) running on the user's machine with their
Claude subscription and their Figma licence. Studio's backend makes **no LLM
call and has no queue or worker** for this feature.

## 3. Flow

```
Studio (brief) ──board MCP──► Claude Code skill ──Figma MCP──► Figma Make file
      ▲                              │                         (source of truth)
      │                              │ reads the code back            │ Publish
      │                              ▼                                ▼
      │                   designs/<slug>/ in this repo       <name>.figma.site
      └──────────────────── framed on the design page ◄───────────────┘
```

1. A person with `data:write` creates a design in Studio: all wireframes or a
   chosen set (one or more), name, brief text, reference images.
2. In Claude Code, `/studio-design generate <design>` reads the brief over the
   board MCP, builds a prototype from the skill's template in
   `designs/<slug>/`, checks it, hands it over to a new Figma Make file,
   records the Make URL on the design, and then mirrors what Make holds back
   into the folder.
3. A person **publishes** the file in Make and the site address is recorded on
   the design (`published_url`). The design page frames it from then on.
4. The design is changed in Figma Make (or, subject to spike 2, through the
   skill's `edit`) and republished. The design page's **Sync** button reloads
   the site, with a cache-buster, so the latest publish is on show.
5. `/studio-design sync [design]` pulls Make's current code into
   `designs/<slug>/`, so coding agents read what the design really is. Nothing
   is built or uploaded to Studio.

## 4. Why a sandboxed frame of the published site

The site runs on `figma.site`, another origin, so the browser already keeps it
away from Studio's DOM, storage, cookies and API. Studio's CSP
(`backend/app/auth/security/security_headers_middleware.py`) lets a frame load
from `https://*.figma.site` and nowhere else; the documents bucket, which
earlier served built revisions, is no longer in `frame-src`.

The frame is `<iframe sandbox="allow-scripts allow-forms allow-same-origin">`.
`allow-same-origin` gives the site its **own** origin (it needs its own
storage). It cannot grant Studio's, because the frame is cross-origin, and a
script inside cannot reach the iframe element to lift its sandbox. There is no
`allow-top-navigation`, `allow-popups` or `allow-modals`. `allow-forms` keeps a
prototype's form-submit Save buttons working. The value lives in
`frontend/app/web/src/features/project/design/PrototypeFrame.tsx` and is
pinned by a test. The page only frames a subdomain of `figma.site` over https
(`publishedSite()` in `designModel.ts`).

## 5. Data model

`project_designs` (migrations `a4c8e2f6b913`, `b5d1f7e3a926`, `c7e3a9d1f528`):

| Column | Notes |
|---|---|
| `id`, `account_id`, `project_id` | `project_id` cascades with the project |
| `all_wireframes` | True: every **active** wireframe of the project, resolved each time the brief is read |
| `wireframe_ids` | Otherwise the wireframes picked, in order (JSONB list, at least one). Soft references, no foreign key: a deleted wireframe drops out of the brief (reported as `missingWireframeIds`) |
| `name`, `brief` | The authored part |
| `reference_document_ids` | JSONB list of `project_documents.id` with `purpose = 'design_reference'` |
| `figma_url` | The Make file. Set by the skill |
| `published_url` | The site published from it; what the design page frames. Set by the skill |
| `status` | `active` / `archived` |
| `pos`, `created_by`, `created_at`, `updated_at` | |

`c7e3a9d1f528` dropped `design_revisions` and the `current_revision_id` and
`synced_at` columns. The revisions' HTML and source archives stay in the
documents bucket under `<account>/<project>/designs/<design>/<revision>/`
(a migration cannot reach S3); delete that prefix by hand if the space
matters.

### Versioning

`project_designs` is in `COPIED_TABLES`. A new project version carries its
designs with wireframe and reference-document ids remapped, and keeps
`figma_url` and `published_url`: both versions point at the same Make file.
Versioning normally locks the source, and a locked project refuses every design
write (423).

## 6. API

All under `/api/studio/projects/{project_id}`. Every write resolves the project
through `get_writable_project`, so a locked version answers 423.

Session only (`require_permission`):

| Route | Permission |
|---|---|
| `POST /designs` | `data:write` |
| `GET /designs/{id}` | `data:read` |
| `PATCH /designs/{id}` — name, brief, reference images, archive / restore, position | `data:write` |
| `DELETE /designs/{id}` — archived designs only | `data:write` |

Session or board token (`require_studio_permission`):

| Route | Permission |
|---|---|
| `GET /designs` | `data:read` |
| `GET /designs/{id}/brief` | `data:read` |
| `PUT /designs/{id}/figma` | `data:write` |

None of these changes design content.

- **Brief payload**: the design, the brief text, `wireframes` (one
  `assemble_wireframe_export()` per wireframe, in order),
  `missingWireframeIds`, `catalogue_reference()`, and a presigned GET URL per
  reference image. 409 when no wireframe resolves.
- **Figma URLs** must be `https` on `figma.com` or `figma.site`. The page
  frames `published_url` only when it is a `figma.site` subdomain.

Reference images are project documents with `purpose = 'design_reference'`,
restricted to PNG and JPEG.

## 7. MCP tools and the skill

`board_mcp.py` has `list_designs`, `get_design_brief` and
`set_design_figma_url`. No delete or edit tool, matching that file's rule.

`.mcp.json` runs the **deployed** `board_mcp.py`, so tool changes exist only
after a deploy and a Claude Code session restart.

`.claude/skills/studio-design/` holds `SKILL.md`, `references/` and a Vite +
React + hash-routing template. Commands: `generate`, `sync`, and `edit`
(conditional on spike 2). `references/figma-make.md` records what handing over
to Make and reading its code back need.

## 8. Frontend

`frontend/app/web/src/features/project/design/`:

- `HighFidelityDesignPage` — the list, with a "Not generated" / "In Figma" /
  "Published" badge, Open / Edit / Archive, and the "New design" drawer ("All
  wireframes" or "Choose wireframes" with a checklist).
- `DesignPage` at `high-fidelity-design/:designId` — the published site in the
  sandboxed frame on a stage sized from the wireframes' interface type (a
  Device select when they differ), **Sync** (reloads the site), **Full screen**
  (the mat, edge to edge) and "Open in Figma". Before publishing, an empty state
  says what is missing.
- Refetches on window focus, so a newly recorded address appears without a
  reload.

Editing the brief and archiving need `data:write`; viewing needs `data:read`.

## Open spikes

1. ~~Can Claude Code read a Make file's full source back?~~ **Yes**
   (2026-11-16): `get_design_context(fileKey, nodeId="0:1")` lists every file
   as an MCP resource. See `references/figma-make.md`.
2. **Can `send_code_to_figma` replace the code of an existing Make file?**
   If not, `edit` is dropped and every change is made in Make.
3. ~~Does a published Make site load in a frame inside Studio?~~ **Yes**
   (2026-11-16): no frame-blocking headers. Built revisions were dropped for it.
4. **Do Figma file metadata or webhooks report changes to Make files?** If
   they do, the repository copy could be refreshed automatically. Until known,
   `sync` is run by hand or under `/loop`.

## Manual steps left

1. Deploy, so the CSP allows `https://*.figma.site` and migration
   `c7e3a9d1f528` runs; then restart Claude Code sessions so the board MCP's
   design tools match.
2. Optionally delete the old revision objects from the documents bucket.
