// One lane of the sprint board: a status heading with its count, the cards
// in queue order, and a drop target for a card from another lane. Blocked is
// a flag rather than a stage on the normal path, but it is a lane here so
// blocked work is seen, not hidden behind a badge.
//
// The count is what the lane SHOWS. When the board's filter is hiding some
// of it the heading says so too, so a lane that reads "2" is never mistaken
// for a lane that holds two.
import { useRef } from "react";
import { useBoard } from "../../board/boardData";
import { ST_ICON, ST_LABEL } from "../../board/constants";
import { useDropTarget } from "../../board/dnd";
import type { Requirement, RequirementPatch, RequirementStatus } from "../../board/requirementsApi";
import { RequirementCard } from "./RequirementCard";

interface KanbanLaneProps {
  status: RequirementStatus;
  requirements: Requirement[];
  /** How many of this lane's cards the board filter is hiding. */
  hidden: number;
  /** False once the sprint is done or the viewer cannot write: no drags, drops or move buttons. */
  canMove: boolean;
  onMove: (r: Requirement, patch: RequirementPatch) => void;
  onOpen: (r: Requirement) => void;
}

export function KanbanLane({ status, requirements, hidden, canMove, onMove, onOpen }: KanbanLaneProps) {
  const { index } = useBoard();
  const ref = useRef<HTMLDivElement>(null);
  const over = useDropTarget(ref, {
    accepts: (d) => d.kind === "card" && d.from !== status,
    onDrop: (d) => {
      const r = index.requirementById.get(d.id);
      if (!r || r.status === status) return;
      // The server stamps blocked_from on a move INTO Blocked and clears it on
      // the way out, so the patch is the status alone either way.
      onMove(r, { status });
    },
    disabled: !canMove,
  });

  return (
    <div ref={ref} className={`sb-col${over ? " is-over" : ""}`}>
      <h4>
        {ST_ICON[status]} {ST_LABEL[status]} · {requirements.length}
        {hidden > 0 && <span className="sb-col-hidden"> (+{hidden} hidden)</span>}
      </h4>
      <div className="cards">
        {requirements.map((r) => (
          <RequirementCard key={r.id} requirement={r} canMove={canMove} onMove={onMove} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
