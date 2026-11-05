"""FS-REQ-84: element types -> shapes -> variants on the backend side.

The importer applies the same element migration the editor runs on read
(model/migrate.ts remapElement), driven by the same catalog.json tables, so a
wireframe written before the regrouping -- or read back through the export,
which returns what is stored -- re-imports cleanly. Pure, no database.
"""
from copy import deepcopy

from app.studio.catalog import BUNDLE_FORMAT_GUIDE, get_catalog, normalise_legacy_elements
from app.studio.importing import validate_bundle, wrap_bare_envelope

CATALOG = get_catalog()


def canvas_page(*elements: dict, links: dict | None = None) -> dict:
    component = {"id": "c1", "type": "canvas", "shape": "plain", "layout": "fixed", "elements": list(elements)}
    if links:
        component["props"] = {"links": links}
    return {
        "id": "p1",
        "name": "Home",
        "layout": {"kind": "region", "id": "r1", "size": {"fr": 1}, "components": [component]},
    }


def elements_of(page: dict) -> list[dict]:
    return page["layout"]["components"][0]["elements"]


def test_every_element_has_one_of_the_six_types():
    groups = {"text", "input", "action", "ui", "image", "basic"}
    for name, component in CATALOG.components.items():
        for el_type, el in component.elements.items():
            assert el.group in groups, f"{name}/{el_type}"


def test_the_canvas_no_longer_offers_the_removed_shapes():
    canvas = CATALOG.component("canvas")
    for gone in CATALOG.retired_elements["canvas"]:
        assert gone not in canvas.elements
    for new in ("date-time", "slider", "icon", "line", "square", "circle", "triangle"):
        assert new in canvas.elements


def test_retired_canvas_shapes_are_remapped_and_data_shape_becomes_variant():
    page = canvas_page(
        {"id": "e1", "type": "filter-multi", "label": "Tags", "data": {"options": "A, B", "shape": "pill", "x": "4"}},
        {"id": "e2", "type": "column", "label": "Status", "data": {"kind": "status", "samples": "Active, Inactive"}},
        {"id": "e3", "type": "row-action", "label": "Edit"},
        {"id": "e4", "type": "column-header", "label": ""},
        {"id": "e5", "type": "badge", "label": "New", "data": {"shape": "rounded"}},
        links={"el:e4": {"pageId": "p1"}, "el:e3": {"pageId": "p1"}},
    )
    normalise_legacy_elements([page], CATALOG)
    got = [(e["id"], e["type"], e.get("data")) for e in elements_of(page)]
    assert got == [
        ("e1", "multi-select", {"options": "A, B", "variant": "pill", "x": "4"}),
        ("e2", "read-only", {"value": "Active"}),
        ("e3", "button", {"style": "secondary"}),
        ("e5", "badge", {"variant": "rounded"}),
    ]
    assert page["layout"]["components"][0]["props"]["links"] == {"el:e3": {"pageId": "p1"}}


def test_other_components_keep_their_shapes():
    page = canvas_page()
    page["layout"]["components"] = [
        {
            "id": "c2",
            "type": "list",
            "shape": "table",
            "elements": [
                {"id": "e1", "type": "column", "label": "Name", "data": {"kind": "text"}},
                {"id": "e2", "type": "search", "label": "Search", "data": {"shape": "pill"}},
            ],
        }
    ]
    normalise_legacy_elements([page], CATALOG)
    assert page["layout"]["components"][0]["elements"] == [
        {"id": "e1", "type": "column", "label": "Name", "data": {"kind": "text"}},
        {"id": "e2", "type": "search", "label": "Search", "data": {"variant": "pill"}},
    ]


def test_a_pre_fs_req_84_wireframe_imports_after_normalising():
    page = canvas_page(
        {"id": "e1", "type": "filter", "label": "Status", "data": {"options": "Open, Closed", "shape": "pill"}},
        {"id": "e2", "type": "section-heading", "label": "Details", "data": {"x": "10", "y": "10"}},
    )
    bundle = wrap_bare_envelope({"wireframes": [{"name": "Old", "interfaceType": "desktop", "pages": [page]}]})
    assert validate_bundle(deepcopy(bundle), CATALOG) != []  # retired shapes and data.shape are rejected as-is
    normalise_legacy_elements(bundle["wireframes"][0]["pages"], CATALOG)
    assert validate_bundle(bundle, CATALOG) == []


def test_the_new_shapes_validate_and_an_icon_must_be_in_the_library():
    page = canvas_page(
        {"id": "e1", "type": "icon", "label": "", "data": {"icon": "star", "x": "0", "y": "0"}},
        {"id": "e2", "type": "slider", "label": "Volume", "data": {"min": "0", "max": "10", "value": "3"}},
        {"id": "e3", "type": "date-time", "label": "Starts", "data": {"time": "10:30"}},
        {"id": "e4", "type": "triangle", "label": ""},
    )
    bundle = wrap_bare_envelope({"wireframes": [{"name": "New", "interfaceType": "desktop", "pages": [page]}]})
    assert validate_bundle(bundle, CATALOG) == []
    elements_of(bundle["wireframes"][0]["pages"][0])[0]["data"]["icon"] = "unicorn"
    errors = validate_bundle(bundle, CATALOG)
    assert [e.path for e in errors] == ["wireframes[0].pages[0].layout.components[0].elements[0].data.icon"]


def test_the_format_guide_teaches_the_type_shape_variant_scheme():
    assert "Text (" in BUNDLE_FORMAT_GUIDE and "Basic (circle, line, square, triangle)" in BUNDLE_FORMAT_GUIDE
    assert "data.variant" in BUNDLE_FORMAT_GUIDE
    assert "data.shape" not in BUNDLE_FORMAT_GUIDE
