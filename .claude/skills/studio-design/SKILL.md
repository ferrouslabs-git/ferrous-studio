---
name: studio-design
description: Generate a high-fidelity interactive prototype for a Ferrous Studio design in Figma Make or Claude Design (whichever the design was created for), record where Studio shows it, and keep its source in the repository for coding agents. Use when asked to generate, sync or edit a Studio "High fidelity design", to send one, several or all wireframes and their aesthetics brief to Figma Make or Claude Design, or to pull a design's current code back out. Commands - generate <design>, sync [design], edit <design>.
---

# Studio design: brief → Figma Make → published site in Studio

A *design* in Ferrous Studio is a brief: one, several or all of the
project's wireframes, a name, aesthetics text and reference images. However
many wireframes it has, it becomes **one** prototype in **one** Make file.
You turn that brief into an interactive prototype and put it in a **Figma
Make** file. Studio shows it by framing the site published from that file.

**Which tool:** each design records it (`provider` in `list_designs` and in
the brief's `design`), chosen by a person when the design was created.
`figma` follows this file as written. **`claude` follows
`references/claude-design.md`** wherever it differs (the artifact replaces the
Make file, a public share link replaces the published site, and `edit`
works). Never move a design from one tool to the other.

Four rules decide everything else (for Claude Design, read "the artifact" for
"the Figma Make file" and "its share link" for "the published site"):

1. **The Figma Make file is the single source of truth.** Studio never edits
   a design and holds no copy of it.
2. **Studio frames the published site** (`published_url`, an
   `https://<name>.figma.site` address). Its Sync button reloads that site, so
   whatever was last published in Make is on show. Nothing is built or
   uploaded to Studio.
3. **The source lives in this repository**, at `designs/<design-slug>/`, for
   coding agents to read. `sync` overwrites it with exactly what Make holds;
   git history shows each change.
4. **You author nothing in Studio except through the three design tools.**
   Never create, rename, archive or delete a design, and never change which
   wireframes the brief points at.

Background and the decisions behind this: `docs/high-fidelity-design.md`.

## Before any command

Check both connections. If one is missing, stop and say which.

| Needed | How to tell | If missing |
|---|---|---|
| Studio board MCP with design tools | `list_designs`, `get_design_brief`, `set_design_figma_url` are available | The connection runs the *deployed* `board_mcp.py`; the tools appear after a deploy and a session restart |
| Figma connector (Figma designs only) | `send_code_to_figma` and `get_design_context` are available | Ask the user to connect Figma in Claude Code |
| Artifact tool (Claude designs only) | `Artifact` is available | Say a Claude design cannot be generated in this session |

For everything Figma-side, follow the `figma:figma-code-workflows` skill. It
owns the mechanics (how a project is packaged and sent, how a Make file's
code is read); `references/figma-make.md` lists what this skill needs from it.

**Resolving `<design>`:** call `list_designs` and match by name or id. If
more than one is plausible, ask. Never invent an id. Skip archived designs
unless the user names one, and then say it is archived.

**The design's folder:** `designs/<design-slug>/` at the repository root,
where the slug is the design's name in lower case with runs of anything else
turned into `-` (`Easy Sales Design V1` → `easy-sales-design-v1`). It holds
the prototype's source and nothing else: no `node_modules/`, no `dist/`
(`designs/.gitignore` keeps them out). Builds and archives go to a temporary
folder outside the repository and are deleted when the command finishes.

## `generate <design>`

For a Claude design, steps 1-4 are the same and then
`references/claude-design.md` takes over from step 5.

For a design that has no Make file yet (`figma_url` is null). If it already
has one, stop and offer `sync` or `edit` instead: generating again would
create a second Make file and split the source of truth.

1. **Read the brief.** `get_design_brief(design_id)`. Read the brief text,
   open every reference image (`saved_to`), and read every wireframe export
   in `wireframes` before writing code. A design set to all wireframes gets
   the project's active ones as they are now.
2. **Scaffold.** Copy `template/` from this skill into the design's folder and
   run `npm install` there.
3. **Build the prototype.** Follow `references/wireframe-to-prototype.md`:
   it maps the wireframe exports onto the template (pages, routes, overlays,
   nested pages, components, sample data, several wireframes). Every page of
   every wireframe is in the prototype; every link in it works.
   - The **wireframes** decide what exists: pages, structure, content, flow.
   - The **brief and reference images** decide how it looks.
   - Where they conflict, structure follows the wireframe and you say so in
     the summary.
4. **Build and check.** `npm run build`, then serve `dist/` and click through
   each page and each overlay in a browser, and fix what is wrong.
5. **Hand over to Figma Make.** Create a new Make file named after the
   design (`create_new_file`, `editorType: "figmake"`), then send the design's
   folder (source, not `dist/` or `node_modules/`) to it with
   `send_code_to_figma`, following its returned instructions. The import needs
   the Make lifecycle files; see "Handing over" in `references/figma-make.md`.
   Keep the file URL without its query string.
6. **Record the URL.** `set_design_figma_url(design_id, figma_url=...)`.
7. **Mirror Make.** Run the `sync` steps for this design, so the folder holds
   what Make holds rather than what you sent.
8. **Report**: the Make URL, and anything in the brief you could not honour.
   Tell the user to **Publish** the file in Make (Studio shows nothing until
   then) and to give you the `figma.site` address, which you record with
   `set_design_figma_url(design_id, published_url=...)`.

## `sync [design]`

(Claude designs: see "sync" in `references/claude-design.md`.)

Pulls the Make file's current code into the design's folder. With no design
named, sync every active design that has a `figma_url`.

For each design:

1. `get_design_brief(design_id, download_images=False)` for `design.figma_url`
   and `design.published_url`.
2. **Read the Make file's current code** and write it into the design's
   folder, replacing what is there: `get_design_context(fileKey=<make key>,
   nodeId="0:1")` lists every source file as a resource link
   (`file://figma/make/source/<key>/<path>`); read each with the MCP resource
   reader and write it out exactly as it is in Make. Delete files Make no
   longer has (Make does not list dotfiles; keep those). Details and traps are
   in "Reading the code back" in `references/figma-make.md`. Do not tidy,
   reformat or "fix" anything: the folder is a mirror of Make.
3. **Report what changed**: `git status`/`git diff --stat` on the folder, in
   a line or two. Nothing changed: say so in one line.
4. If the user gives you a published address that is not recorded yet,
   `set_design_figma_url(design_id, published_url=...)`.

Nothing is built or uploaded, and nothing is committed unless the user asks.
Studio picks up a republished site by itself (its Sync button reloads it).

**Safe to repeat.** An unchanged Make file leaves the folder unchanged, so this
can run under `/loop`. In a loop, stay quiet when nothing changed.

**If you cannot read the complete source back:** stop and say so. Do not
leave the folder half-written; restore it with `git checkout -- <folder>`.

**A locked project** answers 423 to every design write. That version is
frozen; say so and skip recording addresses for it.

**When the brief's wireframes change after generation** (someone adds a
wireframe to the design, or a new wireframe joins a design set to all),
`sync` does not pick that up: it mirrors what Make has. The new pages reach
Make through `edit`, or by being built in Make. Say so when a sync's brief
lists a wireframe the prototype does not have.

