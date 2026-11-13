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

1. **Reading the full source back after an edit in Make.** If only part of
   the project comes back (the entry file but not the rest, or a summary
   rather than files), `sync` cannot build a faithful copy. Then: do not
   submit partial builds; tell the user. The fallback is showing the
   published Make site instead of a built revision, which Studio is not yet
   built to do (`published_url` is stored for it).
2. **Replacing an existing Make file's code, and getting its URL back.** If
   it cannot, `edit` is dropped and all changes are made in Make. If the
   tool does not return a URL even for a new file, ask the user to paste it
   in `generate`.
3. **Framing a published Make site.** Not this skill's concern, but if the
   user publishes the site, record it:
   `set_design_figma_url(design_id, published_url=...)`.
4. **The built file running in Studio's frame.** Checked locally against a
   stand-in for storage, not against the deployed Studio. If a revision
   shows blank in Studio, the browser console of the Studio page says why.
5. **Change notifications for Make files.** Unknown whether Figma file
   metadata or webhooks report them. Until known, `sync` is run by hand or
   on a loop; it is cheap when nothing changed.

## The source hash

`submit_design_revision` hashes every file under `source_dir` (path and
bytes, in path order), leaving out `node_modules`, `dist`, `build` and
`.git`. Two consequences:

- The first `sync` after `generate` may create revision 2 with no visible
  difference, if Make stores the project with any file added, removed or
  rewritten. That is expected, and it happens once.
- If Make returns files with unstable content (timestamps, reordered JSON),
  every sync would look like a change. If you see a new revision on every
  run with nothing changed in Make, stop the loop and report it rather than
  filling the revision list.
