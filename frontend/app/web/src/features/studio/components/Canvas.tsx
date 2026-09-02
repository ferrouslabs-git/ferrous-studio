// The canvas: one page rendered as its layout tree. Splits become flex rows
// and columns separated by draggable dividers; regions are the drop targets
// components stack into. A page placed inside a parent region (a "child
// page") renders inside the parent's shell, which shows read-only around it.
//
// Selection is three-level: a region (click its background), a component
// (click it), or a single element inside one (click a nav item / button —
// see selection.ts). Double-clicking a linked element follows its link.
import { CSSProperties, DragEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode, useState } from "react";
import { elementHosts } from "../catalog";
import { CustomDef, elementLink, locateCmp } from "../model/actions";
import { STRUCTURAL_TYPES } from "../model/regions";
import { SplitSide } from "../model/tree";
import { ComponentNode, LayoutNode, LinkTarget, PageDocument, Size, SplitNode } from "../model/types";
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
  onRemove(id: string): void;
  onEditStructure(id: string): void;
  onDropPattern(id: string, regionId: string, index: number | null): void;
  onDropComponent(type: string, customId: string | undefined, regionId: string, index: number | null, shape?: string): void;
  onDropElement(type: string, cmpId: string): void;
  onReorder(srcId: string, targetId: string, before: boolean): void;
  onMoveToRegion(srcId: string, regionId: string): void;
  onSplit(regionId: string, side: SplitSide): void;
  onRemoveRegion(regionId: string): void;
  onResize(changes: { id: string; size: Size }[]): void;
}

interface Props extends CanvasCallbacks {
  doc: PageDocument | null;
  host: HostLevel[];
  selection: Selection | null;
  editingElement: ElementSel | null;
  defs: readonly CustomDef[];
  canWrite: boolean;
  /** The open page and its ancestor shells, for nav active states. */
  activePageIds: readonly string[];
}

/** Components that fill a region edge-to-edge; everything else gets padding.
 *  A vertical nav bar always fills; so do nav bars and footers generally. */
const fillsRegion = (cmp: ComponentNode): boolean =>
  STRUCTURAL_TYPES.has(cmp.type) ||
  (cmp.type === "navbar" && cmp.layout === "vertical") ||
  cmp.type === "canvas"; // a canvas is always edge-to-edge (float included)

/** A floating canvas overlays its whole region instead of stacking in it. */
const isFloating = (cmp: ComponentNode): boolean => cmp.type === "canvas" && cmp.layout === "float";

