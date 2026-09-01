// The thin strip a collapsed side panel leaves behind: click anywhere on it
// to bring the panel back. Same idea as the app shell's sidebar rail.
export function PanelRail({ side, label, shortcut, onExpand }: { side: "left" | "right"; label: string; shortcut: string; onExpand(): void }) {
  return (
    <button
      type="button"
      className={`panel-rail ${side}`}
      title={`Expand ${label.toLowerCase()} (${shortcut})`}
      aria-label={`Expand ${label} panel`}
      onClick={onExpand}
    >
      <span className="panel-rail-chevron" aria-hidden="true">{side === "left" ? "›" : "‹"}</span>
      <span className="panel-rail-label">{label}</span>
    </button>
  );
}

/** Collapse button for a panel header; the rail above is its counterpart. */
export function PanelCollapse({ side, label, shortcut, onCollapse }: { side: "left" | "right"; label: string; shortcut: string; onCollapse(): void }) {
  return (
    <button
      type="button"
      className="panel-collapse"
      title={`Collapse ${label.toLowerCase()} (${shortcut})`}
      aria-label={`Collapse ${label} panel`}
      onClick={onCollapse}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
