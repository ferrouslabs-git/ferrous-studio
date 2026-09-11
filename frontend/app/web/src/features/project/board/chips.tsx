// The small labelled pieces every board page is built from: id chips,
// status chips, due chips, effort figures, progress bars, the comment
// button. Class names are scoped by board.css under .board-page and
// .board-drawer; the hue system is one --c custom property per status.
import { ReactNode } from "react";
import type { Agent } from "./agentsApi";
import type { DueStatus } from "./boardModel";
import { EPIC_STATUS_LABEL, nextEpicStatus, ST_ICON } from "./constants";
import { effortSummary, type Rollup } from "./effort";
import type { EpicStatus } from "./epicsApi";
import { Icon } from "./icons";
import type { RequirementStatus } from "./requirementsApi";
import type { SprintState } from "./sprintsApi";

export function IdChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="bchip k" title={title}>
      {children}
    </span>
  );
}

export function StatusChip({ status, icon = false }: { status: RequirementStatus; icon?: boolean }) {
  return (
    <span className={`bchip st st-${status}`}>
      {icon ? `${ST_ICON[status]} ` : ""}
      {status}
    </span>
  );
}

// The epic lifecycle chip is a CONTROL when onAdvance is given: clicking it
// advances the status, and the caret plus title say so. Read-only copies
// leave onAdvance off.
export function EpicStatusChip({ status, onAdvance }: { status: EpicStatus; onAdvance?: () => void }) {
  const label = EPIC_STATUS_LABEL[status] ?? status;
  if (!onAdvance) return <span className={`bchip st st-${status}`}>{label}</span>;
  return (
    <button
      type="button"
      className={`bchip st adv st-${status}`}
      title={`click to advance lifecycle status → ${EPIC_STATUS_LABEL[nextEpicStatus(status)]}`}
      onClick={(e) => {
        e.stopPropagation();
        onAdvance();
      }}
    >
      {label}
    </button>
  );
}

export function SprintStateChip({ state }: { state: SprintState }) {
  return <span className={`bchip sp-${state}`}>{state}</span>;
}

export function AgentChip({ agent, compact = false }: { agent: Agent; compact?: boolean }) {
  const title = `${agent.name} · ${agent.status}${agent.current_requirement_id ? " · working" : ""}`;
  return compact ? (
    <i className={`tl-agent ag-${agent.status}`} title={title}>
      {agent.name}
    </i>
  ) : (
    <span className={`bchip ag-${agent.status}`} title={title}>
      {agent.status}
    </span>
  );
}

export function DueChip({ due, title }: { due: DueStatus; title?: string }) {
  return (
    <span className={`due ${due.cls}`} title={title ?? due.label}>
      {due.label}
    </span>
  );
}

// One span, so every effort figure looks the same wherever it lands. Renders
// nothing when there is nothing to sum.
export function EffortFigure({ rollup: p }: { rollup: Rollup }) {
  const s = effortSummary(p);
  if (!s.text) return null;
  return <span className={`est-sum${s.partial ? " est-partial" : ""}`}>{s.text}</span>;
}

export const ProgressFigure = ({ rollup: p }: { rollup: Rollup }) => (
  <span className="r">
    {p.done}/{p.total} · {p.pct}%
  </span>
);

// done / partial / planned as one segmented bar.
export function SegBar({ done, partial, total, width }: { done: number; partial: number; total: number; width?: number }) {
  const w = (x: number) => (total ? (100 * x) / total : 0);
  const planned = total - done - partial;
  return (
    <div
      className="segbar"
      style={width ? { width } : undefined}
      title={`✓ ${done} done · ◐ ${partial} in flight or review · ○ ${planned} planned`}
    >
      {done > 0 && <i className="seg-done" style={{ flex: w(done) }} />}
      {partial > 0 && <i className="seg-partial" style={{ flex: w(partial) }} />}
      {planned > 0 && <i style={{ flex: w(planned) }} />}
    </div>
  );
}

export function ProgressBar({ pct, over = false, title, className }: { pct: number; over?: boolean; title?: string; className?: string }) {
  return (
    <div className={`prog${className ? ` ${className}` : ""}`} title={title}>
      <div className={`prog-fill${over ? " over" : ""}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

// The comments button on a card or row. A zero count hides until the card is
// hovered (board.css .cmt-zero); an unknown count shows the icon alone.
export function CommentButton({
  count,
  onClick,
  className,
}: {
  count?: number | null;
  onClick: () => void;
  className?: string;
}) {
  const n = count ?? 0;
  return (
    <button
      type="button"
      className={`btn mini-x cmt-btn${n ? "" : " cmt-zero"}${className ? ` ${className}` : ""}`}
      title="comments"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon name="message" small />
      {n ? ` ${n}` : ""}
    </button>
  );
}
