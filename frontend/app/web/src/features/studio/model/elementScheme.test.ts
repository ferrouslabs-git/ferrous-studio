// FS-REQ-84: element types → shapes → variants, and the read-time migration
// that carries stored wireframes across the regrouping.
import { describe, expect, it } from "vitest";
import { COMPONENTS, ELEMENT_GROUP_OF, elementGroups, RETIRED_ELEMENTS } from "../catalog";
import { PageLike } from "./applyOps";
import { remapElement } from "./migrate";
import { normalizePage } from "./positions";
import { ComponentNode, ElementNode } from "./types";

const shapeIds = (host: string) =>
  Object.fromEntries(elementGroups(host).map((g) => [g.label, g.shapes.map((m) => m.type)]));

describe("the element scheme", () => {
  it("puts the canvas's shapes under exactly the six types asked for", () => {
    expect(shapeIds("canvas")).toEqual({
      Text: ["heading", "text", "label", "search"],
      Input: ["text-input", "text-area", "select", "multi-select", "date-picker", "date-time", "radio-group", "checkbox", "toggle", "read-only", "file-upload", "slider"],
      Action: ["link", "button"],
      "UI element": ["badge", "box", "divider", "pagination"],
      Image: ["image", "icon"],
      Basic: ["line", "square", "circle", "triangle"],
    });
  });

  it("offers none of the removed shapes on the canvas", () => {
    const canvas = COMPONENTS.canvas.elements.map((m) => m.type);
    for (const gone of Object.keys(RETIRED_ELEMENTS.canvas)) expect(canvas).not.toContain(gone);
  });

  it("groups every element of every component, adding no shape to the others", () => {
    for (const meta of Object.values(COMPONENTS)) {
      for (const el of meta.elements) expect(ELEMENT_GROUP_OF[el.type], `${meta.type}/${el.type}`).toBeDefined();
    }
    // Date/time was later asked for on forms too (FS-REQ-84 review), so only
    // the form may offer it besides the canvas.
    const newShapes = ["date-time", "slider", "icon", "line", "square", "circle", "triangle"];
    for (const meta of Object.values(COMPONENTS)) {
      if (meta.type === "canvas") continue;
      for (const el of meta.elements) {
        if (meta.type === "form" && el.type === "date-time") continue;
        expect(newShapes, `${meta.type}/${el.type}`).not.toContain(el.type);
      }
    }
  });

  it("maps every retired canvas shape to a shape the canvas still has", () => {
    for (const remap of Object.values(RETIRED_ELEMENTS.canvas)) {
      if (remap) expect(COMPONENTS.canvas.elements.some((m) => m.type === remap.type)).toBe(true);
    }
  });
});

const node = (type: string, data?: Record<string, string>, label = "L"): ElementNode =>
  ({ id: "e1", type, label, pos: "a0", ...(data ? { data } : {}) }) as ElementNode;

/** Old canvas shape (+ data) → new shape + data, through remapElement. */
const remap = (type: string, data?: Record<string, string>, host = "canvas") => {
  const el = node(type, data);
  return remapElement(host, el) ? { type: el.type, data: el.data } : null;
};

describe("remapElement: old type/shape → new type + shape + variant", () => {
  it("moves the corner treatment from data.shape to data.variant, in every host", () => {
    expect(remap("badge", { shape: "pill" })).toEqual({ type: "badge", data: { variant: "pill" } });
    expect(remap("search", { shape: "rounded", fill: "ghost" }, "list")).toEqual({ type: "search", data: { variant: "rounded", fill: "ghost" } });
    expect(remap("button", { shape: "square", variant: "pill" }, "form")).toEqual({ type: "button", data: { variant: "pill" } });
  });

  it("maps each retired canvas shape", () => {
    expect(remap("section-heading", { x: "10", y: "20", bg: "#fff" })).toEqual({ type: "heading", data: { x: "10", y: "20", bg: "#fff" } });
    expect(remap("help-text")).toEqual({ type: "text", data: undefined });
    expect(remap("step", { shape: "pill", fill: "filled" })).toEqual({ type: "badge", data: { variant: "pill", fill: "filled" } });
    expect(remap("column", { kind: "status", samples: "Active, Inactive", x: "4", images: "[]" })).toEqual({
      type: "read-only", data: { value: "Active", x: "4" },
    });
    expect(remap("column", { kind: "text", dataset: "ds-1" })).toEqual({ type: "read-only", data: { dataset: "ds-1" } });
    expect(remap("row-action", { shape: "rounded" })).toEqual({ type: "button", data: { variant: "rounded", style: "secondary" } });
    expect(remap("select-column", { x: "1" })).toEqual({ type: "checkbox", data: { x: "1" } });
    expect(remap("filter", { options: "A, B", selected: "B", shape: "pill" })).toEqual({
      type: "select", data: { options: "A, B", selected: "B", variant: "pill" },
    });
    expect(remap("filter-multi", { dataset: "ds-2", selected: "A, B" })).toEqual({ type: "multi-select", data: { dataset: "ds-2", selected: "A, B" } });
    expect(remap("filter-multi-search", { options: "A" })).toEqual({ type: "multi-select", data: { options: "A" } });
  });

  it("drops a column header from a canvas: it has no meaning there", () => {
    expect(remap("column-header")).toBeNull();
  });

  it("leaves the same shapes alone in the components that still have them", () => {
    expect(remap("column", { kind: "text" }, "list")).toEqual({ type: "column", data: { kind: "text" } });
    expect(remap("step", undefined, "form")).toEqual({ type: "step", data: undefined });
    expect(remap("filter-multi", { options: "A" }, "list")).toEqual({ type: "filter-multi", data: { options: "A" } });
  });

  it("is idempotent", () => {
    const el = node("filter", { shape: "pill", options: "A" });
    remapElement("canvas", el);
    const once = JSON.parse(JSON.stringify(el));
    remapElement("canvas", el);
    expect(el).toEqual(once);
  });
});

describe("normalizePage carries a stored canvas across", () => {
  it("remaps, strips, and prunes the link of a stripped element", () => {
    const canvas: ComponentNode = {
      id: "c1", type: "canvas", label: "Canvas", pos: "a0", shape: "plain", layout: "fixed",
      props: { links: { "el:e1": { pageId: "p1" }, "el:e2": { pageId: "p2" } } },
      elements: [
        { id: "e1", type: "row-action", label: "Edit", pos: "a0" },
        { id: "e2", type: "column-header", label: "", pos: "a1" },
        { id: "e3", type: "badge", label: "New", pos: "a2", data: { shape: "pill" } },
      ],
    };
    const page: PageLike = {
      name: "P", route: "/p", pos: "a0",
      document: { root: { kind: "region", id: "r1", size: { fr: 1 } }, regions: { r1: [canvas] } },
    };
    const out = normalizePage(page).document.regions.r1[0];
    expect(out.elements!.map((e) => [e.id, e.type, e.data])).toEqual([
      ["e1", "button", { style: "secondary" }],
      ["e3", "badge", { variant: "pill" }],
    ]);
    expect(out.props?.links).toEqual({ "el:e1": { pageId: "p1" } });
  });
});
