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
