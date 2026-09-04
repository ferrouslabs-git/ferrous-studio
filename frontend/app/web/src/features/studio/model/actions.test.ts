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
  linkedRegionLabel,
  moveElement,
  removeElement,
  relabelLinkedRegion,
  removeRegionAction,
  setComponentFloat,
  setComponentHeight,
  setComponentPosition,
  setComponentShape,
  setComponentSize,
  setComponentType,
  setComponentWidth,
  setRegionDirAction,
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
import { firstRegionId, regionDisplayName, regionIds } from "./tree";
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

  it("removeRegionAction deletes the region and its content", () => {
    const p = page([{ id: "c1", type: "list", label: "Users", pos: "a0" }]);
    const created = splitRegionAction(p, ctx, "r1", "right")!.selectRegionId!;
    p.document.regions[created].push({ id: "c2", type: "form", label: "Form", pos: "a0" });
    removeRegionAction(p, ctx, created);
    expect(p.document.regions.r1.map((c) => c.id)).toEqual(["c1"]);
    expect(p.document.regions[created]).toBeUndefined();
    expect(regionIds(p.document.root)).toEqual(["r1"]);
  });

  it("applyPattern replaces the page with the template's tree", () => {
    const p = page([]);
    applyPattern(p, ctx, "full-shell-basic");
    const ids = regionIds(p.document.root);
    expect(ids).toHaveLength(4); // header, sidebar, content, panel
    const cmps = ids.flatMap((id) => p.document.regions[id]);
    expect(cmps.map((c) => c.type)).toEqual(["navbar", "navbar", "list"]);
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

  it("setElementLink keeps the linked element selected, not its component", () => {
    const p = page([navbar()]);
    const result = setElementLink(p, ctx, "n", elKey("e2"), null, { pageId: "p1" });
    expect(elementLink(listOf(p)[0], elKey("e2"), null)).toEqual({ pageId: "p1" });
    // The link control lives in the element's inspector: selecting the parent
    // component would close it out from under the user.
    expect(result).toEqual({ selectElement: { cmpId: "n", key: elKey("e2"), index: null } });
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

  it("moveElement front/back jumps to either end", () => {
    const p = page([navbar()]);
    moveElement(p, ctx, "n", "e1", "front");
    expect(byPos(listOf(p)[0].elements!).map((e) => e.id)).toEqual(["e2", "e3", "e1"]);
    moveElement(p, ctx, "n", "e3", "back");
    expect(byPos(listOf(p)[0].elements!).map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
  });

  it("moveElement to an end it already occupies writes nothing", () => {
    const p = page([navbar()]);
    const posOf = (id: string) => listOf(p)[0].elements!.find((e) => e.id === id)!.pos;
    const front = posOf("e3");
    const back = posOf("e1");
    moveElement(p, ctx, "n", "e3", "front");
    moveElement(p, ctx, "n", "e1", "back");
    expect(posOf("e3")).toBe(front);
    expect(posOf("e1")).toBe(back);
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
    const calendar: ComponentNode = { id: "d", type: "calendar", label: "Calendar", pos: "a0" };
    expect(elementValue(calendar, "period", null)).toBe("March 2026"); // falls back to the type defaults
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

describe("component sizing", () => {
  it("setComponentSize sets, clamps and clears each axis independently", () => {
    const p = page([{ id: "c1", type: "list", label: "Users", pos: "a0" }]);
    setComponentSize(p, ctx, "c1", { w: 320, h: 10 });
    expect(listOf(p)[0].props).toEqual({ w: 320, h: 24 }); // h clamps to the minimum
    setComponentSize(p, ctx, "c1", { h: 400 });
    expect(listOf(p)[0].props).toEqual({ w: 320, h: 400 }); // w untouched
    setComponentSize(p, ctx, "c1", { w: null, h: null });
    expect(listOf(p)[0].props).toBeUndefined(); // emptied props leave the node
  });

  it("a fixed height replaces fill-region", () => {
    const p = page([{ id: "c1", type: "list", label: "Users", pos: "a0", props: { size: "fill" } }]);
    setComponentSize(p, ctx, "c1", { h: 300 });
    expect(listOf(p)[0].props).toEqual({ h: 300 });
  });

  it("grows the named layout nodes in the same step", () => {
    const p = page([{ id: "c1", type: "list", label: "Users", pos: "a0" }]);
    p.document.root = {
      kind: "split",
      id: "s1",
      dir: "row",
      size: { fr: 1 },
      children: [
        { kind: "region", id: "r1", size: 280 },
        { kind: "region", id: "r2", size: { fr: 1 } },
      ],
    };
    setComponentSize(p, ctx, "c1", { w: 400 }, [{ id: "r1", size: 400 }]);
    expect(listOf(p)[0].props).toEqual({ w: 400 });
    const sidebar = (p.document.root as { children: { id: string; size: unknown }[] }).children[0];
    expect(sidebar.size).toBe(400);
  });

  it("setComponentHeight swaps cleanly between hug, fill and fixed", () => {
    const p = page([{ id: "c1", type: "list", label: "Users", pos: "a0" }]);
    setComponentHeight(p, ctx, "c1", 300);
    expect(listOf(p)[0].props).toEqual({ h: 300 });
    setComponentHeight(p, ctx, "c1", "fill");
    expect(listOf(p)[0].props).toEqual({ size: "fill" });
    setComponentHeight(p, ctx, "c1", "hug");
    expect(listOf(p)[0].props).toBeUndefined();
  });

  it("setComponentWidth clears back to natural sizing with null", () => {
    const p = page([{ id: "c1", type: "list", label: "Users", pos: "a0" }]);
    setComponentWidth(p, ctx, "c1", 640);
    expect(listOf(p)[0].props).toEqual({ w: 640 });
    setComponentWidth(p, ctx, "c1", null);
    expect(listOf(p)[0].props).toBeUndefined();
  });

  it("switching a region to free layout stamps measured boxes; back to a stack drops offsets", () => {
    const p = page([
      { id: "c1", type: "list", label: "Users", pos: "a0" },
      { id: "c2", type: "form", label: "Form", pos: "a1" },
    ]);
    setRegionDirAction(p, ctx, "r1", "free", [
      { id: "c1", x: 0, y: 0, w: 400, h: 120 },
      { id: "c2", x: 0, y: 120, w: 400, h: 200 },
      { id: "foreign", x: 5, y: 5, w: 50, h: 50 }, // not in the region: ignored
    ]);
    expect((p.document.root as { dir?: string }).dir).toBe("free");
    expect(listOf(p)[0].props).toEqual({ x: 0, y: 0, w: 400, h: 120 });
    expect(listOf(p)[1].props).toEqual({ x: 0, y: 120, w: 400, h: 200 });

    setRegionDirAction(p, ctx, "r1", "col");
    expect((p.document.root as { dir?: string }).dir).toBeUndefined();
    // Offsets are stacking-irrelevant and go; sizes survive the switch.
    expect(listOf(p)[0].props).toEqual({ w: 400, h: 120 });
  });

  it("setComponentFloat stamps the measured box on enable and drops offsets on disable", () => {
    const p = page([{ id: "c1", type: "form", label: "Form", pos: "a0", props: { size: "fill" } }]);
    setComponentFloat(p, ctx, "c1", true, { id: "c1", x: 12.4, y: 80, w: 360, h: 240 });
    // Region-fill would fight the stamped height, so it goes.
    expect(listOf(p)[0].props).toEqual({ float: true, x: 12, y: 80, w: 360, h: 240 });

    setComponentFloat(p, ctx, "c1", false);
    // Back in the flow: the float flag and offsets go, sizes survive.
    expect(listOf(p)[0].props).toEqual({ w: 360, h: 240 });
  });

  it("setComponentFloat keeps user-set sizes and ignores a canvas", () => {
    const p = page([
      { id: "c1", type: "list", label: "Users", pos: "a0", props: { w: 500 } },
      { id: "cv", type: "canvas", label: "Sketch", pos: "a1", shape: "plain", layout: "fixed" },
    ]);
    setComponentFloat(p, ctx, "c1", true, { id: "c1", x: 0, y: 0, w: 420, h: 180 });
    // The user's width wins over the measured one; only the missing h freezes.
    expect(listOf(p)[0].props).toEqual({ w: 500, float: true, x: 0, y: 0, h: 180 });

    setComponentFloat(p, ctx, "cv", true, { id: "cv", x: 0, y: 0, w: 100, h: 100 });
    expect(listOf(p)[1].props).toBeUndefined(); // a canvas floats via its layout
  });

  it("setComponentPosition stamps a measured size only onto unset axes", () => {
    const p = page([{ id: "cv", type: "canvas", label: "Sketch", pos: "a0", shape: "plain", layout: "float", props: { w: 300 } }]);
    setComponentPosition(p, ctx, "cv", 40, 60, [], { w: 562, h: 420 });
    // w was already chosen by the user; only the missing h freezes.
    expect(listOf(p)[0].props).toEqual({ w: 300, x: 40, y: 60, h: 420 });
  });

  it("setComponentPosition moves a component and grows the named nodes", () => {
    const p = page([{ id: "c1", type: "list", label: "Users", pos: "a0" }]);
    p.document.root = {
      kind: "split",
      id: "s1",
      dir: "row",
      size: { fr: 1 },
      children: [
        { kind: "region", id: "r1", size: 280, dir: "free" },
        { kind: "region", id: "r2", size: { fr: 1 } },
      ],
    };
    setComponentPosition(p, ctx, "c1", 150.6, -20, [{ id: "r1", size: 470 }]);
    expect(listOf(p)[0].props).toEqual({ x: 151, y: 0 }); // rounded, clamped to 0
    const sidebar = (p.document.root as { children: { size: unknown }[] }).children[0];
    expect(sidebar.size).toBe(470);
  });

  it("Inspector pixel sizes expand a fixed-px region that would clip", () => {
    const p = page([{ id: "c1", type: "list", label: "Users", pos: "a0" }]);
    p.document.root = {
      kind: "split",
      id: "s1",
      dir: "row",
      size: { fr: 1 },
      children: [
        { kind: "region", id: "r1", size: 280 },
        { kind: "region", id: "r2", size: { fr: 1 } },
      ],
    };
    setComponentWidth(p, ctx, "c1", 500);
    const sidebar = (p.document.root as { children: { size: unknown }[] }).children[0];
    expect(sidebar.size).toBe(500); // grew to fit
    setComponentWidth(p, ctx, "c1", 300);
    expect(sidebar.size).toBe(500); // narrower never shrinks the region back
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

describe("linkedRegionLabel", () => {
  const cmp = (over: Partial<ComponentNode>): ComponentNode =>
    ({ id: "c1", type: "list", label: "List", pos: "a0", ...over }) as ComponentNode;

  it("pairs the component with the element that carries the link", () => {
    const list = cmp({
      label: "List",
      elements: [{ id: "h", type: "header", label: "Users", pos: "a0" } as ElementNode],
    });
    expect(linkedRegionLabel(list, "Edit")).toBe("Users > Edit");
  });

  it("falls back to the component's own label when it has no header", () => {
    expect(linkedRegionLabel(cmp({ label: "Users" }), "Edit")).toBe("Users > Edit");
  });

  it("puts a nav item first and calls what it reveals Content", () => {
    const nav = cmp({ type: "navbar", label: "Nav" });
    expect(linkedRegionLabel(nav, "Dashboard")).toBe("Dashboard > Content");
  });

  it("drops a blank half rather than leaving a dangling separator", () => {
    expect(linkedRegionLabel(cmp({ label: "Users" }), "  ")).toBe("Users");
    expect(linkedRegionLabel(cmp({ label: "" }), "Edit")).toBe("Edit");
  });

  it("falls back to Content when nothing names the page", () => {
    expect(linkedRegionLabel(null, "")).toBe("Content");
  });
});

describe("relabelLinkedRegion", () => {
  const nav = { id: "c1", type: "navbar", label: "Nav", pos: "a0" } as ComponentNode;
  const doc = (label: string): PageDocument => ({
    root: { kind: "region", id: "r1", size: { fr: 1 }, label },
    regions: { r1: [] },
  });

  it("carries a nav item's rename through to its page's region", () => {
    // The nav-item flow seeds every page with the default label "Item", so
    // without this every nav-created region would read "Item > Content".
    const d = doc("Item > Content");
    expect(relabelLinkedRegion(d, nav, "Item", "Dashboard")).toBe(true);
    expect((d.root as { label?: string }).label).toBe("Dashboard > Content");
  });

  it("leaves a region the user renamed by hand alone", () => {
    const d = doc("Reports");
    expect(relabelLinkedRegion(d, nav, "Item", "Dashboard")).toBe(false);
    expect((d.root as { label?: string }).label).toBe("Reports");
  });

  it("finds the region wherever the page has since been split", () => {
    const d: PageDocument = {
      root: {
        kind: "split",
        id: "s1",
        dir: "col",
        size: { fr: 1 },
        children: [
          { kind: "region", id: "r1", size: "auto", label: "Item > Content" },
          { kind: "region", id: "r2", size: { fr: 1 }, label: "Content" },
        ],
      },
      regions: { r1: [], r2: [] },
    };
    expect(relabelLinkedRegion(d, nav, "Item", "Dashboard")).toBe(true);
    expect(regionIds(d.root).map((id) => regionDisplayName(d.root, id))).toEqual(["Dashboard > Content", "Content"]);
  });
});
