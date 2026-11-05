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
