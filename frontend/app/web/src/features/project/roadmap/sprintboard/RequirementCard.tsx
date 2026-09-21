// One card on the sprint board: id, priority and estimate on the top line,
// the title, the epic and feature it came from, and the move buttons that
// walk Not started → In progress → To test → Done. Blocked is a flag you set
// from any of those and clear back to where it was (blocked_from). Draggable
// between lanes; a click opens the drawer.
//
// A sprint draws its work from anywhere on the board, so where a card came
// from is not otherwise on screen -- the scope line under the title is the
// only place the lanes say it.
import { useRef } from "react";
import { useBoard } from "../../board/boardData";
import { SB_STAGES, ST_LABEL } from "../../board/constants";
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
  const epicId = index.effectiveEpicId(r);
  const epic = epicId ? index.epicById.get(epicId) ?? null : null;
  const feature = r.feature_id ? index.featureById.get(r.feature_id) ?? null : null;

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
        {r.human_id} · <span className={`pri-${r.priority}`}>{r.priority}</span>
        {r.estimate_hours != null ? ` · ${fmtEffort(r.estimate_hours)}` : ""}
      </div>
      <div className="sb-ttl">{r.title}</div>
      <div className="sb-scope">
        <span className="sb-scope-epic" title={epic ? `${epic.human_id} · ${epic.title}` : "in no epic"}>
          {epic ? epic.title : "No epic"}
        </span>
        {feature && (
          <span className="sb-scope-feature" title={`${feature.human_id} · ${feature.title}`}>
            {feature.title}
          </span>
        )}
      </div>
      <div className="mv">
        {canMove && r.status === "Blocked" && move("▶ Unblock", { status: r.blocked_from || "NotStarted" })}
        {canMove && r.status !== "Blocked" && (
          <>
            {i > 0 && move(`◀ ${ST_LABEL[SB_STAGES[i - 1]]}`, { status: SB_STAGES[i - 1] })}
            {i >= 0 && i < SB_STAGES.length - 1 && move(`${ST_LABEL[SB_STAGES[i + 1]]} ▶`, { status: SB_STAGES[i + 1] })}
            {r.status !== "Done" && move("⛔ Block", { status: "Blocked" }, "blockbtn")}
          </>
        )}
      </div>
    </div>
  );
}
