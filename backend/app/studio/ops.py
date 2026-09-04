"""Generic, id-addressed op application for one page document.

Pure functions over plain dicts so this is unit-testable without a database.
Deliberately knows nothing about Ferrous's component vocabulary: it resolves
an entity by id, checks its version, and applies a set / insert / remove /
move. Domain logic lives in the TypeScript reducer and is never duplicated
here.

Document shape (per page)::

    {"root": <layout node>, "regions": {region_id: [cmp, ...]}}

A layout node is either a region leaf ``{"kind": "region", "id", "label"?,
"size", "dir"?, "bg"?}`` -- ``dir: "row"`` stacks the region's components
horizontally -- or a split ``{"kind": "split", "id", "dir": "row"|"col",
"size", "children": [node, ...]}``. The tree is authoritative for which regions
exist; component lists live beside it keyed by region id. Replacing the tree
(``set`` with path ``root`` and no target) never deletes component lists --
lists for regions the tree lost are inert and pruned by the client on its
next normalise.

Components carry ``pos`` (a fractional index string); lists are kept in
insertion order here and sorted by ``pos`` on read and export.

Conflict rule: every op names an entity (the page's own columns, the layout
tree, or a component). If that entity changed after the ``base_version`` the
client last saw, the whole batch is rejected with the conflicting ids.
Inserts are exempt: two people adding to the same region at once should both
succeed.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from collections.abc import Iterator
from typing import Any

from .positions import key_after

PAGE_KEY = "page"  # entity_versions key for the page's own columns
LAYOUT_KEY = "layout"  # entity_versions key for the layout tree
PAGE_SETTABLE = {"name", "route", "pos", "presentation"}

#: Data key an element binds a dataset id to. Mirrors the two catalogue
#: fields that use it (catalog.ts, kind "dataset"); the value is either a
#: ``datasets`` row id or a shared ``platform_datasets`` one.
DATASET_DATA_KEY = "dataset"

# How a page opens when linked to; None is an ordinary navigate-to page.
# "drawer" slides from the right edge, "drawer-left" from the left.
PRESENTATIONS = {"modal", "drawer", "drawer-left"}


@dataclass
class PageState:
    """Just enough of a project_pages row to apply ops to."""

    name: str
    route: str | None
    pos: str
    document: dict[str, Any]
    entity_versions: dict[str, int]
    version: int
    placement: dict[str, Any] | None = None
    presentation: str | None = None


@dataclass
class ApplyResult:
    page: PageState
    touched: list[str] = field(default_factory=list)


class OpError(ValueError):
    """The batch is malformed or targets something that does not exist."""


class OpConflict(Exception):
    def __init__(self, conflicts: list[dict[str, Any]], version: int):
        super().__init__("conflict")
        self.conflicts = conflicts
        self.version = version


# ── Resolution ──────────────────────────────────────────────────────────────


def _regions(doc: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return doc.setdefault("regions", {})


def _tree_region_ids(node: Any) -> list[str]:
    if not isinstance(node, dict):
        return []
    if node.get("kind") == "split":
        out: list[str] = []
        for child in node.get("children") or []:
            out.extend(_tree_region_ids(child))
        return out
    node_id = node.get("id")
    return [node_id] if isinstance(node_id, str) else []


# Public alias: annotations.py resolves annotation targets with the same walk.
tree_region_ids = _tree_region_ids


def _find_component(doc: dict[str, Any], cmp_id: str) -> tuple[list[dict[str, Any]], int]:
    for items in _regions(doc).values():
        for i, c in enumerate(items):
            if c.get("id") == cmp_id:
                return items, i
    raise OpError(f"component not found: {cmp_id}")


def _target_list(doc: dict[str, Any], region: str | None) -> list[dict[str, Any]]:
    if not region or region not in _tree_region_ids(doc.get("root")):
        raise OpError("region required and must exist in the layout tree")
    return _regions(doc).setdefault(region, [])


def _entity_key(op: dict[str, Any]) -> str:
    target = op.get("target") or {}
    cmp = target.get("cmp")
    if cmp:
        return cmp
    if op.get("op") == "set" and op.get("path") == "root":
        return LAYOUT_KEY
    return PAGE_KEY


def _set_path(obj: dict[str, Any], path: str, value: Any) -> None:
    parts = [p for p in path.split(".") if p]
    if not parts:
        raise OpError("empty path")
    if parts[0] == "id":
        raise OpError("id is immutable")
    cur = obj
    for p in parts[:-1]:
        nxt = cur.get(p)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[p] = nxt
        cur = nxt
    cur[parts[-1]] = value


# ── Apply ───────────────────────────────────────────────────────────────────


def apply_batch(state: PageState, ops: list[dict[str, Any]], base_version: int) -> ApplyResult:
    """Apply ``ops`` to a copy of ``state``. Raises OpConflict or OpError; on
    either, the caller's state is untouched."""
    if not ops:
        raise OpError("empty batch")

    # Pass 1: conflicts, before touching anything.
    conflicts: list[dict[str, Any]] = []
    for op in ops:
        if op.get("op") == "insert":
            continue
        key = _entity_key(op)
        seen_at = int(state.entity_versions.get(key, 0))
        if seen_at > base_version:
            conflicts.append({"entity_id": key, "current_version": seen_at})
    if conflicts:
        raise OpConflict(conflicts, state.version)

    # Pass 2: apply to a copy.
    new = PageState(
        name=state.name,
        route=state.route,
        pos=state.pos,
        document=deepcopy(state.document),
        entity_versions=dict(state.entity_versions),
        version=state.version + 1,
        placement=deepcopy(state.placement),
        presentation=state.presentation,
    )
    touched: list[str] = []
    for op in ops:
        touched.extend(_apply_one(new, op))
    for key in touched:
        new.entity_versions[key] = new.version
    return ApplyResult(page=new, touched=touched)


