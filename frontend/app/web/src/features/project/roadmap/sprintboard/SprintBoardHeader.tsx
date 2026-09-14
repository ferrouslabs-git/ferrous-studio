// The bar across the top of the sprint board: back to the release (or the
// roadmap), the sprint's id, state and editable name, its release (or, for
// a legacy sprint with none, the one place it can be filed), dates, days
// left, progress, and the same lifecycle button as the sprint card.
import { Link } from "react-router-dom";
import { useBoard } from "../../board/boardData";
import { completeSprintMessage, sprintDue, sprintLifecycle } from "../../board/boardModel";
import { useBoardMutations } from "../../board/boardMutations";
import { CommentButton, DueChip, IdChip, ProgressBar, SprintStateChip } from "../../board/chips";
import { useDialogs } from "../../board/dialogs";
import { rollup } from "../../board/effort";
import { InlineText } from "../../board/InlineText";
import type { Requirement } from "../../board/requirementsApi";
import type { Sprint } from "../../board/sprintsApi";
import { useToast } from "../../board/toast";

interface SprintBoardHeaderProps {
  sprint: Sprint;
  /** The sprint's requirements, for progress and the Complete confirmation. */
  requirements: Requirement[];
  refresh: (force?: boolean) => Promise<void>;
  onComments: () => void;
}

export function SprintBoardHeader({ sprint, requirements, refresh, onComments }: SprintBoardHeaderProps) {
  const { index, paths, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const toast = useToast();

  const release = sprint.release_id ? index.releaseById.get(sprint.release_id) ?? null : null;
  const p = rollup(requirements);
  const due = sprintDue(sprint);
  const life = sprintLifecycle(sprint);

  const rename = async (name: string) => {
    try {
      await mutations.patchSprint(sprint.id, { name });
      await refresh(true);
    } catch {
      // Already toasted by the mutation layer.
    }
  };

  // A legacy sprint with no release: the one place it can be filed.
  const file = async (releaseId: string) => {
    const r = index.releaseById.get(releaseId);
    if (!r) return;
    try {
      await mutations.patchSprint(sprint.id, { release_id: r.id });
      toast(`${sprint.human_id} filed under ${r.human_id} · ${r.title}`);
      await refresh(true);
    } catch {
      // Already toasted.
    }
  };

  // ▶ Start / ✓ Complete / ↺ Reopen -- the same control as the sprint card.
  // Completing returns unfinished work to the backlog, so it asks first.
  const runLifecycle = async () => {
    if (life.next === "done") {
      const ok = await dialogs.confirm({
        title: "Complete sprint",
        ok: "Complete",
        danger: false,
        message: completeSprintMessage(sprint, requirements),
      });
      if (!ok) return;
    }
    try {
      await mutations.setSprintState(sprint, life.next);
      await refresh(true);
    } catch {
      // Already toasted.
    }
  };

  return (
    <div className="viewbar sb-head">
      {release ? (
        <Link className="btn mini-x" to={paths.release(release.id)} title={`back to ${release.human_id}`}>
          ← {release.human_id}
        </Link>
      ) : (
        <Link className="btn mini-x" to={paths.roadmap} title="back to the roadmap">
          ← Roadmap
        </Link>
      )}
      <IdChip>{sprint.human_id}</IdChip>
      <SprintStateChip state={sprint.state} />
      <InlineText className="sb-name" value={sprint.name} onSave={rename} disabled={!canWrite} />
      {release ? (
        <Link className="btn mini-x sb-rel" to={paths.release(release.id)} title="open the release page">
          {release.human_id} · {release.title}
        </Link>
      ) : (
        <select className="mini" value="" disabled={!canWrite} onChange={(e) => void file(e.target.value)}>
          <option value="">— release —</option>
          {index.releases.map((r) => (
            <option key={r.id} value={r.id}>
              {r.human_id} · {r.title}
            </option>
          ))}
        </select>
      )}
      <span className="sb-dates">
        {sprint.start_date && sprint.end_date ? `${sprint.start_date} → ${sprint.end_date}` : "no dates"}
      </span>
      {sprint.state !== "done" && due && <DueChip due={due} />}
      <ProgressBar pct={p.pct} />
      <span className="sb-fig">
        {p.done}/{p.total} done · {p.pct}%{p.review ? ` · ${p.review} in review` : ""}
      </span>
      <span className="tk-right">
        {canWrite && (
          <button type="button" className={`btn mini-x${life.primary ? " primary" : ""}`} onClick={() => void runLifecycle()}>
            {life.label}
          </button>
        )}
        <CommentButton count={index.commentCount(sprint.id)} onClick={onComments} />
      </span>
    </div>
  );
}
