// Every canvas shape (FS-REQ-84) renders, in the editor and for viewers —
// a render throw above the canvas's error boundary would blank the studio.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMPONENTS, elementDefaultData } from "../catalog";
import { ComponentNode, ElementNode } from "../model/types";
import { Schematic, SchematicEdit } from "./Schematic";

const noop = () => undefined;
const edit = new Proxy({}, { get: () => noop }) as unknown as SchematicEdit;

const canvasOf = (elements: ElementNode[]): ComponentNode => ({
  id: "c1", type: "canvas", label: "Canvas", pos: "a0", shape: "plain", layout: "fixed", elements,
});

describe("canvas shapes", () => {
  const all = COMPONENTS.canvas.elements.map((m, i): ElementNode => ({
    id: `e${i}`, type: m.type, label: m.defaultLabel, pos: `a${i}`,
    data: { ...elementDefaultData("canvas", m.type), x: String(i * 10), y: "10" },
  }));

  it("draws every shape without throwing", () => {
    for (const props of [{}, { edit }]) {
      const html = renderToStaticMarkup(<Schematic cmp={canvasOf(all)} defs={[]} {...props} />);
      expect(html.match(/class="ui-canvas-el[ "]/g)).toHaveLength(all.length);
    }
  });

  it("draws the new shapes as what they are", () => {
    const html = renderToStaticMarkup(<Schematic cmp={canvasOf(all)} defs={[]} />);
    expect(html).toContain("ui-slider-thumb");
    expect(html).toContain("ui-time");
    expect(html).toMatch(/ui-icon-el[^"]*"[^>]*><svg/);
    for (const shape of ["line", "square", "circle", "triangle"]) expect(html).toContain(`ui-shape ${shape}`);
  });

  it("draws a corner variant as its class", () => {
    const badge: ElementNode = { id: "b", type: "badge", label: "New", pos: "a0", data: { variant: "pill" } };
    expect(renderToStaticMarkup(<Schematic cmp={canvasOf([badge])} defs={[]} />)).toContain("el-variant-pill");
  });
});

describe("rotating canvas elements (FS-REQ-90)", () => {
  const at = (type: string, rotate?: string): ElementNode => ({
    id: "r", type, label: "Go", pos: "a0", data: { x: "10", y: "40", ...(rotate ? { rotate } : {}) },
  });
  const render = (el: ElementNode, props = {}) => renderToStaticMarkup(<Schematic cmp={canvasOf([el])} defs={[]} {...props} />);

  it("turns any element whole, by the stored angle", () => {
    expect(render(at("button", "30"))).toContain("transform:rotate(30deg)");
    expect(render(at("button"))).not.toContain("rotate(");
  });

  it("keeps turning a basic shape's geometry only, so its text stays upright", () => {
    const html = render(at("square", "90"));
    expect(html).toContain("--rot:90deg");
    expect(html).not.toContain("transform:rotate(90deg)");
  });

  it("offers the rotate handle only while editing", () => {
    expect(render(at("button"), { edit })).toContain("ui-canvas-el-rotate");
    expect(render(at("button"))).not.toContain("ui-canvas-el-rotate");
  });
});
