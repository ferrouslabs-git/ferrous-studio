import { describe, expect, it } from "vitest";
import { elKey, LinksProp } from "./actions";
import { defaultChildPage, firstNavTarget, navEffectiveLink, navLinkedPageIds, navRouteLabel, navSubItems, orderPagesByNav } from "./navOrder";
import { BACK_PAGE_ID, ComponentNode, ElementNode, PageDocument } from "./types";

const el = (id: string, type: string, label: string, pos: string, data?: Record<string, string>): ElementNode =>
  data ? { id, type, label, pos, data } : { id, type, label, pos };

/** A nav bar whose items link by element id: [id, pageId | null, data?]. */
function navbar(
  id: string,
  pos: string,
  items: [string, string | null, Record<string, string>?][],
  layout?: string,
): ComponentNode {
  const links: LinksProp = {};
  const elements = items.map(([elId, pageId, data], i) => {
    if (pageId) links[elKey(elId)] = { pageId };
    return el(elId, "nav-item", elId, `a${i}`, data);
  });
  const cmp: ComponentNode = { id, type: "navbar", label: "Nav", pos, elements };
  if (layout) cmp.layout = layout;
  if (Object.keys(links).length) cmp.props = { links };
  return cmp;
}

/** One region per entry; two or more become a row split in key order. */
function doc(regions: Record<string, ComponentNode[]>): PageDocument {
  const children = Object.keys(regions).map((id) => ({ kind: "region" as const, id, size: { fr: 1 } }));
  return {
    root: children.length === 1 ? children[0] : { kind: "split", id: "s1", dir: "row", size: { fr: 1 }, children },
    regions,
  };
}

describe("navLinkedPageIds", () => {
  it("orders a vertical rail by pos, skipping unlinked items, @back and repeats", () => {
    const d = doc({
      r1: [
        navbar(
          "c1",
          "a0",
          [
            ["e1", "p-work"],
            ["e2", "p-deploy"],
            ["e3", null],
            ["e4", BACK_PAGE_ID],
            ["e5", "p-work"],
            ["e6", "p-item"],
          ],
          "vertical",
        ),
      ],
    });
    expect(navLinkedPageIds(d)).toEqual(["p-work", "p-deploy", "p-item"]);
  });

  it("orders a horizontal bar by zone (left → centre → right) before pos", () => {
    const d = doc({
      r1: [
        navbar("c1", "a0", [
          ["e1", "p-account", { align: "right" }],
          ["e2", "p-docs"],
          ["e3", "p-pricing", { align: "centre" }],
        ]),
      ],
    });
    expect(navLinkedPageIds(d)).toEqual(["p-docs", "p-pricing", "p-account"]);
  });

  it("walks regions in reading order and nav bars by pos within one", () => {
    const d = doc({
      r1: [navbar("c2", "a1", [["e3", "p-later"]]), navbar("c1", "a0", [["e1", "p-first"]])],
      r2: [
        { id: "c3", type: "list", label: "Users", pos: "a0" },
        navbar("c4", "a1", [["e4", "p-tab"]]),
      ],
    });
    expect(navLinkedPageIds(d)).toEqual(["p-first", "p-later", "p-tab"]);
  });

  it("returns nothing for a document without nav bars", () => {
    expect(navLinkedPageIds(doc({ r1: [{ id: "c1", type: "graph", label: "Chart", pos: "a0" }] }))).toEqual([]);
  });
});

describe("firstNavTarget", () => {
  const pages = [{ id: "p-home" }, { id: "p-deploy" }];

  it("skips links whose page no longer exists", () => {
    const d = doc({ r1: [navbar("c1", "a0", [["e1", "p-gone"], ["e2", "p-deploy"]], "vertical")] });
    expect(firstNavTarget(d, pages)).toBe("p-deploy");
  });

  it("is null with no surviving target", () => {
    const d = doc({ r1: [navbar("c1", "a0", [["e1", "p-gone"]], "vertical")] });
    expect(firstNavTarget(d, pages)).toBeNull();
  });
});

describe("orderPagesByNav", () => {
  const p = (id: string) => ({ id });

  it("refills the nav-linked slots in nav order; others keep their place", () => {
    const pages = [p("home"), p("item"), p("orphan"), p("deploy"), p("work")];
    const out = orderPagesByNav(pages, ["work", "deploy", "item"]);
    expect(out.map((x) => x.id)).toEqual(["home", "work", "orphan", "deploy", "item"]);
  });

  it("ignores nav ids with no matching page and leaves unlinked lists alone", () => {
    const pages = [p("home"), p("a"), p("b")];
    expect(orderPagesByNav(pages, ["missing"]).map((x) => x.id)).toEqual(["home", "a", "b"]);
    expect(orderPagesByNav(pages, []).map((x) => x.id)).toEqual(["home", "a", "b"]);
  });
});

describe("nested nav items (FS-REQ-64)", () => {
  const nav = (): ComponentNode => {
    const cmp = navbar("n", "a0", [["p", null], ["c1", "kid1"], ["c2", "kid2"], ["q", "solo"]], "vertical");
    cmp.elements![1].type = "nav-sub-item";
    cmp.elements![2].type = "nav-sub-item";
    return cmp;
  };

  it("nests each sub-item under the item before it", () => {
    expect([...navSubItems(nav().elements!).entries()].map(([k, v]) => [k, v.map((e) => e.id)])).toEqual([["p", ["c1", "c2"]]]);
  });

  it("an unlinked parent follows its first linked sub-item", () => {
    expect(navEffectiveLink(nav(), elKey("p"), null)).toEqual({ pageId: "kid1" });
    expect(navEffectiveLink(nav(), elKey("q"), null)).toEqual({ pageId: "solo" });
  });

  it("lists sub-item targets after their parent", () => {
    expect(navLinkedPageIds(doc({ r1: [nav()] }))).toEqual(["kid1", "kid2", "solo"]);
  });
});

describe("navRouteLabel (FS-REQ-58)", () => {
  it("is the label of the nav item routing to the page", () => {
    const d = doc({ r1: [navbar("n", "a0", [["Clients", "p1"], ["Users", "p2"]])] });
    expect(navRouteLabel("p2", [d])).toBe("Users");
    expect(navRouteLabel("p3", [d])).toBeNull();
  });
});

describe("defaultChildPage (FS-REQ-57/62)", () => {
  const page = (id: string, parent: string | null, presentation: string | null = null) => ({
    id,
    placement: parent ? { page_id: parent, region_id: "r2" } : null,
    presentation,
  });

  it("is the first nav target placed inside the page", () => {
    const d = doc({ r1: [navbar("n", "a0", [["a", "sib"], ["b", "kid1"], ["c", "kid2"]])], r2: [] });
    const pages = [page("p", null), page("sib", null), page("kid1", "p"), page("kid2", "p")];
    expect(defaultChildPage(d, "p", pages)).toBe("kid1");
  });

  it("skips overlays and returns null when nothing is placed inside", () => {
    const d = doc({ r1: [navbar("n", "a0", [["a", "modal"], ["b", "elsewhere"]])] });
    const pages = [page("p", null), page("modal", "p", "modal"), page("elsewhere", "q")];
    expect(defaultChildPage(d, "p", pages)).toBeNull();
  });
});
