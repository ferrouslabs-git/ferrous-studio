"""Unit tests for the generic op applier. No database involved."""
from copy import deepcopy

import pytest

from app.studio.ops import OpConflict, OpError, PageState, apply_batch, export_page, import_page


def make_state(version: int = 3, entity_versions: dict | None = None) -> PageState:
    return PageState(
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
                "rh": [{"id": "c1", "type": "navbar", "label": "App", "pos": "a0"}],
                "rs": [],
                "rm": [
                    {"id": "c2", "type": "list", "label": "Directory", "pos": "a0", "props": {"columns": ["Name"]}},
                    {"id": "c3", "type": "kpi", "label": "Stats", "pos": "a1"},
                ],
            },
        },
        entity_versions=entity_versions or {},
        version=version,
    )


def main_ids(state: PageState) -> list[str]:
    return [c["id"] for c in state.document["regions"]["rm"]]


# ── set ─────────────────────────────────────────────────────────────────────


def test_set_component_prop_bumps_version_and_stamps_entity():
    result = apply_batch(
        make_state(),
        [{"op": "set", "target": {"cmp": "c2"}, "path": "props.columns", "value": ["Name", "Email"]}],
        3,
    )
    assert result.page.version == 4
    assert result.page.entity_versions["c2"] == 4
    assert result.page.document["regions"]["rm"][0]["props"]["columns"] == ["Name", "Email"]


def test_apply_does_not_mutate_input():
    state = make_state()
    snapshot = deepcopy(state.document)
    apply_batch(state, [{"op": "set", "target": {"cmp": "c2"}, "path": "label", "value": "X"}], 3)
    assert state.document == snapshot


def test_set_elements_replaces_array_and_stamps_component():
    # Element edits arrive as one whole-array set on the component (see the
    # client's diff.ts CMP_KEYS); conflict granularity stays per component.
    elements = [
        {"id": "e1", "type": "column", "label": "Name", "pos": "a0", "data": {"kind": "text"}},
        {"id": "e2", "type": "column", "label": "Email", "pos": "a1", "data": {"kind": "email"}},
    ]
    result = apply_batch(
        make_state(),
        [{"op": "set", "target": {"cmp": "c2"}, "path": "elements", "value": elements}],
        3,
    )
    assert result.page.entity_versions["c2"] == 4
    assert result.page.document["regions"]["rm"][0]["elements"] == elements


def test_set_shape_and_layout_are_plain_component_keys():
    result = apply_batch(
        make_state(),
        [
            {"op": "set", "target": {"cmp": "c2"}, "path": "shape", "value": "cards"},
            {"op": "set", "target": {"cmp": "c2"}, "path": "layout", "value": "grid"},
        ],
        3,
    )
    cmp = result.page.document["regions"]["rm"][0]
    assert cmp["shape"] == "cards"
    assert cmp["layout"] == "grid"


def test_concurrent_element_set_conflicts_per_component():
    state = make_state(version=5, entity_versions={"c2": 5})
    with pytest.raises(OpConflict):
        apply_batch(state, [{"op": "set", "target": {"cmp": "c2"}, "path": "elements", "value": []}], 4)


def test_insert_component_carrying_elements():
    value = {
        "id": "c9",
        "type": "navbar",
        "label": "App",
        "pos": "a2",
        "shape": "links",
        "layout": "horizontal",
        "elements": [{"id": "e1", "type": "brand", "label": "Acme", "pos": "a0"}],
    }
    result = apply_batch(make_state(), [{"op": "insert", "into": {"region": "rm"}, "value": value}], 3)
    inserted = result.page.document["regions"]["rm"][-1]
    assert inserted["elements"][0]["type"] == "brand"


