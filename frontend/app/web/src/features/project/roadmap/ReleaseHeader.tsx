// The release page's header: the release itself -- title and description
// edited in place, the derived date, its delivery status, comments, delete -- and
// its epics, with "＋ Add epic" to file an unassigned one here and "↩" on
// each row to unfile it. The epic list folds away (the count stays on the
// heading) so a release carrying a dozen epics does not push its sprints off
// the screen; the choice is remembered per release. The date is read-only on purpose: it is the end of
// the last sprint filed under this release, so the way to move it is to move
// that sprint. Ported from the reference app's relPageHead(), relEpicRow()
// and shipRelease() (static/js/releases.js).
import { useNavigate } from "react-router-dom";
import { useBoard } from "../board/boardData";
import { releaseDue, releaseSchedule, shipGaps } from "../board/boardModel";
import { useBoardMutations } from "../board/boardMutations";
import { CommentButton, DeliveryStatusSelect, DueChip, EffortFigure, IdChip, ProgressBar, ProgressFigure } from "../board/chips";
import { useDialogs } from "../board/dialogs";
import { rollup } from "../board/effort";
import { InlineText } from "../board/InlineText";
import type { Release } from "../board/releasesApi";
import type { DeliveryStatus, Sprint } from "../board/sprintsApi";
import { useToast } from "../board/toast";

interface ReleaseHeaderProps {
  release: Release;
  /** Every sprint on the board; the schedule picks out this release's. */
  sprints: Sprint[];
  /** Whether the epic list is folded away, and the toggle for it. */
  epicsFolded: boolean;
  onToggleEpics: () => void;
  onComments: () => void;
}

export function ReleaseHeader({ release, sprints, epicsFolded, onToggleEpics, onComments }: ReleaseHeaderProps) {
  const { index, paths, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const toast = useToast();
  const navigate = useNavigate();

  const sch = releaseSchedule(release.id, sprints);
  const due = releaseDue(release, sprints);
  const backlog = index.releaseBacklog(release.id);
  const p = rollup(backlog);
  const epics = index.epics.filter((e) => e.release_id === release.id);
  const shipped = !!release.shipped_at;

  // The status moves wherever it is pointed -- forwards, backwards, straight
  // to live -- and nothing blocks it. Going live is the one move worth a
  // second look, so it says what is still open first and then does it anyway
  // if that is the answer.
  const setStatus = async (next: DeliveryStatus) => {
    if (next === "DeployedToLive") {
      const gaps = shipGaps(release, backlog, sprints);
      if (gaps.length) {
        const ok = await dialogs.confirm({
          title: "Go live with open work?",
          ok: "Mark it live anyway",
          danger: false,
          message: `${release.human_id} "${release.title}" still has open work:\n• ${gaps.join("\n• ")}\n\nMark it Deployed to Live anyway?`,
        });
        if (!ok) return;
      }
    }
    try {
      await mutations.setReleaseStatus(release, next);
    } catch {
      // Already toasted.
    }
  };

  const remove = async () => {
    const n = sprints.filter((s) => s.release_id === release.id).length;
    const ok = await dialogs.confirm({
      title: "Delete release",
      ok: "Delete release",
      message:
        `Delete ${release.human_id} "${release.title}"?\nLinked epics are kept but untagged` +
        (n ? `; its ${n} sprint(s) are left with no release.` : "."),
    });
    if (!ok) return;
    // No navigation here: ReleasePage leaves for the Roadmap the moment the
    // release is gone from the board, which is before the mutation's cascade
    // refetch resolves this await. A failure is already toasted and keeps
    // the release on screen.
    try {
      await mutations.deleteRelease(release);
    } catch {
      // Already toasted.
    }
  };

  const addEpic = async () => {
    const free = index.epics.filter((e) => !e.release_id);
    if (!free.length) {
      toast("Every epic is already in a release — make a new one on the Epics page");
      return;
    }
    const eid = await dialogs.pick({
      title: `Add an epic to ${release.human_id}`,
      message: release.title,
      items: free.map((e) => ({
        value: e.id,
        label: `${e.human_id} · ${e.title}`,
        hint: `${rollup(index.epicRequirements(e.id)).total} requirement(s)`,
      })),
    });
    if (!eid) return;
    void mutations.assignEpicToRelease(eid, release.id).catch(() => {});
  };

  return (
    <div className={`mscard rel-page${shipped ? " rel-shipped" : ""}`}>
      <div className="mshead">
        <IdChip>{release.human_id}</IdChip>
        <InlineText className="ms-ttl" value={release.title} disabled={!canWrite} onSave={(v) => mutations.patchRelease(release.id, { title: v }).catch(() => {})} />
        {sch.date && sch.last ? (
          <span className="rel-date" title={`set by ${sch.last.human_id} · ${sch.last.name}, the last sprint to end`}>
            {sch.date} <span className="k">{sch.last.human_id}</span>
          </span>
        ) : (
          <span className="rel-date rel-date-none" title="the release date is the end of its last sprint">
            {sch.sprints ? "sprints undated" : "no sprints yet"}
          </span>
        )}
        <DueChip due={due} />
        <span className="spacer" />
        <DeliveryStatusSelect
          status={release.status}
          disabled={!canWrite}
          label={`${release.human_id} status`}
          onChange={(s) => void setStatus(s)}
        />
        <CommentButton count={index.commentCount(release.id)} onClick={onComments} />
        {canWrite && (
          <button type="button" className="btn mini-x danger-ink" title="delete release" onClick={() => void remove()}>
            ✕
          </button>
        )}
      </div>
      <InlineText
        as="div"
        className="ms-desc"
        multiline
        value={release.description}
        disabled={!canWrite}
        onSave={(v) => mutations.patchRelease(release.id, { description: v }).catch(() => {})}
      />
      <div className="rel-stats">
        <ProgressBar pct={p.pct} />
        <span className="fig">
          {p.done}/{p.total} done · {p.pct}% · {p.total} requirement{p.total === 1 ? "" : "s"}
        </span>
        <EffortFigure rollup={p} />
      </div>
      <div className={`rel-epics${epicsFolded ? " rel-epics-folded" : ""}`}>
        <div className="rel-epics-head">
          <button
            type="button"
            className="btn mini-x rel-epics-fold"
            aria-expanded={!epicsFolded}
            title={epicsFolded ? "show this release's epics" : "hide this release's epics"}
            onClick={onToggleEpics}
          >
            {epicsFolded ? "▸" : "▾"} epics ({epics.length})
          </button>
          {canWrite && (
            <button type="button" className="btn mini-x rel-addep" title="file an unassigned epic under this release" onClick={() => void addEpic()}>
              ＋ Add epic
            </button>
          )}
        </div>
        <div className="ms-items" hidden={epicsFolded}>
          {epics.map((e) => (
            <div
              key={e.id}
              className="hrow rel-eprow"
              onClick={(ev) => {
                if ((ev.target as HTMLElement).closest("button")) return;
                navigate(paths.epic(e.id));
              }}
            >
              <span className="k">{e.human_id}</span>
              <span className="t">{e.title}</span>
              <ProgressFigure rollup={rollup(index.epicRequirements(e.id))} />
              {canWrite && (
                <button
                  type="button"
                  className="btn mini-x rel-unassign"
                  title={`remove from ${release.human_id} — back to unassigned`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    void mutations.assignEpicToRelease(e.id, null).catch(() => {});
                  }}
                >
                  ↩
                </button>
              )}
            </div>
          ))}
          {!epics.length && (
            <div className="hempty">
              No epics yet — “＋ Add epic” files an unassigned one here, or pick {release.human_id} in an epic's release menu on the Epics page.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
