// @vitest-environment jsdom
//
// The one graph test in this suite that needs a real maxGraph instance
// (createUserObject's XML document needs `document`) -- scoped to jsdom for
// just this file via the docblock above, rather than making the whole
// suite pay for a DOM on every run the way every other graph test avoids.
import { BaseGraph } from "@maxgraph/core";
import { describe, expect, it } from "vitest";
import { DiagramModel } from "../../project/diagrams/diagramsApi";
import { buildFromModel } from "./applyModel";
import { deriveModel, plainCellsOf } from "./serialize";

function freshGraph(): BaseGraph {
  return new BaseGraph({ container: document.createElement("div") });
}

describe("buildFromModel", () => {
  it("round-trips a two-node model, geometry and all", () => {
    const model: DiagramModel = {
      nodes: [
        { id: "n-project", type: "entity", label: "Project", text: "id\nname", x: 40, y: 40, w: 180, h: 120 },
        { id: "n-requirement", type: "entity", label: "Requirement", x: 320, y: 40, w: 180, h: 100 },
      ],
      edges: [{ id: "e1", type: "association", label: "1..*", source: "n-project", target: "n-requirement" }],
    };

    const graph = freshGraph();
    buildFromModel(graph, model);
    const roundTripped = deriveModel(plainCellsOf(graph));

    expect(roundTripped.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "n-project", type: "entity", label: "Project", text: "id\nname", x: 40, y: 40, w: 180, h: 120 }),
        expect.objectContaining({ id: "n-requirement", type: "entity", label: "Requirement", x: 320, y: 40, w: 180, h: 100 }),
      ]),
    );
    expect(roundTripped.edges).toEqual([
      expect.objectContaining({ id: "e1", type: "association", label: "1..*", source: "n-project", target: "n-requirement" }),
    ]);
  });

  it("places a child under its parent even when the parent appears later in the array", () => {
    const model: DiagramModel = {
      nodes: [
        // Child listed first -- the placement loop must not assume parents
        // come first in the array, since a bundle's own node order isn't
        // guaranteed to be one.
        { id: "child", type: "action", label: "Approve", parentId: "lane", x: 20, y: 20, w: 140, h: 50 },
        { id: "lane", type: "swimlane", label: "Ops", x: 0, y: 0, w: 500, h: 160 },
      ],
      edges: [],
    };

    const graph = freshGraph();
    buildFromModel(graph, model);
    const roundTripped = deriveModel(plainCellsOf(graph));

    const child = roundTripped.nodes.find((n) => n.id === "child");
    expect(child?.parentId).toBe("lane");
  });

  it("places a node with an unresolvable parentId at the root rather than dropping it", () => {
    const model: DiagramModel = {
      nodes: [{ id: "orphan", type: "action", label: "Stray", parentId: "ghost", x: 0, y: 0, w: 140, h: 50 }],
      edges: [],
    };

    const graph = freshGraph();
    buildFromModel(graph, model);
    const roundTripped = deriveModel(plainCellsOf(graph));

    expect(roundTripped.nodes).toHaveLength(1);
    expect(roundTripped.nodes[0].parentId).toBeUndefined();
  });

  it("skips an edge whose endpoint does not resolve, rather than throwing", () => {
    const model: DiagramModel = {
      nodes: [{ id: "n1", type: "entity", label: "A", x: 0, y: 0, w: 100, h: 60 }],
      edges: [{ id: "e1", type: "association", label: "", source: "n1", target: "does-not-exist" }],
    };

    const graph = freshGraph();
    expect(() => buildFromModel(graph, model)).not.toThrow();
    expect(deriveModel(plainCellsOf(graph)).edges).toHaveLength(0);
  });

  it("falls back to a plain rect/association for an unknown type rather than throwing", () => {
    const model = {
      nodes: [{ id: "n1", type: "not-a-real-type", label: "A", x: 0, y: 0, w: 100, h: 60 }],
      edges: [{ id: "e1", type: "not-a-real-edge-type", label: "", source: "n1", target: "n1" }],
    } as unknown as DiagramModel;

    const graph = freshGraph();
    expect(() => buildFromModel(graph, model)).not.toThrow();
    const roundTripped = deriveModel(plainCellsOf(graph));
    expect(roundTripped.nodes[0].type).toBe("rect");
  });
});
