---
name: studio-design
description: Generate a high-fidelity interactive prototype for a Ferrous Studio design in Figma Make, and keep Studio's read-only mirror of it in sync. Use when asked to generate, sync or edit a Studio "High fidelity design", to send a wireframe and its aesthetics brief to Figma Make, or to refresh what Studio shows after a design changed in Make. Commands - generate <design>, sync [design], edit <design>.
---

# Studio design: brief → Figma Make → Studio mirror

A *design* in Ferrous Studio is a brief: a wireframe, a name, aesthetics
text and reference images. You turn that brief into an interactive
prototype, put it in a **Figma Make** file, and upload a built copy back to
Studio so people can see it there.

Three rules decide everything else:

1. **The Figma Make file is the single source of truth.** Studio never edits
   a design; it shows a read-only copy.
2. **Studio's copy is one self-contained HTML file** (a *revision*), shown in
   a sandboxed iframe. Revisions are append-only.
3. **You author nothing in Studio except through the four design tools.**
   Never create, rename, archive or delete a design, and never change the
   wireframe the brief points at.

Background and the decisions behind this: `docs/high-fidelity-design.md`.

## Before any command

Check both connections. If one is missing, stop and say which.

| Needed | How to tell | If missing |
|---|---|---|
| Studio board MCP with design tools | `list_designs`, `get_design_brief`, `set_design_figma_url`, `submit_design_revision` are available | The connection runs the *deployed* `board_mcp.py`; the tools appear after a deploy and a session restart |
| Figma connector | `send_code_to_figma` and `get_design_context` are available | Ask the user to connect Figma in Claude Code |

For everything Figma-side, follow the `figma:figma-code-workflows` skill. It
owns the mechanics (how a project is packaged and sent, how a Make file's
code is read); `references/figma-make.md` only lists what this skill needs
from it and what is still unverified.

**Resolving `<design>`:** call `list_designs` and match by name or id. If
more than one is plausible, ask. Never invent an id. Skip archived designs
unless the user names one, and then say it is archived: an archived design
takes no revision.

**Working folder:** one per design, outside any repository:
`~/studio-designs/<design-id>/`. It holds the prototype project and nothing
else.

## `generate <design>`

For a design that has no Make file yet (`figma_url` is null). If it already
has one, stop and offer `sync` or `edit` instead: generating again would
create a second Make file and split the source of truth.

1. **Read the brief.** `get_design_brief(design_id)`. Read the brief text,
   open every reference image (`saved_to`), and read the whole wireframe
   export before writing code.
2. **Scaffold.** Copy `template/` from this skill into the working folder
   and run `npm install`.
3. **Build the prototype.** Follow `references/wireframe-to-prototype.md`:
   it maps the wireframe export onto the template (pages, routes, overlays,
   nested pages, components, sample data). Every page of the wireframe is in
   the prototype; every link in it works.
   - The **wireframe** decides what exists: pages, structure, content, flow.
   - The **brief and reference images** decide how it looks.
   - Where they conflict, structure follows the wireframe and you say so in
     the summary.
4. **Build and check.**
   ```bash
   npm run build
   node <skill-dir>/scripts/check_build.mjs .
   ```
   Fix every problem the check reports. Then open `dist/index.html` in a
   browser, click through each page and each overlay, and fix what is wrong.
5. **Send to Figma Make.** With `send_code_to_figma`, send the project
   folder (source, not `dist/` or `node_modules/`) to a **new Figma Make
   file** named after the design. Keep the URL it returns. If it returns
   none, ask the user to open the file and paste its URL.
6. **Record the URL.** `set_design_figma_url(design_id, figma_url=...)`.
7. **Submit revision 1.**
   `submit_design_revision(design_id, html_path="<folder>/dist/index.html",
   origin="claude_code", source_dir="<folder>", summary="...")`.
8. **Report**: the Make URL, the revision number, and anything in the brief
   you could not honour.

## `sync [design]`

Brings Studio's copy up to date with the Make file. With no design named,
sync every active design that has a `figma_url`.

For each design:

1. `get_design_brief(design_id, download_images=False)` for `design.figma_url`
   and `currentRevision`.
2. **Read the Make file's current code** through the Figma connector
   (`get_design_context` and the Make file's resources), following
   `figma:figma-code-workflows`. Replace the contents of the working
   folder's source with what you read: every file, exactly as it is in Make.
   Do not tidy, reformat or "fix" anything; a change you make here is not in
   Make and would be lost at the next sync.
3. `npm install` if `package.json` changed, then `npm run build` and
   `check_build.mjs`.
4. `submit_design_revision(..., origin="figma_make", source_dir=..., summary=...)`.
   - `{"unchanged": true}`: nothing changed since the last revision. Say so
     in one line and move on.
   - Otherwise a new revision was created; report its number.

**Safe to repeat.** Nothing is uploaded when the source is unchanged, so
this can run under `/loop` (for example `/loop 10m /studio-design sync`).
In a loop, stay quiet when everything is unchanged.

**If the build fails or the check fails** on code that came from Make: do
not patch it locally and upload. Report what failed. The fix belongs in Make
(or in `edit`), because Studio must show what Make has.

**If you cannot read the complete source back** (see spike 1 in
`references/figma-make.md`): stop and say so. Do not submit a revision built
from partial code.

**A locked project** answers 423 to every design write. That version is
frozen; say so and skip it.

## `edit <design>` (conditional)

> **Only if `send_code_to_figma` can replace the code of an existing Make
> file.** That is unverified (spike 2 in `references/figma-make.md`). Until
> it is confirmed, do not run this command: tell the user that changes are
> made in Figma Make and picked up with `sync`. Never work round it by
> sending to a new Make file; that would fork the design.

1. Run steps 1 and 2 of `sync` so the working folder holds exactly what Make
   has. If that produced a new revision, mention it.
2. Make the requested change in the working folder.
3. Build and check, as in `generate` step 4.
4. Send the project back to the **same** Make file with `send_code_to_figma`.
5. Run `sync`. The revision it uploads comes from what Make now holds, which
   proves the change landed.

## What a revision must be

Studio frames the file from storage with `sandbox="allow-scripts"` and no
`allow-same-origin`, so the prototype runs in an opaque origin:

- **One HTML file**, at most 25 MB, script and style inlined (the template's
  build does this).
- **Nothing fetched at run time**: no CDN script, web font, remote image or
  API call. Import images from `src/` so they are inlined.
- **No browser storage**: `localStorage`, `sessionStorage`, `indexedDB` and
  cookies throw in that frame. Keep state in memory.
- **Hash routing only.** The file does not control its own URL path.
- No `window.parent`, `window.top` or `postMessage` to the host.

`scripts/check_build.mjs` checks the first four.

## Files

- `template/` — Vite + React + hash routing + `vite-plugin-singlefile`.
- `references/wireframe-to-prototype.md` — the mapping from a wireframe
  export to the template.
- `references/figma-make.md` — what is needed from the Figma connector, and
  the open spikes.
- `scripts/check_build.mjs` — verifies a build is a self-contained single
  file.
