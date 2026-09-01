// XML in and out of the graph, plus the derived nodes/edges model the LLM
// export reads. `deriveModel` is pure over plain records so it is testable
// without a DOM or a graph.
import { AbstractGraph, ModelXmlSerializer } from "@maxgraph/core";
import { DiagramModel } from "../../project/diagrams/diagramsApi";
import { EDGE_BY_TYPE, isEdgeType, UML_ATTR } from "./umlTypes";
import { readUml } from "./userObject";

export interface PlainCell {
  id: string;
  vertex: boolean;
  edge: boolean;
  parentId: string | null;
  sourceId: string | null;
  targetId: string | null;
  attrs: Record<string, string>;
  geometry: { x: number; y: number; w: number; h: number } | null;
}

export function deriveModel(cells: PlainCell[]): DiagramModel {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const isUml = (c: PlainCell | undefined) => !!c && !!c.attrs[UML_ATTR];
  const sorted = [...cells].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const nodes: DiagramModel["nodes"] = [];
  const edges: DiagramModel["edges"] = [];
  for (const c of sorted) {
    if (!isUml(c)) continue;
    const type = c.attrs[UML_ATTR];
    if (c.vertex) {
      const parent = c.parentId ? byId.get(c.parentId) : undefined;
      const node: DiagramModel["nodes"][number] = {
        id: c.id,
        type,
        label: c.attrs.label ?? "",
        x: c.geometry?.x ?? 0,
        y: c.geometry?.y ?? 0,
        w: c.geometry?.w ?? 0,
        h: c.geometry?.h ?? 0,
      };
      if (c.attrs.stereotype) node.stereotype = c.attrs.stereotype;
      const text = [c.attrs.text, c.attrs.attributes, c.attrs.operations].filter(Boolean).join("\n---\n");
      if (text) node.text = text;
      if (isUml(parent)) node.parentId = parent!.id;
      nodes.push(node);
    } else if (c.edge) {
      if (!c.sourceId || !c.targetId || !isUml(byId.get(c.sourceId)) || !isUml(byId.get(c.targetId))) continue;
      const fallback = isEdgeType(type) && EDGE_BY_TYPE[type].stereotype ? `«${EDGE_BY_TYPE[type].stereotype}»` : "";
      edges.push({ id: c.id, type, label: c.attrs.label || fallback, source: c.sourceId, target: c.targetId });
    }
  }
  return { nodes, edges };
}

export function plainCellsOf(graph: AbstractGraph): PlainCell[] {
  const model = graph.getDataModel();
  const out: PlainCell[] = [];
  for (const cell of Object.values(model.cells ?? {})) {
    const geometry = cell.getGeometry();
    const attrs = readUml(cell);
    out.push({
      id: cell.getId() ?? "",
      vertex: cell.isVertex(),
      edge: cell.isEdge(),
      parentId: cell.getParent()?.getId() ?? null,
      sourceId: cell.getTerminal(true)?.getId() ?? null,
      targetId: cell.getTerminal(false)?.getId() ?? null,
      attrs: attrs.umlType ? { ...attrs } : {},
      geometry: geometry ? { x: geometry.x, y: geometry.y, w: geometry.width, h: geometry.height } : null,
    });
  }
  return out;
}

export function exportXml(graph: AbstractGraph): string {
  return new ModelXmlSerializer(graph.getDataModel()).export();
}

export function importXml(graph: AbstractGraph, xml: string): void {
  new ModelXmlSerializer(graph.getDataModel()).import(xml);
}
