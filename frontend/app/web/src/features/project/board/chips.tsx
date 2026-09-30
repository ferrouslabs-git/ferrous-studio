// The small labelled pieces every board page is built from: id chips,
// status chips, due chips, effort figures, progress bars, the comment
// button. Class names are scoped by board.css under .board-page and
// .board-drawer; the hue system is one --c custom property per status.
import type { MouseEvent } from "react";
import type { Agent } from "./agentsApi";
import type { DueStatus } from "./boardModel";
import { DELIVERY_STATUS_LABEL, ST_LABEL } from "./constants";
import { effortSummary, type Rollup } from "./effort";
import { Icon } from "./icons";
import type { RequirementStatus } from "./requirementsApi";
import { DELIVERY_STATUSES, type DeliveryStatus } from "./sprintsApi";
import { useToastIfAny } from "./toast";
import { useEntityHref } from "./useGoTo";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Put a link on the clipboard: the id hyperlinked where rich text pastes, "id url" where only text does. */
async function copyLink(id: string, url: string): Promise<void> {
  const text = `${id} ${url}`;
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([`<a href="${escapeHtml(url)}">${escapeHtml(id)}</a>`], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return;
    } catch {
      // Rich clipboard refused (some browsers, some permissions): plain text will do.
    }
  }
  await navigator.clipboard.writeText(text);
}

// An item's board id (IA-REL1, IA-F3, IA-REQ-12) -- the name people use for
// it in a conversation, a commit or a ticket. A click copies a link to it:
// pasted, the id opens the item where it is read in context (a requirement in
// its epic). Given no `of`, or an item with nowhere to link to, it copies the
// bare id. It sits inside rows that open or navigate on click, and the copy
// must not do that too; being a button, it is also never where a row's drag
// starts (dnd.ts refuses those). `bare` drops the chip styling for the id
// column of a list row, which keeps its own look.
export function IdChip({ children: id, of, bare = false }: { children: string; of?: { type: string; id: string }; bare?: boolean }) {
  const toast = useToastIfAny();
  const hrefFor = useEntityHref();
  const path = of ? hrefFor(of.type, of.id) : null;
  const copy = (e: MouseEvent) => {
    e.stopPropagation();
    if (!navigator.clipboard) return;
    const done = path ? copyLink(id, window.location.origin + path) : navigator.clipboard.writeText(id);
    done.then(
      () => toast?.(path ? `Link to ${id} copied` : `${id} copied`),
      () => toast?.(`Couldn't copy ${id}`, { type: "err" }),
    );
  };
  return (
    <button
      type="button"
      className={bare ? "k idchip" : "bchip k idchip"}
      title={path ? `copy a link to ${id}` : `copy ${id}`}
      onClick={copy}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {id}
    </button>
  );
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
