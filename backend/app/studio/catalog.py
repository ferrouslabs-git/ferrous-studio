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
    #: The element's type (FS-REQ-84): text, input, action, ui, image or
    #: basic. The element's own id is its shape.
    group: str
    fields: frozenset[str]
    max: int | None
    variantable: bool
    fillable: bool


@dataclass(frozen=True)
class ElementRemap:
    """What an element of a shape its host withdrew becomes (FS-REQ-84)."""

    type: str
    rename: dict[str, str]
    data: dict[str, str]


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
    #: host -> old shape -> remap, or None where the element is dropped.
    retired_elements: dict[str, dict[str, ElementRemap | None]]
    #: element data keys renamed in every host (old -> new).
    renamed_element_data: dict[str, str]
    #: the icon library's names (an icon element's data.icon).
    icons: frozenset[str]

    def component(self, component_type: str) -> ComponentCatalog | None:
        return self.components.get(component_type)

    def element(self, component_type: str, element_type: str) -> ElementCatalog | None:
        component = self.components.get(component_type)
        return component.elements.get(element_type) if component else None

    def any_element(self, element_type: str) -> ElementCatalog | None:
        """A shape's entry from whichever host has it -- for an element whose
        own host withdrew its shape (see retired_elements)."""
        for component in self.components.values():
            if element_type in component.elements:
                return component.elements[element_type]
        return None


