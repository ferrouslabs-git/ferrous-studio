"""Unit tests for the generic op applier. No database involved."""
from copy import deepcopy

import pytest

from app.studio.ops import OpConflict, OpError, PageState, apply_batch, export_page


def make_state(version: int = 3, entity_versions: dict | None = None) -> PageState:
    return PageState(
        name="Users",
        route="/users",
        pos="a0",
        document={
            "frames": [
                {
                    "id": "f1",
                    "label": "Default",
                    "pos": "a0",
                    "layoutMode": "regions",
                    "layout": {
                        "regions": {
                            "header": [{"id": "c1", "type": "navbar", "label": "App", "pos": "a0"}],
                            "sidebar": [],
                            "main": [
                                {"id": "c2", "type": "list", "label": "Directory", "pos": "a0", "props": {"columns": ["Name"]}},
                                {"id": "c3", "type": "kpi", "label": "Stats", "pos": "a1"},
                            ],
                            "right": [],
                            "footer": [],
                        },
                        "options": {"smartDock": True, "mainFlow": "stack"},
                    },
                }
            ]
        },
        entity_versions=entity_versions or {},
        version=version,
    )


def main_ids(state: PageState) -> list[str]:
    return [c["id"] for c in state.document["frames"][0]["layout"]["regions"]["main"]]


# ── set ─────────────────────────────────────────────────────────────────────


def test_set_component_prop_bumps_version_and_stamps_entity():
    state = make_state()
    result = apply_batch(
        state,
        [{"op": "set", "target": {"frame": "f1", "cmp": "c2"}, "path": "props.columns", "value": ["Name", "Email"]}],
        base_version=3,
    )
    cmp = result.page.document["frames"][0]["layout"]["regions"]["main"][0]
    assert cmp["props"]["columns"] == ["Name", "Email"]
    assert result.page.version == 4
    assert result.page.entity_versions == {"c2": 4}


def test_apply_does_not_mutate_input():
    state = make_state()
    before = deepcopy(state.document)
    apply_batch(state, [{"op": "set", "target": {"frame": "f1", "cmp": "c2"}, "path": "label", "value": "X"}], 3)
    assert state.document == before
    assert state.version == 3


def test_set_page_column_and_frame_option():
    state = make_state()
    result = apply_batch(
        state,
        [
            {"op": "set", "path": "name", "value": "People"},
            {"op": "set", "target": {"frame": "f1"}, "path": "layout.options.mainFlow", "value": "two-col"},
        ],
        3,
    )
    assert result.page.name == "People"
    assert result.page.document["frames"][0]["layout"]["options"]["mainFlow"] == "two-col"
    assert set(result.page.entity_versions) == {"page", "f1"}


def test_set_rejects_id_and_unknown_page_field():
    with pytest.raises(OpError):
        apply_batch(make_state(), [{"op": "set", "target": {"frame": "f1", "cmp": "c2"}, "path": "id", "value": "z"}], 3)
    with pytest.raises(OpError):
        apply_batch(make_state(), [{"op": "set", "path": "document", "value": {}}], 3)


# ── conflicts ───────────────────────────────────────────────────────────────


def test_stale_base_on_same_entity_conflicts_and_applies_nothing():
    state = make_state(version=5, entity_versions={"c2": 5})
    with pytest.raises(OpConflict) as exc:
        apply_batch(state, [{"op": "set", "target": {"frame": "f1", "cmp": "c2"}, "path": "label", "value": "X"}], 4)
    assert exc.value.conflicts == [{"entity_id": "c2", "current_version": 5}]
    assert exc.value.version == 5


def test_stale_base_on_different_entity_is_fine():
    state = make_state(version=5, entity_versions={"c2": 5})
    result = apply_batch(state, [{"op": "set", "target": {"frame": "f1", "cmp": "c3"}, "path": "label", "value": "X"}], 4)
    assert result.page.version == 6


def test_entity_changed_at_exactly_base_version_is_not_a_conflict():
    state = make_state(version=5, entity_versions={"c2": 5})
    apply_batch(state, [{"op": "set", "target": {"frame": "f1", "cmp": "c2"}, "path": "label", "value": "X"}], 5)


