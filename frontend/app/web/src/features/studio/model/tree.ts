// The layout tree: pure helpers over LayoutNode / PageDocument. Actions call
// these on immer drafts; nothing here knows about ops, history or React.
import { uid } from "./regions";
import { ComponentNode, LayoutNode, PageDocument, RegionNode, Size, SplitNode } from "./types";

export type SplitSide = "left" | "right" | "top" | "bottom";

/** Default size of a region added by splitting: side columns get a fixed
 *  width, bands above/below hug their content. */
export const DEFAULT_COLUMN_PX = 280;

export const newRegion = (size: Size = { fr: 1 }): RegionNode => ({ kind: "region", id: uid("r"), size });

/** The label a page's first region takes when nothing names it: the shell
 *  page opens with the navigation band, every other page is content. */
export const SHELL_REGION_LABEL = "Nav";
export const DEFAULT_REGION_LABEL = "Content";

/** Mirrors backend default_page_document (common.py) — keep them in step. */
export function blankDocument(label: string = DEFAULT_REGION_LABEL): PageDocument {
  const root = newRegion();
  root.label = label;
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

/** The nodes from the root down to `id`, both inclusive; null if absent. */
export function nodePath(root: LayoutNode, id: string): LayoutNode[] | null {
  const walk = (node: LayoutNode, trail: LayoutNode[]): LayoutNode[] | null => {
    const path = [...trail, node];
    if (node.id === id) return path;
    if (node.kind === "split") {
      for (const child of node.children) {
        const found = walk(child, path);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(root, []);
}

export function findNode(root: LayoutNode, id: string): FoundNode | null {
  let found: FoundNode | null = null;
  walkNodes(root, (node, parent) => {
    if (node.id === id) found = { node, parent, index: parent ? parent.children.indexOf(node) : 0 };
  });
  return found;
}

/** The region a navigation element in `fromRegionId` opens its pages in:
 *  the first fill-sized region after it in reading order (the content area a
 *  header or sidebar wraps), else the next region, else the same preference
 *  over the regions before it. Null when it is the page's only region. */
export function contentRegionFor(root: LayoutNode, fromRegionId: string): string | null {
  const ids = regionIds(root);
  const at = ids.indexOf(fromRegionId);
  const pick = (pool: string[]): string | null => {
    const fill = pool.find((id) => {
      const found = findNode(root, id);
      return !!found && typeof found.node.size === "object";
    });
    return fill ?? pool[0] ?? null;
  };
  return pick(ids.slice(at + 1)) ?? pick(at > 0 ? ids.slice(0, at) : []);
}

/** Where a child page renders when the region it was placed in has since
 *  been removed from the parent's tree: the parent's main content area — the
 *  first fill-sized region in reading order, else the first region. Keeps the
 *  parent's shell (nav, header, panels) around the child instead of dropping
 *  the page to a bare full-frame render. */
export function fallbackRegionId(root: LayoutNode): string {
  const ids = regionIds(root);
  const fill = ids.find((id) => {
    const found = findNode(root, id);
    return !!found && typeof found.node.size === "object";
  });
  return fill ?? ids[0];
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

/** What a split names the region it creates, by the side it appears on. */
const SIDE_LABELS: Record<SplitSide, string> = { top: "Header", bottom: "Footer", left: "Sidebar", right: "Panel" };

/** `base`, or "`base` 2", "`base` 3"… — first label no region holds yet. */
function nextRegionLabel(root: LayoutNode, base: string): string {
  const taken = new Set<string>();
  walkNodes(root, (n) => {
    if (n.kind === "region" && n.label) taken.add(n.label.toLowerCase());
  });
  let label = base;
  for (let n = 2; taken.has(label.toLowerCase()); n++) label = `${base} ${n}`;
  return label;
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
  // A page's regions are named in creation order: the root (Nav on the shell
  // page, otherwise named from whatever linked to the page), then Content,
  // then side-based names — which give Footer for the usual third band, so a
  // shell reads Nav / Content / Footer. Splitting the lone region *backwards*
  // puts the new one above or beside the root rather than after it, so the
  // side name is the accurate one there.
  const base =
    regionIds(doc.root).length === 1 && !before ? DEFAULT_REGION_LABEL : SIDE_LABELS[side];
  fresh.label = nextRegionLabel(doc.root, base);
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

/** Delete a region and everything in it. A split left with a single child
 *  collapses into that child. The last region of the page cannot be removed. */
export function removeRegion(doc: PageDocument, regionId: string): boolean {
  const found = findNode(doc.root, regionId);
  if (!found || found.node.kind !== "region" || !found.parent) return false;
  const parent = found.parent;
  parent.children.splice(found.index, 1);
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

/** Set how a region lays out its components. "col" is the default, so it is
 *  stored as an absent key to keep documents clean. */
export function setRegionDir(doc: PageDocument, regionId: string, dir: "row" | "col" | "free"): boolean {
  const found = findNode(doc.root, regionId);
  if (!found || found.node.kind !== "region") return false;
  if (dir === "col") delete found.node.dir;
  else found.node.dir = dir;
  return true;
}

/** A component's user-set fixed size (resize handles / Inspector), if any.
 *  Stored as props.w / props.h; numbers or numeric strings both read. */
export function cmpSize(cmp: ComponentNode): { w: number | null; h: number | null } {
  const read = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  return { w: read(cmp.props?.w), h: read(cmp.props?.h) };
}

/** A component's stored offset (props.x/y), if any. */
export function cmpPos(cmp: ComponentNode): { x: number | null; y: number | null } {
  const read = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  };
  return { x: read(cmp.props?.x), y: read(cmp.props?.y) };
}

/** Where a component sits in a free-layout region: its stored props.x/y,
 *  else a small cascade by list index so unplaced components never pile up
 *  on the region's corner. */
export function cmpFreePos(cmp: ComponentNode, index: number): { x: number; y: number } {
  const p = cmpPos(cmp);
  const fallback = 16 + (index % 8) * 24;
  return { x: p.x ?? fallback, y: p.y ?? fallback };
}

/** Where a floating canvas sits: its stored offset, else the region's
 *  corner — a float with no geometry still covers the whole region. */
export function cmpFloatPos(cmp: ComponentNode): { x: number; y: number } {
  const p = cmpPos(cmp);
  return { x: p.x ?? 0, y: p.y ?? 0 };
}

/** The width the page needs for every fixed-px column to show at full size.
 *  Fixed-width nodes never shrink and clip (or scroll) their own content, so
 *  they contribute exactly their set width; flexible nodes squeeze, so they
 *  contribute only what their children demand. `outlet` folds a child page's
 *  demand into the ancestor region it renders in. When `regions` is given, a
 *  fixed-width component in a flexible column region demands its own width
 *  the way a fixed column does — the region widens (and the device grows a
 *  sideways scroll) rather than clipping it; row regions already scroll
 *  their overflow, so their components add nothing. 0 when nothing is fixed. */
export function fixedWidthDemand(
  root: LayoutNode,
  outlet?: { regionId: string; demand: number },
  regions?: Record<string, ComponentNode[]>,
): number {
  const measure = (node: LayoutNode, parentDir: "row" | "col" | null): number => {
    const fixed = parentDir === "row" && typeof node.size === "number" ? node.size : null;
    if (fixed != null) return fixed;
    if (node.kind === "region") {
      if (outlet && node.id === outlet.regionId) return outlet.demand;
      if (!regions || node.dir === "row") return 0;
      const cmps = regions[node.id] ?? [];
      // Free regions place components at offsets, so their demand is the
      // furthest right edge; stacked columns just need their widest member.
      if (node.dir === "free") {
        return Math.max(0, ...cmps.map((c, i) => (cmpSize(c).w != null ? cmpFreePos(c, i).x + cmpSize(c).w! : 0)));
      }
      return Math.max(0, ...cmps.map((c) => cmpSize(c).w ?? 0));
    }
    const widths = node.children.map((child) => measure(child, node.dir));
    return node.dir === "row" ? widths.reduce((a, b) => a + b, 0) : Math.max(0, ...widths);
  };
  return measure(root, null);
}

export function setRegionBg(doc: PageDocument, regionId: string, bg: string): boolean {
  const found = findNode(doc.root, regionId);
  if (!found || found.node.kind !== "region") return false;
  const trimmed = (bg || "").trim();
  if (trimmed) found.node.bg = trimmed;
  else delete found.node.bg;
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
