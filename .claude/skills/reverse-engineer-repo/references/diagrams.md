# Diagrams

Three, all deterministic enough to trust. Sequence, activity and state
diagrams are **not** generated -- inferring them from code is where reverse
engineering stops being reliable, and they are the ones a person draws in
ten minutes once the data model is already on screen.

| Diagram | Kind | From | Nodes / edges |
|---|---|---|---|
| **Data model** | `class` | ORM models (SQLAlchemy, Prisma, Django, ActiveRecord), or migrations when there is no ORM | `entity` per table with `text` listing the columns; `association` per foreign key labelled with cardinality (`1..*`, `0..1`, ...); `parentId` unused |
| **Containers** | `freeform` | Dockerfiles, compose, Terraform, the task definition, env var names | `rect` per deployable (SPA, API, worker), `cylinder` per database or bucket, `hexagon` per queue, `cloud` per external SaaS (auth provider, payments, email); `dependency` edges labelled with the protocol |
| **System context** | `freeform` | The actors plus the containers diagram collapsed to one box | `actor` per role, one `rect` for the system, `cloud` per external system; `association` edges |

## Node types (`diagrams[].model.nodes[].type`)

Only these exist -- anything else fails validation:

```
actor, usecase, boundary, class, entity, start, end, action, decision,
fork, forkV, swimlane, swimlaneV, lifeline, activation, note, text, rect,
roundRect, ellipse, circle, triangle, diamond, pentagon, hexagon, star,
cross, cylinder, cloud, parallelogram, trapezium, arrow, callout
```

For the three diagrams this skill produces, the ones actually used are:
`entity` (data model), `association`/`dependency` edges, `rect` /
`cylinder` / `hexagon` / `cloud` (containers), and `actor` / `rect` /
`cloud` (system context).

## Edge types (`diagrams[].model.edges[].type`)

```
association, directed, generalisation, aggregation, composition,
dependency, flow, include, extend, message, messageAsync
```

## Positions

Lay nodes out in a simple grid yourself as you write each one -- columns by
kind, roughly 240px pitch -- so the result is readable the first time
someone opens it, rather than leaving every node bunched at the origin.
The importer's own `grid_layout` is only a fallback for a node you forgot
to place, not something to lean on for the whole diagram.

## Example: a small data model

```json
{
  "name": "Data model",
  "kind": "class",
  "model": {
    "nodes": [
      { "id": "n-project", "type": "entity", "label": "Project", "text": "id\nname\nstatus", "x": 0, "y": 0, "w": 180, "h": 120 },
      { "id": "n-requirement", "type": "entity", "label": "Requirement", "text": "id\nproject_id\ntitle", "x": 280, "y": 0, "w": 180, "h": 100 }
    ],
    "edges": [
      { "id": "e1", "type": "association", "label": "1..*", "source": "n-project", "target": "n-requirement" }
    ]
  }
}
```
