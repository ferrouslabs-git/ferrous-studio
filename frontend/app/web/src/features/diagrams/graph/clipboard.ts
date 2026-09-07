// Cut / copy / paste for the diagram editor.
//
// maxGraph's own clipboard holds cloned cells in memory, which dies with the
// page and cannot reach a second diagram. This one serialises the copied cells
// through the same model codec the autosave uses and parks the XML in
// localStorage, so a copy crosses diagrams, tabs and reloads.
//
// Copied geometry is absolute. A shape taken out of a swimlane carries a
// position relative to that lane, and pasting it onto the canvas -- or into a
// different lane -- would otherwise land it somewhere unrelated.
import { AbstractGraph, Cell, GraphDataModel, ModelXmlSerializer, cellArrayUtils } from "@maxgraph/core";

export const CLIPBOARD_KEY = "ferrous.diagram.clipboard";

/**
 * What a copy of the given selection should take: the topmost cells (a
 * container brings its children along), plus every connector whose two ends
 * are both leaving with it. A connector to a shape being left behind is
 * dropped -- dangling edges are disallowed, so it would have nothing to land on.
 */
export function cellsToCopy(selection: Cell[]): Cell[] {
  const roots = cellArrayUtils.getTopmostCells(selection.filter((cell) => !!cell.getParent()));
  const carried = new Set<Cell>();
  const collect = (cell: Cell) => {
    carried.add(cell);
    for (const child of cell.getChildren()) collect(child);
  };
  for (const cell of roots) collect(cell);

  const out = [...roots];
  for (const cell of carried) {
    for (let i = 0; i < cell.getEdgeCount(); i += 1) {
      const edge = cell.getEdgeAt(i);
      if (carried.has(edge)) continue;
      const source = edge.getTerminal(true);
      const target = edge.getTerminal(false);
      if (!source || !target || !carried.has(source) || !carried.has(target)) continue;
      carried.add(edge);
      out.push(edge);
    }
  }
  return out;
}

/**
 * The clipboard document for the given cells. `cloneCells` translates each
 * clone by its parent's origin, so what lands here is already in absolute
 * canvas coordinates; the paste converts back into whatever it drops into.
 */
export function encodeCells(graph: AbstractGraph, cells: Cell[]): string {
  const clones = graph.cloneCells(cells, true);
  const model = new GraphDataModel();
  // A fresh model comes with a root holding one layer; that layer is the
  // clipboard's "canvas".
  const layer = model.getRoot()!.getChildAt(0);
  model.beginUpdate();
  try {
    for (const clone of clones) model.add(layer, clone);
  } finally {
    model.endUpdate();
  }
  return new ModelXmlSerializer(model).export({ pretty: false });
}

/** The cells held in a clipboard document, detached from any graph. */
export function decodeCells(xml: string): Cell[] {
  const model = new GraphDataModel();
  new ModelXmlSerializer(model).import(xml);
  return model.getRoot()?.getChildAt(0)?.getChildren() ?? [];
}

/** Top-left corner of the vertices in a clipboard document. */
export function boundsOrigin(cells: Cell[]): { x: number; y: number } {
  let x = Infinity;
  let y = Infinity;
  for (const cell of cells) {
    const geometry = cell.getGeometry();
    if (!cell.isVertex() || !geometry || geometry.relative) continue;
    x = Math.min(x, geometry.x);
    y = Math.min(y, geometry.y);
  }
  return Number.isFinite(x) ? { x, y } : { x: 0, y: 0 };
}

export function writeClipboard(xml: string): void {
  try {
    window.localStorage.setItem(CLIPBOARD_KEY, xml);
  } catch {
    // Private browsing or a full quota: the copy is simply lost.
  }
}

export function readClipboard(): string | null {
  try {
    return window.localStorage.getItem(CLIPBOARD_KEY) || null;
  } catch {
    return null;
  }
}

export const hasClipboard = (): boolean => !!readClipboard();
