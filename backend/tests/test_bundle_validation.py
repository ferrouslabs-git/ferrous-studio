"""The bundle validator: every rule in reverse-engineer-repository.md's
validation table gets one fixture that fails it, with the error's path
asserted -- not just the count, since a validator that reports the wrong
location is nearly as useless as one that misses the problem.

Pure, no database -- validate_bundle only ever reads the dict it is handed.
"""
from copy import deepcopy

from app.studio.catalog import get_catalog
from app.studio.importing import grid_layout, validate_bundle, wrap_bare_envelope
from app.studio.ops import PageState, export_page

CATALOG = get_catalog()


def paths(errors) -> set[str]:
    return {e.path for e in errors}


def messages(errors) -> list[str]:
    return [e.message for e in errors]


def minimal_bundle() -> dict:
    return {
        "actors": [{"name": "Administrator"}],
        "useCases": [{"name": "Sign in", "actors": ["Administrator"]}],
        "wireframes": [
            {
                "name": "App",
                "interfaceType": "desktop",
                "landingPageId": "p1",
                "pages": [
                    {
                        "id": "p1",
                        "name": "Home",
                        "route": "/",
                        "layout": {
                            "kind": "region",
                            "id": "r1",
                            "size": {"fr": 1},
                            "components": [
                                {
                                    "id": "c1",
                                    "type": "navbar",
                                    "shape": "plain",
                                    "elements": [{"id": "e1", "type": "brand", "label": "Brand"}],
                                }
                            ],
                        },
                    }
                ],
            }
        ],
    }


# ── The minimal bundle, and the empty one ────────────────────────────────────


def test_a_minimal_valid_bundle_passes_with_no_errors():
    assert validate_bundle(minimal_bundle(), CATALOG) == []


def test_an_empty_bundle_is_rejected():
    errors = validate_bundle({}, CATALOG)
    assert "" in paths(errors)
    assert any("empty" in m for m in messages(errors))


# ── Pages ─────────────────────────────────────────────────────────────────


def test_a_wireframe_needs_at_least_one_page():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"] = []
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages" in paths(errors)


def test_page_ids_must_be_unique_within_the_wireframe():
    bundle = minimal_bundle()
    dup = deepcopy(bundle["wireframes"][0]["pages"][0])
    bundle["wireframes"][0]["pages"].append(dup)
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages" in paths(errors)
    assert any("unique" in m for m in messages(errors))


def test_a_page_name_must_be_non_empty():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["name"] = "  "
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].name" in paths(errors)


def test_a_page_route_must_be_a_string():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["route"] = 12
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].route" in paths(errors)


# ── Layout tree ───────────────────────────────────────────────────────────


def test_a_split_needs_at_least_two_children():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"] = {
        "kind": "split",
        "id": "s1",
        "dir": "col",
        "size": {"fr": 1},
        "children": [{"kind": "region", "id": "r1", "size": {"fr": 1}}],
    }
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.children" in paths(errors)


def test_a_split_dir_must_be_row_or_col():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"] = {
        "kind": "split",
        "id": "s1",
        "dir": "diagonal",
        "size": {"fr": 1},
        "children": [
            {"kind": "region", "id": "r1", "size": {"fr": 1}},
            {"kind": "region", "id": "r2", "size": {"fr": 1}},
        ],
    }
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.dir" in paths(errors)


def test_size_must_be_auto_a_positive_int_or_fr():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"]["size"] = -5
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.size" in paths(errors)


def test_region_ids_must_be_unique_within_the_page():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"] = {
        "kind": "split",
        "id": "s1",
        "dir": "row",
        "size": {"fr": 1},
        "children": [
            {"kind": "region", "id": "same", "size": {"fr": 1}},
            {"kind": "region", "id": "same", "size": {"fr": 1}},
        ],
    }
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout" in paths(errors)
    assert any("unique" in m for m in messages(errors))


