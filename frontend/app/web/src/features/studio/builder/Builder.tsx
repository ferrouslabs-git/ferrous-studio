// Component builder drawer: slot palette, tree canvas with grouping,
// drag-and-drop, marquee multi-select, undo/redo, and a properties panel.
// Ported from legacy/js/builder.global.js on top of builderModel.ts.
import { produce } from "immer";
import { CSSProperties, DragEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer } from "../../../components/Drawer";
import { CustomDef, Slot } from "../model/actions";
import {
  addSlot,
  commonParent,
  deleteSelected,
  DragSource,
  DropSpec,
  duplicateSelected,
  groupSelected,
  ICON_COLORS,
  isContiguousSelection,
  isDescendantOf,
  isGroup,
  LEAF_TYPES,
  LeafType,
  locate,
  migrateDraft,
  moveSelected,
  newDraft,
  PALETTE,
  performDrop,
  ungroupSelected,
} from "./builderModel";

const HISTORY_LIMIT = 120;

interface Props {
  /** Existing definition to edit, or null for a new one. */
  initial: CustomDef | null;
  onSave(def: CustomDef): void;
  onDelete(id: string): void;
  onClose(): void;
  toast(msg: string): void;
}

type Align = "start" | "center" | "end";
type Layout = "col" | "row" | "grid";
const justify = (a: Align) => (a === "center" ? "center" : a === "end" ? "flex-end" : "flex-start");

function bodyStyle(layout: Layout, align: Align, gridCols: number, gap?: number, padding?: number): CSSProperties {
  const base: CSSProperties = { gap, padding };
  if (layout === "grid") return { ...base, display: "grid", gridTemplateColumns: `repeat(${gridCols}, minmax(180px, 1fr))`, justifyItems: align === "center" ? "center" : align === "end" ? "end" : "start" };
  if (layout === "row") return { ...base, display: "flex", flexDirection: "row", flexWrap: "wrap", justifyContent: justify(align), alignItems: "flex-start", alignContent: "flex-start" };
  return { ...base, display: "flex", flexDirection: "column", alignItems: justify(align) };
}

function LeafPreview({ s }: { s: Slot }) {
  const label = "label" in s ? (s.label ?? "") : "";
  const labels = label.split(",").map((x) => x.trim()).filter(Boolean);
  switch (s.type) {
    case "heading": return <div className="bldr-prev-heading">{label || "Heading"}</div>;
    case "text": return <div className="bldr-prev-text">{label || "Lorem ipsum dolor sit amet, consectetur adipiscing."}</div>;
    case "label": return <div className="bldr-prev-label">{label || "Label"}</div>;
    case "badge": return <span className="sk-pill">{label || "Badge"}</span>;
    case "button": return <span className="sk-pill accent">{label || "Action"}</span>;
    case "button-row": {
      const ll = labels.length ? labels : ["Cancel", "Save"];
      return (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          {ll.map((t, i) => <span key={i} className={`sk-pill${i === ll.length - 1 ? " accent" : ""}`}>{t}</span>)}
        </div>
      );
    }
    case "input": return <div className="bldr-prev-input" />;
    case "image": return <div className="bldr-prev-image" />;
    case "divider": return <div className="bldr-prev-divider" />;
    default: return <div>{s.type}</div>;
  }
}

