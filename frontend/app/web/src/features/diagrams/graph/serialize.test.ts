import { describe, expect, it } from "vitest";
import { deriveModel, PlainCell } from "./serialize";

const cell = (p: Partial<PlainCell> & { id: string }): PlainCell => ({
  vertex: false,
  edge: false,
  parentId: null,
  sourceId: null,
  targetId: null,
  attrs: {},
  geometry: null,
  ...p,
});

const cells: PlainCell[] = [
  cell({ id: "0" }),
  cell({ id: "1", parentId: "0" }),
  cell({ id: "lane", vertex: true, parentId: "1", attrs: { umlType: "swimlane", label: "Ops" }, geometry: { x: 10, y: 10, w: 500, h: 200 } }),
  cell({ id: "a", vertex: true, parentId: "lane", attrs: { umlType: "action", label: "Approve" }, geometry: { x: 20, y: 40, w: 140, h: 50 } }),
  cell({ id: "c", vertex: true, parentId: "1", attrs: { umlType: "class", label: "Order", stereotype: "entity", attributes: "id\ntotal", operations: "cancel()" }, geometry: { x: 0, y: 0, w: 1, h: 1 } }),
  cell({ id: "n", vertex: true, parentId: "1", attrs: { umlType: "note", label: "N", text: "remember" }, geometry: { x: 0, y: 0, w: 1, h: 1 } }),
  cell({ id: "e1", edge: true, parentId: "1", sourceId: "a", targetId: "c", attrs: { umlType: "include" } }),
  cell({ id: "e2", edge: true, parentId: "1", sourceId: "a", targetId: null, attrs: { umlType: "flow" } }),
  cell({ id: "e3", edge: true, parentId: "1", sourceId: "a", targetId: "c", attrs: { umlType: "flow", label: "yes" } }),
];

describe("deriveModel", () => {
  const model = deriveModel(cells);

  it("ignores layer cells and keeps only uml-typed ones", () => {
    expect(model.nodes.map((n) => n.id).sort()).toEqual(["a", "c", "lane", "n"]);
  });

  it("records parentId only for uml containers, with relative geometry", () => {
    const a = model.nodes.find((n) => n.id === "a")!;
    expect(a.parentId).toBe("lane");
    expect(a).toMatchObject({ x: 20, y: 40, w: 140, h: 50 });
    expect(model.nodes.find((n) => n.id === "lane")!.parentId).toBeUndefined();
  });

  it("carries stereotype and compartment text", () => {
    const c = model.nodes.find((n) => n.id === "c")!;
    expect(c.stereotype).toBe("entity");
    expect(c.text).toBe("id\ntotal\n---\ncancel()");
    expect(model.nodes.find((n) => n.id === "n")!.text).toBe("remember");
  });

  it("drops dangling edges and falls back to the stereotype label", () => {
    expect(model.edges.map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(model.edges[0].label).toBe("«include»");
    expect(model.edges[1].label).toBe("yes");
  });
});
