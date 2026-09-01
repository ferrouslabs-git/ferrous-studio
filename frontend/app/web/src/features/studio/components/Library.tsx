// Left panel: screen patterns, components (with shape variants), the
// elements of the selected component, and the project's custom components.
//
// Two classes of library item: components stand alone in a region; elements
// only ever drop into a compatible component. The Elements tab is contextual
// — it shows the vocabulary of the component selected on the canvas.
import { CSSProperties, ReactNode } from "react";
import { ComponentMeta, COMPONENTS, PATTERNS, patternComponents } from "../catalog";
import { CustomDef } from "../model/actions";
import { DragPayload, setPayload } from "./dnd";
import { PanelCollapse } from "./PanelRail";

export type LibTab = "patterns" | "components" | "elements" | "custom";

interface Props {
  tab: LibTab;
  onTab(tab: LibTab): void;
  customComponents: readonly CustomDef[];
  /** Type of the component selected on the canvas (contextual Elements tab). */
  selectedCmpType: string | null;
  canWrite: boolean;
  onApplyPattern(id: string): void;
  onAddComponent(type: string, customId?: string, shape?: string): void;
  onAddElement(type: string): void;
  onNewCustom(): void;
  onEditCustom(id: string): void;
  onCollapse(): void;
}

function LibItem({
  icon, name, desc, meta, drag, onClick, canWrite, iconStyle, extra, below,
}: {
  icon: string; name: string; desc: string; meta: string; drag: DragPayload; onClick(): void; canWrite: boolean;
  iconStyle?: CSSProperties; extra?: ReactNode; below?: ReactNode;
}) {
  return (
    <div
      className="lib-item"
      draggable={canWrite}
      onClick={canWrite ? onClick : undefined}
      onDragStart={(e) => {
        e.currentTarget.classList.add("dragging");
        setPayload(e, drag, "copy");
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove("dragging")}
      style={{ position: "relative" }}
    >
      <div className="lib-icon" style={iconStyle}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="lib-name">{name}</div>
        <div className="lib-desc">{desc}</div>
        <div className="lib-meta">{meta}</div>
        {below}
      </div>
      {extra}
    </div>
  );
}

const PATTERN_GROUPS = ["Starter", "Top Nav", "Left Panel", "Right Panel", "Full Shell"];
/** The six primary components lead; the kept content blocks follow. */
const PRIMARY = ["navbar", "list", "form", "graph", "canvas", "calendar"];

export function Library({
  tab, onTab, customComponents, selectedCmpType, canWrite,
  onApplyPattern, onAddComponent, onAddElement, onNewCustom, onEditCustom, onCollapse,
}: Props) {
  let body: ReactNode;

  const componentItem = (meta: ComponentMeta) => (
    <LibItem
      key={meta.type}
      icon={meta.icon}
      name={meta.label}
      desc={meta.desc}
      meta={meta.layouts.length ? meta.layouts.map((l) => l.label.toLowerCase()).join(" · ") : meta.type}
      drag={{ kind: "component", type: meta.type }}
      onClick={() => onAddComponent(meta.type)}
      canWrite={canWrite}
      below={
        meta.shapes.length > 1 ? (
          <div className="lib-shapes">
            {meta.shapes.map((s) => (
              <span
                key={s.id}
                className="lib-shape"
                title={s.desc ?? `${meta.label} · ${s.label}`}
                draggable={canWrite}
                onClick={
                  canWrite
                    ? (e) => {
                        e.stopPropagation();
                        onAddComponent(meta.type, undefined, s.id);
                      }
                    : undefined
                }
                onDragStart={(e) => {
                  e.stopPropagation();
                  setPayload(e, { kind: "component", type: meta.type, shape: s.id }, "copy");
                }}
              >
                {s.label}
              </span>
            ))}
          </div>
        ) : null
      }
    />
  );

  if (tab === "patterns") {
    const grouped = new Map<string, typeof PATTERNS>();
    for (const p of PATTERNS) grouped.set(p.group, [...(grouped.get(p.group) ?? []), p]);
    const order = [...PATTERN_GROUPS, ...[...grouped.keys()].filter((g) => !PATTERN_GROUPS.includes(g))];
    body = order.map((group) => {
      const items = grouped.get(group);
      if (!items?.length) return null;
      return (
        <div key={group}>
          <div className="group-title">{group}</div>
          {items.map((p) => (
            <LibItem
              key={p.id}
              icon={p.icon}
              name={p.name}
              desc={p.desc}
              meta={patternComponents(p.template).join(" · ") || "blank"}
              drag={{ kind: "pattern", id: p.id }}
              onClick={() => onApplyPattern(p.id)}
              canWrite={canWrite}
            />
          ))}
        </div>
      );
    });
  } else if (tab === "components") {
    const kept = Object.values(COMPONENTS).filter((c) => !PRIMARY.includes(c.type));
    body = (
      <>
        <div className="group-title">Components</div>
        {PRIMARY.map((type) => componentItem(COMPONENTS[type]))}
        <div className="group-title">Content blocks</div>
        {kept.map(componentItem)}
      </>
    );
  } else if (tab === "elements") {
    const meta = selectedCmpType ? COMPONENTS[selectedCmpType] : null;
    body = meta ? (
      <>
        <div className="group-title">Elements for {meta.label}</div>
        {meta.elements.map((e) => (
          <LibItem
            key={e.type}
            icon={e.icon}
            name={e.label}
            desc={e.desc}
            meta={e.dataFields.length ? e.dataFields.map((f) => f.label.toLowerCase()).join(" · ") : e.max === 1 ? "max 1" : e.type}
            drag={{ kind: "element", type: e.type }}
            onClick={() => onAddElement(e.type)}
            canWrite={canWrite}
          />
        ))}
        <div className="empty-hint" style={{ margin: 8 }}>
          Click to add to the selected {meta.label.toLowerCase()}, or drag onto any compatible component. Elements can't sit
          in a region on their own.
        </div>
      </>
    ) : (
      <div className="empty-hint" style={{ margin: 8 }}>
        Select a component on the canvas to see the elements it can hold — a list's columns, a form's fields, a nav bar's
        links.
      </div>
    );
  } else {
    body = (
      <>
        {canWrite && (
          <div style={{ padding: "10px 8px 4px" }}>
            <button className="btn" style={{ width: "100%" }} onClick={onNewCustom}>
              + New component
            </button>
          </div>
        )}
        {customComponents.length === 0 ? (
          <div className="empty-hint" style={{ margin: 8 }}>
            No custom components yet.{canWrite ? " Build one above." : ""}
          </div>
        ) : (
          customComponents.map((def) => (
            <LibItem
              key={def.id}
              icon={(def.icon ?? "CMP").slice(0, 3).toUpperCase()}
              name={def.name}
              desc={def.desc ?? ""}
              meta={`${def.slots.length} slot${def.slots.length !== 1 ? "s" : ""}`}
              drag={{ kind: "component", type: "custom", customId: def.id }}
              onClick={() => onAddComponent("custom", def.id)}
              canWrite={canWrite}
              iconStyle={def.color ? { color: def.color, borderColor: def.color, background: `${def.color}22` } : undefined}
              extra={
                canWrite ? (
                  <button
                    className="btn"
                    title="Edit"
                    style={{ position: "absolute", top: 6, right: 6, height: 20, width: 20, padding: 0, fontSize: 11 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditCustom(def.id);
                    }}
                  >
                    ✎
                  </button>
                ) : null
              }
            />
          ))
        )}
      </>
    );
  }

  return (
    <aside className="panel" id="leftPanel">
      {/* Same header row as the Inspector so both collapse buttons sit in the same place. */}
      <div className="panel-head">
        Library
        <PanelCollapse side="left" label="Library" shortcut="Ctrl/⌘+B" onCollapse={onCollapse} />
      </div>
      <div className="tabs">
        {(["patterns", "components", "elements", "custom"] as LibTab[]).map((t) => (
          <div key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => onTab(t)}>
            {t === "patterns" ? "Patterns" : t === "components" ? "Components" : t === "elements" ? "Elements" : "Mine"}
          </div>
        ))}
      </div>
      <div className="panel-body">{body}</div>
    </aside>
  );
}
