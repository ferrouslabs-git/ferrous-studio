// ONE release, drilled into from its row on the Roadmap: the release itself
// as the header (ReleaseHeader -- title, ship, its epics), then its sprints
// down the left two thirds and its backlog down the right third -- every
// requirement whose EFFECTIVE release is this one and that sits in no
// sprint. Drag a requirement from the backlog onto a sprint to commit it,
// drag it back out to return it, or straight from one sprint to another.
// Sprints are created HERE and nowhere else, which is how every sprint
// comes to belong to a release. Ported from the reference app's
// renderRelease() and spCreate() (static/js/sprints.js) and the #relView
// block of static/index.html.
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useBoard } from "../board/boardData";
import { nextSprintDefaults, sortSprints, sprintsOf } from "../board/boardModel";
import { useBoardMutations } from "../board/boardMutations";
import { CommentsPanel, CommentsTarget } from "../board/CommentsPanel";
import { useDialogs } from "../board/dialogs";
import { useDragActive } from "../board/dnd";
import { boardStorageKey, useFoldMap } from "../board/folds";
import { RequirementDrawer } from "../board/RequirementDrawer";
import { ReleaseBacklog } from "./ReleaseBacklog";
import { ReleaseHeader } from "./ReleaseHeader";
import { SprintCard } from "./SprintCard";

export function ReleasePage() {
  const { releaseId } = useParams<{ releaseId: string }>();
  const { projectId, data, error, index, paths, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const navigate = useNavigate();
  useDragActive("requirement");

  // A done sprint starts folded: its list is history. A folded card is still
  // a drop target -- the whole card always was.
  const defaultFolded = useCallback((id: string) => index.sprintById.get(id)?.state === "done", [index]);
  const folds = useFoldMap(boardStorageKey(projectId, "sprintFold"), defaultFolded);

  const [reqId, setReqId] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentsTarget | null>(null);

  const release = data && releaseId ? index.releaseById.get(releaseId) : undefined;

  // Deleting the release (ReleaseHeader) drops it from the board the moment
  // the DELETE lands, then refetches what the cascade untagged. The reference
  // goes from the confirm straight to the Roadmap (releases.js: patch the
  // board, toast, showView("timeline")), so leave the instant the release we
  // were showing is gone -- before paint, so the "pick a release" empty state
  // below never shows -- rather than once those refetches settle. A release
  // that was never here (a stale link) still gets the empty state.
  const seenRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (release) {
      seenRef.current = release.id;
      return;
    }
    if (data && releaseId && seenRef.current === releaseId) navigate(paths.roadmap);
  }, [release, data, releaseId, navigate, paths.roadmap]);

  if (!data) {
    return error ? (
      <div className="page board-page">
        <div className="status-banner warn">{error}</div>
      </div>
    ) : (
      <div className="page board-page muted">Loading…</div>
    );
  }

  const banner = error ? <div className="status-banner warn">{error}</div> : null;

  if (!release) {
    // Deleted, or never picked: nothing to plan against.
    return (
      <div className="page board-page">
        {banner}
        <div className="viewbar">
          <Link className="btn mini-x" to={paths.roadmap} title="back to the roadmap">
            ← Roadmap
          </Link>
          {canWrite && (
            <button type="button" className="btn mini-x" disabled>
              + New sprint
            </button>
          )}
        </div>
        <div className="hempty centred">
          <div>Pick a release on the Roadmap to plan its sprints.</div>
          <Link className="btn primary" to={paths.roadmap}>
            ← Roadmap
          </Link>
        </div>
      </div>
    );
  }

  const mine = sortSprints(sprintsOf(release.id, data.sprints));
  const backlogCount = index.releaseBacklog(release.id).filter((r) => !r.sprint_id).length;
  const requirement = reqId ? index.requirementById.get(reqId) ?? null : null;

  // A short form rather than create-blank-then-edit: a sprint without dates
  // has no burndown and no place on the roadmap, so asking up front is a
  // kindness. The release is the one on screen -- never a field, so a sprint
  // can't be filed against the wrong one by accident.
  const newSprint = async () => {
    const defaults = nextSprintDefaults(sprintsOf(release.id, data.sprints));
    const fallbackName = `Sprint ${data.sprints.length + 1}`;
    const v = await dialogs.form({
      title: `New sprint in ${release.human_id} · ${release.title}`,
      ok: "Create sprint",
      fields: [
        { key: "name", label: "Name", placeholder: fallbackName },
        { key: "start", label: "Start", type: "date", value: defaults.start },
        { key: "end", label: "End", type: "date", value: defaults.end },
        { key: "goal", label: "Goal", type: "textarea", placeholder: "what this sprint is for" },
      ],
    });
    if (!v) return;
    try {
      await mutations.createSprint({
        name: v.name || fallbackName,
        goal: v.goal,
        start_date: v.start || null,
        end_date: v.end || null,
        release_id: release.id,
        capacity_hours: null,
      });
    } catch {
      // Already toasted.
    }
  };

  return (
    <div className="page board-page">
      {banner}
      <div className="viewbar">
        <Link className="btn mini-x" to={paths.roadmap} title="back to the roadmap">
          ← Roadmap
        </Link>
        {canWrite && (
          <button type="button" className="btn mini-x" onClick={() => void newSprint()}>
            + New sprint
          </button>
        )}
        <span className="tk-right">
          <span className="viewbar-count">
            {mine.length} sprint{mine.length === 1 ? "" : "s"} · {backlogCount} in backlog
          </span>
        </span>
      </div>

      <ReleaseHeader
        release={release}
        sprints={data.sprints}
        onComments={() => setComments({ type: "release", id: release.id, label: `${release.human_id} · ${release.title}` })}
      />

      <div className="rel-layout">
        <section className="rel-sprints">
          {mine.length ? (
            mine.map((s) => (
              <SprintCard
                key={s.id}
                sprint={s}
                folded={folds.isFolded(s.id)}
                onToggleFold={() => folds.toggle(s.id)}
                onOpenRequirement={(r) => setReqId(r.id)}
                onComments={() => setComments({ type: "sprint", id: s.id, label: `${s.human_id} · ${s.name}` })}
              />
            ))
          ) : (
            <div className="hempty centred">
              <div>No sprints for {release.human_id} yet. Create one, then drag requirements in from the backlog on the right.</div>
              {canWrite && (
                <button type="button" className="btn primary" onClick={() => void newSprint()}>
                  ＋ Create a sprint for {release.human_id}
                </button>
              )}
            </div>
          )}
        </section>
        <ReleaseBacklog release={release} sprints={mine} onOpen={(r) => setReqId(r.id)} />
      </div>

      <RequirementDrawer open={requirement !== null} requirement={requirement} onClose={() => setReqId(null)} />
      <CommentsPanel target={comments} onClose={() => setComments(null)} />
    </div>
  );
}
