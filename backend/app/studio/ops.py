"""Generic, id-addressed op application for one page document.

Pure functions over plain dicts so this is unit-testable without a database.
Deliberately knows nothing about Ferrous's region rules, smart dock or slot
trees: it resolves an entity by id, checks its version, and applies a
set / insert / remove / move. Domain logic lives in the TypeScript reducer
and is never duplicated here.

Document shape (per page)::

    {"frames": [ {"id", "label", "pos", "layoutMode": "regions"|"flat",
                  "layout": {"regions": {region: [cmp, ...]}, "options": {...}}
                        | {"components": [cmp, ...]} } ]}

Components carry ``pos`` (a fractional index string); lists are kept in
insertion order here and sorted by ``pos`` on read and export.

Conflict rule: every op names an entity (the page itself, a frame, or a
component). If that entity changed after the ``base_version`` the client last
saw, the whole batch is rejected with the conflicting ids. Inserts are exempt:
two people adding to the same frame at once should both succeed.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any

REGIONS = ("header", "sidebar", "main", "right", "footer")
PAGE_KEY = "page"  # entity_versions key for the page's own columns
PAGE_SETTABLE = {"name", "route", "pos"}


@dataclass
class PageState:
    """Just enough of a project_pages row to apply ops to."""

    name: str
    route: str | None
    pos: str
    document: dict[str, Any]
    entity_versions: dict[str, int]
    version: int


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


def _frames(doc: dict[str, Any]) -> list[dict[str, Any]]:
    return doc.setdefault("frames", [])


def _find_frame(doc: dict[str, Any], frame_id: str) -> dict[str, Any]:
    for f in _frames(doc):
        if f.get("id") == frame_id:
            return f
    raise OpError(f"frame not found: {frame_id}")


def _component_lists(frame: dict[str, Any]) -> list[tuple[str | None, list[dict[str, Any]]]]:
    layout = frame.setdefault("layout", {})
    if frame.get("layoutMode") == "regions":
        regions = layout.setdefault("regions", {})
        return [(r, regions.setdefault(r, [])) for r in REGIONS]
    return [(None, layout.setdefault("components", []))]


def _find_component(frame: dict[str, Any], cmp_id: str) -> tuple[list[dict[str, Any]], int]:
    for _region, items in _component_lists(frame):
        for i, c in enumerate(items):
            if c.get("id") == cmp_id:
                return items, i
    raise OpError(f"component not found: {cmp_id}")


def _target_list(frame: dict[str, Any], region: str | None) -> list[dict[str, Any]]:
    if frame.get("layoutMode") == "regions":
        if region not in REGIONS:
            raise OpError(f"region required and must be one of {REGIONS}")
        return frame["layout"]["regions"].setdefault(region, [])
    return frame["layout"].setdefault("components", [])


def _entity_key(op: dict[str, Any]) -> str:
    target = op.get("target") or {}
    return target.get("cmp") or target.get("frame") or PAGE_KEY


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
    frame_id = target.get("frame")
    cmp_id = target.get("cmp")
    doc = state.document

    if kind == "set":
        path = op.get("path")
        if not isinstance(path, str):
            raise OpError("set requires a path")
        value = op.get("value")
        if cmp_id:
            frame = _find_frame(doc, frame_id) if frame_id else None
            if frame is None:
                raise OpError("set on a component requires target.frame")
            items, i = _find_component(frame, cmp_id)
            _set_path(items[i], path, value)
            return [cmp_id]
        if frame_id:
            _set_path(_find_frame(doc, frame_id), path, value)
            return [frame_id]
        if path not in PAGE_SETTABLE:
            raise OpError(f"page fields settable via ops: {sorted(PAGE_SETTABLE)}")
        setattr(state, path, value)
        return [PAGE_KEY]

    if kind == "insert":
        value = op.get("value")
        if not isinstance(value, dict) or not isinstance(value.get("id"), str) or not value["id"]:
            raise OpError("insert value must be an object with a string id")
        into = op.get("into") or {}
        if frame_id:
            frame = _find_frame(doc, frame_id)
            for _r, items in _component_lists(frame):
                if any(c.get("id") == value["id"] for c in items):
                    raise OpError(f"duplicate component id: {value['id']}")
            _target_list(frame, into.get("region")).append(value)
            return [value["id"]]
        if into.get("list") != "frames":
            raise OpError("insert without target.frame must use into.list = 'frames'")
        if any(f.get("id") == value["id"] for f in _frames(doc)):
            raise OpError(f"duplicate frame id: {value['id']}")
        _frames(doc).append(value)
        return [value["id"]]

    if kind == "remove":
        if cmp_id:
            if not frame_id:
                raise OpError("remove on a component requires target.frame")
            items, i = _find_component(_find_frame(doc, frame_id), cmp_id)
            items.pop(i)
            return [cmp_id]
        if frame_id:
            frames = _frames(doc)
            idx = next((i for i, f in enumerate(frames) if f.get("id") == frame_id), None)
            if idx is None:
                raise OpError(f"frame not found: {frame_id}")
            frames.pop(idx)
            return [frame_id]
        raise OpError("remove requires target.frame or target.cmp")

    if kind == "move":
        if not (frame_id and cmp_id):
            raise OpError("move requires target.frame and target.cmp")
        to = op.get("to") or {}
        if not isinstance(to.get("pos"), str):
            raise OpError("move requires to.pos")
        frame = _find_frame(doc, frame_id)
        items, i = _find_component(frame, cmp_id)
        cmp = items.pop(i)
        cmp["pos"] = to["pos"]
        dest = _target_list(frame, to.get("region")) if "region" in to else items
        dest.append(cmp)
        return [cmp_id]

    raise OpError(f"unknown op: {kind!r}")


# ── Read-side helpers ───────────────────────────────────────────────────────


def _by_pos(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items, key=lambda x: str(x.get("pos", "")))


def export_page(page_id: str, state: PageState) -> dict[str, Any]:
    """The page as it appears in the export envelope: lists ordered by pos,
    with ``pos`` stripped so the payload matches the pre-existing format."""

    def strip(obj: dict[str, Any]) -> dict[str, Any]:
        # Drop pos (storage-only) and nulls (a client "unsets" a key by setting null).
        return {k: v for k, v in obj.items() if k != "pos" and v is not None}

    frames_out = []
    for frame in _by_pos(_frames(deepcopy(state.document))):
        layout = frame.get("layout", {})
        if frame.get("layoutMode") == "regions":
            regions = {r: [strip(c) for c in _by_pos(layout.get("regions", {}).get(r, []))] for r in REGIONS}
            layout_out = {"regions": regions, "options": layout.get("options", {})}
        else:
            layout_out = {"components": [strip(c) for c in _by_pos(layout.get("components", []))]}
        out = strip(frame)
        out["layout"] = layout_out
        frames_out.append(out)

    return {"id": page_id, "name": state.name, "route": state.route, "frames": frames_out}
