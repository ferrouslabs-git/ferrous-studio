// The layout tree: pure helpers over LayoutNode / PageDocument. Actions call
// these on immer drafts; nothing here knows about ops, history or React.
import { posAfterLast } from "./positions";
import { uid } from "./regions";
import { LayoutNode, PageDocument, RegionNode, Size, SplitNode } from "./types";

export type SplitSide = "left" | "right" | "top" | "bottom";

/** Default size of a region added by splitting: side columns get a fixed
 *  width, bands above/below hug their content. */
export const DEFAULT_COLUMN_PX = 280;

export const newRegion = (size: Size = { fr: 1 }): RegionNode => ({ kind: "region", id: uid("r"), size });

export function blankDocument(): PageDocument {
  const root = newRegion();
  return { root, regions: { [root.id]: [] } };
}

export function walkNodes(root: LayoutNode, fn: (node: LayoutNode, parent: SplitNode | null) => void): void {
  const visit = (node: LayoutNode, parent: SplitNode | null) => {
    fn(node, parent);
    if (node.kind === "split") for (const child of node.children) visit(child, node);
  };
  visit(root, null);
}

/** Region ids in tree order (reading order: depth-first). */
export function regionIds(root: LayoutNode): string[] {
  const out: string[] = [];
  walkNodes(root, (n) => {
    if (n.kind === "region") out.push(n.id);
  });
  return out;
}

export const firstRegionId = (root: LayoutNode): string => regionIds(root)[0];

export interface FoundNode {
  node: LayoutNode;
  parent: SplitNode | null;
  index: number;
}

export function findNode(root: LayoutNode, id: string): FoundNode | null {
  let found: FoundNode | null = null;
  walkNodes(root, (node, parent) => {
    if (node.id === id) found = { node, parent, index: parent ? parent.children.indexOf(node) : 0 };
  });
  return found;
}

/** Display name for a region: its label, else "Region n" by tree order. */
export function regionDisplayName(root: LayoutNode, id: string): string {
  const found = findNode(root, id);
  if (found?.node.kind === "region" && found.node.label) return found.node.label;
  const n = regionIds(root).indexOf(id);
  return n >= 0 ? `Region ${n + 1}` : id;
}

function replaceNode(doc: PageDocument, id: string, next: LayoutNode): void {
  const found = findNode(doc.root, id);
  if (!found) return;
  if (found.parent) found.parent.children[found.index] = next;
  else doc.root = next;
}

/** Split a region in two along `side`; the region keeps its content, the new
 *  blank sibling appears on the chosen side. When the region's parent already
 *  splits in the same direction the sibling slots in beside it instead of
 *  nesting another level. Returns the new region's id. */
export function splitRegion(doc: PageDocument, regionId: string, side: SplitSide): string | null {
  const found = findNode(doc.root, regionId);
  if (!found || found.node.kind !== "region") return null;
  const region = found.node;
  const dir: SplitNode["dir"] = side === "left" || side === "right" ? "row" : "col";
  const before = side === "left" || side === "top";
  const fresh = newRegion(dir === "row" ? DEFAULT_COLUMN_PX : "auto");
  doc.regions[fresh.id] = [];

  if (found.parent && found.parent.dir === dir) {
    found.parent.children.splice(before ? found.index : found.index + 1, 0, fresh);
    return fresh.id;
  }
  const split: SplitNode = {
    kind: "split",
    id: uid("s"),
    dir,
    size: region.size,
    children: before ? [fresh, region] : [region, fresh],
  };
  region.size = { fr: 1 };
  replaceNode(doc, regionId, split);
  return fresh.id;
}

/** Remove a region; its components merge into the nearest remaining region.
 *  A split left with a single child collapses into that child. The last
 *  region of the page cannot be removed. */
export function removeRegion(doc: PageDocument, regionId: string): boolean {
  const found = findNode(doc.root, regionId);
  if (!found || found.node.kind !== "region" || !found.parent) return false;
  const parent = found.parent;
  parent.children.splice(found.index, 1);

  const neighbour = parent.children[Math.min(found.index, parent.children.length - 1)];
  const destId = firstRegionId(neighbour);
  const moved = doc.regions[regionId] ?? [];
  const dest = (doc.regions[destId] ??= []);
  for (const cmp of moved) {
    cmp.pos = posAfterLast(dest);
    dest.push(cmp);
  }
  delete doc.regions[regionId];

  if (parent.children.length === 1) {
    const only = parent.children[0];
    only.size = parent.size;
    replaceNode(doc, parent.id, only);
  }
  return true;
}

export function setNodeSize(doc: PageDocument, nodeId: string, size: Size): boolean {
  const found = findNode(doc.root, nodeId);
  if (!found) return false;
  found.node.size = size;
  return true;
}

export function setRegionLabel(doc: PageDocument, regionId: string, label: string): boolean {
  const found = findNode(doc.root, regionId);
  if (!found || found.node.kind !== "region") return false;
  const trimmed = (label || "").trim();
  if (trimmed) found.node.label = trimmed;
  else delete found.node.label;
  return true;
}

/** Light shape check used by normalisation: is this a plausible layout node? */
export function isLayoutNode(value: unknown): value is LayoutNode {
  if (!value || typeof value !== "object") return false;
  const node = value as { id?: unknown; kind?: unknown; children?: unknown };
  if (typeof node.id !== "string" || !node.id) return false;
  if (node.kind === "region") return true;
  if (node.kind === "split") {
    return Array.isArray(node.children) && node.children.length >= 2 && node.children.every(isLayoutNode);
  }
  return false;
}
