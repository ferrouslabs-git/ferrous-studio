# Claude Design: the path for a design whose provider is `claude`

A design records the tool it is made in (`design.provider` in the brief, and
in `list_designs`), chosen by a person when the design was created. For
`claude`, the design is a **Claude Design artifact**: a canvas of live
artboards on claude.ai, made from the **Design** Artifact type. Everything
else matches the Figma path: same brief, same wireframe mapping, same
`designs/<design-slug>/` folder, same three Studio tools.

## How it differs from Figma

| | Figma (`figma`) | Claude Design (`claude`) |
|---|---|---|
| Single source of truth | The Make file | The artifact |
| `figma_url` records | The Make file's URL | The artifact's address, as the Artifact tool returns it |
| `published_url` records | The `figma.site` page | The artifact's **public share link** (`https://claude.ai/artifact/<id>?sk=...`) |
| What Studio shows | Frames the site | Links to the share link: claude.ai refuses to be framed by other sites |
| `edit` | Unverified (spike 2) | Supported: republish to the same artifact |

Studio accepts only claude.ai links for a Claude design (422 otherwise), and
only figma.com / figma.site for a Figma one.

## Before generating

You need the Artifact tool (this session's `Artifact`). If it is missing,
stop and say so: a Claude design cannot be generated without it.

## `generate` (Claude)

Steps 1-4 of `generate` in SKILL.md are the same: read the brief, look at
every reference image, read every wireframe export, and work out the pages,
flow and content from `references/wireframe-to-prototype.md`. Then:

5. **Start the artifact.** Call `Artifact` with `action: "quickstart"` and
   `intent: "design"`, and start from the **Design** type it names: publish
   with its `type_url`, `title` = the design's name, no files and
   `auto_open: "after_first_write"`. The create result carries the type's
   instructions, the pages to read first, the design systems and how to fill
   it. Follow those instructions exactly; they decide the file format.
6. **Fill it.** One artboard per page of every wireframe, in wireframe and
   page order, named after the page. The wireframes decide what exists; the
   brief and reference images decide how it looks, as in SKILL.md. Overlays
   (modal and drawer pages) get their own artboards, shown over their parent.
   Write the artifact's files inside the design's folder and publish them to
   the artifact's `url` with the `root` set to that folder, so the folder and
   the artifact hold the same files.
7. **Record the address.** `set_design_figma_url(design_id,
   figma_url=<the artifact url>)`.
8. **Report**: the artifact link, and anything in the brief you could not
   honour. Tell the user the artifact is **private**: to show it in Studio
   they must share it publicly in claude.ai and give you the share link, which
   you record with `set_design_figma_url(design_id, published_url=...)`. Never
   make or guess a share link yourself.

## `sync` (Claude)

The artifact is the source of truth, so `sync` mirrors it into the folder:
`Artifact` `action: "read"` on `design.figma_url`, then list its files
(`action: "list"`, `scope: "files"`) and read each (`paths`) into the
design's folder, replacing what is there. Report what changed as for Figma.
If the user gives you a share link not yet recorded, record it.

## `edit` (Claude)

Supported, because an artifact is updated in place:

1. Run `sync`, so the folder holds exactly what the artifact has.
2. Make the requested change in the folder.
3. Publish the changed files to the **same** artifact (`url` =
   `design.figma_url`, same `root`). Never publish without `url`: that makes a
   second artifact and forks the design.
4. The share link is unchanged, and Studio's link opens the new version.
