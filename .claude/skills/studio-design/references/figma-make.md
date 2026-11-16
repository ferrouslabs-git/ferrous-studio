# Figma Make: what this skill needs, and what is unverified

The `figma:figma-code-workflows` skill owns how the Figma connector is used.
This file only states what `studio-design` relies on, so that when one of
these turns out not to hold you know which command is affected and what to
do instead.

## Relied on

| Need | Tool | Used by |
|---|---|---|
| Import a local project into a **new** Figma Make file ("in a Figma Make file, the project becomes the file's code") and learn the file's URL | `send_code_to_figma` | `generate` |
| Read the **complete current code** of a Make file | `get_design_context` and the Make file's resources | `sync`, `edit` |
| Replace the code of an **existing** Make file | `send_code_to_figma` | `edit` |

`send_code_to_figma` only works from allow-listed MCP clients such as Claude
Code. It cannot be called from a backend, which is why this is a skill.

## Open spikes

Record the outcome of each in `docs/high-fidelity-design.md` when you learn
it, and adjust `SKILL.md` to match.

1. **Reading the full source back after an edit in Make.** *Settled
   2026-11-16: it works* (see "Reading the code back" below). Every source
   file came back whole after Make had restyled the prototype, and a build of
   it matched Make. Still: if a read ever returns only part of the project,
   do not leave a half-written folder; tell the user.
2. **Replacing an existing Make file's code, and getting its URL back.** If
   it cannot, `edit` is dropped and all changes are made in Make. If the
   tool does not return a URL even for a new file, ask the user to paste it
   in `generate`.
3. **Framing a published Make site.** *Settled 2026-11-16: it can be framed.*
   A published site (`https://<name>.figma.site`) sends no `X-Frame-Options`
   and no CSP `frame-ancestors`, so Studio frames it directly; Studio's own
   CSP allows `frame-src https://*.figma.site`. This replaced building and
   uploading revisions. Record the address with
   `set_design_figma_url(design_id, published_url=...)`.
4. **Change notifications for Make files.** Unknown whether Figma file
   metadata or webhooks report them. Until known, `sync` is run by hand or
   on a loop; it is cheap when nothing changed. Publishing is always a person
   pressing Publish in Make; no tool does it.

## Handing over (`generate`)

What `send_code_to_figma` needed on 2026-11-16, beyond what the template has:

- **Lifecycle files** in `.figma/make/`: executable `install` (`npm ci`),
  `dev` (`exec npx --no-install vite --port "$PORT" --host
  "${FIGMA_DEV_SERVER_HOST:-0.0.0.0}" --strictPort`), `deploy-preview` and
  `deploy` (`npm run build`, check `dist` exists, then
  `figma make deploy-preview` / `figma make deploy --build-dir dist`), plus
  `deploy.json` with `{ "adapter": "static" }`. LF line endings, mode 0755.
- **A `server` block in `vite.config.ts`** that takes `PORT` and
  `FIGMA_DEV_SERVER_HOST` when `FIGMA` is set. `tsc` type-checks the config,
  so read the environment through `globalThis` rather than adding
  `@types/node`.
- **On Windows**: build the archive with Python's `tarfile` and set the
  script modes explicitly (Windows tar loses them), and give `curl` the
  `cygpath -m` form of the `/tmp/...` archive path, or it cannot read the file.
- `create_session` does not support Make files; skip it.
- Windows App Control blocks rollup's native binary; `package.json`
  `"overrides": { "rollup": "npm:@rollup/wasm-node@^4.30.0" }` builds without it.

## Reading the code back (`sync`)

- `get_design_context(fileKey, nodeId="0:1")` on a Make file returns resource
  links: `file://figma/make/source/<key>/<path>` for each source file and
  `file://figma/make/image/<key>/<hash>.png` for Make's own screenshots
  (not source; ignore them).
- Read each source link with the MCP resource reader (`ReadMcpResourceTool`,
  server `plugin:marketing:figma`). Subagents may not have that tool; do it
  in the main session.
- Text comes back inline and must be written byte for byte. A large result
  is saved to a file instead; extract its `contents[0].text` with a script
  rather than retyping it.
- Files keep their own line endings (LF for what Make or prettier wrote; CRLF
  for files that came from this repo's template unchanged).
- Dotfiles are not listed (`.figma/make/*`, `.gitignore`). Keep the ones the
  hand-over sent; Make still has them.
- Make can add remote assets, such as image URLs in data (on 2026-11-16 it
  added three Unsplash avatars). The published site loads them; mention it,
  but do not patch it locally: the folder mirrors Make.
