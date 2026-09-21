// The small labelled pieces every board page is built from: id chips,
// status chips, due chips, effort figures, progress bars, the comment
// button. Class names are scoped by board.css under .board-page and
// .board-drawer; the hue system is one --c custom property per status.
import { ReactNode } from "react";
import type { Agent } from "./agentsApi";
import type { DueStatus } from "./boardModel";
import { DELIVERY_STATUS_LABEL, ST_LABEL } from "./constants";
import { effortSummary, type Rollup } from "./effort";
import { Icon } from "./icons";
import type { RequirementStatus } from "./requirementsApi";
import { DELIVERY_STATUSES, type DeliveryStatus } from "./sprintsApi";

export function IdChip({ children }: { children: ReactNode }) {
  return <span className="bchip k">{children}</span>;
}

export function StatusChip({ status }: { status: RequirementStatus }) {
  return <span className={`bchip st st-${status}`}>{ST_LABEL[status] ?? status}</span>;
}

// An epic's or a feature's status, which is rolled up from the requirements
// under it and cannot be set. Same hues as a requirement's -- it is the same
// vocabulary -- but never a control, and the title says why.
export function RolledUpStatusChip({ status, of }: { status: RequirementStatus; of: "epic" | "feature" }) {
  return (
    <span className={`bchip st rolled st-${status}`} title={`rolled up from this ${of}'s requirements`}>
      {ST_LABEL[status] ?? status}
    </span>
  );
}

export function DeliveryStatusChip({ status }: { status: DeliveryStatus }) {
  return <span className={`bchip dl dl-${status}`}>{DELIVERY_STATUS_LABEL[status] ?? status}</span>;
}

// A sprint's or a release's delivery status, as a control. Every value is
// always offered: the set is non-linear on purpose, so there is no "next"
// and nothing is ever greyed out for being backwards.
export function DeliveryStatusSelect({
  status,
  onChange,
  disabled,
  label,
}: {
  status: DeliveryStatus;
  onChange: (next: DeliveryStatus) => void;
  disabled?: boolean;
  label?: string;
}) {
  if (disabled) return <DeliveryStatusChip status={status} />;
  return (
    <select
      className={`mini dl-select dl-${status}`}
      aria-label={label ?? "delivery status"}
      value={status}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as DeliveryStatus)}
    >
      {DELIVERY_STATUSES.map((s) => (
        <option key={s} value={s}>
          {DELIVERY_STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

export function AgentChip({ agent }: { agent: Agent }) {
  const title = `${agent.name} · ${agent.status}${agent.current_requirement_id ? " · working" : ""}`;
  return (
    <span className={`bchip ag-${agent.status}`} title={title}>
      {agent.status}
    </span>
  );
}

export function DueChip({ due }: { due: DueStatus }) {
  return (
    <span className={`due ${due.cls}`} title={due.label}>
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
export function CommentButton({ count, onClick }: { count?: number | null; onClick: () => void }) {
  const n = count ?? 0;
  return (
    <button
      type="button"
      className={`btn mini-x${n ? "" : " cmt-zero"}`}
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