def test_set_page_column_and_root():
    result = apply_batch(
        make_state(),
        [
            {"op": "set", "path": "name", "value": "People"},
            {"op": "set", "path": "root", "value": {"kind": "region", "id": "rm", "size": {"fr": 1}}},
        ],
        3,
    )
    assert result.page.name == "People"
    assert result.page.document["root"] == {"kind": "region", "id": "rm", "size": {"fr": 1}}
    assert set(result.touched) == {"page", "layout"}
    # Replacing the tree keeps component lists; orphans are pruned client-side.
    assert result.page.document["regions"]["rh"]


def test_set_root_drops_legacy_frames():
    state = make_state()
    state.document = {"frames": [{"id": "f1"}]}
    result = apply_batch(
        state,
        [{"op": "set", "path": "root", "value": {"kind": "region", "id": "r1", "size": {"fr": 1}}}],
        3,
    )
    assert "frames" not in result.page.document
    assert result.page.document["regions"] == {}


def test_set_rejects_id_and_unknown_page_field():
    with pytest.raises(OpError):
        apply_batch(make_state(), [{"op": "set", "target": {"cmp": "c2"}, "path": "id", "value": "x"}], 3)
    with pytest.raises(OpError):
        apply_batch(make_state(), [{"op": "set", "path": "document", "value": {}}], 3)


# ── conflicts ───────────────────────────────────────────────────────────────


def test_stale_base_on_same_entity_conflicts_and_applies_nothing():
    state = make_state(version=5, entity_versions={"c2": 5})
    with pytest.raises(OpConflict) as exc:
        apply_batch(state, [{"op": "set", "target": {"cmp": "c2"}, "path": "label", "value": "X"}], 4)
    assert exc.value.conflicts == [{"entity_id": "c2", "current_version": 5}]


def test_stale_base_on_different_entity_is_fine():
    state = make_state(version=5, entity_versions={"c3": 5})
    result = apply_batch(state, [{"op": "set", "target": {"cmp": "c2"}, "path": "label", "value": "X"}], 4)
    assert result.page.version == 6


def test_layout_conflicts_track_the_layout_entity():
    state = make_state(version=5, entity_versions={"layout": 5})
    with pytest.raises(OpConflict):
        apply_batch(state, [{"op": "set", "path": "root", "value": {"kind": "region", "id": "r", "size": "auto"}}], 4)


def test_insert_is_exempt_from_conflict_check():
    state = make_state(version=5, entity_versions={"c2": 5})
    result = apply_batch(
        state,
        [{"op": "insert", "into": {"region": "rm"}, "value": {"id": "c9", "type": "form", "label": "F", "pos": "a2"}}],
        4,
    )
    assert "c9" in main_ids(result.page)


# ── insert / remove / move ──────────────────────────────────────────────────


def test_insert_component_rejects_duplicate_and_unknown_region():
    with pytest.raises(OpError):
        apply_batch(make_state(), [{"op": "insert", "into": {"region": "rm"}, "value": {"id": "c2"}}], 3)
    with pytest.raises(OpError):
        apply_batch(make_state(), [{"op": "insert", "into": {"region": "nowhere"}, "value": {"id": "c9"}}], 3)


def test_remove_component_stays_stamped():
    result = apply_batch(make_state(), [{"op": "remove", "target": {"cmp": "c2"}}], 3)
    assert main_ids(result.page) == ["c3"]
    assert result.page.entity_versions["c2"] == 4  # removed ids stay stamped so late edits conflict


def test_move_between_regions_sets_pos():
    result = apply_batch(
        make_state(),
        [{"op": "move", "target": {"cmp": "c3"}, "to": {"region": "rs", "pos": "Zz"}}],
        3,
    )
    assert main_ids(result.page) == ["c2"]
    moved = result.page.document["regions"]["rs"][0]
    assert moved["id"] == "c3"
    assert moved["pos"] == "Zz"


