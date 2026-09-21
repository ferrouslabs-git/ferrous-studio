// One requirement inside a sprint card on the release page: its agent-queue
// rank, ▲▼ to reorder, ↩ back to the backlog, and draggable to another sprint
// or the backlog. Only Todo items are numbered -- that is the queue an agent
// actually walks; anything claimed or done shows a dot instead of a rank.
// Ported from the reference app's spRow() (static/js/sprints.js).
import { useRef } from "react";
import { useBoard } from "../board/boardData";
import { sameRef } from "../board/boardModel";
import { useBoardMutations } from "../board/boardMutations";
import { StatusChip } from "../board/chips";
import { useDraggable } from "../board/dnd";
import { fmtEffort } from "../board/effort";
import type { Requirement } from "../board/requirementsApi";
import type { Sprint } from "../board/sprintsApi";

interface SprintRequirementRowProps {
  sprint: Sprint;
  requirement: Requirement;
  /** Position among the sprint's Todo items (0-based), or -1 when not queued. */
  queueIndex: number;
  queueLength: number;
  onOpen: (r: Requirement) => void;
}

export function SprintRequirementRow({ sprint, requirement: r, queueIndex: i, queueLength, onOpen }: SprintRequirementRowProps) {
  const { index, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const ref = useRef<HTMLDivElement>(null);
  const done = !!sprint.closed_at;
  const draggable = canWrite && !done;
  const dragging = useDraggable(ref, draggable ? { kind: "requirement", id: r.id, from: sprint.id } : null);

  // A requirement whose release is not this sprint's is still shown (it IS
  // in the sprint) but says so, rather than silently blending in.
  const rrel = index.effectiveReleaseId(r);
  const stray = !sameRef(rrel, sprint.release_id);
  const strayId = rrel ? index.releaseById.get(rrel)?.human_id ?? rrel : null;

  return (
    <div
      ref={ref}
      className={`hrow sp-row${draggable ? " sp-drag" : ""}${dragging ? " dragging" : ""}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onOpen(r);
      }}
    >
      <span className="k sp-pos">{i >= 0 ? i + 1 : "·"}</span>
      <span className="k">{r.human_id}</span>
      <span className="t">{r.title}</span>
      {stray && (
        <span className="bchip k sp-stray" title={`this requirement's release is ${strayId ?? "none"}, not this sprint's`}>
          {strayId ?? "no release"}
        </span>
      )}
      <span className={`est-sum${r.estimate_hours == null ? " est-partial" : ""}`}>{fmtEffort(r.estimate_hours)}</span>
      <span className="r">
        <StatusChip status={r.status} />
      </span>
      {canWrite && i >= 0 && (
        <>
          <button
            type="button"
            className="btn mini-x sp-up"
            title="earlier"
            disabled={i === 0}
            onClick={(e) => {
              e.stopPropagation();
              void mutations.reorderQueue(sprint.id, r, i).catch(() => {});
            }}
          >
            ▲
          </button>
          <button
            type="button"
            className="btn mini-x sp-down"
            title="later"
            disabled={i === queueLength - 1}
            onClick={(e) => {
              e.stopPropagation();
              void mutations.reorderQueue(sprint.id, r, i + 2).catch(() => {});
            }}
          >
            ▼
          </button>
        </>
      )}
      {canWrite && !done && (
        <button
          type="button"
          className="btn mini-x sp-out"
          title="back to the backlog"
          onClick={(e) => {
            e.stopPropagation();
            void mutations.moveRequirementToSprint(r, null).catch(() => {});
          }}
        >
          ↩
        </button>
      )}
    </div>
  );
}
