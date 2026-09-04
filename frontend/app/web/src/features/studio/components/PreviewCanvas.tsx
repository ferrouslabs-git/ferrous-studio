// Preview rendering of a page: the same layout-tree walk as the editing
// canvas — splits, regions, ancestor shells around a child page — with every
// editing affordance stripped. Components render through Schematic with no
// `edit` handlers, and `followOnClick` chrome makes linked elements navigate
// on a single click, so the page behaves like the screen it describes.
import { CSSProperties, ReactNode } from "react";
import type { Dataset } from "../../project/datasets/datasetsApi";
import { CustomDef, elementLink } from "../model/actions";
import { cmpSize } from "../model/tree";
import { ComponentNode, LayoutNode, LinkTarget, PageDocument, PagePresentation, Size } from "../model/types";
import { cmpSizeStyle, fillsHeight, fillsRegion, floatCmpStyle, freeBodyMinHeight, freeCmpStyle, HostLevel, isFloating } from "./Canvas";
import { Schematic, SchematicChrome, styleData } from "./Schematic";

interface Props {
  doc: PageDocument;
  /** Ancestor shells around a child page, outermost first (see Canvas). */
  host: HostLevel[];
  /** Set when this page opens as an overlay: its placement parent renders in
   *  full behind it and the page floats in modal/drawer chrome. */
  presentation: PagePresentation | null;
  /** The open page and its ancestor shells, for nav active states. */
  activePageIds: readonly string[];
  defs: readonly CustomDef[];
  datasets: readonly Dataset[];
  onFollow(target: LinkTarget): void;
  /** A click on the overlay scrim: close the overlay (go back). */
  onDismiss(): void;
}

/** One level of the host chain: a document and, for ancestors, the region the
 *  next level renders into instead of that region's own components. */
interface Level {
  doc: PageDocument;
  outletRegion: string | null;
  outletContent: ReactNode;
}

export function PreviewCanvas({ doc, host, presentation, activePageIds, defs, datasets, onFollow, onDismiss }: Props) {
  const sizeStyle = (node: LayoutNode, parentDir: "row" | "col" | null): CSSProperties => {
    const base: CSSProperties = { minWidth: 0, minHeight: 0 };
    if (parentDir == null) return { ...base, flex: "1 1 auto" };
    const size: Size = node.size;
    if (typeof size === "number") {
      return parentDir === "row" ? { ...base, flex: "0 0 auto", width: size } : { ...base, flex: "0 0 auto", height: size };
    }
    if (size === "auto") return { ...base, flex: "0 0 auto" };
    return { ...base, flex: `${size.fr} 1 auto` };
  };
  /** Same class as the editor: fixed-px areas scroll their body (studio.css). */
  const fixedCls = (node: LayoutNode, parentDir: "row" | "col" | null): string =>
    parentDir != null && typeof node.size === "number" ? " fixed" : "";

  const renderComponent = (cmp: ComponentNode, row: boolean, free: boolean, index: number) => {
    const chrome: SchematicChrome = {
      selected: null,
      editing: null,
      linkOf: (key, index) => elementLink(cmp, key, index),
      activePageIds,
      followOnClick: true,
      onFollow,
    };
    const fixedH = cmpSize(cmp).h;
    const floating = isFloating(cmp);
    const freePos = free && !floating;
    const cls = ["cmp"];
    if (!fillsRegion(cmp)) cls.push("pad");
    if (floating) cls.push("float");
    // Solid (non-canvas) floats keep the pointer so their links still follow.
    if (floating && cmp.type !== "canvas") cls.push("solid");
    if (fillsHeight(cmp) || fixedH != null) cls.push("fill");
    if (fillsHeight(cmp) && !floating) cls.push("grow");
    if (fixedH != null) cls.push("sized-h");
    return (
      <div
        key={cmp.id}
        className={cls.join(" ")}
        style={{ ...styleData(cmp.props), ...(floating ? floatCmpStyle(cmp) : freePos ? freeCmpStyle(cmp, index) : cmpSizeStyle(cmp, row)) }}
      >
        <Schematic cmp={cmp} defs={defs} datasets={datasets} chrome={chrome} />
      </div>
    );
  };

  const renderRegion = (level: Level, region: LayoutNode & { kind: "region" }, parentDir: "row" | "col" | null) => {
    const isOutlet = level.outletRegion === region.id;
    const list = level.doc.regions[region.id] ?? [];
    const row = region.dir === "row";
    const free = region.dir === "free";
    return (
      <div
        key={region.id}
        className={`rg${fixedCls(region, parentDir)}`}
        style={{ ...sizeStyle(region, parentDir), ...styleData(region.bg ? { bg: region.bg } : undefined) }}
      >
        <div className={`rg-body${row ? " row" : ""}${free ? " free" : ""}`} style={free && !isOutlet ? { minHeight: freeBodyMinHeight(list) } : undefined}>
          {isOutlet ? level.outletContent : list.map((c, i) => renderComponent(c, row, free, i))}
        </div>
      </div>
    );
  };

  const renderNode = (level: Level, node: LayoutNode, parentDir: "row" | "col" | null): ReactNode => {
    if (node.kind === "region") return renderRegion(level, node, parentDir);
    const parts: ReactNode[] = [];
    node.children.forEach((child, i) => {
      parts.push(renderNode(level, child, node.dir));
      // Seam only — no role, so the divider CSS leaves it inert.
      if (i < node.children.length - 1) parts.push(<div key={`${node.id}-div-${i}`} className="split-div" />);
    });
    return (
      <div key={node.id} className={`split split-${node.dir}${fixedCls(node, parentDir)}`} style={sizeStyle(node, parentDir)}>
        {parts}
      </div>
    );
  };

  const renderFrom = (index: number): ReactNode => {
    if (index < host.length) {
      const h = host[index];
      const level: Level = { doc: h.doc, outletRegion: h.regionId, outletContent: renderFrom(index + 1) };
      return (
        <div key={h.pageId} className="host-level">
          {renderNode(level, h.doc.root, null)}
        </div>
      );
    }
    const level: Level = { doc, outletRegion: null, outletContent: null };
    return renderNode(level, doc.root, host.length > 0 ? "col" : null);
  };

  // An overlay page: ancestors render in full as the backdrop (the innermost
  // shell keeps its own region content) and the page floats above; clicking
  // the scrim dismisses it, like the modal it stands for.
  const renderBackdrop = (index: number): ReactNode => {
    if (index >= host.length) return null;
    const h = host[index];
    const last = index === host.length - 1;
    const level: Level = {
      doc: h.doc,
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
    const level: Level = { doc, outletRegion: null, outletContent: null };
    return (
      <div className="frame-body tree">
        {renderBackdrop(0)}
        <div
          className={`overlay-layer overlay-${presentation}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) onDismiss();
          }}
        >
          <div className="overlay-panel">
            <button
              type="button"
              className="overlay-close"
              aria-label="Close"
              title="Close"
              onClick={onDismiss}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
            <div className="overlay-body">{renderNode(level, doc.root, null)}</div>
          </div>
        </div>
      </div>
    );
  }

  return <div className="frame-body tree">{renderFrom(0)}</div>;
}