def _apply_one(state: PageState, op: dict[str, Any]) -> list[str]:
    kind = op.get("op")
    target = op.get("target") or {}
    cmp_id = target.get("cmp")
    doc = state.document

    if kind == "set":
        path = op.get("path")
        if not isinstance(path, str):
            raise OpError("set requires a path")
        value = op.get("value")
        if cmp_id:
            items, i = _find_component(doc, cmp_id)
            _set_path(items[i], path, value)
            return [cmp_id]
        if path == "root":
            if not isinstance(value, dict) or not isinstance(value.get("id"), str):
                raise OpError("root must be a layout node")
            doc.pop("frames", None)  # pre-tree format, replaced wholesale
            _regions(doc)
            doc["root"] = value
            return [LAYOUT_KEY]
        if path not in PAGE_SETTABLE:
            raise OpError(f"page fields settable via ops: {sorted(PAGE_SETTABLE)}")
        if path == "presentation" and value is not None and value not in PRESENTATIONS:
            raise OpError(f"presentation must be one of {sorted(PRESENTATIONS)} or null")
        setattr(state, path, value)
        return [PAGE_KEY]

    if kind == "insert":
        value = op.get("value")
        if not isinstance(value, dict) or not isinstance(value.get("id"), str) or not value["id"]:
            raise OpError("insert value must be an object with a string id")
        into = op.get("into") or {}
        for items in _regions(doc).values():
            if any(c.get("id") == value["id"] for c in items):
                raise OpError(f"duplicate component id: {value['id']}")
        _target_list(doc, into.get("region")).append(value)
        return [value["id"]]

    if kind == "remove":
        if not cmp_id:
            raise OpError("remove requires target.cmp")
        items, i = _find_component(doc, cmp_id)
        items.pop(i)
        return [cmp_id]

    if kind == "move":
        if not cmp_id:
            raise OpError("move requires target.cmp")
        to = op.get("to") or {}
        if not isinstance(to.get("pos"), str):
            raise OpError("move requires to.pos")
        items, i = _find_component(doc, cmp_id)
        cmp = items.pop(i)
        cmp["pos"] = to["pos"]
        # A same-region reorder carries no region (the schema still dumps
        # `region: None`), so only re-home the component when one is given.
        dest = _target_list(doc, to["region"]) if to.get("region") else items
        dest.append(cmp)
        return [cmp_id]

    raise OpError(f"unknown op: {kind!r}")


