// Clearing a brand element's text must not take its logo with it (FS-REQ-26):
// a blank token used to render nothing but an ellipsis, discarding the mark.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMPONENTS } from "../catalog";
import { ComponentNode, ElementNode } from "../model/types";
import { Schematic } from "./Schematic";

const navbar = (label: string, logo?: string): ComponentNode => ({
  id: "c-nav", type: "navbar", label: "Nav", pos: "a0",
  shape: COMPONENTS.navbar.defaultShape, layout: COMPONENTS.navbar.defaultLayout,
  elements: [{ id: "b1", type: "brand", label, data: logo ? { logo } : {} } as ElementNode],
});

const render = (cmp: ComponentNode) => renderToStaticMarkup(<Schematic cmp={cmp} defs={[]} />);

describe("a brand element with no text", () => {
  it("keeps its default logo mark when viewed", () => {
    expect(render(navbar(""))).toContain("ui-brand-default");
  });

  it("keeps a built-in mark", () => {
    expect(render(navbar("", "bolt"))).toContain("ui-brand-mark");
  });

  it("keeps an uploaded logo", () => {
    expect(render(navbar("", "data:image/png;base64,AAAA"))).toContain("ui-brand-img");
  });

  it("still shows the logo and the text when there is text", () => {
    const html = render(navbar("Acme"));
    expect(html).toContain("ui-brand-default");
    expect(html).toContain("Acme");
  });
});
