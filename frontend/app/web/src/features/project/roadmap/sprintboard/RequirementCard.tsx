// One card on the sprint board: id, epic, priority and estimate on the top
// line, the title, and the move buttons that walk Todo → Doing → Review →
// Done. Blocked is a flag you set from any of those and clear back to where
// it was (blocked_from). Draggable between lanes; a click opens the drawer.
import { useRef } from "react";
import { useBoard } from "../../board/boardData";
import { SB_STAGES } from "../../board/constants";
import { useDraggable } from "../../board/dnd";
import { fmtEffort } from "../../board/effort";
import type { Requirement, RequirementPatch } from "../../board/requirementsApi";

interface RequirementCardProps {
  requirement: Requirement;
  canMove: boolean;
  onMove: (r: Requirement, patch: RequirementPatch) => void;
  onOpen: (r: Requirement) => void;
}

export function RequirementCard({ requirement: r, canMove, onMove, onOpen }: RequirementCardProps) {
  const { index } = useBoard();
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useDraggable(ref, canMove ? { kind: "card", id: r.id, from: r.status } : null);

  // Each move button is its own gesture, never the card's click.
  const move = (label: string, patch: RequirementPatch, className?: string) => (
    <button
      type="button"
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        onMove(r, patch);
      }}
    >
      {label}
    </button>
  );
  const i = SB_STAGES.indexOf(r.status);

  return (
    <div ref={ref} className={`reqcard${dragging ? " dragging" : ""}`} onClick={() => onOpen(r)}>
      <div className="k">
        {r.human_id} · {index.epicName(index.effectiveEpicId(r))} · <span className={`pri-${r.priority}`}>{r.priority}</span>
        {r.estimate_hours != null ? ` · ${fmtEffort(r.estimate_hours)}` : ""}
      </div>
      <div className="sb-ttl">{r.title}</div>
      <div className="mv">
        {canMove && r.status === "Blocked" && move("▶ Unblock", { status: r.blocked_from || "Todo" })}
        {canMove && r.status !== "Blocked" && (
          <>
            {i > 0 && move(`◀ ${SB_STAGES[i - 1]}`, { status: SB_STAGES[i - 1] })}
            {i >= 0 && i < SB_STAGES.length - 1 && move(`${SB_STAGES[i + 1]} ▶`, { status: SB_STAGES[i + 1] })}
            {r.status !== "Done" && move("⛔ Block", { status: "Blocked" }, "blockbtn")}
          </>
        )}
      </div>
    </div>
  );
}
