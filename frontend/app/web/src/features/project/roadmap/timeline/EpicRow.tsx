// One epic row inside a release card (release given) or the Unassigned card
// (release null). Its bar spans the sprints holding its requirements; with
// nothing scheduled it says so in the track rather than getting an invented
// date. Drag the row onto another card to move it, or ⇄ -- a drag has no
// keyboard story, so the button is not optional. Ported from the reference
// app's tlEpicRow and tlMoveEpic (static/js/timeline.js).
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useBoard } from "../../board/boardData";
import { releaseDate, releaseDue } from "../../board/boardModel";
import { useBoardMutations } from "../../board/boardMutations";
import { useDialogs } from "../../board/dialogs";
import { useDraggable } from "../../board/dnd";
import { effortSummary, rollup } from "../../board/effort";
import type { Epic } from "../../board/epicsApi";
import { Icon } from "../../board/icons";
import type { Release } from "../../board/releasesApi";
import { TimelineRow } from "./TimelineRow";
import { epicExtent, isLate, tlBarStyle, type TimeWindow } from "./timelineMath";

interface EpicRowProps {
  epic: Epic;
  /** The card's release, for the late check; null on the Unassigned card. */
  release: Release | null;
  w: TimeWindow | null;
}

export function EpicRow({ epic, release, w }: EpicRowProps) {
  const { data, index, paths, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useDraggable(ref, canWrite ? { kind: "epic", id: epic.id, from: release?.id ?? null } : null);

  const sprints = data?.sprints ?? [];
  const reqs = index.epicRequirements(epic.id);
  const eex = epicExtent(reqs, index.sprintById);
  const ep = rollup(reqs);
  const late = isLate(eex, release ? releaseDate(release, sprints) : null);

  const move = async () => {
    const items = index.releases
      .filter((r) => r.id !== epic.release_id)
      .map((r) => ({ value: r.id, label: `${r.human_id} · ${r.title}`, hint: releaseDue(r, sprints).label }));
    if (epic.release_id) items.push({ value: "__none__", label: "Unassigned", hint: "take it out of its release" });
    // The heading carries only the id; the title underneath lets the user
    // confirm which epic is being moved (the reference's uiPick message).
    const v = await dialogs.pick({ title: `Move ${epic.human_id} to…`, message: epic.title, items });
    if (!v) return;
    try {
      await mutations.assignEpicToRelease(epic.id, v === "__none__" ? null : v);
    } catch {
      // Already toasted by the mutation layer.
    }
  };

  return (
    <TimelineRow
      rowRef={ref}
      cls={`tl-epic${canWrite ? " tl-drag" : ""}`}
      className={dragging ? "dragging" : undefined}
      id={epic.id}
      pre={<Icon name="flag" small />}
      label={`${epic.human_id} · ${epic.title}`}
      onClick={(e) => {
        if ((e.target as Element).closest("button")) return;
        navigate(paths.epic(epic.id));
      }}
      meta={
        <>
          {/* The meta column is narrow: progress only, effort in its tooltip. */}
          <span className="tl-fig" title={effortSummary(ep).text || undefined}>
            {ep.done}/{ep.total} · {ep.pct}%
          </span>
          {canWrite && (
            <button
              type="button"
              className="btn mini-x tl-move"
              title={`move ${epic.human_id} to another release`}
              onClick={(e) => {
                e.stopPropagation();
                void move();
              }}
            >
              ⇄
            </button>
          )}
        </>
      }
    >
      {w && eex ? (
        <div
          className={`tl-bar tl-bar-epic${late ? " tl-overrun" : ""}`}
          style={tlBarStyle(w, eex.start, eex.end)}
          title={`${epic.title} — ${eex.sprints} sprint(s), ${eex.start} to ${eex.end}${late ? ", past the release target" : ""}`}
        >
          <span className="tl-fill" style={{ width: `${ep.pct}%` }} />
        </div>
      ) : (
        <span className="tl-nodate">no sprint yet</span>
      )}
    </TimelineRow>
  );
}
