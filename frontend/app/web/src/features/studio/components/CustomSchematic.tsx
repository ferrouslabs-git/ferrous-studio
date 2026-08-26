// Low-fi preview of a custom component definition, ported from
// schematics.global.js renderCustomSchematicHtml. Shared by the canvas and
// the builder's leaf previews.
import { CSSProperties } from "react";
import { CustomDef, Slot } from "../model/actions";

type Align = "start" | "center" | "end";
const justify = (a: Align) => (a === "center" ? "center" : a === "end" ? "flex-end" : "flex-start");
const items = (a: Align) => (a === "center" ? "center" : a === "end" ? "end" : "start");

function groupStyle(layout: string, align: Align, gridCols: number, gap = 8, padding = 0): CSSProperties {
  if (layout === "grid") {
    return { display: "grid", gap, padding, gridTemplateColumns: `repeat(${gridCols}, 1fr)`, justifyItems: items(align) };
  }
  if (layout === "row") {
    return { display: "flex", flexDirection: "row", gap, padding, alignItems: "center", justifyContent: justify(align), flexWrap: "wrap" };
  }
  return { display: "flex", flexDirection: "column", gap: gap === 8 && padding === 0 ? 6 : gap, padding, alignItems: justify(align) };
}

function SlotView({ s, def }: { s: Slot; def: CustomDef }) {
  if (s.type === "group") {
    const g = s as Extract<Slot, { type: "group" }>;
    return (
      <div style={groupStyle(g.layout ?? "col", g.align ?? "start", g.gridCols ?? 2)}>
        {g.children.map((c) => (
          <SlotView key={c.id} s={c} def={def} />
        ))}
      </div>
    );
  }
  const label = "label" in s ? (s.label ?? "") : "";
  switch (s.type) {
    case "text":
      return <div className="sk-bar dim" style={{ width: "80%" }} />;
    case "heading":
      return <div className="sk-bar" style={{ width: "58%", height: 12 }} />;
    case "label":
      return <div className="sk-bar dim" style={{ width: "38%", height: 8 }} />;
    case "image":
      return <div style={{ width: "min(680px,100%)", height: 200, background: "var(--skeleton)", borderRadius: 6 }} />;
    case "action":
    case "button":
      return <span className="sk-pill accent">{label || "Action"}</span>;
    case "list":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="sk-bar dim" style={{ width: "90%" }} />
          ))}
        </div>
      );
    case "badge":
      return (
        <span className="sk-pill" style={{ background: `${def.color ?? "var(--skeleton-dim)"}22`, color: def.color ?? "var(--accent)" }}>
          {label || "Badge"}
        </span>
      );
    case "input":
      return <div className="sk-input" style={{ width: "min(420px,100%)", height: 30 }} />;
    case "divider":
      return <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />;
    case "row":
      return (
        <div className="sk-row" style={{ gap: 8 }}>
          <div className="sk-bar" style={{ width: "28%", height: 8 }} />
          <div className="sk-bar dim" style={{ width: "28%", height: 8 }} />
          <span className="sk-pill accent" style={{ marginLeft: "auto" }}>
            {label || "Action"}
          </span>
        </div>
      );
    case "button-row": {
      const labels = (label || "Cancel, Save").split(",").map((x) => x.trim()).filter(Boolean);
      return (
        <div className="sk-row" style={{ gap: 6, justifyContent: "flex-end" }}>
          {labels.map((t, i) => (
            <span key={i} className={`sk-pill${i === labels.length - 1 ? " accent" : ""}`}>
              {t}
            </span>
          ))}
        </div>
      );
    }
    default:
      return <div className="sk-bar dim" style={{ width: "70%" }} />;
  }
}

export function CustomSchematic({ def }: { def: CustomDef }) {
  const layout = def.rootLayout ?? "col";
  const align = def.rootAlign ?? "start";
  const gap = Math.max(0, Number(def.rootGap ?? 8));
  const padding = Math.max(0, Number(def.rootPadding ?? 8));
  const root: CSSProperties =
    layout === "grid"
      ? { display: "grid", gap, padding, gridTemplateColumns: `repeat(${def.rootGridCols ?? 2}, minmax(180px,1fr))`, justifyItems: items(align) }
      : layout === "row"
        ? { display: "flex", flexDirection: "row", gap, padding, flexWrap: "wrap", justifyContent: justify(align), alignItems: "flex-start" }
        : { display: "flex", flexDirection: "column", gap, padding, alignItems: justify(align) };
  const color = def.color ?? "var(--accent)";
  return (
    <div style={root}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--mono)",
            fontSize: 10,
            fontWeight: 700,
            background: def.color ? `${def.color}22` : "var(--accent-soft)",
            color,
            border: `1px solid ${color}`,
          }}
        >
          {(def.icon ?? "CMP").slice(0, 3).toUpperCase()}
        </div>
        <div className="sk-bar" style={{ width: 100, height: 10 }} />
      </div>
      {def.slots.map((s) => (
        <SlotView key={s.id} s={s} def={def} />
      ))}
    </div>
  );
}