def _parse(raw: dict[str, Any]) -> Catalog:
    components = {
        name: ComponentCatalog(
            shapes=frozenset(meta["shapes"]),
            layouts=frozenset(meta["layouts"]),
            elements={
                el_type: ElementCatalog(
                    group=el["group"],
                    fields=frozenset(el["fields"]),
                    max=el["max"],
                    variantable=el["variantable"],
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
        retired_elements={
            host: {
                old: (
                    ElementRemap(
                        type=remap["type"],
                        rename=dict(remap.get("rename") or {}),
                        data=dict(remap.get("data") or {}),
                    )
                    if remap
                    else None
                )
                for old, remap in table.items()
            }
            for host, table in raw.get("retiredElements", {}).items()
        },
        renamed_element_data=dict(raw.get("renamedElementData", {})),
        icons=frozenset(raw.get("icons", [])),
    )


# ── Element migration (FS-REQ-84) ────────────────────────────────────────
# Shared by the importer (before validating a bundle) and the wireframe
# export (so what an agent reads back is already in today's scheme).


def _own_data_keys(meta: ElementCatalog | None) -> set[str]:
    """The data keys a shape owns: its fields, plus variant/fill where
    offered. Placement and styling keys belong to no shape."""
    if meta is None:
        return set()
    keys = set(meta.fields)
    if meta.variantable:
        keys.add("variant")
    if meta.fillable:
        keys.add("fill")
    return keys


def _first_of_list(value: Any) -> str:
    if isinstance(value, list):
        return str(value[0] if value else "").strip()
    return str(value if value is not None else "").split(",")[0].strip()


def _remap_element(element: dict[str, Any], host: str, catalog: Catalog) -> bool:
    """The importer's copy of the frontend's read-time element migration
    (model/migrate.ts remapElement, FS-REQ-84), driven by the same
    catalog.json tables: renamed data keys (data.shape -> data.variant), and
    an element of a shape its host withdrew becomes the mapped shape. Mutates
    ``element``; False means drop it."""
    data = element.get("data")
    if isinstance(data, dict):
        for old, new in catalog.renamed_element_data.items():
            if old in data:
                data.setdefault(new, data[old])
                del data[old]
    el_type = element.get("type")
    table = catalog.retired_elements.get(host, {})
    if not isinstance(el_type, str) or el_type not in table:
        return True
    remap = table[el_type]
    target = catalog.element(host, remap.type) if remap else None
    if remap is None or target is None:
        return False
    from_keys = _own_data_keys(catalog.any_element(el_type))
    to_keys = _own_data_keys(target)
    out: dict[str, Any] = {}
    for key, value in (data if isinstance(data, dict) else {}).items():
        if key in remap.rename:
            out[remap.rename[key]] = _first_of_list(value)
        elif key not in from_keys or key in to_keys:
            out[key] = value
    out.update(remap.data)
    out = {k: v for k, v in out.items() if v != ""}
    element["type"] = remap.type
    if out:
        element["data"] = out
    else:
        element.pop("data", None)
    return True


def gather_legacy_steps(elements: list[Any]) -> list[Any]:
    """A wizard-shaped form listed every step first and every field after
    them; steps now own the fields that follow them (FS-REQ-89). When the
    steps run together ahead of the fields, the later steps move after the
    last field, so the first step keeps what the form showed. Mirrors
    gatherLegacySteps in the frontend's model/migrate.ts."""
    def kind(e: Any) -> str:
        return e.get("type", "") if isinstance(e, dict) else ""

    flow = [e for e in elements if kind(e) not in ("header", "button")]
    first = next((i for i, e in enumerate(flow) if kind(e) == "step"), -1)
    if first < 0:
        return elements
    end = first
    while end < len(flow) and kind(flow[end]) == "step":
        end += 1
    later = flow[first + 1:end]
    if not later or end == len(flow) or any(kind(e) == "step" for e in flow[end:]):
        return elements
    last_field = flow[-1]
    ordered: list[Any] = []
    for e in elements:
        if any(e is m for m in later):
            continue
        ordered.append(e)
        if e is last_field:
            ordered.extend(later)
    return ordered


def normalise_legacy_elements(pages: Any, catalog: Catalog) -> None:
    """Carry export-shaped pages written before FS-REQ-84 across to today's
    element scheme, in place -- so a wireframe exported earlier (or read back
    through get_wireframe, which exports what is stored) re-imports cleanly.
    Applied before validation; anything malformed is left for the validator
    to report."""
    if not isinstance(pages, list):
        return

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        for child in node.get("children") or []:
            walk(child)
        for component in node.get("components") or []:
            if not isinstance(component, dict):
                continue
            # A wizard was a form shape until it became its own component
            # (FS-REQ-89); the steps, fields and buttons carry straight over.
            if component.get("type") == "form" and component.get("shape") == "wizard":
                component["type"] = "wizard"
                component["shape"] = "steps"
                if component.get("layout") == "two-column":
                    props = component.setdefault("props", {})
                    if isinstance(props, dict):
                        props.setdefault("columns", "2")
                if component.get("layout") != "horizontal":
                    component["layout"] = "one-column"
                if isinstance(component.get("elements"), list):
                    component["elements"] = gather_legacy_steps(component["elements"])
            if not isinstance(component.get("elements"), list):
                continue
            host = component.get("type")
            if not isinstance(host, str) or catalog.component(host) is None:
                continue
            kept = [e for e in component["elements"] if not isinstance(e, dict) or _remap_element(e, host, catalog)]
            if len(kept) != len(component["elements"]):
                dropped = {e.get("id") for e in component["elements"] if isinstance(e, dict) and e not in kept}
                component["elements"] = kept
                # A link keyed by a dropped element has nothing left to address.
                props = component.get("props")
                links = props.get("links") if isinstance(props, dict) else None
                if isinstance(links, dict):
                    for element_id in dropped:
                        links.pop(element_id, None)
                        links.pop(f"el:{element_id}", None)

    for page in pages:
        if isinstance(page, dict):
            walk(page.get("layout"))


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
    "form": "a create/edit form, settings page, login form -- one page of fields",
    "wizard": "a multi-step form: each step element owns the fields after it, up to the next step; buttons sit under every step",
    "graph": "any chart, or KPI tiles (shape: stats + one stat element per tile)",
    "calendar": "a scheduler or booking calendar -- rare; most date-oriented needs are actually a list with a date column",
    "canvas": "anything else: a hero, a detail panel of labelled values (label+text pairs), a dashboard's free-form section, prose -- when nothing else fits, it's a canvas",
}


#: On-screen names of the element types (FS-REQ-84), in their order.
ELEMENT_GROUP_LABELS = {
    "text": "Text",
    "input": "Input",
    "action": "Action",
    "ui": "UI element",
    "image": "Image",
    "basic": "Basic",
}


def _elements_by_type(component: ComponentCatalog) -> str:
    """A component's element ids grouped under their type, e.g.
    "Text (heading, label) / Action (button)"."""
    parts = []
    for group, label in ELEMENT_GROUP_LABELS.items():
        ids = sorted(el_type for el_type, el in component.elements.items() if el.group == group)
        if ids:
            parts.append(f"{label} ({', '.join(ids)})")
    return " / ".join(parts)


def catalogue_reference() -> str:
    """The bundle format's component vocabulary, generated from the real
    catalogue rather than hand-copied into the prompt -- this can never
    drift out of sync with what create_bundle_content actually accepts."""
    catalog = get_catalog()
    lines = ["Only seven component types exist in a page's layout -- nothing else is valid:"]
    for name, hint in COMPONENT_HINTS.items():
        component = catalog.component(name)
        if component is None:
            continue
        shapes = ", ".join(sorted(component.shapes))
        layouts = ", ".join(sorted(component.layouts))
        elements = _elements_by_type(component)
        lines.append(f"- {name} -- shapes: {shapes}. layouts: {layouts}. elements: {elements}. Use for: {hint}.")
    lines.append("")
    lines.append(
        "Every element is a SHAPE of one of six element TYPES -- Text, Input, Action, UI element, Image, "
        "Basic. An element's \"type\" field holds its shape id, as listed per component above (the "
        "element type in brackets is implied by the id, never written). Where an element supports it, "
        'data.variant picks its corners: square, rounded or pill (data.fill: filled, outline or ghost). '
        "A canvas places any of its elements freely with data.x/data.y (and data.w/data.h). Canvas "
        "icon: data.icon names a library icon -- one of: " + ", ".join(sorted(catalog.icons)) + "."
    )
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
    "{id, type (one of the seven below), shape, layout, elements}. An element: {id, type, "
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