# ── Read-side helpers ───────────────────────────────────────────────────────


def _by_pos(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items, key=lambda x: str(x.get("pos", "")))


def export_page(page_id: str, state: PageState) -> dict[str, Any]:
    """The page as it appears in the export envelope: the layout tree with
    each region's components embedded in pos order, ``pos`` stripped."""

    def strip(obj: dict[str, Any]) -> dict[str, Any]:
        # Drop pos (storage-only) and nulls (a client "unsets" a key by setting
        # null) at every level: a component's ``elements`` are pos-ordered
        # child dicts and export like components do.
        out: dict[str, Any] = {}
        for k, v in obj.items():
            if k == "pos" or v is None:
                continue
            if isinstance(v, list) and v and all(isinstance(x, dict) for x in v):
                v = [strip(x) for x in sorted(v, key=lambda x: str(x.get("pos", "")))]
            out[k] = v
        return out

    doc = deepcopy(state.document)
    regions = doc.get("regions") if isinstance(doc.get("regions"), dict) else {}
    root = doc.get("root")
    if not isinstance(root, dict):
        root = {"kind": "region", "id": "r-root", "size": {"fr": 1}}

    def embed(node: dict[str, Any]) -> dict[str, Any]:
        if node.get("kind") == "split":
            return {
                "kind": "split",
                "id": node.get("id"),
                "dir": node.get("dir"),
                "size": node.get("size"),
                "children": [embed(c) for c in node.get("children") or [] if isinstance(c, dict)],
            }
        out = {k: v for k, v in node.items() if v is not None}
        out["components"] = [strip(c) for c in _by_pos(regions.get(node.get("id"), []))]
        return out

    out = {"id": page_id, "name": state.name, "route": state.route, "layout": embed(root)}
    if state.placement:
        out["placement"] = state.placement
    if state.presentation:
        out["presentation"] = state.presentation
    return out


def import_page(data: dict[str, Any]) -> dict[str, Any]:
    """Invert ``export_page``: rebuild the stored document (layout tree plus
    per-region component lists) from the export shape. Array order is
    authoritative where the export stripped ``pos`` -- region component lists
    and each component's ``elements`` -- so fresh strictly-increasing keys are
    assigned in that order."""

    def repos(items: list[Any]) -> None:
        last: str | None = None
        for item in items:
            if isinstance(item, dict):
                last = key_after(last)
                item["pos"] = last

    regions: dict[str, list[dict[str, Any]]] = {}

    def unembed(node: dict[str, Any]) -> dict[str, Any]:
        if node.get("kind") == "split":
            return {
                "kind": "split",
                "id": node.get("id"),
                "dir": node.get("dir"),
                "size": node.get("size"),
                "children": [unembed(c) for c in node.get("children") or [] if isinstance(c, dict)],
            }
        out = {k: v for k, v in node.items() if k != "components"}
        components = [deepcopy(c) for c in node.get("components") or [] if isinstance(c, dict)]
        repos(components)
        for cmp in components:
            if isinstance(cmp.get("elements"), list):
                repos(cmp["elements"])
        regions[str(node.get("id"))] = components
        return out

    layout = data.get("layout")
    root = unembed(layout) if isinstance(layout, dict) else None
    if root is None or not regions:
        root = {"kind": "region", "id": "r-root", "size": {"fr": 1}}
        regions = {"r-root": []}
    placement = data.get("placement")
    presentation = data.get("presentation")
    route = data.get("route")
    return {
        "name": str(data.get("name") or "Page"),
        "route": route if isinstance(route, str) else None,
        "placement": deepcopy(placement) if isinstance(placement, dict) else None,
        "presentation": presentation if presentation in PRESENTATIONS else None,
        "document": {"root": root, "regions": regions},
    }


