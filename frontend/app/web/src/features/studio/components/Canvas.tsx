// The canvas: one page rendered as its layout tree. Splits become flex rows
// and columns separated by draggable dividers; regions are the drop targets
// components stack into. A page placed inside a parent region (a "child
// page") renders inside the parent's shell, which shows read-only around it.
//
// Selection is three-level: a region (click its background), a component
// (click it), or a single element inside one (click a nav item / button —
// see selection.ts). Double-clicking a linked element follows its link.
import { CSSProperties, DragEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode, useState } from "react";
import type { Dataset } from "../../project/datasets/datasetsApi";
import { elementHosts } from "../catalog";
import { CustomDef, elementLink, locateCmp } from "../model/actions";
import { STRUCTURAL_TYPES } from "../model/regions";
import { cmpFloatPos, cmpFreePos, cmpPos, cmpSize, fixedWidthDemand, nodePath, SplitSide } from "../model/tree";
import { ComponentNode, LayoutNode, LinkTarget, PageDocument, PagePresentation, Size, SplitNode } from "../model/types";
import { stageScale } from "../stage";
import { draggedElementType, dropBefore, DropHint, hasPayload, readPayload, setPayload } from "./dnd";
import { EDIT_TOKEN_SELECTOR, Schematic, SchematicChrome, SchematicEdit, styleData } from "./Schematic";
import { ElementSel, Selection } from "./selection";

/** One ancestor shell around the page being edited: its document plus the
 *  region the next level renders into. Outermost first. */
export interface HostLevel {
  pageId: string;
  doc: PageDocument;
  regionId: string;
}

export interface CanvasCallbacks {
  onSelect(sel: Selection | null): void;
  editFor(id: string): SchematicEdit;
  onEditEnd(): void;
  onFollow(target: LinkTarget): void;
  onMove(id: string, delta: -1 | 1): void;
  onCopy(id: string): void;
  onRemove(id: string): void;
  onEditStructure(id: string): void;
  onDropPattern(id: string, regionId: string, index: number | null): void;
  onDropComponent(type: string, customId: string | undefined, regionId: string, index: number | null, shape?: string, at?: { x: number; y: number } | null): void;
  onDropElement(type: string, cmpId: string): void;
  onReorder(srcId: string, targetId: string, before: boolean): void;
  onMoveToRegion(srcId: string, regionId: string, at?: { x: number; y: number } | null): void;
  onSplit(regionId: string, side: SplitSide): void;
  onRemoveRegion(regionId: string): void;
  onResize(changes: { id: string; size: Size }[]): void;
  /** A completed component resize: the new fixed size for the dragged axes,
   *  plus any layout-node bumps for a fixed region it outgrew. */
  onResizeCmp(id: string, size: { w?: number; h?: number }, grow: { id: string; size: Size }[]): void;
  /** A completed drag in a free-layout region (or of a floating canvas):
   *  the new position, plus any layout-node bumps for a fixed region edge it
   *  was pushed past. `stamp` freezes the measured size onto axes that had
   *  none — a full-region float must not stay pinned to the far edges. */
  onMoveCmp(id: string, pos: { x: number; y: number }, grow: { id: string; size: Size }[], stamp?: { w: number; h: number }): void;
}

/** Which node ids on the visible documents carry annotations, by target
 *  level. Ids are page-unique uids, so flat sets across the page and its
 *  shells suffice. */
export interface MarkSets {
  regions: ReadonlySet<string>;
  cmps: ReadonlySet<string>;
  els: ReadonlySet<string>;
}

export interface AnnotationMarks {
  notes: MarkSets;
  /** Open tasks only — resolving a task removes its marker. */
  tasks: MarkSets;
}

/** The annotation target being hovered — in the panel (a row) or on the
 *  canvas (a badge, or a marked element as a whole). Both sides highlight
 *  whatever matches it. "both" arises from hovering an element that carries
 *  notes AND open tasks — its rows of either kind light up. */
export interface HotMark {
  kind: "note" | "task" | "both";
  targetId: string;
}

interface Props extends CanvasCallbacks {
  doc: PageDocument | null;
  host: HostLevel[];
  /** Set when this page opens as an overlay: its placement parent renders in
   *  full as the dimmed backdrop and the page is edited inside modal/drawer
   *  chrome floating over it. */
  presentation: PagePresentation | null;
  /** The overlay chrome's × control: leave this page for the one it floats
   *  over (back where possible, else the backdrop parent). */
  onDismissOverlay(): void;
  selection: Selection | null;
  editingElement: ElementSel | null;
  defs: readonly CustomDef[];
  /** Bindable datasets, handed through to every Schematic. */
  datasets: readonly Dataset[];
  canWrite: boolean;
  /** The open page and its ancestor shells, for nav active states. */
  activePageIds: readonly string[];
  /** Annotated nodes to badge; absent (the preview) draws no markers. */
  marks?: AnnotationMarks;
  /** A marker was clicked: select its node and open the matching tab. */
  onMarkClick?(sel: Selection, kind: "note" | "task"): void;
  /** Two-way hover link with the annotations panel: the hovered target to
   *  emphasise here, and hover changes on the badges to report back. */
  hotMark?: HotMark | null;
  onMarkHover?(mark: HotMark | null): void;
  /** Region hovered in the link menu's Region list: outlined so the user can
   *  see which region the new page would replace. */
  linkHotRegion?: string | null;
}

/** Components that fill a region edge-to-edge; everything else gets padding.
 *  A vertical nav bar always fills; so do nav bars and footers generally.
 *  Shared with the preview canvas, which paints the same tree read-only. */
export const fillsRegion = (cmp: ComponentNode): boolean =>
  STRUCTURAL_TYPES.has(cmp.type) ||
  (cmp.type === "navbar" && cmp.layout === "vertical") ||
  cmp.type === "canvas"; // a canvas is always edge-to-edge (float included)

/** A floating component overlays its region instead of flowing in it, so
 *  components can stack on top of each other. A canvas floats through its
 *  "float" layout; every other type floats through props.float (Inspector →
 *  Placement), set by setComponentFloat. */
