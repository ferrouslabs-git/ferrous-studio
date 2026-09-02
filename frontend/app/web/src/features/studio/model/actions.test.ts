import { describe, expect, it } from "vitest";
import {
  ActionContext,
  addElement,
  addListRow,
  appendComponent,
  applyPattern,
  elementLink,
  elementValue,
  elKey,
  moveElement,
  removeElement,
  removeRegionAction,
  setComponentShape,
  setComponentType,
  reorderElement,
  setElementLink,
  setElementSize,
  setElementText,
  setListCell,
  splitRegionAction,
} from "./actions";
import { navAlign } from "../catalog";
import { PageLike } from "./applyOps";
import { byPos } from "./positions";
import { firstRegionId, regionIds } from "./tree";
import { ComponentNode, ElementNode, PageDocument } from "./types";

function page(components: ComponentNode[]): PageLike {
  const document: PageDocument = {
    root: { kind: "region", id: "r1", size: { fr: 1 } },
    regions: { r1: components },
  };
  return { name: "Users", route: "/users", pos: "a0", document };
}

const ctx: ActionContext = { customComponents: [] };
const listOf = (p: PageLike, region = "r1") => p.document.regions[region];
const el = (id: string, type: string, label: string, pos: string, data?: Record<string, string>): ElementNode =>
  data ? { id, type, label, pos, data } : { id, type, label, pos };