def test_a_region_dir_must_be_row_col_or_free():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"]["dir"] = "sideways"
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.dir" in paths(errors)


# ── Components ────────────────────────────────────────────────────────────


def test_an_unknown_component_type_is_rejected():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"]["components"][0]["type"] = "not-a-real-thing"
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.components[0].type" in paths(errors)


def test_a_retired_component_type_names_itself_retired():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"]["components"][0]["type"] = "hero"
    errors = validate_bundle(bundle, CATALOG)
    match = [e for e in errors if e.path == "wireframes[0].pages[0].layout.components[0].type"]
    assert match and "retired" in match[0].message


def test_a_shape_must_belong_to_its_component():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"]["components"][0]["shape"] = "not-a-shape"
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.components[0].shape" in paths(errors)


def test_a_layout_must_belong_to_its_component():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"]["components"][0]["layout"] = "not-a-layout"
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.components[0].layout" in paths(errors)


def test_a_link_target_must_resolve_to_a_page_in_the_wireframe():
    bundle = minimal_bundle()
    cmp = bundle["wireframes"][0]["pages"][0]["layout"]["components"][0]
    cmp["elements"] = [{"id": "e2", "type": "button", "label": "Go"}]
    cmp["props"] = {"links": {"el:e2": {"pageId": "nope"}}}
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.components[0].props.links.el:e2.pageId" in paths(errors)


def test_a_link_target_may_be_the_back_sentinel():
    bundle = minimal_bundle()
    cmp = bundle["wireframes"][0]["pages"][0]["layout"]["components"][0]
    cmp["elements"] = [{"id": "e2", "type": "button", "label": "Go"}]
    cmp["props"] = {"links": {"el:e2": {"pageId": "@back"}}}
    assert validate_bundle(bundle, CATALOG) == []


def test_component_size_must_be_a_known_value():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"]["components"][0]["props"] = {"size": "huge"}
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.components[0].props.size" in paths(errors)


# ── Elements ──────────────────────────────────────────────────────────────


def test_an_element_type_must_belong_to_its_host_component():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"]["components"][0]["elements"] = [
        {"id": "e1", "type": "column", "label": "Not on a navbar"}
    ]
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.components[0].elements[0].type" in paths(errors)


def test_an_element_max_count_is_enforced():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"]["components"][0]["elements"] = [
        {"id": "e1", "type": "brand", "label": "One"},
        {"id": "e2", "type": "brand", "label": "Two"},
    ]
    errors = validate_bundle(bundle, CATALOG)
    assert any("elements" in e.path and "brand" in e.message for e in errors)


def test_a_data_key_must_belong_to_the_element():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"]["components"][0]["elements"][0]["data"] = {"nonsense": "x"}
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.components[0].elements[0].data.nonsense" in paths(errors)


def test_shape_and_fill_data_keys_are_allowed_when_the_element_supports_them():
    bundle = minimal_bundle()
    button_cmp = {
        "id": "c2",
        "type": "form",
        "shape": "simple",
        "elements": [{"id": "e2", "type": "button", "label": "Save", "data": {"shape": "pill", "fill": "outline"}}],
    }
    bundle["wireframes"][0]["pages"][0]["layout"]["components"].append(button_cmp)
    assert validate_bundle(bundle, CATALOG) == []


def test_a_column_data_kind_must_be_a_known_data_kind():
    bundle = minimal_bundle()
    list_cmp = {
        "id": "c2",
        "type": "list",
        "shape": "table",
        "elements": [{"id": "e2", "type": "column", "label": "Weird", "data": {"kind": "not-a-kind"}}],
    }
    bundle["wireframes"][0]["pages"][0]["layout"]["components"].append(list_cmp)
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.components[1].elements[0].data.kind" in paths(errors)


