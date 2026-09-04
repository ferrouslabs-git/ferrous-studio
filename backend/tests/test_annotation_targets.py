"""find_annotation_target resolves an annotation's node inside a page
document: regions against the layout tree (which is authoritative),
components against every region list, elements against their owning
component. Pure function over dicts; no database."""
from app.studio.annotations import find_annotation_target


def make_document():
    return {
        "root": {
            "kind": "split",
            "id": "s-root",
            "dir": "col",
            "size": {"fr": 1},
            "children": [
                {"kind": "region", "id": "r-nav", "label": "Nav", "size": "auto"},
                {"kind": "region", "id": "r-main", "label": "Content", "size": {"fr": 1}},
            ],
        },
        "regions": {
            "r-nav": [
                {
                    "id": "c-navbar",
                    "type": "navbar",
                    "label": "Nav bar",
                    "pos": "a0",
                    "elements": [{"id": "e-home", "type": "nav-item", "label": "Home", "pos": "a0"}],
                }
            ],
            "r-main": [{"id": "c-table", "type": "table", "label": "Table", "pos": "a0"}],
            # A stale list whose region the tree no longer contains: inert,
            # pruned by the client on its next normalise (see ops.py).
            "r-stale": [{"id": "c-ghost", "type": "card", "label": "Ghost", "pos": "a0"}],
        },
    }


# ── Regions ─────────────────────────────────────────────────────────────────


def test_region_in_the_layout_tree_resolves():
    assert find_annotation_target(make_document(), "region", "r-main", None) is True


def test_region_only_present_as_a_stale_list_does_not_resolve():
    assert find_annotation_target(make_document(), "region", "r-stale", None) is False


def test_unknown_region_does_not_resolve():
    assert find_annotation_target(make_document(), "region", "r-nope", None) is False


# ── Components ──────────────────────────────────────────────────────────────


def test_component_in_any_region_list_resolves():
    doc = make_document()
    assert find_annotation_target(doc, "cmp", "c-navbar", None) is True
    assert find_annotation_target(doc, "cmp", "c-table", None) is True


def test_unknown_component_does_not_resolve():
    assert find_annotation_target(make_document(), "cmp", "c-nope", None) is False


# ── Elements ────────────────────────────────────────────────────────────────


def test_element_under_its_owning_component_resolves():
    assert find_annotation_target(make_document(), "element", "e-home", "c-navbar") is True


def test_element_under_the_wrong_component_does_not_resolve():
    assert find_annotation_target(make_document(), "element", "e-home", "c-table") is False


def test_element_without_an_owning_component_does_not_resolve():
    assert find_annotation_target(make_document(), "element", "e-home", None) is False


def test_el_prefixed_ids_are_rejected():
    # The frontend's "el:" address form must be stripped before storage.
    assert find_annotation_target(make_document(), "element", "el:e-home", "c-navbar") is False


# ── Degenerate documents ────────────────────────────────────────────────────


def test_empty_or_missing_document_resolves_nothing():
    for doc in (None, {}, {"root": None, "regions": None}):
        assert find_annotation_target(doc, "region", "r-main", None) is False
        assert find_annotation_target(doc, "cmp", "c-table", None) is False
        assert find_annotation_target(doc, "element", "e-home", "c-navbar") is False
