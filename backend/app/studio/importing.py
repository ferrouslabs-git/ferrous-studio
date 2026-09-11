"""Validating a project import bundle -- the inverse of ``GET
/projects/{id}/export``, checked against exactly the vocabulary the canvas
editor allows (see ``catalog.py``) before anything is created from it.

Pure: no database, no network. This is also what the reverse-engineering
skill runs locally before anyone uploads a bundle (a separate, not-yet-built
plan), so a bundle that reaches the server is one the generator has already
been told is clean.

A bundle is the mirror of ``export_project``/``assemble_wireframe_export``
(see ``projects.py``, ``wireframes.py``), minus the ids the server owns:
wireframe pages carry ``export_page``-shaped documents (``ops.py``), any
string id, remapped to real ids on import. Every top-level section --
``actors``, ``useCases``, ``datasets``, ``wireframes``, ``diagrams`` -- is
optional; a bundle with none of them is rejected as empty.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, get_args
from uuid import UUID, uuid4

from fastapi import APIRouter, Body, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.database import get_db
from app.auth.security import require_permission
from app.auth.security.scope_context import ScopeContext

from .audit import record_event
from .catalog import Catalog, get_catalog
from .common import get_writable_project, next_pos
from .models import Dataset, Persona, Project, ProjectDiagram, UseCase, UseCaseActor, Wireframe, utc_now
from .ops import BACK_PAGE_ID, remap_dataset_ids
from .schemas import DiagramKind, InterfaceType
# _set_actors/_set_personas/_snapshot/insert_pages are wireframes.py's own
# "create a whole wireframe's worth of state at once" helpers -- exactly what
# copy_version_to_wireframe already does from a snapshot, generalised here to
# do it from a bundle instead. Reused rather than copied a third time.
from .wireframes import _set_actors, _set_personas, _snapshot, insert_pages

#: Matches the request-body cap the import route will enforce; checked here
#: too so the skill's local validate.py catches an oversized bundle before
#: anyone uploads it.
MAX_BUNDLE_BYTES = 4 * 1024 * 1024
MAX_PAGES_PER_WIREFRAME = 200

DIAGRAM_KINDS: frozenset[str] = frozenset(get_args(DiagramKind))
INTERFACE_TYPES: frozenset[str] = frozenset(get_args(InterfaceType))

#: The only value a component's own ``props.size`` is ever written as (see
#: setComponentHeight in model/actions.ts) -- "hug" and a fixed pixel height
#: are represented by the key's *absence* and ``props.h`` respectively.
COMPONENT_SIZES: frozenset[str] = frozenset({"fill"})


@dataclass(frozen=True)
class BundleError:
    path: str
    message: str

    def as_dict(self) -> dict[str, str]:
        return {"path": self.path, "message": self.message}


def wrap_bare_envelope(body: dict[str, Any]) -> dict[str, Any]:
    """A bare wireframe export (``schemaVersion`` + ``pages`` at the top
    level, i.e. exactly what ``GET /wireframes/{id}/export`` returns) is
    accepted too, wrapped as ``{"wireframes": [it]}`` -- so Export -> Import
    round-trips a single wireframe without anyone reshaping the file.
    """
    if not isinstance(body, dict) or "wireframes" in body or "pages" not in body:
        return body
    wireframe = dict(body)
    if "name" not in wireframe and "wireframeName" in wireframe:
        wireframe["name"] = wireframe["wireframeName"]
    return {"wireframes": [wireframe]}


def _is_valid_size(value: Any) -> bool:
    if value == "auto":
        return True
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return value > 0
    if isinstance(value, dict) and "fr" in value:
        fr = value["fr"]
        return isinstance(fr, (int, float)) and not isinstance(fr, bool) and fr > 0
    return False


def _iter_components(layout: Any):
    """Every component in an export-shaped layout tree, splits included --
    the same walk as ``ops._walk_components``, kept local rather than
    imported since that helper is private to ``ops.py``."""
    if not isinstance(layout, dict):
        return
    for child in layout.get("children") or []:
        yield from _iter_components(child)
    for cmp in layout.get("components") or []:
        if isinstance(cmp, dict):
            yield cmp


def _validate_layout_tree(
    node: Any, path: str, errors: list[BundleError], region_ids: list[str]
) -> None:
    if not isinstance(node, dict):
        errors.append(BundleError(path, "layout node must be an object"))
        return
    kind = node.get("kind")
    if kind == "split":
        if node.get("dir") not in ("row", "col"):
            errors.append(BundleError(f"{path}.dir", 'split dir must be "row" or "col"'))
        if not _is_valid_size(node.get("size")):
            errors.append(BundleError(f"{path}.size", 'size must be "auto", a positive integer, or {"fr": >0}'))
        children = node.get("children")
        if not isinstance(children, list) or len(children) < 2:
            errors.append(BundleError(f"{path}.children", "a split needs at least 2 children"))
            children = children if isinstance(children, list) else []
        for i, child in enumerate(children):
            _validate_layout_tree(child, f"{path}.children[{i}]", errors, region_ids)
    elif kind == "region":
        region_id = node.get("id")
        if isinstance(region_id, str) and region_id:
            region_ids.append(region_id)
        else:
            errors.append(BundleError(f"{path}.id", "a region needs a non-empty id"))
        if not _is_valid_size(node.get("size")):
            errors.append(BundleError(f"{path}.size", 'size must be "auto", a positive integer, or {"fr": >0}'))
        if "dir" in node and node["dir"] not in ("row", "col", "free"):
            errors.append(BundleError(f"{path}.dir", 'region dir must be "row", "col" or "free"'))
    else:
        errors.append(BundleError(f"{path}.kind", 'layout node kind must be "split" or "region"'))


def _validate_links(
    links: Any, path: str, errors: list[BundleError], page_ids: frozenset[str]
) -> None:
    if not isinstance(links, dict):
        errors.append(BundleError(path, "links must be an object keyed by element/component reference"))
        return
    for key, entry in links.items():
        entries = entry if isinstance(entry, list) else [entry]
        for i, target in enumerate(entries):
            if target is None:
                continue  # a hole: index is meaning, a cleared link leaves a gap
            item_path = f"{path}.{key}[{i}]" if isinstance(entry, list) else f"{path}.{key}"
            if not isinstance(target, dict) or "pageId" not in target:
                errors.append(BundleError(item_path, 'a link target must be {"pageId": ...}'))
                continue
            page_id = target["pageId"]
            if page_id != BACK_PAGE_ID and page_id not in page_ids:
                errors.append(BundleError(f"{item_path}.pageId", f'"{page_id}" is not a page in this wireframe'))


def _validate_element(
    element: Any,
    path: str,
    errors: list[BundleError],
    catalog: Catalog,
    host_component_type: str,
    dataset_ids: frozenset[str],
) -> None:
    if not isinstance(element, dict):
        errors.append(BundleError(path, "an element must be an object"))
        return
    el_type = element.get("type")
    meta = catalog.element(host_component_type, el_type) if isinstance(el_type, str) else None
    if meta is None:
        errors.append(BundleError(f"{path}.type", f'unknown element type "{el_type}" for component "{host_component_type}"'))
        return

    data = element.get("data")
    if data is None:
        return
    if not isinstance(data, dict):
        errors.append(BundleError(f"{path}.data", "data must be an object"))
        return

    allowed = set(meta.fields)
    if meta.shapeable:
        allowed.add("shape")
    if meta.fillable:
        allowed.add("fill")
    if host_component_type == "canvas":
        allowed |= {"x", "y"}

    for key, value in data.items():
        if key not in allowed:
            errors.append(BundleError(f"{path}.data.{key}", f'"{key}" is not a known field of "{el_type}"'))
        elif key == "kind" and el_type == "column" and value not in catalog.data_kinds:
            errors.append(BundleError(f"{path}.data.kind", f'"{value}" is not a known data kind'))
        elif key == "kind" and el_type == "text-input" and value not in catalog.input_kinds:
            errors.append(BundleError(f"{path}.data.kind", f'"{value}" is not a known input kind'))
        elif key == "dataset" and value not in dataset_ids:
            errors.append(BundleError(f"{path}.data.dataset", f'"{value}" does not resolve to a dataset in this bundle'))


def _validate_component(
    component: Any,
    path: str,
    errors: list[BundleError],
    catalog: Catalog,
    page_ids: frozenset[str],
    dataset_ids: frozenset[str],
) -> None:
    if not isinstance(component, dict):
        errors.append(BundleError(path, "a component must be an object"))
        return
    cmp_type = component.get("type")
    cmp_meta = catalog.component(cmp_type) if isinstance(cmp_type, str) else None
    if cmp_type in catalog.retired:
        errors.append(BundleError(f"{path}.type", f'unknown component type "{cmp_type}" (retired)'))
        return
    if cmp_meta is None:
        errors.append(BundleError(f"{path}.type", f'unknown component type "{cmp_type}"'))
        return

    shape = component.get("shape")
    if shape is not None and shape not in cmp_meta.shapes:
        errors.append(BundleError(f"{path}.shape", f'"{shape}" is not a shape of "{cmp_type}"'))
    layout = component.get("layout")
    if layout is not None and layout not in cmp_meta.layouts:
        errors.append(BundleError(f"{path}.layout", f'"{layout}" is not a layout of "{cmp_type}"'))

    props = component.get("props")
    if isinstance(props, dict):
        if "size" in props and props["size"] not in COMPONENT_SIZES:
            errors.append(BundleError(f"{path}.props.size", f'"{props["size"]}" is not a known size'))
        if "links" in props:
            _validate_links(props["links"], f"{path}.props.links", errors, page_ids)

    elements = component.get("elements")
    if elements is not None:
        if not isinstance(elements, list):
            errors.append(BundleError(f"{path}.elements", "elements must be an array"))
        else:
            counts: dict[str, int] = {}
            for i, element in enumerate(elements):
                _validate_element(element, f"{path}.elements[{i}]", errors, catalog, cmp_type, dataset_ids)
                el_type = element.get("type") if isinstance(element, dict) else None
                if isinstance(el_type, str):
                    counts[el_type] = counts.get(el_type, 0) + 1
            for el_type, count in counts.items():
                meta = catalog.element(cmp_type, el_type)
                if meta is not None and meta.max is not None and count > meta.max:
                    errors.append(
                        BundleError(f"{path}.elements", f'at most {meta.max} "{el_type}" element(s) allowed, found {count}')
                    )


def _validate_page(
    page: Any,
    path: str,
    errors: list[BundleError],
    catalog: Catalog,
    page_ids: frozenset[str],
    dataset_ids: frozenset[str],
) -> list[str]:
    """Validates one export-shaped page; returns its layout's region ids
    (used by the placement pass, which needs every OTHER page's regions)."""
    region_ids: list[str] = []
    if not isinstance(page, dict):
        errors.append(BundleError(path, "a page must be an object"))
        return region_ids

    if not isinstance(page.get("name"), str) or not page["name"].strip():
        errors.append(BundleError(f"{path}.name", "name must be non-empty"))
    if "route" in page and page["route"] is not None and not isinstance(page["route"], str):
        errors.append(BundleError(f"{path}.route", "route must be a string"))
    if "presentation" in page and page["presentation"] is not None and page["presentation"] not in catalog.presentations:
        errors.append(BundleError(f"{path}.presentation", f'"{page["presentation"]}" is not a known presentation'))

    layout = page.get("layout")
    if layout is None:
        errors.append(BundleError(f"{path}.layout", "a page needs a layout"))
    else:
        _validate_layout_tree(layout, f"{path}.layout", errors, region_ids)
        for i, component in enumerate(_iter_components(layout)):
            _validate_component(component, f"{path}.layout.components[{i}]", errors, catalog, page_ids, dataset_ids)

    if len(set(region_ids)) != len(region_ids):
        errors.append(BundleError(f"{path}.layout", "region ids must be unique within the page"))

    return region_ids


def _validate_placements(
    pages: list[dict[str, Any]],
    path: str,
    errors: list[BundleError],
    pages_by_id: dict[str, dict[str, Any]],
    regions_by_id: dict[str, list[str]],
) -> None:
    for i, page in enumerate(pages):
        if not isinstance(page, dict):
            continue
        placement = page.get("placement")
        if placement is None:
            continue
        page_path = f"{path}[{i}].placement"
        if not isinstance(placement, dict):
            errors.append(BundleError(page_path, 'placement must be {"page_id", "region_id"}'))
            continue
        target_id = placement.get("page_id")
        target = pages_by_id.get(target_id)
        if target is None:
            errors.append(BundleError(f"{page_path}.page_id", f'"{target_id}" is not a page in this wireframe'))
            continue
        if target.get("presentation"):
            errors.append(BundleError(f"{page_path}.page_id", f'"{target_id}" is an overlay page and cannot host a placement'))
        region_id = placement.get("region_id")
        if region_id not in regions_by_id.get(target_id, []):
            errors.append(BundleError(f"{page_path}.region_id", f'"{region_id}" is not a region of "{target_id}"'))

    # Cycle check: follow page -> placement.page_id until @back, a page with
    # no placement, or a page already seen in this chain.
    for start_id, start_page in pages_by_id.items():
        seen = {start_id}
        current = start_page
        while True:
            placement = current.get("placement") if isinstance(current, dict) else None
            next_id = placement.get("page_id") if isinstance(placement, dict) else None
            if next_id is None or next_id not in pages_by_id:
                break
            if next_id in seen:
                errors.append(BundleError(f"{path}", f'"{start_id}" placement cycles back through "{next_id}"'))
                break
            seen.add(next_id)
            current = pages_by_id[next_id]


def _validate_wireframe(wireframe: Any, path: str, errors: list[BundleError], catalog: Catalog, dataset_ids: frozenset[str]) -> None:
    if not isinstance(wireframe, dict):
        errors.append(BundleError(path, "a wireframe must be an object"))
        return

    if "interfaceType" in wireframe and wireframe["interfaceType"] not in INTERFACE_TYPES:
        errors.append(BundleError(f"{path}.interfaceType", f'"{wireframe["interfaceType"]}" is not a known interface type'))

    pages = wireframe.get("pages") or []
    if not isinstance(pages, list) or not (1 <= len(pages) <= MAX_PAGES_PER_WIREFRAME):
        errors.append(BundleError(f"{path}.pages", f"a wireframe needs between 1 and {MAX_PAGES_PER_WIREFRAME} pages"))
        pages = pages if isinstance(pages, list) else []

    ids = [p.get("id") for p in pages if isinstance(p, dict)]
    if len(set(ids)) != len(ids):
        errors.append(BundleError(f"{path}.pages", "page ids must be unique within the wireframe"))
    page_ids = frozenset(i for i in ids if isinstance(i, str))

    pages_by_id: dict[str, dict[str, Any]] = {p["id"]: p for p in pages if isinstance(p, dict) and isinstance(p.get("id"), str)}
    regions_by_id: dict[str, list[str]] = {}
    for i, page in enumerate(pages):
        page_id = page.get("id") if isinstance(page, dict) else None
        region_ids = _validate_page(page, f"{path}.pages[{i}]", errors, catalog, page_ids, dataset_ids)
        if isinstance(page_id, str):
            regions_by_id[page_id] = region_ids

    _validate_placements(pages, f"{path}.pages", errors, pages_by_id, regions_by_id)

    landing = wireframe.get("landingPageId")
    if landing is not None and landing not in page_ids:
        errors.append(BundleError(f"{path}.landingPageId", f'"{landing}" is not a page in this wireframe'))


def _validate_diagram(diagram: Any, path: str, errors: list[BundleError], catalog: Catalog) -> None:
    if not isinstance(diagram, dict):
        errors.append(BundleError(path, "a diagram must be an object"))
        return
    kind = diagram.get("kind")
    if kind is not None and kind not in DIAGRAM_KINDS:
        errors.append(BundleError(f"{path}.kind", f'"{kind}" is not a known diagram kind'))

    model = diagram.get("model") or {}
    nodes = model.get("nodes") or []
    edges = model.get("edges") or []
    node_ids = {n.get("id") for n in nodes if isinstance(n, dict)}

    for i, node in enumerate(nodes):
        node_path = f"{path}.model.nodes[{i}]"
        if not isinstance(node, dict):
            errors.append(BundleError(node_path, "a node must be an object"))
            continue
        if node.get("type") not in catalog.uml_node_types:
            errors.append(BundleError(f"{node_path}.type", f'"{node.get("type")}" is not a known diagram node type'))
        for dim in ("w", "h"):
            if dim in node and node[dim] is not None and not (isinstance(node[dim], (int, float)) and node[dim] > 0):
                errors.append(BundleError(f"{node_path}.{dim}", f"{dim} must be greater than 0 when given"))
        parent_id = node.get("parentId")
        if parent_id is not None and parent_id not in node_ids:
            errors.append(BundleError(f"{node_path}.parentId", f'"{parent_id}" is not a node in this diagram'))

    for i, edge in enumerate(edges):
        edge_path = f"{path}.model.edges[{i}]"
        if not isinstance(edge, dict):
            errors.append(BundleError(edge_path, "an edge must be an object"))
            continue
        if edge.get("type") not in catalog.uml_edge_types:
            errors.append(BundleError(f"{edge_path}.type", f'"{edge.get("type")}" is not a known diagram edge type'))
        for end in ("source", "target"):
            if edge.get(end) not in node_ids:
                errors.append(BundleError(f"{edge_path}.{end}", f'"{edge.get(end)}" is not a node in this diagram'))


def _validate_use_cases(bundle: dict[str, Any], errors: list[BundleError]) -> None:
    actor_names = {a.get("name", "").casefold() for a in bundle.get("actors") or [] if isinstance(a, dict)}
    for i, use_case in enumerate(bundle.get("useCases") or []):
        if not isinstance(use_case, dict):
            errors.append(BundleError(f"useCases[{i}]", "a use case must be an object"))
            continue
        for j, actor_name in enumerate(use_case.get("actors") or []):
            if not isinstance(actor_name, str) or actor_name.casefold() not in actor_names:
                errors.append(BundleError(f"useCases[{i}].actors[{j}]", f'"{actor_name}" is not one of this bundle\'s actors'))


def validate_bundle(bundle: dict[str, Any], catalog: Catalog) -> list[BundleError]:
    """Every error the bundle contains, or an empty list if it is clean.

    Never raises on a malformed bundle -- a bundle is untrusted input by
    definition, so every section is read defensively and a wrong shape is
    reported as an error at that path rather than crashing the request.
    """
    errors: list[BundleError] = []

    size = len(json.dumps(bundle).encode("utf-8"))
    if size > MAX_BUNDLE_BYTES:
        errors.append(BundleError("", f"bundle is {size} bytes, over the {MAX_BUNDLE_BYTES} byte limit"))

    if not isinstance(bundle, dict) or not any(
        bundle.get(key) for key in ("actors", "useCases", "datasets", "wireframes", "diagrams")
    ):
        errors.append(BundleError("", "bundle is empty"))
        return errors

    dataset_ids = frozenset(
        d.get("id") for d in bundle.get("datasets") or [] if isinstance(d, dict) and isinstance(d.get("id"), str)
    )

    catalog_local = catalog
    for i, wireframe in enumerate(bundle.get("wireframes") or []):
        _validate_wireframe(wireframe, f"wireframes[{i}]", errors, catalog_local, dataset_ids)

    for i, diagram in enumerate(bundle.get("diagrams") or []):
        _validate_diagram(diagram, f"diagrams[{i}]", errors, catalog_local)

    _validate_use_cases(bundle, errors)

    return errors


def grid_layout(model: dict[str, Any], catalog: Catalog) -> dict[str, Any]:
    """Fill in x/y/w/h for any node the bundle left ungeometried.

    A simple grid, not a layout engine: nodes without x/y/w/h are placed in
    rows of six, in the order they appear, sized from the palette's own
    default for that node type. This is a fallback for what the skill's own
    grid forgot, not a substitute for it -- see diagrams.md.
    """
    out = {**model, "nodes": [dict(n) for n in model.get("nodes") or []]}
    columns, pitch_x, pitch_y = 6, 240, 160
    col = row = 0
    for node in out["nodes"]:
        if all(node.get(k) is not None for k in ("x", "y", "w", "h")):
            continue
        default_w, default_h = catalog.uml_node_defaults.get(node.get("type"), (140, 80))
        node.setdefault("w", default_w)
        node.setdefault("h", default_h)
        node["x"] = node.get("x") if node.get("x") is not None else col * pitch_x
        node["y"] = node.get("y") if node.get("y") is not None else row * pitch_y
        col += 1
        if col >= columns:
            col = 0
            row += 1
    return out


# ── The import route ─────────────────────────────────────────────────────
#
# Actors, use cases and datasets all resolve the same way: match an existing
# project row by case-folded name, or create one. Only the matching itself is
# pure -- the create side needs the database -- so that is what is pulled out
# and tested on its own (test_bundle_import.py), the same way the rest of
# this file keeps every rule it can pure and lets the route be the thin,
# untested-on-its-own part.


def resolve_by_name(bundle_name: str, existing_by_name: dict[str, Any]) -> Any | None:
    """The existing row ``bundle_name`` matches by case-folded name, or
    ``None`` if nothing does and one should be created."""
    return existing_by_name.get(bundle_name.casefold())


router = APIRouter()


async def _resolve_actors(
    db: AsyncSession, project: Project, ctx: ScopeContext, bundle: dict[str, Any]
) -> tuple[dict[str, UseCaseActor], int, int]:
    """Every actor the bundle names, matched by case-folded name against the
    project's existing ``UseCaseActor`` rows or created fresh. Returns a
    lookup keyed by case-folded name (used to resolve use-case and
    wireframe user-type references), plus created/matched counts."""
    existing = (
        (
            await db.execute(
                select(UseCaseActor).where(UseCaseActor.project_id == project.id, UseCaseActor.account_id == project.account_id)
            )
        )
        .scalars()
        .all()
    )
    by_name = {a.name.casefold(): a for a in existing}
    created = matched = 0
    for entry in bundle.get("actors") or []:
        name = entry.get("name") if isinstance(entry, dict) else None
        if not isinstance(name, str) or not name.strip():
            continue
        if resolve_by_name(name, by_name) is not None:
            matched += 1
            continue
        row = UseCaseActor(
            project_id=project.id,
            account_id=project.account_id,
            name=name,
            description=entry.get("description"),
            pos=await next_pos(db, UseCaseActor, UseCaseActor.project_id == project.id),
            created_by=ctx.user_id,
        )
        db.add(row)
        await db.flush()
        by_name[key] = row
        created += 1
    return by_name, created, matched


async def _resolve_use_cases(
    db: AsyncSession, project: Project, ctx: ScopeContext, bundle: dict[str, Any], actors_by_name: dict[str, UseCaseActor]
) -> tuple[int, int]:
    """Match by name; a matched use case is left untouched -- no overwrite of
    a hand-edited description."""
    existing_by_name = {
        name.casefold(): True
        for (name,) in (
            await db.execute(select(UseCase.name).where(UseCase.project_id == project.id, UseCase.account_id == project.account_id))
        ).all()
    }
    created = matched = 0
    for entry in bundle.get("useCases") or []:
        name = entry.get("name") if isinstance(entry, dict) else None
        if not isinstance(name, str) or not name.strip():
            continue
        if resolve_by_name(name, existing_by_name) is not None:
            matched += 1
            continue
        actor_ids = [
            str(resolve_by_name(a, actors_by_name).id)
            for a in entry.get("actors") or []
            if isinstance(a, str) and resolve_by_name(a, actors_by_name) is not None
        ]
        db.add(
            UseCase(
                project_id=project.id,
                account_id=project.account_id,
                name=name,
                description=entry.get("description"),
                actor_ids=actor_ids,
                pos=await next_pos(db, UseCase, UseCase.project_id == project.id),
                created_by=ctx.user_id,
            )
        )
        existing_by_name[name.casefold()] = True
        created += 1
    return created, matched


async def _resolve_datasets(
    db: AsyncSession, project: Project, ctx: ScopeContext, bundle: dict[str, Any]
) -> tuple[dict[str, str], int, int]:
    """Match by name against the project's own datasets; create the rest.
    Returns the bundle-local id -> real row id mapping ``remap_dataset_ids``
    needs, plus created/matched counts."""
    existing = (
        (await db.execute(select(Dataset).where(Dataset.project_id == project.id, Dataset.account_id == project.account_id)))
        .scalars()
        .all()
    )
    by_name = {d.name.casefold(): d for d in existing}
    id_map: dict[str, str] = {}
    created = matched = 0
    for entry in bundle.get("datasets") or []:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name")
        bundle_id = entry.get("id")
        if not isinstance(name, str) or not name.strip():
            continue
        existing_row = resolve_by_name(name, by_name)
        if existing_row is not None:
            matched += 1
            row = existing_row
        else:
            row = Dataset(
                project_id=project.id,
                account_id=project.account_id,
                name=name,
                kind=entry.get("kind") or "text",
                values=entry.get("values") or [],
                pos=await next_pos(db, Dataset, Dataset.project_id == project.id),
                created_by=ctx.user_id,
            )
            db.add(row)
            await db.flush()
            by_name[key] = row
            created += 1
        if isinstance(bundle_id, str):
            id_map[bundle_id] = str(row.id)
    return id_map, created, matched


async def _import_wireframe(
    db: AsyncSession,
    project: Project,
    ctx: ScopeContext,
    wireframe_data: dict[str, Any],
    actors_by_name: dict[str, UseCaseActor],
    dataset_id_map: dict[str, str],
    source: dict[str, Any],
    warnings: list[str],
) -> dict[str, Any]:
    pages_data = wireframe_data.get("pages") or []
    remap_dataset_ids(pages_data, dataset_id_map)

    wireframe = Wireframe(
        project_id=project.id,
        account_id=project.account_id,
        name=wireframe_data.get("name") or "Imported wireframe",
        interface_type=wireframe_data.get("interfaceType") or "desktop",
        pos=await next_pos(db, Wireframe, Wireframe.project_id == project.id),
        created_by=ctx.user_id,
    )
    db.add(wireframe)
    await db.flush()

    actor_ids = [
        resolve_by_name(name, actors_by_name).id
        for name in wireframe_data.get("userTypes") or []
        if isinstance(name, str) and resolve_by_name(name, actors_by_name) is not None
    ]
    await _set_actors(db, project, wireframe, actor_ids)

    persona_names = [n for n in wireframe_data.get("personas") or [] if isinstance(n, str)]
    if persona_names:
        existing_personas = (
            (await db.execute(select(Persona).where(Persona.project_id == project.id, Persona.account_id == project.account_id)))
            .scalars()
            .all()
        )
        personas_by_name = {p.name.casefold(): p for p in existing_personas}
        persona_ids = []
        for name in persona_names:
            row = resolve_by_name(name, personas_by_name)
            if row is None:
                warnings.append(f'The persona "{name}" did not match an existing persona and was skipped.')
            else:
                persona_ids.append(row.id)
        if persona_ids:
            await _set_personas(db, project, wireframe, persona_ids)

    mapping = {str(p.get("id")): str(uuid4()) for p in pages_data if isinstance(p, dict)}
    await insert_pages(db, project, wireframe, pages_data, mapping)

    landing = mapping.get(str(wireframe_data.get("landingPageId")))
    wireframe.landing_page_id = UUID(landing) if landing else None

    await _snapshot(db, project, wireframe, reason="imported", user_id=ctx.user_id)
    await record_event(
        db,
        project=project,
        wireframe=wireframe,
        user_id=ctx.user_id,
        event="imported",
        detail={"source": source, "page_count": len(pages_data)},
    )
    return {"id": str(wireframe.id), "name": wireframe.name, "pages": len(pages_data)}


def _import_diagram(project: Project, ctx: ScopeContext, diagram_data: dict[str, Any], catalog: Catalog, warnings: list[str]) -> ProjectDiagram:
    model = diagram_data.get("model") or {"nodes": [], "edges": []}
    missing_geometry = any(
        isinstance(n, dict) and any(n.get(k) is None for k in ("x", "y", "w", "h")) for n in model.get("nodes") or []
    )
    laid_out = grid_layout(model, catalog)
    diagram = ProjectDiagram(
        project_id=project.id,
        account_id=project.account_id,
        name=diagram_data.get("name") or "Imported diagram",
        kind=diagram_data.get("kind") or "freeform",
        xml="",
        model=laid_out,
        version=0,
        created_by=ctx.user_id,
    )
    if missing_geometry:
        warnings.append(f'"{diagram.name}" had a node with no position -- placed on a grid.')
    return diagram


async def create_bundle_content(
    db: AsyncSession, project: Project, ctx: ScopeContext, payload: dict[str, Any]
) -> tuple[dict[str, Any], list[BundleError]]:
    """Validate a bundle and create everything in it -- the whole of what
    ``import_bundle`` does, minus resolving the project and committing, so a
    second caller can run this inside its own transaction/lock decision.
    Shared by the Import button's route and the Project Agent chatbot's
    ``create_bundle`` tool, so a bundle the chat produces is validated and
    created by the exact same code, not a second copy of it.

    Returns ``(result, [])`` on success or ``({}, errors)`` on a bundle that
    doesn't validate -- nothing is created in the error case. Flushes (so
    new ids are available to the caller) but never commits.
    """
    catalog = get_catalog()
    bundle = wrap_bare_envelope(payload)
    errors = validate_bundle(bundle, catalog)
    if errors:
        return {}, errors

    warnings: list[str] = []
    source = bundle.get("source") or {}
    repo_full_name = source.get("repo_full_name") if isinstance(source, dict) else None
    if repo_full_name and project.repo_full_name and repo_full_name != project.repo_full_name:
        warnings.append(
            f"The bundle was generated from {repo_full_name}, which is not this project's linked repository."
        )

    actors_by_name, actors_created, actors_matched = await _resolve_actors(db, project, ctx, bundle)
    use_cases_created, use_cases_matched = await _resolve_use_cases(db, project, ctx, bundle, actors_by_name)
    dataset_id_map, datasets_created, datasets_matched = await _resolve_datasets(db, project, ctx, bundle)

    wireframes_out = [
        await _import_wireframe(db, project, ctx, wf, actors_by_name, dataset_id_map, source, warnings)
        for wf in bundle.get("wireframes") or []
        if isinstance(wf, dict)
    ]

    diagrams_out = []
    for diagram_data in bundle.get("diagrams") or []:
        if not isinstance(diagram_data, dict):
            continue
        diagram = _import_diagram(project, ctx, diagram_data, catalog, warnings)
        db.add(diagram)
        await db.flush()
        diagrams_out.append({"id": str(diagram.id), "name": diagram.name})

    await record_event(
        db,
        project=project,
        wireframe=None,
        user_id=ctx.user_id,
        event="bundle_imported",
        detail={"source": source, "wireframes": len(wireframes_out), "diagrams": len(diagrams_out)},
    )
    project.updated_at = utc_now()

    return {
        "wireframes": wireframes_out,
        "diagrams": diagrams_out,
        "actors": {"created": actors_created, "matched": actors_matched},
        "use_cases": {"created": use_cases_created, "matched": use_cases_matched},
        "datasets": {"created": datasets_created, "matched": datasets_matched},
        "warnings": warnings,
    }, []


@router.post("/projects/{project_id}/import")
async def import_bundle(
    project_id: UUID,
    payload: dict[str, Any] = Body(...),
    ctx: ScopeContext = Depends(require_permission("data:write")),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Import a project bundle: the inverse of ``GET /projects/{id}/export``.

    One transaction -- any failure rolls the whole bundle back, so half an
    import never lands. 423 on a locked version: import is content, exactly
    like restore.
    """
    project = await get_writable_project(db, project_id, ctx)

    result, errors = await create_bundle_content(db, project, ctx, payload)
    if errors:
        # A direct JSONResponse, not HTTPException(detail=...) -- the latter
        # would nest this under a second "detail" key (see the op-batch and
        # diagram-save conflict responses, which use the same pattern).
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"errors": [e.as_dict() for e in errors]}
        )

    await db.commit()
    return result