def test_insert_is_exempt_from_conflict_check():
    state = make_state(version=5, entity_versions={"f1": 5, "c2": 5})
    result = apply_batch(
        state,
        [{"op": "insert", "target": {"frame": "f1"}, "into": {"region": "main"}, "value": {"id": "c9", "type": "form", "pos": "a2"}}],
        2,
    )
    assert "c9" in main_ids(result.page)
    assert result.page.entity_versions["c9"] == 6


# ── insert / remove / move ──────────────────────────────────────────────────


def test_insert_component_rejects_duplicate_and_bad_region():
    with pytest.raises(OpError):
        apply_batch(make_state(), [{"op": "insert", "target": {"frame": "f1"}, "into": {"region": "main"}, "value": {"id": "c2"}}], 3)
    with pytest.raises(OpError):
        apply_batch(make_state(), [{"op": "insert", "target": {"frame": "f1"}, "into": {"region": "nowhere"}, "value": {"id": "c9"}}], 3)


def test_insert_frame():
    result = apply_batch(
        make_state(),
        [{"op": "insert", "into": {"list": "frames"}, "value": {"id": "f2", "label": "Mobile", "pos": "a1", "layoutMode": "flat", "layout": {"components": []}}}],
        3,
    )
    assert [f["id"] for f in result.page.document["frames"]] == ["f1", "f2"]


def test_remove_component_and_frame():
    result = apply_batch(make_state(), [{"op": "remove", "target": {"frame": "f1", "cmp": "c2"}}], 3)
    assert main_ids(result.page) == ["c3"]
    assert result.page.entity_versions["c2"] == 4  # removed ids stay stamped so late edits conflict

    result = apply_batch(make_state(), [{"op": "remove", "target": {"frame": "f1"}}], 3)
    assert result.page.document["frames"] == []


def test_move_between_regions_sets_pos():
    result = apply_batch(
        make_state(),
        [{"op": "move", "target": {"frame": "f1", "cmp": "c3"}, "to": {"region": "right", "pos": "Zz"}}],
        3,
    )
    regions = result.page.document["frames"][0]["layout"]["regions"]
    assert [c["id"] for c in regions["main"]] == ["c2"]
    assert regions["right"][0]["id"] == "c3"
    assert regions["right"][0]["pos"] == "Zz"


def test_move_within_region_only_changes_pos():
    result = apply_batch(
        make_state(),
        [{"op": "move", "target": {"frame": "f1", "cmp": "c3"}, "to": {"pos": "Zz"}}],
        3,
    )
    main = result.page.document["frames"][0]["layout"]["regions"]["main"]
    assert {c["id"] for c in main} == {"c2", "c3"}
    assert next(c for c in main if c["id"] == "c3")["pos"] == "Zz"


def test_unknown_target_and_empty_batch_are_errors():
    with pytest.raises(OpError):
        apply_batch(make_state(), [{"op": "set", "target": {"frame": "f1", "cmp": "nope"}, "path": "label", "value": 1}], 3)
    with pytest.raises(OpError):
        apply_batch(make_state(), [], 3)


# ── export ──────────────────────────────────────────────────────────────────


def test_export_orders_by_pos_and_strips_it():
    state = make_state()
    # Store c3 first but give it the larger pos; export must sort by pos.
    # (Fractional-index order is byte order: digits < upper < lower, so "a2"
    # rather than something like "Zz", which would sort *before* "a0".)
    main = state.document["frames"][0]["layout"]["regions"]["main"]
    main.reverse()
    main[0]["pos"] = "a2"
    out = export_page("p1", state)
    ids = [c["id"] for c in out["frames"][0]["layout"]["regions"]["main"]]
    assert ids == ["c2", "c3"]
    assert "pos" not in out["frames"][0]
    assert all("pos" not in c for c in out["frames"][0]["layout"]["regions"]["main"])
    assert out["name"] == "Users" and out["route"] == "/users"
