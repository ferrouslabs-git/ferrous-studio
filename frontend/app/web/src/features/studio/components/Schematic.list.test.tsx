// List rendering: column widths (FS-REQ-59), freely positioned card fields
// (FS-REQ-69) and image columns (FS-REQ-70). Rendered without edit handlers,
// the way preview mode draws a list, so these also pin what viewers see.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { imageList } from "../catalog";
import { ComponentNode, ElementNode } from "../model/types";
import { freeCardSpot, parseImageSize, Schematic } from "./Schematic";

const col = (id: string, label: string, data: Record<string, unknown> = {}): ElementNode =>
  ({ id, type: "column", label, pos: id, data: { kind: "text", ...data } }) as unknown as ElementNode;

const list = (elements: ElementNode[], extra: Partial<ComponentNode> = {}): ComponentNode => ({
  id: "c1",
  type: "list",
  label: "Contacts",
  pos: "a0",
  shape: "table",
  layout: "vertical",
  elements,
  ...extra,
});

const render = (cmp: ComponentNode) => renderToStaticMarkup(<Schematic cmp={cmp} defs={[]} />);

const IMG_A = "data:image/png;base64,AAAA";
const IMG_B = "data:image/png;base64,BBBB";

describe("column widths (FS-REQ-59)", () => {
  it("sizes a column's header and cells to its stored width", () => {
    const html = render(list([{ id: "h", type: "column-header", label: "", pos: "a" } as ElementNode, col("b1", "Name", { w: "180" }), col("b2", "Email")]));
    // Header + three sample rows, each clipped to the width.
    expect(html.match(/class="ui-col-fit" style="width:180px"/g)).toHaveLength(4);
    expect(html).toContain("max-width:180px");
  });

  it("leaves unsized columns automatic and draws no grips for viewers", () => {
    const html = render(list([{ id: "h", type: "column-header", label: "", pos: "a" } as ElementNode, col("b1", "Name")]));
    expect(html).not.toContain("ui-col-fit");
    expect(html).not.toContain("ui-col-resize");
  });
});

describe("image columns (FS-REQ-70)", () => {
  it("shows one image per cell, cycling through the uploads by row", () => {
    const cmp = list([col("b1", "Photo", { kind: "image", images: JSON.stringify([IMG_A, IMG_B]) })], {
      props: { rows: [{}, {}, {}] },
    });
    const srcs = [...render(cmp).matchAll(/<img src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs).toEqual([IMG_A, IMG_B, IMG_A]);
  });

  it("sizes every cell image to the column's image size", () => {
    const cmp = list([col("b1", "Photo", { kind: "image", images: JSON.stringify([IMG_A]), imageSize: "64x48" })]);
    expect(render(cmp)).toContain('style="width:64px;height:48px"');
  });

  it("draws a placeholder until images are uploaded", () => {
    const html = render(list([col("b1", "Photo", { kind: "image" })]));
    expect(html).toContain("ui-cell-img empty");
    expect(html).not.toContain("<img");
  });

  it("reads images stored as a JSON array, a real array or a lone URL", () => {
    expect(imageList(JSON.stringify([IMG_A, IMG_B]))).toEqual([IMG_A, IMG_B]);
    expect(imageList([IMG_A])).toEqual([IMG_A]);
    expect(imageList(IMG_A)).toEqual([IMG_A]);
    expect(imageList("")).toEqual([]);
    expect(imageList("[not json")).toEqual([]);
    expect(imageList(undefined)).toEqual([]);
  });

  it("parses the stored image size, clamped, with a 40px default", () => {
    expect(parseImageSize("64x48")).toEqual({ w: 64, h: 48 });
    expect(parseImageSize(" 120 X 90 ")).toEqual({ w: 120, h: 90 });
    expect(parseImageSize("2x9999")).toEqual({ w: 16, h: 600 });
    expect(parseImageSize(undefined)).toEqual({ w: 40, h: 40 });
    expect(parseImageSize("big")).toEqual({ w: 40, h: 40 });
  });
});

describe("free card layout (FS-REQ-69)", () => {
  const cards = (elements: ElementNode[], props: Record<string, unknown> = { cardLayout: "free" }) =>
    list(elements, { shape: "cards", props: { ...props, rows: [{}, {}] } });

  it("places each field at its column's x/y in every card", () => {
    const html = render(cards([col("b1", "Name", { x: "30", y: "50" }), col("b2", "Email", { x: "100", y: "8" })]));
    expect(html.match(/class="ui-card-free-el" style="left:30px;top:50px"/g)).toHaveLength(2);
    expect(html.match(/class="ui-card-free-el" style="left:100px;top:8px"/g)).toHaveLength(2);
  });

  it("stacks fields that have not been placed yet", () => {
    const html = render(cards([col("b1", "Name"), col("b2", "Email")]));
    const second = freeCardSpot(1);
    expect(html).toContain(`style="left:${second.x}px;top:${second.y}px"`);
  });

  it("grows the card to hold its lowest field, and honours a taller stored height", () => {
    const low = render(cards([col("b1", "Name", { x: "10", y: "200" })]));
    expect(low).toMatch(/ui-card-item free" style="height:(\d+)px"/);
    expect(Number(/ui-card-item free" style="height:(\d+)px"/.exec(low)![1])).toBeGreaterThan(200);
    const tall = render(cards([col("b1", "Name")], { cardLayout: "free", cardH: "400" }));
    expect(tall).toContain('ui-card-item free" style="height:400px"');
  });

  it("keeps the stacked card when the layout is not free", () => {
    const html = render(cards([col("b1", "Name", { x: "30", y: "50" })], {}));
    expect(html).not.toContain("ui-card-free-el");
    expect(html).toContain("ui-card-item-head");
  });
});
