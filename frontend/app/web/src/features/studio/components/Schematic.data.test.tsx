// A page document is data the renderer did not write. It arrives from an
// import, from a bundle an agent generated, or from a document older than the
// code reading it, and its `data` values are typed as strings only by
// convention — nothing on the way in enforces that. So every component must
// survive a data value of the wrong shape.
//
// This exists because it did not. A reverse-engineered bundle wrote
// `data.samples` as a JSON array instead of comma-separated text, splitList
// called .split on it, and with no error boundary above the canvas the whole
// studio went blank on any page holding a table.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { COMPONENTS } from "../catalog";
import { PageLike } from "../model/applyOps";
import { normalizePage } from "../model/positions";
import { defaultElementsFor } from "../model/regions";
import { ComponentNode, ElementNode } from "../model/types";
import { Schematic } from "./Schematic";

/** Every shape a `data` value has actually turned up as, or plausibly could.
 *  `unknown` because the declared type is exactly what is not trustworthy. */
const ODD_VALUES: readonly { name: string; value: unknown }[] = [
  { name: "array", value: ["one", "two, with a comma", "three"] },
  { name: "empty array", value: [] },
  { name: "number", value: 42 },
  { name: "null", value: null },
  { name: "object", value: { a: 1 } },
  { name: "nested array", value: [["one"], "two"] },
];

const component = (type: string, elements: ElementNode[]): ComponentNode => ({
  id: `c-${type}`,
  type,
  label: type,
  pos: "a0",
  shape: COMPONENTS[type].defaultShape,
  layout: COMPONENTS[type].defaultLayout,
  elements,
});

/** Through normalizePage first, the way the canvas receives it. */
const normalised = (cmp: ComponentNode): ComponentNode => {
  const page = normalizePage({
    id: "p", project_id: "x", name: "n", route: null, placement: null, presentation: null,
    entity_versions: {}, version: 0, updated_at: "",
    document: { root: { id: "r", kind: "region", size: { fr: 1 } }, regions: { r: [cmp] } },
  } as unknown as PageLike);
  return page.document.regions.r[0];
};

const render = (cmp: ComponentNode) => renderToStaticMarkup(<Schematic cmp={normalised(cmp)} defs={[]} />);

describe("Schematic survives untrustworthy document data", () => {
  const types = Object.keys(COMPONENTS);

  it.each(types)("%s renders with its default elements", (type) => {
    expect(() => render(component(type, defaultElementsFor(type)))).not.toThrow();
  });

  // The regression itself: the same components with every data value replaced
  // by a shape the document could legally have been imported with.
  it.each(types.flatMap((type) => ODD_VALUES.map((odd) => [type, odd.name, odd.value] as const)))(
    "%s renders when every data value is a %s",
    (type, _name, value) => {
      const elements = defaultElementsFor(type).map((el) => ({
        ...el,
        data: Object.fromEntries(Object.keys(el.data ?? {}).map((k) => [k, value])),
      })) as unknown as ElementNode[];
      expect(() => render(component(type, elements))).not.toThrow();
    },
  );

  it.each(types)("%s renders with no elements and no data at all", (type) => {
    expect(() => render(component(type, []))).not.toThrow();
  });

  // The exact column that blanked the studio, kept as the named case.
  it("renders a table column whose samples are a JSON array", () => {
    const cmp = component("list", [
      { id: "e-c1", type: "column", label: "Name", pos: "a0", data: { kind: "text", samples: ["acme", "northwind"] } },
      { id: "e-c2", type: "column", label: "Spaces", pos: "a1", data: { kind: "text", samples: ["demo-space, support", "research"] } },
      { id: "e-a1", type: "row-action", label: "Open", pos: "a2" },
    ] as unknown as ElementNode[]);
    const html = render(cmp);
    // Read as-is, not re-joined: a value containing a comma stays one value.
    expect(html).toContain("demo-space, support");
    expect(html).toContain("northwind");
  });
});
