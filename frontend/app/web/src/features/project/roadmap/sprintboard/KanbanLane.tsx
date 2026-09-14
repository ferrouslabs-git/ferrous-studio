// One lane of the sprint board: a status heading with its count, the cards
// in queue order, and a drop target for a card from another lane. Blocked is
// a flag rather than a stage on the normal path, but it is a lane here so
// blocked work is seen, not hidden behind a badge.
import { useRef } from "react";
import { useBoard } from "../../board/boardData";
import { ST_ICON } from "../../board/constants";
import { useDropTarget } from "../../board/dnd";
import type { Requirement, RequirementPatch, RequirementStatus } from "../../board/requirementsApi";
import { RequirementCard } from "./RequirementCard";

interface KanbanLaneProps {
  status: RequirementStatus;
  requirements: Requirement[];
  /** False once the sprint is done or the viewer cannot write: no drags, drops or move buttons. */
  canMove: boolean;
  onMove: (r: Requirement, patch: RequirementPatch) => void;
  onOpen: (r: Requirement) => void;
}

export function KanbanLane({ status, requirements, canMove, onMove, onOpen }: KanbanLaneProps) {
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
        {ST_ICON[status]} {status} · {requirements.length}
      </h4>
      <div className="cards">
        {requirements.map((r) => (
          <RequirementCard key={r.id} requirement={r} canMove={canMove} onMove={onMove} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}