def test_a_text_input_kind_must_be_a_known_input_kind():
    bundle = minimal_bundle()
    form_cmp = {
        "id": "c2",
        "type": "form",
        "shape": "simple",
        "elements": [{"id": "e2", "type": "text-input", "label": "Odd", "data": {"kind": "not-an-input-kind"}}],
    }
    bundle["wireframes"][0]["pages"][0]["layout"]["components"].append(form_cmp)
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.components[1].elements[0].data.kind" in paths(errors)


def test_x_and_y_data_keys_are_only_allowed_on_a_canvas():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"]["components"][0]["elements"][0]["data"] = {"x": 10, "y": 10}
    errors = validate_bundle(bundle, CATALOG)
    assert any(e.path.endswith(".data.x") for e in errors)
    assert any(e.path.endswith(".data.y") for e in errors)

    bundle2 = minimal_bundle()
    canvas_cmp = {
        "id": "c2",
        "type": "canvas",
        "shape": "plain",
        "elements": [{"id": "e2", "type": "box", "label": "Free", "data": {"x": 10, "y": 10}}],
    }
    bundle2["wireframes"][0]["pages"][0]["layout"]["components"].append(canvas_cmp)
    assert validate_bundle(bundle2, CATALOG) == []


def test_a_dataset_reference_must_resolve_within_the_bundle():
    bundle = minimal_bundle()
    list_cmp = {
        "id": "c2",
        "type": "list",
        "shape": "table",
        "elements": [{"id": "e2", "type": "column", "label": "Status", "data": {"dataset": "ds-missing"}}],
    }
    bundle["wireframes"][0]["pages"][0]["layout"]["components"].append(list_cmp)
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].layout.components[1].elements[0].data.dataset" in paths(errors)

    bundle["datasets"] = [{"id": "ds-missing", "name": "Status", "values": ["Open", "Closed"]}]
    assert validate_bundle(bundle, CATALOG) == []


# ── Placement ─────────────────────────────────────────────────────────────


def _with_child_page(target_page_extra: dict | None = None) -> dict:
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0].update(target_page_extra or {})
    bundle["wireframes"][0]["pages"].append(
        {
            "id": "p2",
            "name": "Child",
            "layout": {"kind": "region", "id": "r2", "size": {"fr": 1}},
            "placement": {"page_id": "p1", "region_id": "r1"},
        }
    )
    return bundle


def test_a_valid_placement_passes():
    assert validate_bundle(_with_child_page(), CATALOG) == []


def test_placement_page_id_must_resolve_within_the_wireframe():
    bundle = _with_child_page()
    bundle["wireframes"][0]["pages"][1]["placement"]["page_id"] = "not-a-page"
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[1].placement.page_id" in paths(errors)


def test_placement_region_id_must_be_a_region_of_the_target_page():
    bundle = _with_child_page()
    bundle["wireframes"][0]["pages"][1]["placement"]["region_id"] = "not-a-region"
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[1].placement.region_id" in paths(errors)


def test_an_overlay_page_cannot_host_a_placement():
    bundle = _with_child_page({"presentation": "modal"})
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[1].placement.page_id" in paths(errors)
    assert any("overlay" in m for m in messages(errors))


def test_placement_cycles_are_rejected():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["placement"] = {"page_id": "p2", "region_id": "r2"}
    bundle["wireframes"][0]["pages"].append(
        {
            "id": "p2",
            "name": "Other",
            "layout": {"kind": "region", "id": "r2", "size": {"fr": 1}},
            "placement": {"page_id": "p1", "region_id": "r1"},
        }
    )
    errors = validate_bundle(bundle, CATALOG)
    assert any("cycle" in m for m in messages(errors))


# ── Presentation ──────────────────────────────────────────────────────────


def test_presentation_must_be_a_known_value():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["presentation"] = "popover"
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].pages[0].presentation" in paths(errors)


def test_every_real_presentation_is_accepted():
    for presentation in ("modal", "drawer", "drawer-left"):
        bundle = minimal_bundle()
        bundle["wireframes"][0]["pages"][0]["presentation"] = presentation
        assert validate_bundle(bundle, CATALOG) == []


