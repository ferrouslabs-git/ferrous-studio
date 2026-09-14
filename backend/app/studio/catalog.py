"""The canvas editor's component vocabulary, mirrored from the frontend.

``catalog.json`` is generated (``npm run catalog:emit`` in
``frontend/app/web``) from ``features/studio/catalog.ts`` and pinned there by
``catalog.mirror.test.ts`` -- editing the catalogue without re-emitting fails
the frontend test suite. This module only ever reads the JSON; it never
computes catalogue facts itself, so the bundle validator can never see a
component, shape, layout or element the canvas editor does not actually have.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).parent / "catalog.json"


@dataclass(frozen=True)
class ElementCatalog:
    fields: frozenset[str]
    max: int | None
    shapeable: bool
    fillable: bool


@dataclass(frozen=True)
class ComponentCatalog:
    shapes: frozenset[str]
    layouts: frozenset[str]
    elements: dict[str, ElementCatalog]


@dataclass(frozen=True)
class Catalog:
    data_kinds: frozenset[str]
    input_kinds: frozenset[str]
    presentations: frozenset[str]
    retired: frozenset[str]
    uml_node_types: frozenset[str]
    uml_edge_types: frozenset[str]
    #: The palette's own default size per node type, reused by grid_layout
    #: for a diagram node the bundle left ungeometried.
    uml_node_defaults: dict[str, tuple[int, int]]
    components: dict[str, ComponentCatalog]

    def component(self, component_type: str) -> ComponentCatalog | None:
        return self.components.get(component_type)

    def element(self, component_type: str, element_type: str) -> ElementCatalog | None:
        component = self.components.get(component_type)
        return component.elements.get(element_type) if component else None


def _parse(raw: dict[str, Any]) -> Catalog:
    components = {
        name: ComponentCatalog(
            shapes=frozenset(meta["shapes"]),
            layouts=frozenset(meta["layouts"]),
            elements={
                el_type: ElementCatalog(
                    fields=frozenset(el["fields"]),
                    max=el["max"],
                    shapeable=el["shapeable"],
                    fillable=el["fillable"],
                )
                for el_type, el in meta["elements"].items()
            },
        )
        for name, meta in raw["components"].items()
    }
    return Catalog(
        data_kinds=frozenset(raw["dataKinds"]),
        input_kinds=frozenset(raw["inputKinds"]),
        presentations=frozenset(raw["presentations"]),
        retired=frozenset(raw["retired"]),
        uml_node_types=frozenset(raw["umlNodeTypes"]),
        uml_edge_types=frozenset(raw["umlEdgeTypes"]),
        uml_node_defaults={t: (d["w"], d["h"]) for t, d in raw["umlNodeDefaults"].items()},
        components=components,
    )


@lru_cache(maxsize=1)
def get_catalog() -> Catalog:
    """The parsed catalogue, read once per process.

    ``lru_cache`` rather than a module-level constant so a test can clear it
    (``get_catalog.cache_clear()``) and re-read a fixture file if it ever
    needs to point ``CATALOG_PATH`` somewhere else -- nothing does today.
    """
    with CATALOG_PATH.open() as f:
        raw = json.load(f)
    return _parse(raw)


# ── The bundle format guide ──────────────────────────────────────────────
#
# Shared prose teaching an LLM the bundle format create_bundle_content (see
# importing.py) actually accepts -- originally project_agent.py's own
# prompt-building code, moved here once a second caller needed it
# (board_mcp.py's wireframe tools, for the client's MCP-first direction --
# docs/project-agent-implementation-plan.md) so both read the exact same
# text instead of a hand-copied, driftable second version. board_mcp.py has
# no import access to this module (deliberately isolated, see its own
# docstring), so it fetches this text over HTTP instead -- see the
# bundle_format_guide route wherever it is registered.

#: Short, per-component usage hints. Not safety-critical -- a wrong hint
#: makes a worse suggestion, never an invalid bundle, since validate_bundle
#: (via create_bundle_content) is the real gate regardless of what the
#: model does with this text.
COMPONENT_HINTS = {
    "navbar": "primary nav, a sidebar, a top tab strip, a breadcrumb trail",
    "list": "a data table, card grid, settings list, activity feed -- shape: table + column elements is the default for tabular data",
    "form": "a create/edit form, settings page, login form, multi-step wizard (shape: wizard + step elements)",
    "graph": "any chart, or KPI tiles (shape: stats + one stat element per tile)",
    "calendar": "a scheduler or booking calendar -- rare; most date-oriented needs are actually a list with a date column",
    "canvas": "anything else: a hero, a detail panel of labelled values (label+text pairs), a dashboard's free-form section, prose -- when nothing else fits, it's a canvas",
}


def catalogue_reference() -> str:
    """The bundle format's component vocabulary, generated from the real
    catalogue rather than hand-copied into the prompt -- this can never
    drift out of sync with what create_bundle_content actually accepts."""
    catalog = get_catalog()
    lines = ["Only six component types exist in a page's layout -- nothing else is valid:"]
    for name, hint in COMPONENT_HINTS.items():
        component = catalog.component(name)
        if component is None:
            continue
        shapes = ", ".join(sorted(component.shapes))
        layouts = ", ".join(sorted(component.layouts))
        elements = ", ".join(sorted(component.elements))
        lines.append(f"- {name} -- shapes: {shapes}. layouts: {layouts}. elements: {elements}. Use for: {hint}.")
    lines.append("")
    lines.append(f'Column element data.kind: {", ".join(sorted(catalog.data_kinds))}.')
    lines.append(f'Text-input element data.kind (a smaller, different list): {", ".join(sorted(catalog.input_kinds))}.')
    lines.append(
        f'A page that opens as an overlay instead of navigating sets "presentation" to one of: '
        f'{", ".join(sorted(catalog.presentations))}.'
    )
    lines.append("")
    lines.append(f'Diagram node types (model.nodes[].type): {", ".join(sorted(catalog.uml_node_types))}.')
    lines.append(f'Diagram edge types (model.edges[].type): {", ".join(sorted(catalog.uml_edge_types))}.')
    return "\n".join(lines)


#: A minimal but complete, valid example -- shown verbatim because prose
#: description alone was not enough in practice: a live run asked to
#: reverse-engineer a plausible app put every element's label under
#: data.label/data.text instead of as a top-level field, invented fields
#: like "icon" that don't exist, and omitted "size" on the root layout node.
#: An example anchors the exact shape in a way a list of field names doesn't.
WORKED_EXAMPLE = """
{
  "wireframes": [{
    "name": "Example app", "interfaceType": "desktop", "landingPageId": "page-dashboard",
    "pages": [
      {
        "id": "page-dashboard", "name": "Dashboard",
        "layout": {
          "kind": "split", "dir": "row", "size": {"fr": 1},
          "children": [
            {"kind": "region", "id": "r-nav", "size": 220, "components": [
              {"id": "c-nav", "type": "navbar", "shape": "plain", "layout": "vertical", "elements": [
                {"id": "e-brand", "type": "brand", "label": "Example app"},
                {"id": "e-home", "type": "nav-item", "label": "Dashboard", "props": {"links": {"e-home": {"pageId": "page-dashboard"}}}},
                {"id": "e-settings", "type": "nav-item", "label": "Settings", "props": {"links": {"e-settings": {"pageId": "page-settings"}}}}
              ]}
            ]},
            {"kind": "region", "id": "r-content", "size": {"fr": 1}, "components": [
              {"id": "c-stats", "type": "graph", "shape": "stats", "layout": "horizontal", "elements": [
                {"id": "e-stat1", "type": "stat", "label": "Active users", "data": {"value": "128"}}
              ]}
            ]}
          ]
        }
      },
      {
        "id": "page-settings", "name": "Settings", "route": "/settings",
        "placement": {"page_id": "page-dashboard", "region_id": "r-content"},
        "layout": {"kind": "region", "id": "r-root", "size": {"fr": 1}, "components": [
          {"id": "c-form", "type": "form", "shape": "simple", "layout": "one-column", "elements": [
            {"id": "e-header", "type": "header", "label": "Account settings"},
            {"id": "e-name", "type": "text-input", "label": "Name", "data": {"kind": "text"}},
            {"id": "e-submit", "type": "button", "label": "Save"}
          ]}
        ]}
      }
    ]
  }],
  "diagrams": [{
    "name": "Data model", "kind": "class",
    "model": {
      "nodes": [
        {"id": "n-user", "type": "entity", "label": "User", "text": "id\\nname\\nemail", "x": 0, "y": 0, "w": 180, "h": 100}
      ],
      "edges": []
    }
  }]
}
""".strip()

BUNDLE_FORMAT_GUIDE = (
    "wireframes: a list of {name, interfaceType (desktop/tablet/mobile), landingPageId, "
    "pages}. Each page: {id (any short readable string, e.g. \"page-dashboard\"), name, "
    "route (optional), layout, placement (optional, {page_id, region_id} for a page that "
    "renders inside another page's shell)}. A layout is a nested tree, and EVERY node in it "
    '-- including the outermost/root one -- needs its own "size": {"kind": "region", "id", '
    '"size" ({"fr": 1}, a positive integer, or "auto"), "components": [...]} or {"kind": '
    '"split", "dir": "row"/"col", "size", "children": [<region or split>, ...]}. A component: '
    "{id, type (one of the six below), shape, layout, elements}. An element: {id, type, "
    '"label" (a plain string, directly on the element -- see the common mistakes below), '
    '"data" (optional, only the specific fields that element type actually takes -- e.g. '
    '"kind"/"samples"/"placeholder"/"value", never invented ones), "props": {"links": '
    '{<element id>: {"pageId": <page id or "@back">}}} only on elements that navigate}. '
    "Write shell/nav pages after every page they link to, so every nav-item's link resolves "
    "to a page id that's actually in the SAME wireframe's pages list. Sample data "
    "(data.samples) is invented, never a real person's data.\n\n"
    "Common mistakes to avoid (all seen in real runs):\n"
    '- An element\'s label is a TOP-LEVEL field: {"type": "nav-item", "label": "Dashboard"} '
    '-- never {"data": {"label": ...}} or {"data": {"text": ...}}.\n'
    "- Only use fields a given element type actually has. Don't add fields like \"icon\" or "
    '"title" that aren\'t in its list just because they seem plausible.\n'
    '- The root layout node needs a "size" too, not just its children.\n\n'
    f"{catalogue_reference()}\n\n"
    "diagrams: a list of {name, kind (class/freeform/usecase/activity/sequence/state), model: "
    "{nodes, edges}}. A node: {id, type, label, text (optional multi-line detail), x, y, w, h "
    "(position may be omitted and will be grid-placed, but lay nodes out yourself in a simple "
    "grid, roughly 240px pitch, for a readable result)}. An edge: {id, type, label (optional), "
    "source, target}. For a data-model diagram (kind: class): one entity node per table, "
    '"text" listing its fields one per line; association edges labelled with cardinality '
    "(1..*, 0..1, etc).\n\n"
    "A complete, valid example (follow this shape exactly):\n"
    f"{WORKED_EXAMPLE}"
)