## `edit <design>` (conditional)

Claude designs: supported now -- see "edit" in `references/claude-design.md`.
The condition below is about Figma Make only.

> **Only if `send_code_to_figma` can replace the code of an existing Make
> file.** That is unverified (spike 2 in `references/figma-make.md`). Until
> it is confirmed, do not run this command: tell the user that changes are
> made in Figma Make and picked up with `sync`. Never work round it by
> sending to a new Make file; that would fork the design.

1. Run `sync` so the design's folder holds exactly what Make has.
2. Make the requested change in the folder.
3. Build and check, as in `generate` step 4.
4. Send the folder back to the **same** Make file with `send_code_to_figma`.
5. Run `sync`. The folder then holds what Make now has, which proves the change
   landed. Remind the user to republish in Make.

## What the prototype must be

Studio frames the published site with `sandbox="allow-scripts allow-forms
allow-same-origin"` on `figma.site`, another origin from Studio's:

- **Hash routing only.** Studio adds a `?studio_sync=` cache-buster to the
  address; the app must not depend on its own query string.
- **No popups, dialogs (`alert`, `confirm`) or top-level navigation**: the
  sandbox blocks them.
- No `window.parent`, `window.top` or `postMessage` to the host.
- Prefer assets bundled from `src/` over remote ones, so the prototype shows
  the same everywhere.

## Files

- `template/` — Vite + React + hash routing.
- `references/wireframe-to-prototype.md` — the mapping from a wireframe
  export to the template.
- `references/figma-make.md` — what is needed from the Figma connector:
  handing over, reading the code back, and the open spikes.
- `references/claude-design.md` — the Claude Design path: the Design
  Artifact type, the share link Studio links to, sync and edit.
- `scripts/check_build.mjs` — checks a build is one self-contained file; no
  longer required, useful when a prototype must work offline.