# ── Wireframe ─────────────────────────────────────────────────────────────


def test_interface_type_must_be_known():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["interfaceType"] = "smart-fridge"
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].interfaceType" in paths(errors)


def test_landing_page_id_must_be_a_page_in_the_wireframe():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["landingPageId"] = "nowhere"
    errors = validate_bundle(bundle, CATALOG)
    assert "wireframes[0].landingPageId" in paths(errors)


# ── Diagrams ──────────────────────────────────────────────────────────────


def _bundle_with_diagram(model: dict, kind: str = "class") -> dict:
    bundle = minimal_bundle()
    bundle["diagrams"] = [{"name": "Data model", "kind": kind, "model": model}]
    return bundle


def test_a_valid_diagram_passes():
    model = {
        "nodes": [{"id": "n1", "type": "entity", "label": "Project", "x": 0, "y": 0, "w": 180, "h": 120}],
        "edges": [],
    }
    assert validate_bundle(_bundle_with_diagram(model), CATALOG) == []


def test_diagram_kind_must_be_known():
    errors = validate_bundle(_bundle_with_diagram({"nodes": [], "edges": []}, kind="spaghetti"), CATALOG)
    assert "diagrams[0].kind" in paths(errors)


def test_diagram_node_type_must_be_known():
    model = {"nodes": [{"id": "n1", "type": "spaceship", "label": "?"}], "edges": []}
    errors = validate_bundle(_bundle_with_diagram(model), CATALOG)
    assert "diagrams[0].model.nodes[0].type" in paths(errors)


def test_diagram_edge_type_must_be_known():
    model = {
        "nodes": [
            {"id": "n1", "type": "entity", "label": "A"},
            {"id": "n2", "type": "entity", "label": "B"},
        ],
        "edges": [{"id": "e1", "type": "teleport", "source": "n1", "target": "n2"}],
    }
    errors = validate_bundle(_bundle_with_diagram(model), CATALOG)
    assert "diagrams[0].model.edges[0].type" in paths(errors)


def test_diagram_edge_endpoints_must_resolve():
    model = {
        "nodes": [{"id": "n1", "type": "entity", "label": "A"}],
        "edges": [{"id": "e1", "type": "association", "source": "n1", "target": "ghost"}],
    }
    errors = validate_bundle(_bundle_with_diagram(model), CATALOG)
    assert "diagrams[0].model.edges[0].target" in paths(errors)


def test_diagram_parent_id_must_resolve():
    model = {"nodes": [{"id": "n1", "type": "entity", "label": "A", "parentId": "ghost"}], "edges": []}
    errors = validate_bundle(_bundle_with_diagram(model), CATALOG)
    assert "diagrams[0].model.nodes[0].parentId" in paths(errors)


def test_diagram_node_w_and_h_must_be_positive_when_given():
    model = {"nodes": [{"id": "n1", "type": "entity", "label": "A", "w": -10}], "edges": []}
    errors = validate_bundle(_bundle_with_diagram(model), CATALOG)
    assert "diagrams[0].model.nodes[0].w" in paths(errors)


# ── Use cases ─────────────────────────────────────────────────────────────


def test_every_use_case_actor_must_be_a_bundle_actor():
    bundle = minimal_bundle()
    bundle["useCases"][0]["actors"] = ["Nobody"]
    errors = validate_bundle(bundle, CATALOG)
    assert "useCases[0].actors[0]" in paths(errors)


def test_use_case_actor_matching_is_case_folded():
    bundle = minimal_bundle()
    bundle["useCases"][0]["actors"] = ["administrator"]
    assert validate_bundle(bundle, CATALOG) == []


# ── Size ──────────────────────────────────────────────────────────────────