def test_move_within_region_tolerates_null_region():
    # The request schema dumps `to.region: None` for a same-region reorder;
    # that must keep the component where it is, not demand a region.
    result = apply_batch(
        make_state(),
        [{"op": "move", "target": {"cmp": "c3"}, "to": {"region": None, "pos": "Zz"}}],
        3,
    )
    assert main_ids(result.page) == ["c2", "c3"]
    assert result.page.document["regions"]["rm"][1]["pos"] == "Zz"


def test_unknown_target_and_empty_batch_are_errors():
    with pytest.raises(OpError):
        apply_batch(make_state(), [{"op": "set", "target": {"cmp": "nope"}, "path": "label", "value": "X"}], 3)
    with pytest.raises(OpError):
        apply_batch(make_state(), [], 3)


# ── export ──────────────────────────────────────────────────────────────────


def test_export_embeds_components_in_pos_order_and_strips_pos():
    state = make_state()
    state.document["regions"]["rm"] = [
        {"id": "c3", "type": "kpi", "label": "Stats", "pos": "a1"},
        {"id": "c2", "type": "list", "label": "Directory", "pos": "a0"},
    ]
    out = export_page("p1", state)
    assert out["layout"]["kind"] == "split"
    row = out["layout"]["children"][1]
    main = row["children"][1]
    assert [c["id"] for c in main["components"]] == ["c2", "c3"]
    assert all("pos" not in c for c in main["components"])
    assert "placement" not in out


def test_export_orders_elements_by_pos_and_strips_their_pos():
    state = make_state()
    state.document["regions"]["rh"][0]["elements"] = [
        {"id": "e2", "type": "nav-item", "label": "Users", "pos": "a1"},
        {"id": "e1", "type": "brand", "label": "Acme", "pos": "a0"},
    ]
    out = export_page("p1", state)
    nav = out["layout"]["children"][0]["components"][0]
    assert [e["id"] for e in nav["elements"]] == ["e1", "e2"]
    assert all("pos" not in e for e in nav["elements"])


def test_export_includes_placement_when_present():
    state = make_state()
    state.placement = {"page_id": "p0", "region_id": "rX"}
    out = export_page("p1", state)
    assert out["placement"] == {"page_id": "p0", "region_id": "rX"}


# ── import (snapshot restore) ───────────────────────────────────────────────


def test_import_page_round_trips_export():
    state = make_state()
    state.placement = {"page_id": "p0", "region_id": "rX"}
    state.document["regions"]["rh"][0]["elements"] = [
        {"id": "e2", "type": "nav-item", "label": "Users", "pos": "a1"},
        {"id": "e1", "type": "brand", "label": "Acme", "pos": "a0", "data": {"href": "/"}},
    ]
    imported = import_page(export_page("p1", state))

    assert imported["name"] == "Users"
    assert imported["route"] == "/users"
    assert imported["placement"] == {"page_id": "p0", "region_id": "rX"}
    doc = imported["document"]
    # The layout tree survives unchanged; component lists come back keyed by
    # region with fresh strictly-increasing pos in the export's order.
    assert doc["root"] == state.document["root"]
    assert set(doc["regions"]) == {"rh", "rs", "rm"}
    assert doc["regions"]["rs"] == []
    assert [c["id"] for c in doc["regions"]["rm"]] == ["c2", "c3"]
    assert doc["regions"]["rm"][0]["pos"] < doc["regions"]["rm"][1]["pos"]
    assert doc["regions"]["rm"][0]["props"] == {"columns": ["Name"]}
    elements = doc["regions"]["rh"][0]["elements"]
    assert [e["id"] for e in elements] == ["e1", "e2"]  # export sorted them by old pos
    assert elements[0]["pos"] < elements[1]["pos"]
    assert elements[0]["data"] == {"href": "/"}


def test_import_page_resets_malformed_layout_to_blank():
    imported = import_page({"id": "p1", "name": "Broken", "layout": "nonsense"})
    root = imported["document"]["root"]
    assert root["kind"] == "region"
    assert imported["document"]["regions"] == {root["id"]: []}
    assert imported["placement"] is None
