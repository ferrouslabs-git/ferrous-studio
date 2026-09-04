import { describe, expect, it } from "vitest";
import { elKey, LinksProp } from "./actions";
import { firstNavTarget, navLinkedPageIds, orderPagesByNav } from "./navOrder";
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