describe("layout actions", () => {
  it("splitRegionAction creates and selects the new region", () => {
    const p = page([]);
    const result = splitRegionAction(p, ctx, "r1", "left");
    expect(result?.selectRegionId).toBeTruthy();
    expect(regionIds(p.document.root)).toHaveLength(2);
    expect(p.document.regions[result!.selectRegionId!]).toEqual([]);
  });

  it("removeRegionAction merges content back", () => {
    const p = page([{ id: "c1", type: "main", label: "Main", pos: "a0" }]);
    const created = splitRegionAction(p, ctx, "r1", "right")!.selectRegionId!;
    p.document.regions[created].push({ id: "c2", type: "form", label: "Form", pos: "a0" });
    removeRegionAction(p, ctx, created);
    expect(p.document.regions.r1.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(regionIds(p.document.root)).toEqual(["r1"]);
  });

  it("applyPattern replaces the page with the template's tree", () => {
    const p = page([]);
    applyPattern(p, ctx, "full-shell-basic");
    const ids = regionIds(p.document.root);
    expect(ids).toHaveLength(4); // header, sidebar, content, panel
    const cmps = ids.flatMap((id) => p.document.regions[id]);
    expect(cmps.map((c) => c.type)).toEqual(["navbar", "navbar", "main", "detail"]);
    const [topNav, sideNav] = cmps;
    expect(topNav.shape).toBe("plain");
    expect(topNav.layout).toBe("horizontal");
    expect(sideNav.layout).toBe("vertical");
    expect(topNav.elements!.some((e) => e.type === "brand")).toBe(true);
  });

  it("appendComponent lands in the first region and mints shape, layout and elements", () => {
    const p = page([]);
    applyPattern(p, ctx, "left-panel-simple");
    const first = firstRegionId(p.document.root);
    appendComponent(p, ctx, "list", null, null);
    const cmp = p.document.regions[first].find((c) => c.type === "list")!;
    expect(cmp.shape).toBe("table");
    expect(cmp.layout).toBe("vertical");
    expect(cmp.elements!.filter((e) => e.type === "column")).toHaveLength(4);
    expect(cmp.elements!.some((e) => e.type === "column-header")).toBe(true);
  });
});

describe("element CRUD", () => {
  const navbar = (): ComponentNode => ({
    id: "n", type: "navbar", label: "App", pos: "a0", shape: "plain", layout: "horizontal",
    elements: [el("e1", "brand", "Acme", "a0"), el("e2", "nav-item", "Overview", "a1"), el("e3", "avatar", "AL", "a2")],
  });

  it("addElement appends within the vocabulary and selects the new element", () => {
    const p = page([navbar()]);
    const result = addElement(p, ctx, "n", "search");
    const cmp = listOf(p)[0];
    expect(cmp.elements!.some((e) => e.type === "search")).toBe(true);
    expect(result?.selectElement?.key).toMatch(/^el:/);
  });

  it("addElement refuses element types outside the vocabulary", () => {
    const p = page([navbar()]);
    addElement(p, ctx, "n", "column");
    expect(listOf(p)[0].elements!.some((e) => e.type === "column")).toBe(false);
  });

  it("addElement honours max (one avatar per nav)", () => {
    const p = page([navbar()]);
    addElement(p, ctx, "n", "avatar");
    expect(listOf(p)[0].elements!.filter((e) => e.type === "avatar")).toHaveLength(1);
  });

  it("gives canvas children a cascading default position", () => {
    const p = page([{ id: "cv", type: "canvas", label: "Canvas", pos: "a0", shape: "plain", layout: "fixed", elements: [] }]);
    addElement(p, ctx, "cv", "button");
    addElement(p, ctx, "cv", "badge");
    const [b1, b2] = listOf(p)[0].elements!;
    expect(b1.data!.x).toBe("16");
    expect(b2.data!.x).toBe("40");
  });

  it("reorderElement drops an element before/after a sibling", () => {
    const p = page([navbar()]);
    reorderElement(p, ctx, "n", "e3", "e1", true); // avatar before brand
    expect(byPos(listOf(p)[0].elements!).map((e) => e.id)).toEqual(["e3", "e1", "e2"]);
    reorderElement(p, ctx, "n", "e3", "e2", false); // avatar after nav item
    expect(byPos(listOf(p)[0].elements!).map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });

  it("reorderElement in a horizontal nav bar adopts the target's zone", () => {
    const p = page([navbar()]);
    // Avatar defaults to the right zone; dropping it beside the brand (left
    // zone) re-aligns it so the drag reads spatially.
    reorderElement(p, ctx, "n", "e3", "e1", false);
    expect(listOf(p)[0].elements!.find((e) => e.id === "e3")!.data?.align).toBe("left");
    expect(navAlign(listOf(p)[0].elements!.find((e) => e.id === "e3")!)).toBe("left");
    // A same-zone drop writes nothing.
    reorderElement(p, ctx, "n", "e2", "e1", true);
    expect(listOf(p)[0].elements!.find((e) => e.id === "e2")!.data?.align).toBeUndefined();
  });

  it("reorderElement in a vertical nav bar never writes alignment", () => {
    const p = page([{ ...navbar(), layout: "vertical" }]);
    reorderElement(p, ctx, "n", "e3", "e1", true);
    expect(listOf(p)[0].elements!.find((e) => e.id === "e3")!.data?.align).toBeUndefined();
  });

  it("navAlign defaults by type and honours an explicit data.align", () => {
    expect(navAlign(el("x", "brand", "Acme", "a0"))).toBe("left");
    expect(navAlign(el("x", "nav-item", "Home", "a0"))).toBe("left");
    expect(navAlign(el("x", "search", "Search…", "a0"))).toBe("right");
    expect(navAlign(el("x", "avatar", "AL", "a0"))).toBe("right");
    expect(navAlign(el("x", "button", "Go", "a0", { align: "centre" }))).toBe("centre");
    expect(navAlign(el("x", "brand", "Acme", "a0", { align: "nonsense" }))).toBe("left");
  });

  it("setElementSize stores a clamped w/h beside the position", () => {
    const p = page([{ id: "cv", type: "canvas", label: "Canvas", pos: "a0", shape: "plain", layout: "fixed", elements: [] }]);
    addElement(p, ctx, "cv", "box");
    const box = listOf(p)[0].elements![0];
    setElementSize(p, ctx, "cv", box.id, 220.4, 10);
    expect(box.data!.w).toBe("220");
    expect(box.data!.h).toBe("24"); // clamped to the minimum
    expect(box.data!.x).toBe("16"); // position untouched
  });

  it("removeElement drops the element and its link", () => {
    const p = page([navbar()]);
    setElementLink(p, ctx, "n", elKey("e2"), null, { pageId: "p1" });
    removeElement(p, ctx, "n", "e2");
    const cmp = listOf(p)[0];
    expect(cmp.elements!.map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(cmp.props?.links).toBeUndefined();
  });

  it("moveElement reorders by pos", () => {
    const p = page([navbar()]);
    moveElement(p, ctx, "n", "e3", -1);
    expect(byPos(listOf(p)[0].elements!).map((e) => e.id)).toEqual(["e1", "e3", "e2"]);
  });

  it("setElementText renames an element and removes pure-text elements on an empty commit", () => {
    const p = page([navbar()]);
    setElementText(p, ctx, "n", elKey("e2"), null, "Home");
    expect(listOf(p)[0].elements!.find((e) => e.id === "e2")!.label).toBe("Home");
    setElementText(p, ctx, "n", elKey("e2"), null, ""); // nav item: label IS the element
    expect(listOf(p)[0].elements!.some((e) => e.id === "e2")).toBe(false);
  });

  it("blanking a widget element's label keeps the element", () => {
    const p = page([
      {
        id: "f", type: "form", label: "Form", pos: "a0", shape: "simple", layout: "one-column",
        elements: [el("e9", "text-input", "Email", "a0", { kind: "email" })],
      },
    ]);
    setElementText(p, ctx, "f", elKey("e9"), null, "");
    const input = listOf(p)[0].elements!.find((e) => e.id === "e9");
    expect(input).toBeDefined(); // the input survives; only its label blanks
    expect(input!.label).toBe("");
    expect(input!.data!.kind).toBe("email");
  });

  it("elementValue and elementLink address element nodes and scalar props", () => {
    const cmp: ComponentNode = {
      ...navbar(),
      props: { links: { [elKey("e2")]: { pageId: "p7" } } },
    };
    expect(elementValue(cmp, elKey("e2"), null)).toBe("Overview");
    expect(elementLink(cmp, elKey("e2"), null)).toEqual({ pageId: "p7" });
    const detail: ComponentNode = { id: "d", type: "detail", label: "Detail", pos: "a0" };
    expect(elementValue(detail, "heading", null)).toBe("Ada Lovelace"); // falls back to the type defaults
  });
});

describe("shape and type changes", () => {
  it("setComponentShape keeps elements and props", () => {
    const p = page([{
      id: "l", type: "list", label: "List", pos: "a0", shape: "table", layout: "vertical",
      elements: [el("c1", "column", "Name", "a0", { kind: "text" })],
      props: { rows: [{ c1: "Ada" }] },
    }]);
    setComponentShape(p, ctx, "l", "cards");
    const cmp = listOf(p)[0];
    expect(cmp.shape).toBe("cards");
    expect(cmp.elements).toHaveLength(1);
    expect(cmp.props?.rows).toEqual([{ c1: "Ada" }]);
  });

  it("setComponentShape rejects shapes outside the component's set", () => {
    const p = page([{ id: "l", type: "list", label: "List", pos: "a0", shape: "table", elements: [] }]);
    setComponentShape(p, ctx, "l", "wizard");
    expect(listOf(p)[0].shape).toBe("table");
  });

  it("setComponentType resets to the new type's defaults", () => {
    const p = page([{ id: "x", type: "list", label: "List", pos: "a0", shape: "table", elements: [], props: { rows: [] } }]);
    setComponentType(p, ctx, "x", "form");
    const cmp = listOf(p)[0];
    expect(cmp.type).toBe("form");
    expect(cmp.shape).toBe("simple");
    expect(cmp.elements!.some((e) => e.type === "text-input")).toBe(true);
    expect(cmp.props).toBeUndefined();
  });
});

describe("list rows", () => {
  it("setListCell materialises sparse rows keyed by column id; blank clears", () => {
    const p = page([{
      id: "l", type: "list", label: "List", pos: "a0", shape: "table",
      elements: [el("c1", "column", "Name", "a0")], props: { rows: [{}, {}] },
    }]);
    setListCell(p, ctx, "l", 1, "c1", "Ada");
    expect(listOf(p)[0].props?.rows).toEqual([{}, { c1: "Ada" }]);
    setListCell(p, ctx, "l", 1, "c1", "");
    expect(listOf(p)[0].props?.rows).toEqual([{}, {}]);
  });

  it("addListRow appends an empty record and removeElement clears its column's cells", () => {
    const p = page([{
      id: "l", type: "list", label: "List", pos: "a0", shape: "table",
      elements: [el("c1", "column", "Name", "a0"), el("c2", "column", "Email", "a1")],
      props: { rows: [{ c1: "Ada", c2: "ada@acme.io" }] },
    }]);
    addListRow(p, ctx, "l");
    removeElement(p, ctx, "l", "c2");
    expect(listOf(p)[0].props?.rows).toEqual([{ c1: "Ada" }, {}]);
  });
});

describe("header element", () => {
  it("seeds new components with a header titled from the label, sorted first", () => {
    const p = page([]);
    appendComponent(p, ctx, { type: "list", label: "Team members" });
    const cmp = listOf(p)[0];
    const header = cmp.elements!.find((e) => e.type === "header")!;
    expect(header.label).toBe("Team members");
    expect(header.data?.placement).toBe("inline");
    expect(byPos(cmp.elements!)[0].type).toBe("header");
  });

  it("an explicit header seed replaces the default one (max 1)", () => {
    const p = page([]);
    appendComponent(p, ctx, { type: "form", label: "Filters", elements: [{ type: "header", label: "Refine" }] });
    const headers = listOf(p)[0].elements!.filter((e) => e.type === "header");
    expect(headers.map((h) => h.label)).toEqual(["Refine"]);
  });

  it("removing the header leaves a tombstone so migration cannot resurrect it", () => {
    const p = page([]);
    appendComponent(p, ctx, "graph");
    const cmp = listOf(p)[0];
    const header = cmp.elements!.find((e) => e.type === "header")!;
    removeElement(p, ctx, cmp.id, header.id);
    expect(cmp.elements!.some((e) => e.type === "header")).toBe(false);
    expect(cmp.props?.title).toBe("");
  });

  it("re-adding a header from the library titles it from the label again", () => {
    const p = page([]);
    appendComponent(p, ctx, { type: "calendar", label: "Roadmap" });
    const cmp = listOf(p)[0];
    removeElement(p, ctx, cmp.id, cmp.elements!.find((e) => e.type === "header")!.id);
    addElement(p, ctx, cmp.id, "header");
    const header = cmp.elements!.find((e) => e.type === "header")!;
    expect(header.label).toBe("Roadmap");
  });
});