# ── Copying a whole wireframe's pages ───────────────────────────────────────

BACK_PAGE_ID = "@back"  # link sentinel: go back, not to a page (see types.ts)


def _walk_components(layout: Any) -> Iterator[dict[str, Any]]:
    """Every component in an export-shaped layout tree, splits included."""
    if not isinstance(layout, dict):
        return
    for child in layout.get("children") or []:
        yield from _walk_components(child)
    for cmp in layout.get("components") or []:
        if isinstance(cmp, dict):
            yield cmp


def remap_page_ids(pages: list[dict[str, Any]], mapping: dict[str, str]) -> list[dict[str, Any]]:
    """Deep-copy export-shaped ``pages`` with every page id rewritten through
    ``mapping``: the page's own id, a child page's ``placement.page_id`` and
    the link targets elements carry (``props.links``).

    Page ids are identity in the database, so copying a wireframe has to mint
    new ones -- and then every reference to an old id has to follow, or the
    copy's links would point back at the original's pages. A target missing
    from the mapping is dropped rather than kept: it would either dangle or,
    worse, reach across into another wireframe. The ``@back`` sentinel is not
    a page id and always survives.
    """

    def remap_link(link: Any) -> Any:
        if not isinstance(link, dict):
            return None
        page_id = link.get("pageId")
        if page_id == BACK_PAGE_ID:
            return dict(link)
        new_id = mapping.get(str(page_id))
        return None if new_id is None else {**link, "pageId": new_id}

    def remap_links(props: dict[str, Any]) -> None:
        links = props.get("links")
        if not isinstance(links, dict):
            return
        for key, entry in list(links.items()):
            if isinstance(entry, list):
                # Index is meaning here (link N belongs to element N), so a
                # dropped target leaves a hole rather than shifting the rest.
                remapped = [remap_link(item) for item in entry]
                while remapped and remapped[-1] is None:
                    remapped.pop()
                if remapped:
                    links[key] = remapped
                else:
                    del links[key]
            else:
                remapped_one = remap_link(entry)
                if remapped_one is None:
                    del links[key]
                else:
                    links[key] = remapped_one
        if not links:
            del props["links"]

    out: list[dict[str, Any]] = []
    for data in pages:
        if not isinstance(data, dict):
            continue
        page = deepcopy(data)
        new_id = mapping.get(str(page.get("id")))
        if new_id is None:
            continue  # a page nothing minted an id for is not part of the copy
        page["id"] = new_id
        placement = page.get("placement")
        if isinstance(placement, dict):
            parent = mapping.get(str(placement.get("page_id")))
            # A placement whose parent did not travel would make the page
            # render inside the original wireframe's shell: promote it instead.
            if parent is None:
                page.pop("placement", None)
            else:
                page["placement"] = {**placement, "page_id": parent}
        for cmp in _walk_components(page.get("layout")):
            if isinstance(cmp.get("props"), dict):
                remap_links(cmp["props"])
        out.append(page)
    return out


def remap_dataset_ids(pages: list[dict[str, Any]], mapping: dict[str, str]) -> None:
    """Rewrite element dataset bindings through ``mapping``, in place.

    Copying a project mints new ``datasets`` rows, so an element still bound to
    the source project's id would read another project's values. Only ids the
    mapping names are touched: a platform dataset is shared rather than copied,
    so its id is absent and correctly left alone -- as is a binding to a dataset
    that no longer exists, which already renders as unbound.

    Unlike ``remap_page_ids`` this mutates the pages it is given; it runs on the
    output of that function, which has already deep-copied.
    """
    for page in pages:
        if not isinstance(page, dict):
            continue
        for cmp in _walk_components(page.get("layout")):
            for element in cmp.get("elements") or []:
                if not isinstance(element, dict):
                    continue
                data = element.get("data")
                if not isinstance(data, dict):
                    continue
                new_id = mapping.get(str(data.get(DATASET_DATA_KEY)))
                if new_id is not None:
                    data[DATASET_DATA_KEY] = new_id
