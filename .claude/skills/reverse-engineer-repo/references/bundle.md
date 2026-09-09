# The bundle format

A bundle is the inverse of `GET /projects/{id}/export`, minus the ids the
server owns. Every section is optional; a bundle with none of them is
rejected as empty. `schemaVersion` is not checked by the validator, but
write `"1.0"` anyway.

**This skill only ever writes `source`, `wireframes` and `diagrams`.** The
format technically also has `actors`, `useCases` and `datasets` sections
(the server still accepts and validates them, for other producers of a
bundle) but this skill never generates them -- see
`mapping-rules.md` for what an auth role or a shared enum becomes instead.

```json
{
  "schemaVersion": "1.0",
  "source": {
    "repo_full_name": "acme/software-management-app",
    "commit_sha": "9f3c1a2",
    "generated_at": "2026-09-09T10:12:00Z",
    "generator": "reverse-engineer-repo skill v1"
  },
  "wireframes": [{
    "name": "Management app",
    "interfaceType": "desktop",
    "landingPageId": "page-dashboard",
    "pages": [
      {
        "id": "page-dashboard",
        "name": "Dashboard",
        "route": "/",
        "layout": {
          "kind": "region", "id": "r-root", "size": { "fr": 1 },
          "components": [
            {
              "id": "c-nav", "type": "navbar", "shape": "plain", "layout": "vertical",
              "elements": [
                { "id": "e-brand", "type": "brand", "label": "Brand" },
                { "id": "e-home", "type": "nav-item", "label": "Dashboard", "data": {}, "props": { "links": { "e-home": { "pageId": "page-dashboard" } } } }
              ]
            }
          ]
        }
      }
    ]
  }],
  "diagrams": [{
    "name": "Data model",
    "kind": "class",
    "model": {
      "nodes": [
        { "id": "n-project", "type": "entity", "label": "Project", "text": "id\nname\nstatus", "x": 40, "y": 40, "w": 180, "h": 120 },
        { "id": "n-requirement", "type": "entity", "label": "Requirement", "x": 320, "y": 40, "w": 180, "h": 100 }
      ],
      "edges": [
        { "id": "e1", "type": "association", "label": "1..*", "source": "n-project", "target": "n-requirement" }
      ]
    }
  }]
}
```

## Rules that differ from a plain export

- **Page ids can be any string.** Write something readable
  (`page-change-requests`, not a UUID) -- the bundle is what a reviewer
  diffs, and the server remints real ids on import.
- **No `data.dataset` references.** A column, dropdown or filter that would
  otherwise bind to a shared dataset instead carries its own `data.samples`
  -- see `mapping-rules.md`.
- **Diagram node `x`/`y`/`w`/`h` may all be omitted.** The importer's
  `grid_layout` fills in whatever is missing.
- **A bare wireframe export** (`schemaVersion` + `pages` at the top level,
  exactly what Studio's own Export button produces) is accepted directly --
  it gets wrapped as `{"wireframes": [it]}` automatically. Handy for
  round-tripping one wireframe without reshaping anything.

## What gets rejected outright

Run `scripts/validate.py` on every merge -- it prints every problem in one
pass, each with the exact path into the JSON:

```
wireframes[0].pages[3].layout.children[1].components[0].type: unknown component type "hero" (retired)
```

The full rule set lives in the validator itself
(`backend/app/studio/importing.py::validate_bundle`); `catalogue.md` in this
directory is the vocabulary it checks against.
