// The epics in no release -- a dashed card at the bottom, and the pool you
// drag into a release from. An epic is never invisible: it is in a release
// card or it is here. A sprint in no release (a row from before every sprint
// had to have one) shows here too, flagged, so it is never lost. Below them,
// the requirements in no epic -- the one place on the board that lists
// them, and where a feed link to one lands. Ported from the reference app's
// renderTimeline (static/js/timeline.js).
import { useRef } from "react";
import { useBoard } from "../../board/boardData";
import { sortRequirements, sprintsOf } from "../../board/boardModel";
import { useBoardMutations } from "../../board/boardMutations";
import { StatusChip } from "../../board/chips";
import { useDropTarget } from "../../board/dnd";
import { Icon } from "../../board/icons";
import type { Requirement } from "../../board/requirementsApi";
import { EpicRow } from "./EpicRow";
import { FoldBar, type TimelineFolds } from "./FoldBar";
import { SprintRow } from "./SprintRow";
import { TimelineRow } from "./TimelineRow";
import type { TimeWindow } from "./timelineMath";

interface UnassignedCardProps {
  /** Null when nothing on the board is dated: rows then carry no bars. */
  w: TimeWindow | null;
  folds: TimelineFolds;
  onOpenRequirement: (r: Requirement) => void;
}

export function UnassignedCard({ w, folds, onOpenRequirement }: UnassignedCardProps) {
  const { data, index, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const ref = useRef<HTMLDivElement>(null);
  const over = useDropTarget(ref, {
    accepts: (d) => d.kind === "epic" && (index.epicById.get(d.id)?.release_id ?? null) !== null,
    onDrop: (d) => void mutations.assignEpicToRelease(d.id, null).catch(() => undefined),
    disabled: !canWrite,
  });

  const loose = index.epics.filter((e) => !e.release_id || !index.releaseById.has(e.release_id));
  const looseSprints = sprintsOf(null, data?.sprints ?? []);
  const orphans = sortRequirements((data?.requirements ?? []).filter((r) => index.effectiveEpicId(r) === null));

  return (
    <div ref={ref} className={`tl-card tl-card-loose${over ? " is-over" : ""}`} data-rel="">
      <TimelineRow cls="tl-cardhead tl-loosehead" label="Unassigned epics" meta={`${loose.length} epic${loose.length === 1 ? "" : "s"}`}>
        <span className="tl-hint">drag an epic onto a release above — or ⇄ on its row</span>
      </TimelineRow>
      <FoldBar releaseId={null} sprints={looseSprints} epics={loose} folds={folds} />
      {looseSprints.length > 0 && (
        <div className="tl-empty tl-warn">
          {looseSprints.length} sprint(s) have no release — open one to file it under a release.
        </div>
      )}
      {!folds.folded(null, "sprints") && looseSprints.map((s) => <SprintRow key={s.id} sprint={s} w={w} />)}
      {!folds.folded(null, "epics") && loose.map((e) => <EpicRow key={e.id} epic={e} release={null} w={w} />)}
      {!loose.length && !looseSprints.length && <div className="tl-empty">Every epic is in a release.</div>}
      {orphans.length > 0 && (
        <>
          <div className="tl-empty">{orphans.length} requirement(s) in no epic</div>
          {orphans.map((r) => (
            <TimelineRow
              key={r.id}
              cls="tl-requirement"
              id={r.id}
              pre={<Icon name="requirement" small />}
              label={`${r.human_id} · ${r.title}`}
              meta={<StatusChip status={r.status} />}
              onClick={() => onOpenRequirement(r)}
            >
              <span className="tl-nodate">no epic</span>
            </TimelineRow>
          ))}
        </>
      )}
    </div>
  );
}
