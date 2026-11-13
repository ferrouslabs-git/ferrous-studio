"""Pages shared across a project's wireframes: a link may target a page whose
home is another wireframe. No database involved."""
from app.studio.ops import remap_page_ids
from app.studio.wireframes import links_to, region_summaries

OLD_SHELL = "11111111-1111-1111-1111-111111111111"
NEW_SHELL = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
SHARED = "33333333-3333-3333-3333-333333333333"  # lives in another wireframe
STALE = "99999999-9999-9999-9999-999999999999"  # the source's own, left behind


def shell(links: dict) -> list[dict]:
    return [
        {
            "id": OLD_SHELL,
            "name": "Shell",
            "layout": {
                "kind": "region",
                "id": "r1",
                "components": [
                    {"id": "c1", "type": "navbar", "elements": [], "props": {"links": links}},
                ],
            },
        }
    ]


def links_of(page: dict) -> dict:
    return page["layout"]["components"][0]["props"].get("links", {})


def test_links_to_a_kept_page_survive_a_copy_unchanged():
    pages = shell({"el:e1": {"pageId": SHARED}, "el:e2": {"pageId": STALE}})
    copied = remap_page_ids(pages, {OLD_SHELL: NEW_SHELL}, keep={SHARED})

    links = links_of(copied[0])
    assert links["el:e1"] == {"pageId": SHARED}
    # Not shared, not copied: it would point back into the original.
    assert "el:e2" not in links


def test_kept_targets_hold_their_slot_in_an_array():
    pages = shell({"el:e1": [{"pageId": STALE}, {"pageId": SHARED}]})
    copied = remap_page_ids(pages, {OLD_SHELL: NEW_SHELL}, keep={SHARED})

    assert links_of(copied[0])["el:e1"] == [None, {"pageId": SHARED}]


def test_without_keep_a_foreign_target_is_still_dropped():
    copied = remap_page_ids(shell({"el:e1": {"pageId": SHARED}}), {OLD_SHELL: NEW_SHELL})
    assert links_of(copied[0]) == {}


def test_links_to_finds_scalar_and_array_links_in_live_documents():
    doc = {
        "root": {"kind": "region", "id": "r1"},
        "regions": {
            "r1": [
                {"id": "c1", "props": {"links": {"el:e1": {"pageId": "@back"}}}},
                {"id": "c2", "props": {"links": {"el:e2": [None, {"pageId": SHARED}]}}},
            ]
        },
    }
    assert links_to(doc, SHARED)
    assert not links_to(doc, STALE)


def test_links_to_ignores_the_id_outside_a_link():
    # A placement or a stray string naming the page is not a link to it.
    doc = {"regions": {"r1": [{"id": "c1", "props": {"note": SHARED, "pageId": SHARED}}]}}
    assert not links_to(doc, SHARED)


def test_region_summaries_list_regions_in_reading_order_with_display_names():
    document = {
        "root": {
            "kind": "split",
            "id": "s1",
            "children": [
                {"kind": "region", "id": "r1", "label": "Filters"},
                {"kind": "split", "id": "s2", "children": [{"kind": "region", "id": "r2"}]},
            ],
        },
        "regions": {},
    }
    assert region_summaries(document) == [
        {"id": "r1", "label": "Filters"},
        {"id": "r2", "label": "Region 2"},
    ]
    assert region_summaries({}) == []


def test_a_region_link_keeps_its_region_through_a_copy():
    link = {"pageId": OLD_SHELL, "regionId": "r1"}
    pages = shell({"el:a": link})
    copied = remap_page_ids(pages, {OLD_SHELL: NEW_SHELL})
    assert links_of(copied[0])["el:a"] == {"pageId": NEW_SHELL, "regionId": "r1"}



def test_opens_in_follows_its_host_page_through_a_copy():
    link = {"pageId": SHARED, "into": {"pageId": OLD_SHELL, "regionId": "r1"}}
    copied = remap_page_ids(shell({"el:a": link}), {OLD_SHELL: NEW_SHELL}, keep={SHARED})
    assert links_of(copied[0])["el:a"] == {"pageId": SHARED, "into": {"pageId": NEW_SHELL, "regionId": "r1"}}


def test_opens_in_is_dropped_when_its_host_page_did_not_travel():
    link = {"pageId": OLD_SHELL, "into": {"pageId": STALE, "regionId": "r9"}}
    copied = remap_page_ids(shell({"el:a": link}), {OLD_SHELL: NEW_SHELL})
    assert links_of(copied[0])["el:a"] == {"pageId": NEW_SHELL}
