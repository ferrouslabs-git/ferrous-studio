# High-fidelity design

Plan of record for the project section "High fidelity design". Status: built on
branch `high-fidelity-design`; **not deployed, migration not applied, five
spikes open** (see [Open spikes](#open-spikes)).

## 1. What it is

A wireframe plus an aesthetics brief goes to Figma Make; the resulting
interactive prototype is shown inside Studio.

Studio authors exactly one thing: **the brief** (which wireframe, a name, the
aesthetics text, reference images). It never edits a design. Changes to a
design are made in Figma Make or in Claude Code, and Studio shows a read-only
mirror of the result. **The Figma Make file is the single source of truth.**

## 2. Constraints that shaped it

- Figma Make and Claude Design have no API a backend can call. Figma's MCP
  write tool `send_code_to_figma` imports a local project zip ("in a Figma Make
  file, the project becomes the file's code") and only works from allow-listed
  MCP clients such as Claude Code.
- Unpublished Make files cannot be iframed.
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
      │                              │ build single-file HTML
      └──── revision upload ◄────────┘
            (presigned PUT → confirm)
```

1. A person with `data:write` creates a design in Studio: wireframe, name,
   brief text, reference images.
2. In Claude Code, `/studio-design generate <design>` reads the brief over the
   board MCP, scaffolds a prototype from the skill's template, builds it, sends
   the project to a new Figma Make file, records the Make URL on the design and
   uploads the built HTML as revision 1.
3. The design is then changed in Figma Make (or, subject to spike 2, in Claude
   Code via `edit`).
4. `/studio-design sync [design]` reads the Make file's current code, builds
   it, and uploads a new revision **only if the source changed**. It is safe to
   run repeatedly (for example under `/loop`).
5. Studio shows the current revision in a sandboxed iframe, with a read-only
   revision switcher, a "Last synced" readout and an "Open in Figma" button.

## 4. Why a sandboxed S3 iframe

Studio's CSP (`backend/app/auth/security/security_headers_middleware.py`) has
`script-src 'self'`, and a `blob:` iframe inherits the embedding page's CSP, so
generated JavaScript cannot run from a blob. It can only run from another
origin. A revision is therefore one self-contained HTML file in the documents
bucket, loaded through `presign_get(..., inline_as="text/html")` into
`<iframe sandbox="allow-scripts allow-forms">` **without** `allow-same-origin`:
the prototype runs in an opaque origin, cannot read Studio's storage or cookies
and cannot call Studio's API as the signed-in user. It also has no
`allow-top-navigation`, `allow-popups` or `allow-modals`.

`allow-forms` is an addition to the approved `sandbox="allow-scripts"`. Without
it the browser drops a form's `submit` event altogether, so a prototype's Save
button (usually a form submit handled in script) does nothing, and code written
in Make is not ours to rewrite. It grants nothing a script in that frame could
not already do. The value lives in one place,
`frontend/app/web/src/features/project/design/PrototypeFrame.tsx`, and is
pinned by a test.

`frame-src` gains the two documents-bucket hosts already present in
`connect-src`. No Figma host is added.

## 5. Data model

One migration, `a4c8e2f6b913_project_designs.py`, with row-level security on
both tables.

`project_designs`

| Column | Notes |
|---|---|
| `id`, `account_id`, `project_id` | `project_id` cascades with the project |
| `wireframe_id` | Soft reference, no foreign key. A deleted wireframe leaves the design and its revisions readable; only the brief stops resolving |
| `name`, `brief` | The authored part |
| `reference_document_ids` | JSONB list of `project_documents.id` with `purpose = 'design_reference'` |
| `figma_url`, `published_url` | Set by the skill. `published_url` is stored for spike 3 and not used by the UI |
| `current_revision_id` | Soft reference to the revision on show |
| `status` | `active` / `archived` |
| `pos`, `synced_at`, `created_by`, `created_at`, `updated_at` | `synced_at` moves on every successful sync, including one that found nothing changed |

`design_revisions` (append-only)

| Column | Notes |
|---|---|
| `id`, `account_id`, `project_id`, `design_id` | `project_id` is carried so versioning and RLS treat it like every other project-owned table |
| `revision_no` | Per design, unique |
| `html_key`, `source_key` | S3 keys. `source_key` is null when no source archive was uploaded |
| `html_bytes`, `source_bytes` | Declared sizes, checked against the object at confirm |
| `source_hash` | SHA-256 the skill computes over the source tree. Equal to the current revision's hash means "nothing changed" |
| `origin` | `figma_make` / `claude_code` |
| `summary` | One line from the skill |
| `status` | `pending` until confirmed, then `uploaded` |
| `created_at` | |

Additions to the approved column list, each needed by an approved behaviour:
`reference_document_ids` (which images belong to which design), `source_hash`
(the unchanged-sync no-op), `html_bytes` / `source_bytes` (the size check at
confirm) and `design_revisions.project_id` (`test_version_coverage.py` keys on
that column).

`SCOPED_TABLES` in `f7a3d8e1c265_rls_platform_read_only.py` is a historical
list: it narrowed the `WITH CHECK` of policies that existed at that revision.
Tables created later take the already-narrowed policy from `_apply_rls`, as
`b8e2c5f174ad` does, so the new tables are not added to that tuple (editing an
applied migration to name tables that did not exist yet would break it).

### Versioning

Both tables are in `COPIED_TABLES`. A new project version carries its designs
and every uploaded revision: rows are remapped (wireframe id, reference
document ids, revision ids), revision rows land as `pending`, and the S3
objects are copied after the commit by `finish_design_copies`, exactly as
documents are. A design whose current revision's object did not arrive falls
back to its newest revision that did.

The copy keeps `figma_url`. Versioning normally locks the source, and a locked
project refuses every design write (423), so syncs land on the new version
while the old one stays as it was when frozen.

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
| `GET /designs/{id}/revisions` | `data:read` |
| `GET /designs/{id}/revisions/{rid}/view` — short-lived inline presigned URL | `data:read` |

Session or board token (`require_studio_permission`):

| Route | Permission |
|---|---|
| `GET /designs` | `data:read` |
| `GET /designs/{id}/brief` | `data:read` |
| `PUT /designs/{id}/figma` | `data:write` |
| `POST /designs/{id}/revisions` | `data:write` |
| `POST /designs/{id}/revisions/{rid}/confirm` | `data:write` |

None of the session routes changes design content; the only way a revision
comes into being is the ticket → direct PUT → confirm path, the same one
`documents.py` uses.

- **Brief payload**: the design, the brief text, `assemble_wireframe_export()`
  for the wireframe, `catalogue_reference()`, and a presigned GET URL per
  reference image.
- **Revision request**: the caller declares origin, summary, source hash and
  sizes. If the hash equals the current revision's, the answer is
  `unchanged: true`, no row is created and `synced_at` moves. Otherwise a
  `pending` revision and upload tickets come back. Repeating the request while
  one is still pending reuses that revision rather than minting another.
- **Confirm**: head-checks size and content type of each object, checks the
  HTML starts like an HTML document and the archive like a zip, then marks the
  revision `uploaded`, points `current_revision_id` at it and sets `synced_at`.
  A failed check deletes the objects and the pending row.
- **Figma URLs** must be `https` on `figma.com` or `figma.site`. Whether
  `published_url` needs a wider rule (custom domains) is part of spike 3.

Reference images are project documents with `purpose = 'design_reference'`,
restricted to PNG and JPEG.

## 7. MCP tools and the skill

`board_mcp.py` gains `list_designs`, `get_design_brief`,
`set_design_figma_url` and `submit_design_revision` (which uploads local files
through the presigned tickets). No delete tool, matching that file's rule.

`.mcp.json` runs the **deployed** `board_mcp.py`, so these tools exist only
after a deploy and a Claude Code session restart.

`.claude/skills/studio-design/` holds `SKILL.md`, `references/` and a Vite +
React + hash-routing + `vite-plugin-singlefile` template that builds one
self-contained HTML file containing every page of the wireframe. Commands:
`generate`, `sync`, and `edit` (conditional on spike 2).

## 8. Frontend

`frontend/app/web/src/features/project/design/`:

- `HighFidelityDesignPage` — the list, with a "Not generated" / "Synced"
  badge, Open / Edit / Archive, and the "New design" drawer.
- `DesignPage` at `high-fidelity-design/:designId` — the sandboxed iframe on a
  stage sized from the wireframe's interface type, the revision switcher, the
  "Last synced" readout and "Open in Figma". No refine box, no edit controls.
- `designsApi.ts` — refetches on window focus so a new sync appears without a
  reload.

Editing the brief and archiving need `data:write`; viewing needs `data:read`.

## Open spikes

None of these could be checked where this was built (no Figma account, no
Claude Code Figma connector, no deployed environment). Each has a survivable
outcome.

1. **Can Claude Code read a Make file's full project source back after it was
   edited in Make?** `sync` depends on it. If only partial code comes back,
   `sync` cannot produce a faithful build: the fallback is the live embed of
   the published site (spike 3), for which `published_url` already exists. The
   revision API also accepts a revision with no source archive.
2. **Can `send_code_to_figma` replace the code of an existing Make file, and
   does it return the file's URL?** If not, the `edit` command is dropped and
   every change is made in Make. `SKILL.md` marks `edit` as conditional. If no
   URL is returned on create either, `generate` asks the user to paste it.
3. **Does a published Make site load in an iframe inside Studio?**
   (`GET /v1/oembed`, needs public link access.) `published_url` is stored for
   this; the live-embed toggle is deliberately **not** built, and `frame-src`
   has no Figma host.
4. **Does single-file HTML with inline JavaScript, served from an inline
   presigned S3 URL, run in the sandboxed iframe under the real CSP?** The CSP
   only applies when the backend serves the built SPA on port 8080, not on the
   Vite dev server, so this must be checked against a deployed (or locally
   built-and-served) Studio. If S3 or the sandbox blocks it, the fallback is
   serving revisions from a dedicated origin.
5. **Do Figma file metadata or webhooks report changes to Make files?** If
   they do, `sync` can be triggered rather than polled. Until known, `sync` is
   run by hand or under `/loop`, and is cheap when nothing changed.

### What was checked locally

Not a substitute for the spikes, but it narrows two of them:

- The skill's template builds to one HTML file, and that file runs, routes,
  opens its overlay and submits its form inside a cross-origin
  `sandbox="allow-scripts allow-forms"` iframe on a page served with the exact
  `Content-Security-Policy` string from `security_headers_middleware.py`. The
  storage host was a local stand-in, so **S3's own response headers and a real
  presigned URL were not exercised** (spike 4 stays open).
- The whole Studio side ran against a local Postgres with the migration
  applied and S3 replaced by an in-memory stand-in: create a design with a
  reference image, read the brief and upload two revisions through the real
  `board_mcp.py` tools with a real board token, see the new revision appear on
  window focus, switch revisions, archive, restore, and a viewer being refused
  every write.

## Manual steps left

1. Apply the Alembic migration (`a4c8e2f6b913`) per environment.
2. Deploy, then restart the Claude Code session so the new MCP tools load.
3. Run the five spikes.
4. Run the first `generate` end to end.
