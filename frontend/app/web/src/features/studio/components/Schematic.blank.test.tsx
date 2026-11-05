// An element with no text (FS-REQ-85) renders as itself with nothing in it:
// never removed, never an ellipsis — for editors and viewers alike.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMPONENTS } from "../catalog";
import { ComponentNode, ElementNode } from "../model/types";
import { Schematic, SchematicEdit } from "./Schematic";

const canvas = (...elements: ElementNode[]): ComponentNode => ({
  id: "c1", type: "canvas", label: "Canvas", pos: "a0",
  shape: COMPONENTS.canvas.defaultShape, layout: COMPONENTS.canvas.defaultLayout,
  elements,
});
const el = (id: string, type: string, pos: string): ElementNode => ({ id, type, label: "", pos, data: { x: "10", y: "10" } });

const noop = () => undefined;
const edit = new Proxy({}, { get: () => noop }) as unknown as SchematicEdit;

describe("an element with no text", () => {
  const cmp = canvas(el("b", "button", "a0"), el("g", "badge", "a1"), el("h", "heading", "a2"));
  const modes: [string, () => string][] = [
    ["viewer", () => renderToStaticMarkup(<Schematic cmp={cmp} defs={[]} />)],
    ["editor", () => renderToStaticMarkup(<Schematic cmp={cmp} defs={[]} edit={edit} />)],
  ];

  for (const [mode, html] of modes) {
    it(`still draws its box, with no ellipsis (${mode})`, () => {
      const out = html();
      expect(out).toMatch(/class="ui-edit blank ui-btn/);
      expect(out).toMatch(/class="ui-edit blank ui-badge/);
      expect(out).toContain("ui-h2");
      expect(out).not.toContain("…");
    });
  }
});
