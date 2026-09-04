"""Unit tests for the page-id remap behind "create as a new wireframe".
No database involved."""
from copy import deepcopy

from app.studio.ops import remap_dataset_ids, remap_page_ids

OLD_SHELL = "11111111-1111-1111-1111-111111111111"
OLD_USERS = "22222222-2222-2222-2222-222222222222"
NEW_SHELL = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
NEW_USERS = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

MAPPING = {OLD_SHELL: NEW_SHELL, OLD_USERS: NEW_USERS}


def make_pages() -> list[dict]:
    return [
        {
            "id": OLD_SHELL,
            "name": "Shell",
            "route": "/",
            "layout": {
                "kind": "split",
                "id": "s1",
                "dir": "col",
                "size": {"fr": 1},
                "children": [
                    {
                        "kind": "region",
                        "id": "rnav",
                        "size": "auto",
                        "components": [
                            {
                                "id": "c1",
                                "type": "navbar",
                                "label": "Nav",
                                "elements": [{"id": "e1", "type": "navitem", "label": "Users"}],
                                "props": {
                                    "links": {
                                        "el:e1": {"pageId": OLD_USERS},
                                        "el:e2": [{"pageId": OLD_USERS}, {"pageId": "@back"}],
                                    }
                                },
                            }
                        ],
                    },
                    {"kind": "region", "id": "rmain", "size": {"fr": 1}, "components": []},
                ],
            },
        },
        {
            "id": OLD_USERS,
            "name": "Users",
            "route": "/users",
            "placement": {"page_id": OLD_SHELL, "region_id": "rmain"},
            "layout": {"kind": "region", "id": "r-root", "size": {"fr": 1}, "components": []},
        },
    ]


def links_of(page: dict) -> dict:
    nav = page["layout"]["children"][0]["components"][0]
    return nav["props"]["links"]


def test_remaps_ids_placements_and_links():
    pages = remap_page_ids(make_pages(), MAPPING)

    assert [p["id"] for p in pages] == [NEW_SHELL, NEW_USERS]
    assert pages[1]["placement"] == {"page_id": NEW_SHELL, "region_id": "rmain"}
    assert links_of(pages[0])["el:e1"] == {"pageId": NEW_USERS}


def test_back_sentinel_survives_but_foreign_targets_are_dropped():
    pages = make_pages()
    links = links_of(pages[0])
    links["el:e3"] = {"pageId": "99999999-9999-9999-9999-999999999999"}
    copied = remap_page_ids(pages, MAPPING)

    remapped = links_of(copied[0])
    # Index is meaning inside an array, so the sentinel keeps its slot.
    assert remapped["el:e2"] == [{"pageId": NEW_USERS}, {"pageId": "@back"}]
    # A target outside the copy would reach into the original wireframe.
    assert "el:e3" not in remapped


def test_placement_onto_a_page_left_behind_is_promoted():
    copied = remap_page_ids(make_pages(), {OLD_USERS: NEW_USERS})

    assert [p["id"] for p in copied] == [NEW_USERS]
    assert "placement" not in copied[0]


def test_source_pages_are_left_untouched():
    pages = make_pages()
    before = deepcopy(pages)
    remap_page_ids(pages, MAPPING)

    assert pages == before


# ── dataset bindings ────────────────────────────────────────────────────────

OLD_DS = "33333333-3333-3333-3333-333333333333"
NEW_DS = "cccccccc-cccc-cccc-cccc-cccccccccccc"
PLATFORM_DS = "44444444-4444-4444-4444-444444444444"


def make_bound_pages() -> list[dict]:
    """One page whose list columns bind to a project dataset, a platform
    dataset and nothing at all."""
    return [
        {
            "id": OLD_USERS,
            "name": "Users",
            "layout": {
                "kind": "region",
                "id": "r-root",
                "size": {"fr": 1},
                "components": [
                    {
                        "id": "c1",
                        "type": "list",
                        "elements": [
                            {"id": "e1", "type": "column", "data": {"dataset": OLD_DS}},
                            {"id": "e2", "type": "column", "data": {"dataset": PLATFORM_DS}},
                            {"id": "e3", "type": "column", "data": {"samples": OLD_DS}},
                            {"id": "e4", "type": "column"},
                        ],
                    }
                ],
            },
        }
    ]


def columns_of(page: dict) -> list[dict]:
    return page["layout"]["components"][0]["elements"]


def test_remaps_project_datasets_and_leaves_platform_ones_alone():
    pages = make_bound_pages()
    remap_dataset_ids(pages, {OLD_DS: NEW_DS})

    columns = columns_of(pages[0])
    assert columns[0]["data"]["dataset"] == NEW_DS
    # Platform datasets are shared, not copied, so their ids must survive.
    assert columns[1]["data"]["dataset"] == PLATFORM_DS
    # Only the dataset key is a binding; an id-shaped value elsewhere is data.
    assert columns[2]["data"]["samples"] == OLD_DS
    assert "data" not in columns[3]


def test_dataset_remap_reaches_components_nested_in_splits():
    pages = make_bound_pages()
    pages[0]["layout"] = {
        "kind": "split",
        "id": "s1",
        "dir": "col",
        "children": [make_bound_pages()[0]["layout"]],
    }
    remap_dataset_ids(pages, {OLD_DS: NEW_DS})

    nested = pages[0]["layout"]["children"][0]["components"][0]["elements"]
    assert nested[0]["data"]["dataset"] == NEW_DS


def test_dataset_binding_to_a_dataset_left_behind_is_untouched():
    """A dangling binding already renders as unbound; rewriting it to None
    would be a second, different behaviour change."""
    pages = make_bound_pages()
    remap_dataset_ids(pages, {})

    assert columns_of(pages[0])[0]["data"]["dataset"] == OLD_DS
