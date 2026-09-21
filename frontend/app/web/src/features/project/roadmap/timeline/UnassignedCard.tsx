// The dashed card at the bottom of the Roadmap: the things that fell outside
// the structure and would otherwise be invisible -- a sprint filed under no
// release (a row from before every sprint had to have one), and the
// requirements in no epic, the one place on the board that lists them and
// where a feed link to one lands.
//
// It used to list the epics in no release too, and was the pool you dragged
// an epic out of a release into. That section was removed on 2026-09-18: a
// card of unfiled epics sat under every roadmap whether or not anyone was
// filing anything, and the Epics tab answers the question better -- its
// release filter takes "Not in a release" as one of its choices, beside the
// search and the progress figures. Unfiling an epic is still ⇄ on its row in
// the release card above. Ported from the reference app's renderTimeline
// (static/js/timeline.js).
import { useBoard } from "../../board/boardData";
import { sortRequirements, sprintsOf } from "../../board/boardModel";
import { StatusChip } from "../../board/chips";
import { Icon } from "../../board/icons";
import type { Requirement } from "../../board/requirementsApi";
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
  const { data, index } = useBoard();

  const looseSprints = sprintsOf(null, data?.sprints ?? []);
  const orphans = sortRequirements((data?.requirements ?? []).filter((r) => index.effectiveEpicId(r) === null));
  const parts = [
    looseSprints.length ? `${looseSprints.length} sprint${looseSprints.length === 1 ? "" : "s"}` : null,
    orphans.length ? `${orphans.length} requirement${orphans.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <div className="tl-card tl-card-loose" data-rel="">
      <TimelineRow cls="tl-cardhead tl-loosehead" label="Unfiled" meta={parts.join(" · ")}>
        <span className="tl-hint">work that sits outside a release or an epic</span>
      </TimelineRow>
      {looseSprints.length > 0 && (
        <>
          <FoldBar releaseId={null} sprints={looseSprints} folds={folds} />
          <div className="tl-empty tl-warn">
            {looseSprints.length} sprint(s) have no release — open one to file it under a release.
          </div>
          {!folds.folded(null, "sprints") && looseSprints.map((s) => <SprintRow key={s.id} sprint={s} w={w} />)}
        </>
      )}
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