export const isFloating = (cmp: ComponentNode): boolean =>
  cmp.type === "canvas" ? cmp.layout === "float" : cmp.props?.float === true;

/** The width the device must reserve so every fixed-px column — across the
 *  page and its ancestor shells — shows at full size; the canvas scrolls
 *  sideways to reach it. An overlay page scrolls inside its own floating
 *  panel, so only its backdrop chain counts (and the innermost shell keeps
 *  its own region content, not an outlet). Shared with the preview page. */
export function deviceMinWidth(doc: PageDocument, host: HostLevel[], presentation: PagePresentation | null): number {
  let demand = presentation ? 0 : fixedWidthDemand(doc.root, undefined, doc.regions);
  for (let i = host.length - 1; i >= 0; i--) {
    const outlet = presentation && i === host.length - 1 ? undefined : { regionId: host[i].regionId, demand };
    demand = fixedWidthDemand(host[i].doc.root, outlet, host[i].doc.regions);
  }
  return demand;
}

/** Inline style for a user-set component size (props.w / props.h). In a row
 *  region a fixed width must also drop the flex share components normally
 *  take there; in a column an explicit width simply beats the default
 *  stretch. A fixed height pins the flex basis so `.fill` cannot re-grow it.
 *  Shared with the preview canvas. */
export function cmpSizeStyle(cmp: ComponentNode, row: boolean, live?: { w?: number; h?: number }): CSSProperties | undefined {
  const set = cmpSize(cmp);
  const w = live?.w ?? set.w;
  const h = live?.h ?? set.h;
  if (w == null && h == null) return undefined;
  const s: CSSProperties = {};
  if (w != null) {
    s.width = w;
    if (row) {
      s.flex = "0 0 auto";
      s.minWidth = 0;
    }
  }
  if (h != null) {
    s.height = h;
    if (!row) s.flex = "0 0 auto";
  }
  return s;
}

/** Inline style for a component in a free-layout region: absolute at its
 *  stored (or cascading) offset, sized when a size is set. Shared with the
 *  preview canvas. */
export function freeCmpStyle(
  cmp: ComponentNode,
  index: number,
  livePos?: { x: number; y: number },
  liveSz?: { w?: number; h?: number },
): CSSProperties {
  const pos = cmpFreePos(cmp, index);
  const set = cmpSize(cmp);
  const s: CSSProperties = { position: "absolute", left: livePos?.x ?? pos.x, top: livePos?.y ?? pos.y };
  const w = liveSz?.w ?? set.w;
  const h = liveSz?.h ?? set.h;
  if (w != null) s.width = w;
  if (h != null) s.height = h;
  return s;
}

/** The height a free region's body reserves so its lowest component stays
 *  inside — absolutely positioned children add no intrinsic height. A
 *  component without a set height counts only its offset; a fixed region
 *  scrolls to the rest. Shared with the preview canvas. */
export function freeBodyMinHeight(
  list: readonly ComponentNode[],
  livePos?: Record<string, { x: number; y: number }>,
  liveSz?: Record<string, { w?: number; h?: number }>,
): number {
  return Math.max(
    40,
    ...list.map((c, i) => {
      const y = livePos?.[c.id]?.y ?? (isFloating(c) ? cmpFloatPos(c).y : cmpFreePos(c, i).y);
      return y + (liveSz?.[c.id]?.h ?? cmpSize(c).h ?? 0);
    }),
  );
}

/** Inline geometry for a floating canvas. Nothing set keeps the CSS default
 *  (inset 0 — the float covers its whole region); a set offset or size pins
 *  that edge and releases the opposite one, so the float can sit over just
 *  part of the region. Shared with the preview canvas. */
export function floatCmpStyle(
  cmp: ComponentNode,
  livePos?: { x: number; y: number },
  liveSz?: { w?: number; h?: number },
): CSSProperties | undefined {
  const pos = cmpPos(cmp);
  const set = cmpSize(cmp);
  const x = livePos?.x ?? pos.x;
  const y = livePos?.y ?? pos.y;
  const w = liveSz?.w ?? set.w;
  const h = liveSz?.h ?? set.h;
  if (x == null && y == null && w == null && h == null) return undefined;
  const s: CSSProperties = {};
  if (x != null) s.left = x;
  if (y != null) s.top = y;
  if (w != null) {
    s.width = w;
    s.right = "auto";
  }
  if (h != null) {
    s.height = h;
    s.bottom = "auto";
  }
  return s;
}

/** Components set to grow into their region's leftover height (Inspector →
 *  Size → "Fill region"). A canvas keeps its layout-based fill instead: its
 *  "fill" and "float" layouts predate the generic setting. */
export const fillsHeight = (cmp: ComponentNode): boolean =>
  cmp.type === "canvas" ? cmp.layout === "fill" || cmp.layout === "float" : cmp.props?.size === "fill";

