// Seeds a diagram editor's graph from its saved `model` (nodes/edges JSON,
// no `xml` yet) -- the shape a bundle import writes (see
// backend/app/studio/importing.py::grid_layout). Builds real maxGraph cells
// the same way the palette does (createUserObject + a named style; compare
// createGraph.ts's makeVertex/makeEdge), so a seeded diagram is
// indistinguishable from one drawn by hand. The caller saves the resulting
// XML once, so every later open is the ordinary xml-import path.
import { BaseGraph, Cell, Geometry } from "@maxgraph/core";
import { DiagramModel, DiagramNode } from "../../project/diagrams/diagramsApi";
import { isEdgeType, isNodeType, NODE_BY_TYPE, UmlEdgeType, UmlNodeType } from "./umlTypes";
import { styleName } from "./umlStyles";
import { createUserObject } from "./userObject";

const FALLBACK_NODE_TYPE: UmlNodeType = "rect";
const FALLBACK_EDGE_TYPE: UmlEdgeType = "association";
const FALLBACK_SIZE = { w: 140, h: 80 };

function makeModelVertex(node: DiagramNode): Cell {
  const type = isNodeType(node.type) ? node.type : FALLBACK_NODE_TYPE;
  const entry = NODE_BY_TYPE[type];
  const w = node.w > 0 ? node.w : entry?.w ?? FALLBACK_SIZE.w;
  const h = node.h > 0 ? node.h : entry?.h ?? FALLBACK_SIZE.h;
  const cell = new Cell(
    createUserObject(type, { label: node.label, stereotype: node.stereotype, text: node.text }),
    new Geometry(node.x, node.y, w, h),
    { baseStyleNames: [styleName(type)] },
  );
  // Preserve the bundle's own id -- otherwise maxGraph mints a fresh
  // sequential one on insert, and the first save would silently discard
  // every id the bundle (or a reviewer diffing it) named.
  cell.setId(node.id);
  cell.setVertex(true);
  cell.setConnectable(!entry?.container || type === "lifeline");
  return cell;
}

function makeModelEdge(id: string, edgeType: string, label: string): Cell {
  const type = isEdgeType(edgeType) ? edgeType : FALLBACK_EDGE_TYPE;
  const geometry = new Geometry();
  geometry.relative = true;
  const cell = new Cell(createUserObject(type, { label }), geometry, { baseStyleNames: [styleName(type)] });
  cell.setId(id);
  cell.setEdge(true);
  return cell;
}

/**
 * Build `model`'s nodes and edges onto a fresh graph, parents before
 * children so a swimlane/boundary/lifeline exists before anything is added
 * inside it.
 *
 * Silently skips what the bundle validator would already have rejected (an
 * edge endpoint or `parentId` that does not resolve) rather than throwing --
 * this runs once, automatically, on first open, and a diagram that is
 * mostly right should still open rather than fail outright over one bad
 * reference from data that arrived some other way than the validated path.
 */
export function buildFromModel(graph: BaseGraph, model: DiagramModel): void {
  const cellsById = new Map<string, Cell>();
  const remaining = new Map(model.nodes.map((n) => [n.id, n]));
  const defaultParent = graph.getDefaultParent();

  graph.batchUpdate(() => {
    // Repeatedly place every node whose parent is already placed (or has
    // none), until nothing more can be placed -- handles any nesting depth
    // without assuming the array already lists parents before children.
    let progressed = true;
    while (remaining.size > 0 && progressed) {
      progressed = false;
      for (const [id, node] of [...remaining]) {
        if (node.parentId && !cellsById.has(node.parentId)) continue;
        const parentCell = node.parentId ? cellsById.get(node.parentId)! : defaultParent;
        const cell = makeModelVertex(node);
        graph.addCell(cell, parentCell);
        cellsById.set(id, cell);
        remaining.delete(id);
        progressed = true;
      }
    }
    // A node whose parentId never resolves is placed at the root rather than
    // dropped, so nothing a reviewer expected to see silently vanishes.
    for (const node of remaining.values()) {
      const cell = makeModelVertex(node);
      graph.addCell(cell, defaultParent);
      cellsById.set(node.id, cell);
    }

    for (const edge of model.edges) {
      const source = cellsById.get(edge.source);
      const target = cellsById.get(edge.target);
      if (!source || !target) continue;
      const cell = makeModelEdge(edge.id, edge.type, edge.label);
      graph.addCell(cell, defaultParent, null, source, target);
    }
  });
}