export function Builder({ initial, onSave, onDelete, onClose, toast }: Props) {
  const [draft, setDraft] = useState<CustomDef>(() => (initial ? migrateDraft(initial) : newDraft()));
  const [selection, setSelection] = useState<string[]>([]);
  const past = useRef<CustomDef[]>([]);
  const future = useRef<CustomDef[]>([]);
  const [, bump] = useState(0);
  const dragSource = useRef<DragSource | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; mode: "before" | "after" | "into" | "root" } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const marquee = useRef<{ startX: number; startY: number; endX: number; endY: number; moved: boolean } | null>(null);
  const [marqueeBox, setMarqueeBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const isExisting = !!initial;
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Every mutation goes through here: it is the undo boundary.
  const mutate = useCallback((fn: (d: CustomDef) => void) => {
    setDraft((cur) => {
      const next = produce(cur, fn);
      if (next !== cur) {
        past.current.push(cur);
        if (past.current.length > HISTORY_LIMIT) past.current.shift();
        future.current = [];
        bump((n) => n + 1);
      }
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    setDraft((cur) => {
      future.current.push(cur);
      return prev;
    });
    setSelection([]);
    bump((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    setDraft((cur) => {
      past.current.push(cur);
      return next;
    });
    setSelection([]);
    bump((n) => n + 1);
  }, []);

  const doGroup = (layout: Layout) => {
    if (!isContiguousSelection(draft, selection)) {
      toast("Select adjacent siblings to group");
      return;
    }
    let gid: string | null = null;
    mutate((d) => {
      gid = groupSelected(d, selection, layout);
    });
    if (gid) setSelection([gid]);
  };
  const doUngroup = () => {
    let kids: string[] | null = null;
    mutate((d) => {
      kids = ungroupSelected(d, selection);
    });
    if (kids) setSelection(kids);
    else toast("Select a single group to ungroup");
  };
  const doMove = (dir: "up" | "down") => mutate((d) => void moveSelected(d, selection, dir));
  const doDuplicate = () => {
    let id: string | null = null;
    mutate((d) => {
      id = duplicateSelected(d, selection);
    });
    if (id) setSelection([id]);
  };
  const doDelete = () => {
    if (!selection.length) return;
    mutate((d) => deleteSelected(d, selection));
    setSelection([]);
  };
  const doAdd = (type: LeafType) => {
    let id = "";
    mutate((d) => {
      id = addSlot(d, selection, type);
    });
    setSelection([id]);
  };
  const doDrop = (drop: DropSpec) => {
    const src = dragSource.current;
    dragSource.current = null;
    setDropTarget(null);
    if (!src) return;
    let id: string | null = null;
    mutate((d) => {
      id = performDrop(d, src, drop);
    });
    if (id) setSelection([id]);
  };

  const select = (id: string, e: ReactMouseEvent) => {
    e.stopPropagation();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    setSelection((sel) => (additive ? (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]) : [id]));
  };

  const save = () => {
    if (!draft.name.trim()) {
      toast("Give the component a name first");
      return;
    }
    onSave(draft);
  };

  // Keyboard shortcuts while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && e.shiftKey) { redo(); e.preventDefault(); }
      else if (mod && e.key.toLowerCase() === "y") { redo(); e.preventDefault(); }
      else if (mod && e.key.toLowerCase() === "z") { undo(); e.preventDefault(); }
      else if (e.key === "Escape") onClose();
      else if (e.key === "Delete" || e.key === "Backspace") { doDelete(); e.preventDefault(); }
      else if (mod && e.key.toLowerCase() === "d") { doDuplicate(); e.preventDefault(); }
      else if (e.key === "ArrowUp" && mod) { doMove("up"); e.preventDefault(); }
      else if (e.key === "ArrowDown" && mod) { doMove("down"); e.preventDefault(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // Marquee selection on empty canvas space.
  const onCanvasMouseDown = (e: ReactMouseEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".bldr-node")) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left + canvas.scrollLeft;
    const y = e.clientY - rect.top + canvas.scrollTop;
    marquee.current = { startX: x, startY: y, endX: x, endY: y, moved: false };
    setMarqueeBox({ left: x, top: y, width: 0, height: 0 });
    e.preventDefault();
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const m = marquee.current;
      const canvas = canvasRef.current;
      if (!m || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      m.endX = e.clientX - rect.left + canvas.scrollLeft;
      m.endY = e.clientY - rect.top + canvas.scrollTop;
      if (Math.abs(m.endX - m.startX) > 4 || Math.abs(m.endY - m.startY) > 4) m.moved = true;
      setMarqueeBox({
        left: Math.min(m.startX, m.endX),
        top: Math.min(m.startY, m.endY),
        width: Math.abs(m.endX - m.startX),
        height: Math.abs(m.endY - m.startY),
      });
    };
    const onUp = () => {
      const m = marquee.current;
      const canvas = canvasRef.current;
      marquee.current = null;
      setMarqueeBox(null);
      if (!m || !canvas) return;
      const width = Math.abs(m.endX - m.startX);
      const height = Math.abs(m.endY - m.startY);
      if (!m.moved || width < 4 || height < 4) {
        setSelection([]);
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const left = rect.left + Math.min(m.startX, m.endX) - canvas.scrollLeft;
      const top = rect.top + Math.min(m.startY, m.endY) - canvas.scrollTop;
      const sel = { left, top, right: left + width, bottom: top + height };
      const hits = Array.from(canvas.querySelectorAll<HTMLElement>(".bldr-node[data-slot-id]"))
        .filter((n) => {
          const r = n.getBoundingClientRect();
          return r.left >= sel.left && r.right <= sel.right && r.top >= sel.top && r.bottom <= sel.bottom;
        })
        .map((n) => n.dataset.slotId!)
        .filter(Boolean);
      setSelection(hits);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const located = useMemo(() => selection.map((id) => locate(id, draft.slots)).filter((x): x is NonNullable<typeof x> => !!x), [draft, selection]);
  const single = located.length === 1 ? located[0].slot : null;
  const canGroup = selection.length >= 1 && isContiguousSelection(draft, selection);
  const color = draft.color ?? "#6aa0ff";

  const renderNode = (slot: Slot, parentLayout: Layout) => {
    const group = isGroup(slot);
    const cls = ["bldr-node"];
    if (group) cls.push("is-group", `bldr-layout-${slot.layout ?? "col"}`);
    if (parentLayout === "row") cls.push("in-row-parent");
    if (parentLayout === "grid") cls.push("in-grid-parent");
    if (selection.includes(slot.id)) cls.push("selected");
    if (dropTarget?.id === slot.id) cls.push(`drop-${dropTarget.mode}`);
    const blocked = (src: DragSource | null) => src?.kind === "node" && (src.id === slot.id || isDescendantOf(locate(src.id, draft.slots)?.slot ?? slot, slot.id));
    return (
      <div
        key={slot.id}
        className={cls.join(" ")}
        data-slot-id={slot.id}
        draggable
        onClick={(e) => select(slot.id, e)}
        onDragStart={(e) => {
          e.stopPropagation();
          dragSource.current = { kind: "node", id: slot.id };
          e.dataTransfer.effectAllowed = "move";
          try { e.dataTransfer.setData("text/plain", `node:${slot.id}`); } catch { /* some browsers throw */ }
        }}
        onDragEnd={() => {
          dragSource.current = null;
          setDropTarget(null);
        }}
        onDragOver={(e) => {
          const src = dragSource.current;
          if (!src || blocked(src)) return;
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = src.kind === "palette" ? "copy" : "move";
          const rect = e.currentTarget.getBoundingClientRect();
          const isRow = parentLayout === "row";
          const pos = isRow ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
          const mode = group && pos > 0.25 && pos < 0.75 ? "into" : pos < 0.5 ? "before" : "after";
          if (dropTarget?.id !== slot.id || dropTarget.mode !== mode) setDropTarget({ id: slot.id, mode });
        }}
        onDrop={(e) => {
          const src = dragSource.current;
          if (!src || blocked(src)) return;
          e.preventDefault();
          e.stopPropagation();
          const mode = dropTarget?.id === slot.id ? dropTarget.mode : "after";
          if (mode === "into" && group) doDrop({ kind: "into", groupId: slot.id });
          else doDrop({ kind: mode === "before" ? "before" : "after", id: slot.id });
        }}
      >
        {group ? (
          <>
            <div className="bldr-group-head">
              <span className="bldr-group-tag">
                {(slot.layout ?? "col").toUpperCase()}
                {slot.layout === "grid" ? ` · ${slot.gridCols ?? 2}col` : ""}
                {slot.align && slot.align !== "start" ? ` · ${slot.align}` : ""}
              </span>
            </div>
            <div className="bldr-group-body" style={{ width: "100%", minWidth: 0, ...bodyStyle(slot.layout ?? "col", slot.align ?? "start", slot.gridCols ?? 2) }}>
              {slot.children.map((c) => renderNode(c, slot.layout ?? "col"))}
              {slot.children.length === 0 && <div className="bldr-empty bldr-empty-sm" style={{ flex: 1 }}>Empty group — drop something here</div>}
            </div>
          </>
        ) : (
          <>
            <div className="bldr-leaf-render"><LeafPreview s={slot} /></div>
            <span className="bldr-leaf-tag">{slot.type}</span>
          </>
        )}
      </div>
    );
  };

  const rootDrop = {
    onDragOver: (e: DragEvent) => {
      if (!dragSource.current || e.target !== e.currentTarget) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = dragSource.current.kind === "palette" ? "copy" : "move";
      if (dropTarget?.id !== "__root") setDropTarget({ id: "__root", mode: "root" });
    },
    onDrop: (e: DragEvent) => {
      if (!dragSource.current || e.target !== e.currentTarget) return;
      e.preventDefault();
      doDrop({ kind: "root-append" });
    },
  };
  const rootLayout = draft.rootLayout ?? "col";

  return (
    <Drawer
      open
      title={isExisting ? "Edit component" : "New component"}
      onClose={onClose}
      width={1280}
      className="builder-drawer"
      footer={
        <>
          {isExisting && (
            <button type="button" className="btn danger" style={{ marginRight: "auto" }} onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>Save component</button>
        </>
      }
    >
      <ConfirmDrawer
        open={confirmDelete}
        title="Delete component"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => onDelete(draft.id)}
      >
        <p>Delete <b>{draft.name || "this component"}</b>? Instances already placed on pages keep their layout but lose the link to this definition.</p>
      </ConfirmDrawer>
      <div className="builder-panel">
        <div className="builder-head">
          <div className="builder-head-id">
            <div className="builder-icon-preview" style={{ background: `${color}22`, color, borderColor: color }}>
              {(draft.icon ?? "CMP").slice(0, 4).toUpperCase()}
            </div>
            <div className="builder-head-meta">
              <input className="builder-name-input" placeholder="Component name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <input className="builder-desc-input" placeholder="Short description (optional)" value={draft.desc ?? ""} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="builder-body builder-body-3col">
          <aside className="bldr-palette">
            <div className="bldr-section-title">Slot palette</div>
            <div className="bldr-palette-hint">Click to add into the selected group (or root).</div>
            <div className="bldr-palette-grid">
              {PALETTE.map((p) => (
                <button
                  key={p.type}
                  type="button"
                  className="bldr-palette-item"
                  draggable
                  title="Click to add, or drag onto canvas"
                  onClick={() => doAdd(p.type)}
                  onDragStart={(e) => {
                    dragSource.current = { kind: "palette", type: p.type };
                    e.dataTransfer.effectAllowed = "copy";
                    e.dataTransfer.setData("text/plain", `palette:${p.type}`);
                  }}
                  onDragEnd={() => {
                    dragSource.current = null;
                    setDropTarget(null);
                  }}
                >
                  <span className="bldr-pal-icon">{p.icon}</span>
                  <span className="bldr-pal-name">{p.label}</span>
                </button>
              ))}
            </div>
            <div className="bldr-section-title" style={{ marginTop: 14 }}>Identity</div>
            <div className="field">
              <label>Icon</label>
              <input maxLength={4} placeholder="PRD" value={draft.icon ?? ""} onChange={(e) => setDraft({ ...draft, icon: e.target.value.toUpperCase() })} />
            </div>
            <div className="field">
              <label>Colour</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ICON_COLORS.map((c) => (
                  <div key={c} className={`color-swatch${c === draft.color ? " active" : ""}`} style={{ background: c }} title={c} onClick={() => setDraft({ ...draft, color: c })} />
                ))}
              </div>
            </div>
          </aside>

          <section className="bldr-canvas-wrap">
            <div className="bldr-toolbar">
              <div className="bldr-toolbar-group">
                <button className="btn small" disabled={!canGroup} title="Group selected as flex column" onClick={() => doGroup("col")}>⬇ Column</button>
                <button className="btn small" disabled={!canGroup} title="Group selected as flex row" onClick={() => doGroup("row")}>➡ Row</button>
                <button className="btn small" disabled={!canGroup} title="Group selected as grid" onClick={() => doGroup("grid")}>▦ Grid</button>
                <button className="btn small" disabled={!(single && isGroup(single))} title="Ungroup" onClick={doUngroup}>⤺ Ungroup</button>
              </div>
              <div className="bldr-toolbar-group">
                <button className="btn small" disabled={!single} title="Move up" onClick={() => doMove("up")}>▲</button>
                <button className="btn small" disabled={!single} title="Move down" onClick={() => doMove("down")}>▼</button>
                <button className="btn small" disabled={!single} title="Duplicate" onClick={doDuplicate}>⎘</button>
                <button className="btn small" disabled={selection.length === 0} title="Delete" onClick={doDelete}>✕</button>
              </div>
              <div className="bldr-toolbar-group">
                <button className="btn small" disabled={past.current.length === 0} title="Undo (Ctrl/Cmd+Z)" onClick={undo}>↶ Undo</button>
                <button className="btn small" disabled={future.current.length === 0} title="Redo (Ctrl/Cmd+Shift+Z)" onClick={redo}>↷ Redo</button>
              </div>
              <div className="bldr-toolbar-spacer" />
              <div className="bldr-selection-info">
                {selection.length === 0 ? "Nothing selected" : single ? `Selected: ${isGroup(single) ? `group · ${single.layout ?? "col"}` : single.type}` : `${selection.length} nodes selected`}
              </div>
            </div>
            <div className="bldr-canvas" ref={canvasRef} onMouseDown={onCanvasMouseDown} style={{ position: "relative" }}>
              {draft.slots.length === 0 ? (
                <div className={`bldr-empty${dropTarget?.id === "__root" ? " drop-target" : ""}`} {...rootDrop}>Click a palette item or drag one here to start</div>
              ) : (
                <div
                  className={`bldr-root bldr-layout-${rootLayout}${dropTarget?.id === "__root" ? " drop-target" : ""}`}
                  style={bodyStyle(rootLayout, draft.rootAlign ?? "start", draft.rootGridCols ?? 2, Math.max(0, draft.rootGap ?? 8), Math.max(0, draft.rootPadding ?? 8))}
                  {...rootDrop}
                >
                  {draft.slots.map((s) => renderNode(s, rootLayout))}
                </div>
              )}
              {marqueeBox && <div className="bldr-marquee" style={{ display: "block", ...marqueeBox }} />}
            </div>
            <div className="bldr-canvas-hint">Click to select · Shift/Ctrl-click to multi-select · selection must share the same parent to group</div>
          </section>

          <aside className="bldr-props">
            <div className="bldr-section-title">Properties</div>
            {located.length === 0 ? (
              <>
                <div className="bldr-multi-info">Canvas container selected (root parent).</div>
                <div className="field"><label>Layout</label>
                  <select value={rootLayout} onChange={(e) => mutate((d) => { d.rootLayout = e.target.value as Layout; })}>
                    <option value="col">Flex column ⬇</option><option value="row">Flex row ➡</option><option value="grid">Grid ▦</option>
                  </select>
                </div>
                <div className="field"><label>Align</label>
                  <select value={draft.rootAlign ?? "start"} onChange={(e) => mutate((d) => { d.rootAlign = e.target.value as Align; })}>
                    <option value="start">Start (left/top)</option><option value="center">Centre</option><option value="end">End (right/bottom)</option>
                  </select>
                </div>
                <div className="field"><label>Gap</label>
                  <input type="number" min={0} max={48} value={draft.rootGap ?? 8} onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) mutate((d) => { d.rootGap = Math.max(0, Math.min(48, v)); }); }} />
                </div>
                <div className="field"><label>Padding</label>
                  <input type="number" min={0} max={64} value={draft.rootPadding ?? 8} onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) mutate((d) => { d.rootPadding = Math.max(0, Math.min(64, v)); }); }} />
                </div>
                {rootLayout === "grid" && (
                  <div className="field"><label>Columns</label>
                    <input type="number" min={2} max={6} value={draft.rootGridCols ?? 2} onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) mutate((d) => { d.rootGridCols = Math.max(2, Math.min(6, v)); }); }} />
                  </div>
                )}
              </>
            ) : located.length > 1 ? (
              <>
                <div className="bldr-multi-info">
                  <b>{located.length}</b> nodes selected{!commonParent(draft, selection) && <span style={{ color: "var(--warn)" }}> (different parents — cannot group)</span>}
                </div>
                <div className="bldr-prop-actions">
                  <button className="btn small" disabled>Duplicate</button>
                  <button className="btn small" style={{ color: "#e06060", borderColor: "#e06060" }} onClick={doDelete}>Delete</button>
                </div>
              </>
            ) : single && isGroup(single) ? (
              <>
                <div className="field"><label>Layout</label>
                  <select value={single.layout ?? "col"} onChange={(e) => mutate((d) => { const r = locate(single.id, d.slots); if (r && isGroup(r.slot)) r.slot.layout = e.target.value as Layout; })}>
                    <option value="col">Flex column ⬇</option><option value="row">Flex row ➡</option><option value="grid">Grid ▦</option>
                  </select>
                </div>
                <div className="field"><label>Align</label>
                  <select value={single.align ?? "start"} onChange={(e) => mutate((d) => { const r = locate(single.id, d.slots); if (r && isGroup(r.slot)) r.slot.align = e.target.value as Align; })}>
                    <option value="start">Start (left/top)</option><option value="center">Centre</option><option value="end">End (right/bottom)</option>
                  </select>
                </div>
                {single.layout === "grid" && (
                  <div className="field"><label>Columns</label>
                    <input type="number" min={2} max={6} value={single.gridCols ?? 2} onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) mutate((d) => { const r = locate(single.id, d.slots); if (r && isGroup(r.slot)) r.slot.gridCols = Math.max(2, Math.min(6, v)); }); }} />
                  </div>
                )}
                <div style={{ fontSize: 11, color: "var(--text-mute)", padding: "4px 0" }}>{single.children.length} child node(s)</div>
                <div className="bldr-prop-actions">
                  <button className="btn small" onClick={doDuplicate}>Duplicate</button>
                  <button className="btn small" style={{ color: "#e06060", borderColor: "#e06060" }} onClick={doDelete}>Delete</button>
                </div>
              </>
            ) : single ? (
              <>
                <div className="field"><label>Type</label>
                  <select value={single.type} onChange={(e) => mutate((d) => { const r = locate(single.id, d.slots); if (r) r.slot.type = e.target.value; })}>
                    {LEAF_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field"><label>Label</label>
                  <input
                    value={"label" in single ? (single.label ?? "") : ""}
                    placeholder={single.type === "button-row" ? "Comma-separated labels" : single.type === "text" ? "Text content" : "Label"}
                    onChange={(e) => mutate((d) => { const r = locate(single.id, d.slots); if (r && "label" in r.slot) r.slot.label = e.target.value; })}
                  />
                </div>
                <div className="bldr-prop-actions">
                  <button className="btn small" onClick={doDuplicate}>Duplicate</button>
                  <button className="btn small" style={{ color: "#e06060", borderColor: "#e06060" }} onClick={doDelete}>Delete</button>
                </div>
              </>
            ) : null}
          </aside>
        </div>
      </div>
    </Drawer>
  );
}