const ICON = {
  pencil: "M11.5 2.5l2 2L5 13H3v-2l8.5-8.5Z",
  up: "M8 13V3M3.5 7.5 8 3l4.5 4.5",
  down: "M8 3v10M3.5 8.5 8 13l4.5-4.5",
  left: "M13 8H3M7.5 3.5 3 8l4.5 4.5",
  right: "M3 8h10M8.5 3.5 13 8l-4.5 4.5",
  close: "M4 4l8 8M12 4l-8 8",
  copy: "M5.5 5.5h8v8h-8Z M10.5 5.5v-3h-8v8h3",
  splitLeft: "M13 3v10M3 8h6M6 5 3 8l3 3",
  splitRight: "M3 3v10M7 8h6M10 5l3 3-3 3",
  splitTop: "M3 13h10M8 7V1.5M5 4.5 8 1.5l3 3",
  splitBottom: "M3 3h10M8 9v5M5 11.5 8 14.5l3-3",
};
const Glyph = ({ d }: { d: string }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

export function Canvas(props: Props) {
  const { doc, host, presentation, canWrite, selection, editingElement } = props;
  const [hint, setHint] = useState<DropHint | null>(null);
  const [overRegion, setOverRegion] = useState<string | null>(null);
  /** Component highlighted as the target of an element drag. */
  const [overElCmp, setOverElCmp] = useState<string | null>(null);
  /** Live pixel override per node while a divider drag is in flight. */
  const [live, setLive] = useState<Record<string, number>>({});
  /** Live w/h override while a component edge/corner drag is in flight. */
  const [liveCmp, setLiveCmp] = useState<Record<string, { w?: number; h?: number }>>({});
  /** Live x/y override while a free-region component drag is in flight. */
  const [liveCmpPos, setLiveCmpPos] = useState<Record<string, { x: number; y: number }>>({});
  const clear = () => {
    setHint(null);
    setOverRegion(null);
    setOverElCmp(null);
  };

  if (!doc) return null;

  // ── Sizing ────────────────────────────────────────────────────────────────

  const sizeStyle = (node: LayoutNode, parentDir: "row" | "col" | null): CSSProperties => {
    const base: CSSProperties = { minWidth: 0, minHeight: 0 };
    if (parentDir == null) return { ...base, flex: "1 1 auto" };
    const px = live[node.id];
    const size: Size = px != null ? px : node.size;
    if (typeof size === "number") {
      return parentDir === "row"
        ? { ...base, flex: "0 0 auto", width: size }
        : { ...base, flex: "0 0 auto", height: size };
    }
    if (size === "auto") return { ...base, flex: "0 0 auto" };
    return { ...base, flex: `${size.fr} 1 auto` };
  };
  /** Fixed-px areas carry `.fixed`, whose clip lives in the stylesheet so an
   *  open dropdown menu can lift it (see .rg.fixed in studio.css). */
  const fixedCls = (node: LayoutNode, parentDir: "row" | "col" | null): string =>
    parentDir != null && typeof (live[node.id] ?? node.size) === "number" ? " fixed" : "";

  const startDividerDrag = (split: SplitNode, index: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const row = split.dir === "row";
    const a = split.children[index];
    const b = split.children[index + 1];
    // Adjust the pixel-sized neighbour if there is one; otherwise the
    // before-side child becomes pixel-sized at its measured extent.
    const child = typeof a.size === "number" ? a : typeof b.size === "number" ? b : a;
    const sign = child === a ? 1 : -1;
    const el = container.querySelector(`[data-node-id="${CSS.escape(child.id)}"]`) as HTMLElement | null;
    // offset*, not the bounding rect: sizes are stored in the device's own
    // pixels, and a fitted stage renders them smaller (see stage.tsx).
    const startPx = el ? (row ? el.offsetWidth : el.offsetHeight) : 200;
    const scale = stageScale(container);
    const startPos = row ? e.clientX : e.clientY;
    let latest = Math.round(startPx);
    const move = (ev: PointerEvent) => {
      const delta = (((row ? ev.clientX : ev.clientY) - startPos) * sign) / scale;
      // No upper bound: a region can grow past the viewport and the canvas
      // scrolls to it (the Inspector's pixel field reaches further still).
      latest = Math.max(48, Math.round(startPx + delta));
      setLive((l) => ({ ...l, [child.id]: latest }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      setLive((l) => {
        const next = { ...l };
        delete next[child.id];
        return next;
      });
      props.onResize([{ id: child.id, size: latest }]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  /** Drag on a selected region's trailing-edge grip: sets a fixed pixel size
   *  along the parent split's axis — a hug or fill region becomes fixed at
   *  the dragged size, so adjusting is what opts a region into fixed sizing.
   *  Distances are measured in document space (pointer plus canvas scroll),
   *  and a pointer held at the canvas's far edge keeps growing the region:
   *  a region at the bottom (or right) of the page can be pulled outward
   *  even though the pointer itself has nowhere left to travel — the page
   *  grows and the canvas scrolls after the edge. Same live-override
   *  machinery and 48px floor as the divider drag; one commit on release. */
  const startRegionResize = (region: LayoutNode, row: boolean) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).parentElement;
    if (!el) return;
    const wrap = el.closest(".canvas-wrap") as HTMLElement | null;
    const scroll = () => (wrap ? (row ? wrap.scrollLeft : wrap.scrollTop) : 0);
    const startPx = Math.round(row ? el.offsetWidth : el.offsetHeight);
    // The pointer, the mat's scroll and the hot-zone growth are all screen
    // distances; the size being set is in device pixels.
    const scale = stageScale(el);
    const startPos = (row ? e.clientX : e.clientY) + scroll();
    let pointer = row ? e.clientX : e.clientY;
    let moved = false;
    let grown = 0;
    let latest = startPx;
    const apply = () => {
      // No upper bound, like the divider drag: the canvas scrolls to an
      // overgrown region rather than clamping it.
      latest = Math.max(48, Math.round(startPx + (pointer + scroll() - startPos + grown) / scale));
      setLive((l) => ({ ...l, [region.id]: latest }));
    };
    const move = (ev: PointerEvent) => {
      pointer = row ? ev.clientX : ev.clientY;
      moved = true;
      apply();
    };
    // Hot zone: once the drag is underway, a pointer within 28px of the
    // canvas's far edge grows the region every frame. Scrolling soaks up
    // what it can so the edge stays under the pointer; whatever the scroll
    // cannot take (the page still fits the viewport, so there is nothing to
    // scroll yet) grows the region all the same via `grown`.
    let raf = requestAnimationFrame(function tick() {
      if (wrap && moved) {
        const r = wrap.getBoundingClientRect();
        const past = pointer - ((row ? r.right : r.bottom) - 28);
        if (past > 0) {
          const step = Math.min(16, Math.ceil(past / 4));
          const before = scroll();
          if (row) wrap.scrollLeft += step;
          else wrap.scrollTop += step;
          grown += step - (scroll() - before);
          apply();
        }
      }
      raf = requestAnimationFrame(tick);
    });
    const up = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      setLive((l) => {
        const next = { ...l };
        delete next[region.id];
        return next;
      });
      if (latest !== startPx) props.onResize([{ id: region.id, size: latest }]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  /** The layout node a growing component pushes on, per axis: the nearest
   *  ancestor sitting in a split of that direction with a fixed px size —
   *  the node whose `.fixed` overflow would otherwise clip the component.
   *  Flexible nodes grow (or the device widens) on their own, so they never
   *  need a bump. */
  const growNodeFor = (root: LayoutNode, regionId: string, axis: "row" | "col"): LayoutNode | null => {
    const path = nodePath(root, regionId);
    if (!path) return null;
    for (let i = path.length - 1; i > 0; i--) {
      const parent = path[i - 1];
      if (parent.kind === "split" && parent.dir === axis && typeof path[i].size === "number") return path[i];
    }
    return null;
  };

  /** Edge/corner drag on a component: sets its fixed width/height, growing a
   *  fixed-px region live when the component outruns it; one commit (size +
   *  region bumps together) on release. The starting size is the rendered
   *  box, so the first resize of an auto-sized component feels continuous.
   *  `at` anchors an absolutely placed component (free layout, or a floating
   *  canvas): its own far edge, offset included, is what must fit. */
  const startCmpResize =
    (level: { doc: PageDocument }, cmp: ComponentNode, regionId: string, row: boolean, at: { x: number; y: number } | null, axes: { w: boolean; h: boolean }) =>
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const box = (e.currentTarget as HTMLElement).closest(".cmp") as HTMLElement | null;
      const body = box?.closest(".rg-body") as HTMLElement | null;
      const frame = box?.closest(".frame-body") as HTMLElement | null;
      if (!box || !body) return;
      const scale = stageScale(box);
      const renderW = box.offsetWidth;
      const renderH = box.offsetHeight;
      const set = cmpSize(cmp);
      const fromW = set.w ?? renderW;
      const fromH = set.h ?? renderH;
      // The region's room and content extent at the start of the drag; the
      // drag's overflow is measured against these, not re-read mid-gesture.
      const availW = body.clientWidth;
      const availH = body.clientHeight;
      const scrollW = body.scrollWidth;
      const scrollH = body.scrollHeight;
      const growW = axes.w ? growNodeFor(level.doc.root, regionId, "row") : null;
      const growH = axes.h ? growNodeFor(level.doc.root, regionId, "col") : null;
      const measureNode = (node: LayoutNode | null, horizontal: boolean): number => {
        const el = node ? (frame?.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`) as HTMLElement | null) : null;
        if (!el) return 0;
        return horizontal ? el.offsetWidth : el.offsetHeight;
      };
      const growW0 = measureNode(growW, true);
      const growH0 = measureNode(growH, false);
      // Along the stacking axis the whole stack must fit; across it, just
      // this component. In a free region the component's own far edge
      // (offset + size) is what must fit.
      const overflowW = (w: number) => (at ? at.x + w - availW : row ? scrollW - renderW + w - availW : w - availW);
      const overflowH = (h: number) => (at ? at.y + h - availH : row ? h - availH : scrollH - renderH + h - availH);
      const startX = e.clientX;
      const startY = e.clientY;
      let latest = { w: fromW, h: fromH };
      const move = (ev: PointerEvent) => {
        latest = {
          w: axes.w ? Math.max(40, Math.min(4000, Math.round(fromW + (ev.clientX - startX) / scale))) : fromW,
          h: axes.h ? Math.max(24, Math.min(4000, Math.round(fromH + (ev.clientY - startY) / scale))) : fromH,
        };
        setLiveCmp((m) => ({ ...m, [cmp.id]: { ...(axes.w ? { w: latest.w } : {}), ...(axes.h ? { h: latest.h } : {}) } }));
        if (growW) setLive((l) => ({ ...l, [growW.id]: Math.max(growW0, growW0 + overflowW(latest.w)) }));
        if (growH) setLive((l) => ({ ...l, [growH.id]: Math.max(growH0, growH0 + overflowH(latest.h)) }));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        setLiveCmp((m) => {
          const next = { ...m };
          delete next[cmp.id];
          return next;
        });
        setLive((l) => {
          const next = { ...l };
          if (growW) delete next[growW.id];
          if (growH) delete next[growH.id];
          return next;
        });
        const grow: { id: string; size: Size }[] = [];
        if (growW && overflowW(latest.w) > 0) grow.push({ id: growW.id, size: growW0 + overflowW(latest.w) });
        if (growH && overflowH(latest.h) > 0) grow.push({ id: growH.id, size: growH0 + overflowH(latest.h) });
        const size: { w?: number; h?: number } = {};
        if (axes.w && latest.w !== fromW) size.w = latest.w;
        if (axes.h && latest.h !== fromH) size.h = latest.h;
        if (Object.keys(size).length || grow.length) props.onResizeCmp(cmp.id, size, grow);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    };

  /** Pointer drag anywhere on a component in a free-layout region — or on a
   *  selected floating canvas in any region — moves it. Movement only begins
   *  past a small threshold, so clicks still select and double-clicks still
   *  edit; one commit (position + region bumps) on release. Mirrors the
   *  canvas component's child drag. `freeze` stamps the measured size onto
   *  unset axes (a full-region float would otherwise stay pinned to the far
   *  region edges and warp instead of moving). */
  const startCmpMove =
    (level: { doc: PageDocument }, cmp: ComponentNode, regionId: string, from: { x: number; y: number }, freeze: boolean) => (e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      // Text editing, toolbars, grips and open menus own their own gestures.
      if ((e.target as HTMLElement).closest(`${EDIT_TOKEN_SELECTOR}, .cmp-actions, .cmp-resize, .ui-select-menu, .ui-canvas-tools, .ui-canvas-el-resize, .ui-canvas-el`)) return;
      e.preventDefault();
      const box = e.currentTarget as HTMLElement;
      const body = box.closest(".rg-body") as HTMLElement | null;
      const frame = box.closest(".frame-body") as HTMLElement | null;
      if (!body) return;
      const scale = stageScale(box);
      const renderW = box.offsetWidth;
      const renderH = box.offsetHeight;
      const set = cmpSize(cmp);
      const stamp = freeze && (set.w == null || set.h == null) ? { w: set.w ?? renderW, h: set.h ?? renderH } : null;
      const availW = body.clientWidth;
      const availH = body.clientHeight;
      const growX = growNodeFor(level.doc.root, regionId, "row");
      const growY = growNodeFor(level.doc.root, regionId, "col");
      const measureNode = (node: LayoutNode | null, horizontal: boolean): number => {
        const el = node ? (frame?.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`) as HTMLElement | null) : null;
        if (!el) return 0;
        return horizontal ? el.offsetWidth : el.offsetHeight;
      };
      const growX0 = measureNode(growX, true);
      const growY0 = measureNode(growY, false);
      const startX = e.clientX;
      const startY = e.clientY;
      let started = false;
      let latest = { x: from.x, y: from.y };
      const prevUserSelect = document.body.style.userSelect;
      const move = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        if (!started) {
          if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          started = true;
          document.body.style.userSelect = "none";
          window.getSelection()?.removeAllRanges();
        }
        latest = { x: Math.max(0, Math.round(from.x + dx)), y: Math.max(0, Math.round(from.y + dy)) };
        setLiveCmpPos((m) => ({ ...m, [cmp.id]: latest }));
        // The frozen size rides in the live map so the box keeps its shape
        // from the very first pixel of the drag.
        if (stamp) setLiveCmp((m) => (m[cmp.id] ? m : { ...m, [cmp.id]: { w: stamp.w, h: stamp.h } }));
        if (growX) setLive((l) => ({ ...l, [growX.id]: Math.max(growX0, growX0 + latest.x + renderW - availW) }));
        if (growY) setLive((l) => ({ ...l, [growY.id]: Math.max(growY0, growY0 + latest.y + renderH - availH) }));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        document.body.style.userSelect = prevUserSelect;
        setLiveCmpPos((m) => {
          const next = { ...m };
          delete next[cmp.id];
          return next;
        });
        if (stamp)
          setLiveCmp((m) => {
            const next = { ...m };
            delete next[cmp.id];
            return next;
          });
        setLive((l) => {
          const next = { ...l };
          if (growX) delete next[growX.id];
          if (growY) delete next[growY.id];
          return next;
        });
        if (!started || (latest.x === from.x && latest.y === from.y)) return;
        const grow: { id: string; size: Size }[] = [];
        const overX = latest.x + renderW - availW;
        const overY = latest.y + renderH - availH;
        if (growX && overX > 0) grow.push({ id: growX.id, size: growX0 + overX });
        if (growY && overY > 0) grow.push({ id: growY.id, size: growY0 + overY });
        props.onMoveCmp(cmp.id, latest, grow, stamp ?? undefined);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    };

  // ── Drops ─────────────────────────────────────────────────────────────────

  /** Where a drop landed inside its region's body, for free-layout drops. */
  const dropAt = (e: DragEvent, target: HTMLElement): { x: number; y: number } | null => {
    const body = target.closest(".rg")?.querySelector(":scope > .rg-body") as HTMLElement | null;
    if (!body) return null;
    const r = body.getBoundingClientRect();
    const scale = stageScale(body);
    return {
      x: Math.max(0, Math.round((e.clientX - r.left) / scale + body.scrollLeft)),
      y: Math.max(0, Math.round((e.clientY - r.top) / scale + body.scrollTop)),
    };
  };

  const dropPayload = (e: DragEvent, regionId: string, index: number | null, targetId: string | null, before: boolean, at: { x: number; y: number } | null = null) => {
    const data = readPayload(e);
    clear();
    if (!data || !canWrite) return;
    if (data.kind === "pattern") props.onDropPattern(data.id, regionId, index);
    else if (data.kind === "component") props.onDropComponent(data.type, data.customId, regionId, index, data.shape, at);
    else if (data.kind === "reorder") {
      if (targetId) props.onReorder(data.id, targetId, before);
      else props.onMoveToRegion(data.id, regionId, at);
    }
    // "element" payloads never resolve here: they only land on a component.
  };

  // ── Annotation markers ────────────────────────────────────────────────────

  /** The always-visible note/task badges on an annotated region or
   *  component. Clicking one selects the node and opens the matching tab;
   *  hovering one lights the matching panel rows (and vice versa — a hovered
   *  row lights the badge via `hotMark`). Viewers get them too (reading
   *  notes needs no write access). */
  const markBadges = (className: string, sel: Selection, nodeId: string, hasNote: boolean, hasTask: boolean) => {
    if (!hasNote && !hasTask) return null;
    const badge = (kind: "note" | "task") => (
      <button
        type="button"
        className={`${kind}-badge${
          props.hotMark && (props.hotMark.kind === kind || props.hotMark.kind === "both") && props.hotMark.targetId === nodeId
            ? " hot"
            : ""
        }`}
        title={kind === "note" ? "View notes" : "View tasks"}
        aria-label={kind === "note" ? "View notes" : "View tasks"}
        onClick={(e) => {
          e.stopPropagation();
          props.onMarkClick?.(sel, kind);
        }}
        onMouseEnter={() => props.onMarkHover?.({ kind, targetId: nodeId })}
        onMouseLeave={() => props.onMarkHover?.(null)}
      >
        {kind === "note" ? "N" : "T"}
      </button>
    );
    return (
      <div className={`mark-badges ${className}`}>
        {hasNote && badge("note")}
        {hasTask && badge("task")}
      </div>
    );
  };

  /** Outline class for the node a hovered panel row points at. */
  const hotNodeCls = (nodeId: string): string =>
    props.hotMark && props.hotMark.targetId === nodeId ? ` mark-hot-${props.hotMark.kind}` : "";

  // ── Components ────────────────────────────────────────────────────────────

  const renderComponent = (level: { doc: PageDocument; editable: boolean }, cmp: ComponentNode, regionId: string, row: boolean, free: boolean, index: number) => {
    const editable = level.editable && canWrite;
    const sel = level.editable && selection?.kind === "element" && selection.cmpId === cmp.id ? selection : null;
    const liveSz = level.editable ? liveCmp[cmp.id] : undefined;
    const fixedH = liveSz?.h ?? cmpSize(cmp).h;
    // A floating component overlays its region whatever the layout mode; with
    // geometry set it covers just part of it (floatCmpStyle). Non-canvas
    // floats are solid content, so they keep the pointer instead of the
    // canvas float's click-through.
    const floating = isFloating(cmp);
    const freePos = free && !floating;
    const cls = ["cmp"];
    if (!fillsRegion(cmp)) cls.push("pad");
    if (floating) cls.push("float");
    if (floating && cmp.type !== "canvas") cls.push("solid");
    if (freePos) cls.push("free-pos");
    // A fixed height reuses the fill machinery so the widget stretches to
    // the box (and tables scroll inside it) instead of leaving whitespace.
    if (fillsHeight(cmp) || fixedH != null) cls.push("fill");
    // "grow" marks an actual Fill region choice (never the fixed-height
    // reuse above): in a row split it claims the leftover width (studio.css).
    if (fillsHeight(cmp) && !floating) cls.push("grow");
    if (fixedH != null) cls.push("sized-h");
    if (level.editable && selection?.kind === "cmp" && selection.id === cmp.id) cls.push("selected");
    // Editing controls are select-gated, so "an element in me is selected"
    // must keep them visible too.
    if (sel) cls.push("has-sel");
    if (level.editable && overElCmp === cmp.id) cls.push("el-target");
    if (props.hotMark && props.hotMark.targetId === cmp.id) cls.push(`mark-hot-${props.hotMark.kind}`);
    const structural = cmp.type === "editable-component" || cmp.type === "custom";
    const showHint = level.editable && hint?.cmpId === cmp.id;
    const action = (fn: () => void) => (e: MouseEvent) => {
      e.stopPropagation();
      fn();
    };
    const chrome: SchematicChrome = {
      selected: sel,
      editing: level.editable && editingElement?.cmpId === cmp.id ? editingElement : null,
      linkOf: (key, index) => elementLink(cmp, key, index),
      activePageIds: props.activePageIds,
      noteEls: props.marks?.notes.els,
      taskEls: props.marks?.tasks.els,
      hotEl: props.hotMark ? { id: props.hotMark.targetId, kind: props.hotMark.kind } : null,
      onMarkHover: props.onMarkHover
        ? (mark) => props.onMarkHover!(mark ? { kind: mark.kind, targetId: mark.id } : null)
        : undefined,
      onSelectElement: editable ? (key, index) => props.onSelect({ kind: "element", cmpId: cmp.id, key, index }) : undefined,
      onFollow: props.onFollow,
      onEditEnd: props.onEditEnd,
    };
    return (
      <div key={cmp.id} style={{ display: "contents" }}>
        {showHint && hint.before && <div className="drop-indicator" />}
        <div
          className={cls.join(" ")}
          data-cmp-id={cmp.id}
          style={{
            ...styleData(cmp.props),
            ...(floating
              ? floatCmpStyle(cmp, level.editable ? liveCmpPos[cmp.id] : undefined, liveSz)
              : freePos
                ? freeCmpStyle(cmp, index, level.editable ? liveCmpPos[cmp.id] : undefined, liveSz)
                : cmpSizeStyle(cmp, row, liveSz)),
          }}
          draggable={editable && !freePos && !floating}
          onPointerDown={
            editable && (freePos || floating)
              ? startCmpMove(level, cmp, regionId, floating ? cmpFloatPos(cmp) : cmpFreePos(cmp, index), floating)
              : undefined
          }
          onClick={
            level.editable
              ? (e) => {
                  if ((e.target as HTMLElement).closest(".cmp-actions")) return;
                  props.onSelect({ kind: "cmp", id: cmp.id });
                }
              : undefined
          }
          onDoubleClick={
            editable
              ? (e) => {
                  if (structural && !(e.target as HTMLElement).closest(EDIT_TOKEN_SELECTOR)) {
                    e.stopPropagation();
                    props.onEditStructure(cmp.id);
                  }
                }
              : undefined
          }
          onDragStart={
            editable
              ? (e) => {
                  if ((e.target as HTMLElement).closest(`${EDIT_TOKEN_SELECTOR}, .cmp-resize`)) {
                    e.preventDefault();
                    return;
                  }
                  e.currentTarget.classList.add("dragging");
                  setPayload(e, { kind: "reorder", id: cmp.id }, "move");
                }
              : undefined
          }
          onDragEnd={
            editable
              ? (e) => {
                  e.currentTarget.classList.remove("dragging");
                  clear();
                }
              : undefined
          }
          onDragOver={
            editable
              ? (e) => {
                  if (!hasPayload(e)) return;
                  const elType = draggedElementType(e);
                  if (elType) {
                    // An element drop lands on a compatible component or nowhere.
                    if (!elementHosts(elType).includes(cmp.type)) {
                      if (overElCmp === cmp.id) setOverElCmp(null);
                      return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "copy";
                    if (overElCmp !== cmp.id) {
                      setHint(null);
                      setOverRegion(null);
                      setOverElCmp(cmp.id);
                    }
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "move" ? "move" : "copy";
                  // Free layout has no before/after: the drop lands at the
                  // pointer, so the region highlight is the only cue.
                  if (freePos) {
                    setHint(null);
                    if (overRegion !== regionId) setOverRegion(regionId);
                    return;
                  }
                  const before = dropBefore(e, e.currentTarget, row);
                  if (hint?.cmpId !== cmp.id || hint.before !== before) {
                    setOverRegion(null);
                    setHint({ cmpId: cmp.id, before });
                  }
                }
              : undefined
          }
          onDrop={
            editable
              ? (e) => {
                  if (!hasPayload(e)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const data = readPayload(e);
                  if (data?.kind === "element") {
                    clear();
                    if (elementHosts(data.type).includes(cmp.type)) props.onDropElement(data.type, cmp.id);
                    return;
                  }
                  if (freePos) {
                    dropPayload(e, regionId, null, null, false, dropAt(e, e.currentTarget));
                    return;
                  }
                  const before = dropBefore(e, e.currentTarget, row);
                  const loc = locateCmp(level.doc, cmp.id);
                  const idx = loc ? loc.index : 0;
                  dropPayload(e, regionId, before ? idx : idx + 1, cmp.id, before);
                }
              : undefined
          }
        >
          {markBadges(
            "cmp-marks",
            { kind: "cmp", id: cmp.id },
            cmp.id,
            !!props.marks?.notes.cmps.has(cmp.id),
            !!props.marks?.tasks.cmps.has(cmp.id),
          )}
          {editable && (
            <div className="cmp-actions" role="toolbar" aria-label={`${cmp.label} controls`} title={`${cmp.type} · ${cmp.label}`}>
              {structural && (
                <button type="button" title="Edit structure" aria-label="Edit structure" onClick={action(() => props.onEditStructure(cmp.id))}>
                  <Glyph d={ICON.pencil} />
                </button>
              )}
              {/* In a free region — and for a float anywhere — pos is paint
                  order, so the arrows step the component through the stack
                  instead of the list. */}
              {(() => {
                const stacked = free || floating;
                const back = stacked ? "Send backward" : row ? "Move left" : "Move up";
                const fwd = stacked ? "Bring forward" : row ? "Move right" : "Move down";
                return (
                  <>
                    <button type="button" title={back} aria-label={back} onClick={action(() => props.onMove(cmp.id, -1))}>
                      <Glyph d={!stacked && row ? ICON.left : ICON.up} />
                    </button>
                    <button type="button" title={fwd} aria-label={fwd} onClick={action(() => props.onMove(cmp.id, 1))}>
                      <Glyph d={!stacked && row ? ICON.right : ICON.down} />
                    </button>
                  </>
                );
              })()}
              <button type="button" title="Copy (Ctrl/⌘+C, then Ctrl/⌘+V)" aria-label="Copy" onClick={action(() => props.onCopy(cmp.id))}>
                <Glyph d={ICON.copy} />
              </button>
              <button type="button" className="danger" title="Remove" aria-label="Remove" onClick={action(() => props.onRemove(cmp.id))}>
                <Glyph d={ICON.close} />
              </button>
            </div>
          )}
          {/* Edge/corner grips, shown while selected. On a floating canvas
              they carve the float down from full-region to a placed box. */}
          {editable &&
            (() => {
              const gripAt = floating ? cmpFloatPos(cmp) : freePos ? cmpFreePos(cmp, index) : null;
              return (
                <>
                  <div className="cmp-resize e" title="Drag to resize" onPointerDown={startCmpResize(level, cmp, regionId, row, gripAt, { w: true, h: false })} />
                  <div className="cmp-resize s" title="Drag to resize" onPointerDown={startCmpResize(level, cmp, regionId, row, gripAt, { w: false, h: true })} />
                  <div className="cmp-resize se" title="Drag to resize" onPointerDown={startCmpResize(level, cmp, regionId, row, gripAt, { w: true, h: true })} />
                </>
              );
            })()}
          <Schematic cmp={cmp} defs={props.defs} datasets={props.datasets} edit={editable ? props.editFor(cmp.id) : undefined} chrome={chrome} />
        </div>
        {showHint && !hint.before && <div className="drop-indicator" />}
      </div>
    );
  };

  // ── Regions and splits ────────────────────────────────────────────────────

  interface Level {
    doc: PageDocument;
    editable: boolean;
    outletRegion: string | null;
    outletContent: ReactNode;
  }

  const renderRegion = (level: Level, region: LayoutNode & { kind: "region" }, parentDir: "row" | "col" | null, hasParent: boolean) => {
    const isOutlet = level.outletRegion === region.id;
    const editable = level.editable && canWrite;
    const selected = level.editable && selection?.kind === "region" && selection.id === region.id;
    const list = level.doc.regions[region.id] ?? [];
    const row = region.dir === "row";
    const free = region.dir === "free";
    return (
      <div
        key={region.id}
        data-node-id={region.id}
        data-region-id={region.id}
        className={`rg${fixedCls(region, parentDir)}${selected ? " selected" : ""}${level.editable && overRegion === region.id ? " over" : ""}${isOutlet ? " rg-outlet" : ""}${hotNodeCls(region.id)}${props.linkHotRegion === region.id ? " link-hot" : ""}`}
        style={{ ...sizeStyle(region, parentDir), ...styleData(region.bg ? { bg: region.bg } : undefined) }}
        onClick={
          editable
            ? (e) => {
                if ((e.target as HTMLElement).closest(".cmp, .rg-toolbar")) return;
                e.stopPropagation();
                props.onSelect({ kind: "region", id: region.id });
              }
            : undefined
        }
        onDragOver={
          // The outlet region holds the child page, not its own components —
          // a drop there would vanish behind the child, so it takes none.
          editable && !isOutlet
            ? (e) => {
                if (!hasPayload(e)) return;
                if ((e.target as HTMLElement).closest(".cmp")) return;
                // Regions nest across shell levels now, so a handled dragover
                // must not bubble into the ancestor region around this one.
                e.stopPropagation();
                // Elements can never sit in a region on their own.
                if (draggedElementType(e)) {
                  setOverRegion(null);
                  return;
                }
                e.preventDefault();
                e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "move" ? "move" : "copy";
                setHint(null);
                setOverRegion(region.id);
              }
            : undefined
        }
        onDragLeave={
          editable && !isOutlet
            ? (e) => {
                if (e.target === e.currentTarget) setOverRegion(null);
              }
            : undefined
        }
        onDrop={
          editable && !isOutlet
            ? (e) => {
                if (!hasPayload(e)) return;
                if ((e.target as HTMLElement).closest(".cmp")) return;
                e.preventDefault();
                e.stopPropagation();
                dropPayload(e, region.id, null, null, false, free ? dropAt(e, e.currentTarget) : null);
              }
            : undefined
        }
      >
        {markBadges(
          "rg-marks",
          { kind: "region", id: region.id },
          region.id,
          !!props.marks?.notes.regions.has(region.id),
          !!props.marks?.tasks.regions.has(region.id),
        )}
        {editable && (
          <div className="rg-toolbar" role="toolbar" aria-label="Region controls" title={region.label ?? "Region"}>
            <button type="button" title="Add region left" aria-label="Add region left" onClick={(e) => { e.stopPropagation(); props.onSplit(region.id, "left"); }}>
              <Glyph d={ICON.splitLeft} />
            </button>
            <button type="button" title="Add region above" aria-label="Add region above" onClick={(e) => { e.stopPropagation(); props.onSplit(region.id, "top"); }}>
              <Glyph d={ICON.splitTop} />
            </button>
            <button type="button" title="Add region below" aria-label="Add region below" onClick={(e) => { e.stopPropagation(); props.onSplit(region.id, "bottom"); }}>
              <Glyph d={ICON.splitBottom} />
            </button>
            <button type="button" title="Add region right" aria-label="Add region right" onClick={(e) => { e.stopPropagation(); props.onSplit(region.id, "right"); }}>
              <Glyph d={ICON.splitRight} />
            </button>
            {hasParent && (
              <button type="button" className="danger" title="Delete region" aria-label="Delete region" onClick={(e) => { e.stopPropagation(); props.onRemoveRegion(region.id); }}>
                <Glyph d={ICON.close} />
              </button>
            )}
          </div>
        )}
        {/* Resize grip on any selected region's trailing edge. A hug or fill
            region becomes fixed at the dragged size; the root region has no
            grip — it is the page. */}
        {editable && selected && parentDir != null && (
          <div
            className={`rg-resize ${parentDir === "row" ? "e" : "s"}`}
            title="Drag to resize"
            onPointerDown={startRegionResize(region, parentDir === "row")}
          />
        )}
        <div
          className={`rg-body${row ? " row" : ""}${free ? " free" : ""}`}
          style={free && !isOutlet ? { minHeight: freeBodyMinHeight(list, liveCmpPos, liveCmp) } : undefined}
        >
          {isOutlet ? (
            level.outletContent
          ) : list.length === 0 ? (
            level.editable ? (
              <div className="rg-empty">{canWrite ? "Drag a component here, or split this region" : "Empty region"}</div>
            ) : null
          ) : (
            list.map((c, i) => renderComponent(level, c, region.id, row, free, i))
          )}
        </div>
      </div>
    );
  };

  const renderNode = (level: Level, node: LayoutNode, parentDir: "row" | "col" | null): ReactNode => {
    if (node.kind === "region") return renderRegion(level, node, parentDir, parentDir != null);
    const parts: ReactNode[] = [];
    node.children.forEach((child, i) => {
      parts.push(renderNode(level, child, node.dir));
      if (i < node.children.length - 1) {
        parts.push(
          <div
            key={`${node.id}-div-${i}`}
            className="split-div"
            role="separator"
            aria-orientation={node.dir === "row" ? "vertical" : "horizontal"}
            onPointerDown={level.editable && canWrite ? startDividerDrag(node, i) : undefined}
          />,
        );
      }
    });
    return (
      <div key={node.id} data-node-id={node.id} className={`split split-${node.dir}${fixedCls(node, parentDir)}`} style={sizeStyle(node, parentDir)}>
        {parts}
      </div>
    );
  };

  // ── Host chain ────────────────────────────────────────────────────────────

  // Ancestor shells are editable in place: their components and regions take
  // the same interactions as the open page's, and the studio routes each
  // commit to the page that owns the edited id. Only the outlet region —
  // where the child page renders — keeps the child's content instead.
  const renderFrom = (index: number): ReactNode => {
    if (index < host.length) {
      const h = host[index];
      const level: Level = { doc: h.doc, editable: true, outletRegion: h.regionId, outletContent: renderFrom(index + 1) };
      return (
        <div key={h.pageId} className="host-level">
          {renderNode(level, h.doc.root, null)}
        </div>
      );
    }
    const level: Level = { doc, editable: true, outletRegion: null, outletContent: null };
    return renderNode(level, doc.root, host.length > 0 ? "col" : null);
  };

  // An overlay page: its ancestors render as the backdrop — the innermost
  // shell keeps its own region content instead of opening an outlet — and the
  // page itself is edited inside the overlay chrome floating above.
  const renderBackdrop = (index: number): ReactNode => {
    if (index >= host.length) return null;
    const h = host[index];
    const last = index === host.length - 1;
    const level: Level = {
      doc: h.doc,
      editable: false,
      outletRegion: last ? null : h.regionId,
      outletContent: last ? null : renderBackdrop(index + 1),
    };
    return (
      <div key={h.pageId} className="host-level">
        {renderNode(level, h.doc.root, null)}
      </div>
    );
  };

  if (presentation) {
    const level: Level = { doc, editable: true, outletRegion: null, outletContent: null };
    return (
      <div className="frame-body tree">
        {renderBackdrop(0)}
        {/* Namespaced modifier: the app's Drawer component owns bare `.drawer`. */}
        <div className={`overlay-layer overlay-${presentation}`}>
          <div className="overlay-panel">
            {/* Chrome, not a document element: every overlay page keeps a way
                back to the page it floats over. */}
            <button
              type="button"
              className="overlay-close"
              aria-label="Close"
              title="Close (back to the page behind)"
              onClick={(e) => {
                e.stopPropagation();
                props.onDismissOverlay();
              }}
            >
              <Glyph d={ICON.close} />
            </button>
            <div className="overlay-body">{renderNode(level, doc.root, null)}</div>
          </div>
        </div>
      </div>
    );
  }

  return <div className="frame-body tree">{renderFrom(0)}</div>;
}
