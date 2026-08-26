// The frame canvas: regions grid or flat list, components with their
// schematics, selection, and drag-and-drop. Ported from render.global.js
// (renderCanvas/renderRegion/renderComponent) and dnd.global.js.
import { DragEvent, useState } from "react";
import { CustomDef, locateCmp } from "../model/actions";
import { REGION_LABEL } from "../model/regions";
import { ComponentNode, Frame, REGION_ORDER, RegionName } from "../model/types";
import { dropBefore, DropHint, hasPayload, readPayload, setPayload } from "./dnd";
import { Schematic, SchematicEdit } from "./Schematic";

export interface CanvasCallbacks {
  onSelect(id: string | null): void;
  editFor(id: string): SchematicEdit;
  onMove(id: string, delta: -1 | 1): void;
  onRemove(id: string): void;
  onEditStructure(id: string): void;
  onDropPattern(id: string, region: RegionName | null, index: number | null): void;
  onDropComponent(type: string, customId: string | undefined, region: RegionName | null, index: number | null): void;
  onReorder(srcId: string, targetId: string, before: boolean): void;
  onMoveToRegion(srcId: string, region: RegionName): void;
}

interface Props extends CanvasCallbacks {
  frame: Frame | null;
  selectedId: string | null;
  defs: readonly CustomDef[];
  canWrite: boolean;
}

const TOKEN_SELECTOR = ".shell-pill, .prop-pill, .editable-title, .editable-text, .editable-pill, .tbl-edit, .inline-edit-input";
const SIDENAV = new Set(["sidebar", "sidenav-simple", "sidenav-grouped", "sidenav-workspace"]);
const RIGHTPANEL = new Set(["detail", "rightpanel-detail", "rightpanel-filters", "rightpanel-activity"]);
const WIDE = new Set(["list", "chart", "form", "detail", "modal"]);

