// Left panel: screen patterns, components (with shell families), and the
// project's custom components. Ported from render.global.js renderLibrary.
import { CSSProperties, ReactNode } from "react";
import { COMPONENT_FAMILIES, COMPONENT_TYPES, PATTERNS } from "../catalog";
import { CustomDef } from "../model/actions";
import { STRUCTURAL_TYPES } from "../model/regions";
import { DragPayload, setPayload } from "./dnd";

export type LibTab = "patterns" | "components" | "custom";

interface Props {
  tab: LibTab;
  onTab(tab: LibTab): void;
  customComponents: readonly CustomDef[];
  canWrite: boolean;
  onApplyPattern(id: string): void;
  onAddComponent(type: string, customId?: string): void;
  onNewCustom(): void;
  onEditCustom(id: string): void;
}

function LibItem({
  icon, name, desc, meta, drag, onClick, canWrite, iconStyle, extra,
}: {
  icon: string; name: string; desc: string; meta: string; drag: DragPayload; onClick(): void; canWrite: boolean;
  iconStyle?: CSSProperties; extra?: ReactNode;
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
      <div>
        <div className="lib-name">{name}</div>
        <div className="lib-desc">{desc}</div>
        <div className="lib-meta">{meta}</div>
      </div>
      {extra}
    </div>
  );
}

const PATTERN_GROUPS = ["Starter", "Top Nav", "Left Panel", "Right Panel", "Full Shell"];

export function Library({ tab, onTab, customComponents, canWrite, onApplyPattern, onAddComponent, onNewCustom, onEditCustom }: Props) {
  let body: ReactNode;

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
              meta={p.components.join(" · ")}
              drag={{ kind: "pattern", id: p.id }}
              onClick={() => onApplyPattern(p.id)}
              canWrite={canWrite}
            />
          ))}
        </div>
      );
    });
  } else if (tab === "components") {
    const groups = new Map<string, [string, (typeof COMPONENT_TYPES)[string]][]>();
    for (const [type, info] of Object.entries(COMPONENT_TYPES)) {
      if (STRUCTURAL_TYPES.has(type)) continue; // shell chrome lives under Shell below
      groups.set(info.group, [...(groups.get(info.group) ?? []), [type, info]]);
    }
    body = (
      <>
        <div className="group-title">Shell</div>
        {COMPONENT_FAMILIES.flatMap((fam) =>
          fam.variants.map((v) => (
            <LibItem
              key={v.type}
              icon={v.icon}
              name={`${fam.name} · ${v.name}`}
              desc={v.desc}
              meta={`${v.type} → ${fam.region}`}
              drag={{ kind: "component", type: v.type }}
              onClick={() => onAddComponent(v.type)}
              canWrite={canWrite}
            />
          )),
        )}
        {[...groups.entries()].map(([group, items]) => (
          <div key={group}>
            <div className="group-title">{group}</div>
            {items.map(([type, info]) => (
              <LibItem
                key={type}
                icon={type.slice(0, 3).toUpperCase()}
                name={info.label}
                desc={info.desc}
                meta={type}
                drag={{ kind: "component", type }}
                onClick={() => onAddComponent(type)}
                canWrite={canWrite}
              />
            ))}
          </div>
        ))}
      </>
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
      <div className="tabs">
        {(["patterns", "components", "custom"] as LibTab[]).map((t) => (
          <div key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => onTab(t)}>
            {t === "patterns" ? "Screen patterns" : t === "components" ? "Components" : "My components"}
          </div>
        ))}
      </div>
      <div className="panel-body">{body}</div>
    </aside>
  );
}