const ICON = {
  pencil: "M11.5 2.5l2 2L5 13H3v-2l8.5-8.5Z",
  up: "M8 13V3M3.5 7.5 8 3l4.5 4.5",
  down: "M8 3v10M3.5 8.5 8 13l4.5-4.5",
  close: "M4 4l8 8M12 4l-8 8",
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

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function Canvas(props: Props) {
  const { doc, host, canWrite, selection, editingElement } = props;
  const [hint, setHint] = useState<DropHint | null>(null);
  const [overRegion, setOverRegion] = useState<string | null>(null);
  /** Component highlighted as the target of an element drag. */
  const [overElCmp, setOverElCmp] = useState<string | null>(null);
  /** Live pixel override per node while a divider drag is in flight. */
  const [live, setLive] = useState<Record<string, number>>({});
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
        ? { ...base, flex: "0 0 auto", width: size, overflow: "hidden" }
        : { ...base, flex: "0 0 auto", height: size, overflow: "hidden" };
    }
    if (size === "auto") return { ...base, flex: "0 0 auto" };
    return { ...base, flex: `${size.fr} 1 auto` };
  };

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
    const rect = el?.getBoundingClientRect();
    const startPx = rect ? (row ? rect.width : rect.height) : 200;
    const startPos = row ? e.clientX : e.clientY;
    let latest = Math.round(startPx);
    const move = (ev: PointerEvent) => {
      const delta = ((row ? ev.clientX : ev.clientY) - startPos) * sign;
      latest = clamp(Math.round(startPx + delta), 48, 4000);
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

  // ── Drops ─────────────────────────────────────────────────────────────────

  const dropPayload = (e: DragEvent, regionId: string, index: number | null, targetId: string | null, before: boolean) => {
    const data = readPayload(e);
    clear();
    if (!data || !canWrite) return;
    if (data.kind === "pattern") props.onDropPattern(data.id, regionId, index);
    else if (data.kind === "component") props.onDropComponent(data.type, data.customId, regionId, index, data.shape);
    else if (data.kind === "reorder") {
      if (targetId) props.onReorder(data.id, targetId, before);
      else props.onMoveToRegion(data.id, regionId);
    }
    // "element" payloads never resolve here: they only land on a component.
  };

  // ── Components ────────────────────────────────────────────────────────────

  const renderComponent = (level: { doc: PageDocument; editable: boolean }, cmp: ComponentNode, regionId: string) => {
    const editable = level.editable && canWrite;
    const sel = level.editable && selection?.kind === "element" && selection.cmpId === cmp.id ? selection : null;
    const cls = ["cmp"];
    if (!fillsRegion(cmp)) cls.push("pad");
    if (isFloating(cmp)) cls.push("float");
    if (level.editable && selection?.kind === "cmp" && selection.id === cmp.id) cls.push("selected");
    // Editing controls are select-gated, so "an element in me is selected"
    // must keep them visible too.
    if (sel) cls.push("has-sel");
    if (level.editable && overElCmp === cmp.id) cls.push("el-target");
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
          style={styleData(cmp.props)}
          draggable={editable}
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
                  if ((e.target as HTMLElement).closest(EDIT_TOKEN_SELECTOR)) {
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
                  const before = dropBefore(e, e.currentTarget);
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
                  const before = dropBefore(e, e.currentTarget);
                  const loc = locateCmp(level.doc, cmp.id);
                  const idx = loc ? loc.index : 0;
                  dropPayload(e, regionId, before ? idx : idx + 1, cmp.id, before);
                }
              : undefined
          }
        >
          {editable && (
            <div className="cmp-actions" role="toolbar" aria-label={`${cmp.label} controls`} title={`${cmp.type} · ${cmp.label}`}>
              {structural && (
                <button type="button" title="Edit structure" aria-label="Edit structure" onClick={action(() => props.onEditStructure(cmp.id))}>
                  <Glyph d={ICON.pencil} />
                </button>
              )}
              <button type="button" title="Move up" aria-label="Move up" onClick={action(() => props.onMove(cmp.id, -1))}>
                <Glyph d={ICON.up} />
              </button>
              <button type="button" title="Move down" aria-label="Move down" onClick={action(() => props.onMove(cmp.id, 1))}>
                <Glyph d={ICON.down} />
              </button>
              <button type="button" className="danger" title="Remove" aria-label="Remove" onClick={action(() => props.onRemove(cmp.id))}>
                <Glyph d={ICON.close} />
              </button>
            </div>
          )}
          <Schematic cmp={cmp} defs={props.defs} edit={editable ? props.editFor(cmp.id) : undefined} chrome={chrome} />
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
    const isOutlet = !level.editable && level.outletRegion === region.id;
    const editable = level.editable && canWrite;
    const selected = level.editable && selection?.kind === "region" && selection.id === region.id;
    const list = level.doc.regions[region.id] ?? [];
    return (
      <div
        key={region.id}
        data-node-id={region.id}
        data-region-id={region.id}
        className={`rg${selected ? " selected" : ""}${level.editable && overRegion === region.id ? " over" : ""}${isOutlet ? " rg-outlet" : ""}`}
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
          editable
            ? (e) => {
                if (!hasPayload(e)) return;
                if ((e.target as HTMLElement).closest(".cmp")) return;
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
          editable
            ? (e) => {
                if (e.target === e.currentTarget) setOverRegion(null);
              }
            : undefined
        }
        onDrop={
          editable
            ? (e) => {
                if (!hasPayload(e)) return;
                if ((e.target as HTMLElement).closest(".cmp")) return;
                e.preventDefault();
                dropPayload(e, region.id, null, null, false);
              }
            : undefined
        }
      >
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
              <button type="button" className="danger" title="Remove region" aria-label="Remove region" onClick={(e) => { e.stopPropagation(); props.onRemoveRegion(region.id); }}>
                <Glyph d={ICON.close} />
              </button>
            )}
          </div>
        )}
        <div className="rg-body">
          {isOutlet ? (
            level.outletContent
          ) : list.length === 0 ? (
            level.editable ? (
              <div className="rg-empty">{canWrite ? "Drag a component here, or split this region" : "Empty region"}</div>
            ) : null
          ) : (
            list.map((c) => renderComponent(level, c, region.id))
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
      <div key={node.id} data-node-id={node.id} className={`split split-${node.dir}`} style={sizeStyle(node, parentDir)}>
        {parts}
      </div>
    );
  };

  // ── Host chain ────────────────────────────────────────────────────────────

  const renderFrom = (index: number): ReactNode => {
    if (index < host.length) {
      const h = host[index];
      const level: Level = { doc: h.doc, editable: false, outletRegion: h.regionId, outletContent: renderFrom(index + 1) };
      return (
        <div key={h.pageId} className="host-level">
          {renderNode(level, h.doc.root, null)}
        </div>
      );
    }
    const level: Level = { doc, editable: true, outletRegion: null, outletContent: null };
    return renderNode(level, doc.root, host.length > 0 ? "col" : null);
  };

  return <div className="frame-body tree">{renderFrom(0)}</div>;
}