def test_an_oversized_bundle_is_rejected():
    bundle = minimal_bundle()
    bundle["wireframes"][0]["pages"][0]["layout"]["components"][0]["elements"][0]["label"] = "x" * (5 * 1024 * 1024)
    errors = validate_bundle(bundle, CATALOG)
    assert "" in paths(errors)
    assert any("byte" in m for m in messages(errors))


# ── The bare-envelope wrapper ─────────────────────────────────────────────


def test_a_bare_wireframe_export_is_wrapped_and_validates():
    bare = minimal_bundle()["wireframes"][0]
    bare["schemaVersion"] = "1.0"
    wrapped = wrap_bare_envelope(bare)
    assert wrapped == {"wireframes": [bare]}
    assert validate_bundle(wrapped, CATALOG) == []


def test_wireframe_name_falls_back_to_wireframe_name_field():
    bare = {"schemaVersion": "1.0", "wireframeName": "Exported", "pages": minimal_bundle()["wireframes"][0]["pages"]}
    wrapped = wrap_bare_envelope(bare)
    assert wrapped["wireframes"][0]["name"] == "Exported"


def test_a_bundle_that_already_has_wireframes_is_left_alone():
    bundle = minimal_bundle()
    assert wrap_bare_envelope(bundle) == bundle


# ── Round-trip: keeps the importer honest against what the Studio produces ──


def test_export_page_of_a_stored_document_validates_clean():
    """The test that matters most: whatever the Studio itself writes as an
    export must always be accepted back as a bundle page."""
    state = PageState(
        name="Users",
        route="/users",
        pos="a0",
        document={
            "root": {
                "kind": "split",
                "id": "s1",
                "dir": "col",
                "size": {"fr": 1},
                "children": [
                    {"kind": "region", "id": "rh", "label": "Header", "size": "auto"},
                    {
                        "kind": "split",
                        "id": "s2",
                        "dir": "row",
                        "size": {"fr": 1},
                        "children": [
                            {"kind": "region", "id": "rs", "size": 260},
                            {"kind": "region", "id": "rm", "size": {"fr": 1}},
                        ],
                    },
                ],
            },
            "regions": {
                "rh": [{"id": "c1", "type": "navbar", "label": "App", "pos": "a0", "shape": "plain"}],
                "rs": [],
                "rm": [
                    {
                        "id": "c2",
                        "type": "list",
                        "label": "Directory",
                        "pos": "a0",
                        "shape": "table",
                        "elements": [
                            {"id": "e1", "type": "column", "label": "Name", "pos": "a0", "data": {"kind": "text"}}
                        ],
                    },
                ],
            },
        },
        entity_versions={},
        version=1,
    )
    page = export_page("p1", state)
    bundle = {"wireframes": [{"name": "W", "pages": [page]}]}
    assert validate_bundle(bundle, CATALOG) == []


# ── grid_layout ───────────────────────────────────────────────────────────


def test_grid_layout_fills_missing_geometry_only():
    model = {
        "nodes": [
            {"id": "n1", "type": "entity", "label": "Has geometry", "x": 500, "y": 500, "w": 999, "h": 999},
            {"id": "n2", "type": "actor", "label": "Missing geometry"},
        ],
        "edges": [],
    }
    laid_out = grid_layout(model, CATALOG)
    assert laid_out["nodes"][0] == model["nodes"][0]
    n2 = laid_out["nodes"][1]
    assert n2["x"] == 0 and n2["y"] == 0
    assert (n2["w"], n2["h"]) == CATALOG.uml_node_defaults["actor"]


def test_grid_layout_places_nodes_in_rows_of_six():
    nodes = [{"id": f"n{i}", "type": "rect", "label": str(i)} for i in range(7)]
    laid_out = grid_layout({"nodes": nodes, "edges": []}, CATALOG)
    assert laid_out["nodes"][5]["x"] > laid_out["nodes"][0]["x"]
    assert laid_out["nodes"][6]["y"] > laid_out["nodes"][0]["y"]
    assert laid_out["nodes"][6]["x"] == laid_out["nodes"][0]["x"]
