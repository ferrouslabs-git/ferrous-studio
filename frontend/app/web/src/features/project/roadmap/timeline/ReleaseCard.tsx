// One release card: the head row (the release bar plus its date marker),
// its sprints, its epics. The card is the drop target for an epic row.
//
// The release's date is the end of the last sprint FILED UNDER it; the bar
// spans the sprints holding its epics' requirements. They disagree only when
// a requirement sits in a sprint filed under another release (or none) --
// that is the overrun worth showing. Ported from the reference app's
// tlReleaseCard (static/js/timeline.js).
import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useBoard } from "../../board/boardData";
import { releaseDate, releaseDue, sprintsOf } from "../../board/boardModel";
import { useBoardMutations } from "../../board/boardMutations";
import { useDropTarget } from "../../board/dnd";
import { effortSummary, rollup } from "../../board/effort";
import type { Release } from "../../board/releasesApi";
import { EpicRow } from "./EpicRow";
import { FoldBar, type TimelineFolds } from "./FoldBar";
import { SprintRow } from "./SprintRow";
import { TimelineRow } from "./TimelineRow";
import { epicExtent, releaseExtent, tlBarStyle, tlPct, type TimeWindow } from "./timelineMath";

export function ReleaseCard({ release, w, folds }: { release: Release; w: TimeWindow; folds: TimelineFolds }) {
  const { data, index, paths, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  // A drop onto the card the epic is already in is refused, so it does not
  // light up as a target while its own epic is in flight.
  const over = useDropTarget(ref, {
    accepts: (d) => d.kind === "epic" && (index.epicById.get(d.id)?.release_id ?? null) !== release.id,
    onDrop: (d) => void mutations.assignEpicToRelease(d.id, release.id).catch(() => undefined),
    disabled: !canWrite,
  });

  const sprints = data?.sprints ?? [];
  const mine = index.epics.filter((e) => e.release_id === release.id);
  const sps = sprintsOf(release.id, sprints);
  const ex = releaseExtent(
    mine.map((e) => epicExtent(index.epicRequirements(e.id), index.sprintById)),
    sps,
  );
  const p = rollup(index.releaseBacklog(release.id));
  const due = releaseDue(release, sprints);
  const date = releaseDate(release, sprints);
  const overrun = !!(ex && date && ex.end > date);

  return (
    <div
      ref={ref}
      className={`tl-card tl-card-rel${release.shipped_at ? " tl-shipped" : ""}${over ? " is-over" : ""}`}
      data-rel={release.id}
    >
      <TimelineRow
        cls="tl-release tl-cardhead"
        id={release.id}
        label={`${release.human_id} · ${release.title}`}
        onClick={() => navigate(paths.release(release.id))}
        meta={
          <>
            <span className={`due ${due.cls}`} title={due.label}>
              {release.shipped_at ? "shipped" : due.label}
            </span>
            <span className="tl-fig" title={effortSummary(p).text || undefined}>
              {p.done}/{p.total} · {p.pct}%
            </span>
          </>
        }
      >
        {ex && (
          <div
            className={`tl-bar tl-bar-release${overrun ? " tl-overrun" : ""}`}
            style={tlBarStyle(w, ex.start, ex.end)}
            title={
              `${release.title} — work spans ${ex.start} to ${ex.end}` +
              (overrun ? `, past ${date}, when its last sprint ends` : "")
            }
          >
            <span className="tl-fill" style={{ width: `${p.pct}%` }} />
          </div>
        )}
        {date && (
          <i className="tl-target" style={{ left: `${tlPct(w, date)}%` }} title={`${release.title}: last sprint ends ${date}`} />
        )}
      </TimelineRow>
      <FoldBar releaseId={release.id} sprints={sps} epics={mine} folds={folds} />
      {!folds.folded(release.id, "sprints") && sps.map((s) => <SprintRow key={s.id} sprint={s} w={w} />)}
      {!folds.folded(release.id, "epics") && mine.map((e) => <EpicRow key={e.id} epic={e} release={release} w={w} />)}
      {!mine.length && !sps.length && (
        <div className="tl-empty">
          Nothing in {release.human_id} yet — drag an epic in from Unassigned below, then plan its sprints.
        </div>
      )}
    </div>
  );
}
