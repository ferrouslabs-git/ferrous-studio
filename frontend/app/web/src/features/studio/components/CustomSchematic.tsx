// Canvas rendering of a custom component definition: each slot draws as the
// real element it stands for, using the labels the user gave it in the
// builder. (The builder has its own leaf previews in Builder.tsx.)
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

const splitList = (label: string, fallback: string[]) => {
  const parts = label.split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : fallback;
};

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
      return <p className="ui-p">{label || "Lorem ipsum dolor sit amet, consectetur adipiscing."}</p>;
    case "heading":
      return <h3 className="ui-h2">{label || "Heading"}</h3>;
    case "label":
      return <span className="ui-label tight">{label || "Label"}</span>;
    case "image":
      return <div className="ui-image" aria-label={label || "Image"} />;
    case "action":
    case "button":
      return <span className="ui-btn primary">{label || "Action"}</span>;
    case "list":
      return (
        <ul className="ui-list">
          {splitList(label, ["First item", "Second item", "Third item"]).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      );
    case "badge":
      return (
        <span className="ui-badge" style={def.color ? { background: `${def.color}22`, color: def.color } : undefined}>
          {label || "Badge"}
        </span>
      );
    case "input":
      return (
        <div className="ui-field">
          {label && <label className="ui-label">{label}</label>}
          <div className="ui-input ui-input-wide">
            <span className="ui-placeholder">{label ? `Enter ${label.toLowerCase()}` : "Type here…"}</span>
          </div>
        </div>
      );
    case "divider":
      return <hr className="ui-divider" />;
    case "row":
      return (
        <div className="ui-row between">
          <span className="ui-p strong">{label || "Row item"}</span>
          <span className="ui-btn sm">Action</span>
        </div>
      );
    case "button-row":
      return (
        <div className="ui-row end">
          {splitList(label, ["Cancel", "Save"]).map((t, i, all) => (
            <span key={i} className={`ui-btn${i === all.length - 1 ? " primary" : ""}`}>
              {t}
            </span>
          ))}
        </div>
      );
    default:
      return <p className="ui-p">{label || s.type}</p>;
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
  return (
    <div className="ui-custom" style={root}>
      {def.slots.map((s) => (
        <SlotView key={s.id} s={s} def={def} />
      ))}
    </div>
  );
}