export function Canvas(props: Props) {
  const { frame, canWrite } = props;
  const [hint, setHint] = useState<DropHint | null>(null);
  const [overRegion, setOverRegion] = useState<RegionName | null>(null);
  const [overEmpty, setOverEmpty] = useState(false);
  const clear = () => {
    setHint(null);
    setOverRegion(null);
    setOverEmpty(false);
  };

  if (!frame) return null;

  const dropPayload = (e: DragEvent, region: RegionName | null, index: number | null, targetId: string | null, before: boolean) => {
    const data = readPayload(e);
    clear();
    if (!data || !canWrite) return;
    if (data.kind === "pattern") props.onDropPattern(data.id, region, index);
    else if (data.kind === "component") props.onDropComponent(data.type, data.customId, region, index);
    else if (data.kind === "reorder") {
      if (targetId) props.onReorder(data.id, targetId, before);
      else if (region) props.onMoveToRegion(data.id, region);
    }
  };

  const renderComponent = (cmp: ComponentNode, region: RegionName | null) => {
    const cls = ["cmp"];
    if (cmp.id === props.selectedId) cls.push("selected");
    if (SIDENAV.has(cmp.type) && region === "sidebar") cls.push("cmp-shell-sidebar");
    if (RIGHTPANEL.has(cmp.type) && region === "right") cls.push("cmp-shell-right");
    if (region === "main" && WIDE.has(cmp.type)) cls.push("cmp-wide");
    const structural = cmp.type === "editable-component" || cmp.type === "custom";
    const showHint = hint?.cmpId === cmp.id;
    return (
      <div key={cmp.id} style={{ display: "contents" }}>
        {showHint && hint.before && <div className="drop-indicator" />}
        <div
          className={cls.join(" ")}
          data-cmp-id={cmp.id}
          draggable={canWrite}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest(".cmp-actions")) return;
            props.onSelect(cmp.id);
          }}
          onDoubleClick={(e) => {
            if (structural && !(e.target as HTMLElement).closest(TOKEN_SELECTOR)) {
              e.stopPropagation();
              props.onEditStructure(cmp.id);
            }
          }}
          onDragStart={(e) => {
            if ((e.target as HTMLElement).closest(TOKEN_SELECTOR)) {
              e.preventDefault();
              return;
            }
            e.currentTarget.classList.add("dragging");
            setPayload(e, { kind: "reorder", id: cmp.id }, "move");
          }}
          onDragEnd={(e) => {
            e.currentTarget.classList.remove("dragging");
            clear();
          }}
          onDragOver={(e) => {
            if (!hasPayload(e) || !canWrite) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "move" ? "move" : "copy";
            const before = dropBefore(e, e.currentTarget);
            if (hint?.cmpId !== cmp.id || hint.before !== before) {
              setOverRegion(null);
              setHint({ cmpId: cmp.id, before });
            }
          }}
          onDrop={(e) => {
            if (!hasPayload(e)) return;
            e.preventDefault();
            e.stopPropagation();
            const before = dropBefore(e, e.currentTarget);
            const loc = locateCmp(frame, cmp.id);
            const idx = loc ? loc.index : 0;
            dropPayload(e, region, before ? idx : idx + 1, cmp.id, before);
          }}
        >
          <span className="cmp-tag">
            {cmp.type} · "{cmp.label}"
          </span>
          {canWrite && (
            <div className="cmp-actions">
              {structural && (
                <button title="Edit component structure" onClick={() => props.onEditStructure(cmp.id)}>✎</button>
              )}
              <button title="Move up" onClick={() => props.onMove(cmp.id, -1)}>↑</button>
              <button title="Move down" onClick={() => props.onMove(cmp.id, 1)}>↓</button>
              <button title="Remove" onClick={() => props.onRemove(cmp.id)}>×</button>
            </div>
          )}
          <Schematic cmp={cmp} region={region} defs={props.defs} edit={canWrite ? props.editFor(cmp.id) : undefined} />
        </div>
        {showHint && !hint.before && <div className="drop-indicator" />}
      </div>
    );
  };

  const emptyDropProps = (region: RegionName | null) => ({
    onDragOver: (e: DragEvent) => {
      if (!hasPayload(e) || !canWrite) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setOverEmpty(true);
    },
    onDragLeave: () => setOverEmpty(false),
    onDrop: (e: DragEvent) => {
      if (!hasPayload(e)) return;
      e.preventDefault();
      dropPayload(e, region, null, null, false);
    },
  });

  if (frame.layoutMode === "flat") {
    const list = frame.layout.components;
    return (
      <div className={`frame-body${overEmpty ? " over-empty" : ""}`} {...(list.length === 0 ? emptyDropProps(null) : {})}>
        {list.length === 0 ? (
          <div className={`empty-hint${overEmpty ? " over" : ""}`}>Drag a preset or component here</div>
        ) : (
          list.map((c) => renderComponent(c, null))
        )}
      </div>
    );
  }

  const regions = frame.layout.regions;
  const has = (r: RegionName) => regions[r].length > 0;
  const gridCls = [
    "regions",
    has("header") ? "has-header" : "no-header",
    has("sidebar") ? "has-sidebar" : "no-sidebar",
    has("right") ? "has-right" : "no-right",
    has("footer") ? "has-footer" : "no-footer",
  ].join(" ");

  return (
    <div className="frame-body">
      <div className={gridCls}>
        {REGION_ORDER.map((name) => {
          const list = regions[name];
          const collapsed = list.length === 0 && name !== "main";
          return (
            <div
              key={name}
              className={`region r-${name}${collapsed ? " collapsed" : ""}${overRegion === name ? " over" : ""}`}
              data-region={name}
              onDragOver={(e) => {
                if (!hasPayload(e) || !canWrite) return;
                if ((e.target as HTMLElement).closest(".cmp")) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === "move" ? "move" : "copy";
                setHint(null);
                setOverRegion(name);
              }}
              onDragLeave={(e) => {
                if (e.target === e.currentTarget) setOverRegion(null);
              }}
              onDrop={(e) => {
                if (!hasPayload(e)) return;
                if ((e.target as HTMLElement).closest(".cmp")) return;
                e.preventDefault();
                dropPayload(e, name, null, null, false);
              }}
            >
              <span className="region-label">{REGION_LABEL[name]}</span>
              <div className={`region-content${name === "main" ? ` main-flow-${frame.layout.options.mainFlow}` : ""}`}>
                {list.length === 0 ? (
                  <div className="region-empty">
                    {name === "sidebar" ? "Drop sidebar here" : name === "right" ? "Drop right panel here" : `Drop here · ${name}`}
                  </div>
                ) : (
                  list.map((c) => renderComponent(c, name))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
