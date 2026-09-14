---
name: reverse-engineer-repo
description: Turn an existing application's source code into a Ferrous Studio import bundle (wireframes and diagrams -- nothing else) without redrawing every screen by hand. Use when asked to reverse-engineer a repository, recreate an existing app's screens in Studio, or generate wireframes/diagrams from a codebase.
---

# Reverse-engineer a repository into a Studio bundle

You read an existing application's source code and describe its screens
and data model as one JSON **bundle** that Ferrous Studio can import.
**Wireframes and diagrams only** -- no actors, use cases or datasets; see
§5. Import happens at the very end (§8): directly, via an MCP board-token
connection if one is available, or otherwise handed off to a signed-in
person through the app (Project details or the Wireframes list →
**Import…**). Everything before §8 is the same either way.

Read `references/bundle.md`, `references/catalogue.md`,
`references/mapping-rules.md` and `references/diagrams.md` before starting
the mapping pass. They are the actual rules; this file is only the order of
operations.

## 1. Pin the source

Work on a local clone at a named commit. Confirm the tree is clean
(`git status --porcelain` empty) before reading anything -- never analyse a
dirty tree, since `commit_sha` is a claim about exactly what was read.

```bash
git -C <repo> status --porcelain   # must be empty
git -C <repo> rev-parse HEAD       # this is source.commit_sha
```

Create a working directory for this run (outside the source repo):

```bash
mkdir -p out/pages out/diagrams
```

## 2. Inventory pass (read only -- write nothing you'll import yet)

Before mapping a single screen, read the whole application and write
`out/inventory.md`: one table of routes (path → component/page file →
auth role(s) required), one of entities (from the ORM models or
migrations), one of services (deployment description: Dockerfiles,
compose, Terraform, env var names naming external systems).

This is the document to get right first. A wrong assumption here costs one
correction; the same wrong assumption discovered after forty pages are
mapped costs forty corrections. If you can, have the inventory reviewed by
someone who already knows the application before continuing.

Also note here, explicitly:

- the framework and its router
- the layout shell(s) and what nests inside them
- anything **behind a feature flag or an unresolvable dynamic import** --
  these get written to `REPORT.md` at the end as "skipped", never guessed

## 3. Mapping pass -- one page per file

For each route in the inventory, write `out/pages/<slug>.json` in
`export_page` shape (see `references/bundle.md`). One file per page:

- a bad page corrupts one file, not the whole run
- a reviewer can diff a single page's file against the real screen
- `validate.py` (step 6) points at exactly the file that's wrong

Use `references/mapping-rules.md` for what each piece of code becomes.
Every component type and element type you write must come from
`references/catalogue.md` -- if nothing there fits, it's a `canvas`.

## 4. Shell and links

Write the shell page(s) **last**, after every page they link to already
exists -- their nav items are what tie the whole wireframe together, and
writing them last means every link target is already a known page id.
Check every `nav-item`'s `props.links[].pageId` resolves to a page you
actually wrote (or `@back`).

## 5. Diagrams

This skill produces **wireframes and diagrams only** -- no actors, use
cases or datasets. A route's auth role still matters for reading the code
(it tells you which screens exist for whom), and the system-context
diagram still draws a role as an `actor` shape -- but nothing is written
to `out/actors.json`, `out/use-cases.json` or `out/datasets.json`, because
this skill doesn't produce those files at all. An enum used on several
screens becomes plain inline sample values (`data.samples`) on each
column, dropdown or filter that uses it, not a shared dataset.

Following `references/diagrams.md`:

- `out/diagrams/data-model.json` -- from the ORM/migrations
- `out/diagrams/containers.json` -- from the deployment description
- `out/diagrams/system-context.json` -- roles + containers, collapsed

And:

- `out/source.json` -- `{"repo_full_name", "commit_sha", "generated_at",
  "generator": "reverse-engineer-repo skill v1"}`
- `out/wireframe.json` -- `{"name", "interfaceType", "landingPageId"}` for
  the wireframe as a whole (`landingPageId` is the shell or home page's id
  from step 4)

## 6. Merge and validate

```bash
.venv312/bin/python .claude/skills/reverse-engineer-repo/scripts/merge.py out
.venv312/bin/python .claude/skills/reverse-engineer-repo/scripts/validate.py out/<repo-name>.bundle.json
```

Fix and re-run `validate.py` until it prints `clean`. Every error names the
exact JSON path and the rule it broke -- fix the page file at that path,
don't hand-edit the merged bundle (the next merge would overwrite it).

## 7. Write the report

`out/REPORT.md`: one row per route, saying which page it became, what was
approximated, and what was skipped and why (from step 2's feature-flag/
dynamic-import notes). This is what whoever reviews the imported project
reads alongside it.

## 8. Import

**If you have an MCP connection to this project's board** (a
`create_wireframes_and_diagrams` tool is available -- board_mcp.py,
connected via a board token in `.mcp.json`), call it directly to finish
the run:

```
create_wireframes_and_diagrams(
  wireframes=<the merged bundle's "wireframes">,
  diagrams=<the merged bundle's "diagrams">,
  source=<the merged bundle's "source">,
)
```

Read the values out of `out/<repo-name>.bundle.json` itself (already
merged and validated in step 6) rather than reassembling them from the
`out/` files a second time. If it returns validation errors, they name
the exact same paths `validate.py` would have -- fix the page file at
that path and call the tool again, the same way you'd fix a
`validate.py` failure. Report what was created (wireframe/page/diagram
counts, the ids the tool returned) alongside `REPORT.md`.

**If no MCP connection is available**, hand off instead -- import happens
through the Studio UI, by a signed-in person, on
`out/<repo-name>.bundle.json`:

**Project details** or **Wireframes → Import…** → pick the file → check the
summary (wireframe/page/diagram counts, source repo and commit) →
**Import**.

Either way, you never construct or call the raw HTTP import endpoint
yourself outside of `create_wireframes_and_diagrams` -- that tool (or the
signed-in person's UI action) is the only sanctioned way in.

## Rules, stated plainly

- **Only the six components exist.** `references/catalogue.md` is exact;
  the validator says "retired" for a type that used to exist and doesn't
  anymore.
- **Prefer fewer, correct pages** over more, approximate ones. A redirect,
  a 404 page, or an OAuth callback is not a page.
- **Sample data is invented, never copied** from fixtures, seeds or tests
  that contain anything that looks like a real person.
- **Do not guess what you cannot see.** Note it in `REPORT.md` instead.
- **Run `validate.py` after every merge**, not just once at the end -- it's
  seconds, and it turns "forty things might be wrong" into "here are the
  three specific things that are."
