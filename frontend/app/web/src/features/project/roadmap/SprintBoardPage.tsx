// The sprint board: one sprint's kanban (Todo / Doing / Review / Blocked /
// Done lanes) with the agent(s) delivering it beside it -- start/stop, what
// each is working on, the questions they have asked, and a live feed of what
// has happened here. Reached from a sprint row on the Roadmap or a sprint
// card on the release page. Ported from the reference app's
// static/js/sprintboard.js.
//
// The sprint and its requirements come from the shared board; agents, events
// and questions from the activity poll (useSprintActivity), which never
// redraws over a card in mid-drag or a field being typed in. Every write on
// this page refreshes the poll straight away so the questions and the feed
// catch up now, not in ten seconds. `?req=<id>` opens the requirement
// drawer, so a card can be linked to and survives a reload.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useBoard } from "../board/boardData";
import { spOrdered } from "../board/boardModel";
import { useBoardMutations } from "../board/boardMutations";
import { CommentsPanel, CommentsTarget } from "../board/CommentsPanel";
import { useDragActive } from "../board/dnd";
import { RequirementDrawer } from "../board/RequirementDrawer";
import { Requirement, REQUIREMENT_STATUSES, RequirementPatch } from "../board/requirementsApi";
import { useToast } from "../board/toast";
import { useSprintActivity } from "../board/useSprintActivity";
import { ActivityFeedCard } from "./sprintboard/ActivityFeedCard";
import { AgentCard } from "./sprintboard/AgentCard";
import { KanbanLane } from "./sprintboard/KanbanLane";
import { QuestionsCard } from "./sprintboard/QuestionsCard";
import { SprintBoardHeader } from "./sprintboard/SprintBoardHeader";

// The reference holds a poll's redraw off while focus is anywhere in its
// view (#sprintBoardView: the head bar and the board/side layout), but its
// innerHTML rebuild after every action drops that focus, so in practice only
// something being TYPED in -- an answer box, an inline rename, the release
// select -- ever holds a poll off. React keeps a clicked button focused, so
// the check here is on text entry, never on a button: otherwise pressing
// ▶ Start or ■ Stop would freeze the live column until you clicked away.
const EDITING_CONTROLS = "input, textarea, select";
const VIEW_SCOPE = ".sb-head, .sb-layout";
function isEditingInView(): boolean {
  const el = document.activeElement;
  return el instanceof Element && el.matches(EDITING_CONTROLS) && el.closest(VIEW_SCOPE) !== null;
}

export function SprintBoardPage() {
  const { sprintId = "" } = useParams<{ sprintId: string }>();
  const { data, error, index, paths, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const dragging = useDragActive("card");
  // A poll never redraws over a card in mid-drag or a field being typed in.
  const busy = () => dragging || isEditingInView();
  const { live, gone, refresh } = useSprintActivity(sprintId, busy);
  const [comments, setComments] = useState<CommentsTarget | null>(null);
  // The index changes on every write; a toast's Undo fires seconds later and
  // must see the requirement as it is THEN, not as it was when the toast rose.
  const indexRef = useRef(index);
  indexRef.current = index;

  const sprint = index.sprintById.get(sprintId) ?? null;
  const requirements = useMemo(() => spOrdered(index.sprintRequirements(sprintId)), [index, sprintId]);

  const reqId = params.get("req");
  const openRequirement = reqId ? index.requirementById.get(reqId) ?? null : null;
  const openDrawer = useCallback(
    (r: Requirement) =>
      setParams(
        (prev) => {
          const q = new URLSearchParams(prev);
          q.set("req", r.id);
          return q;
        },
        { replace: true },
      ),
    [setParams],
  );
  const closeDrawer = useCallback(
    () =>
      setParams(
        (prev) => {
          const q = new URLSearchParams(prev);
          q.delete("req");
          return q;
        },
        { replace: true },
      ),
    [setParams],
  );
  // A link to a requirement that is no longer on the board: drop the stale
  // query rather than open an empty "new requirement" drawer.
  useEffect(() => {
    if (data && reqId && !index.requirementById.has(reqId)) closeDrawer();
  }, [data, reqId, index, closeDrawer]);

  // One PATCH with the cross-epic board's undo toast, then the live column
  // catches up straight away. The Undo re-enters this same routine, so the
  // reverting move gets its own toast (an undo can be undone) and its own
  // refresh (the Questions card and the feed catch up now, not in ten
  // seconds) -- the reference's sbPatch(rid, prev). The server stamps
  // blocked_from on a move into Blocked and clears it on the way out, so the
  // reverting patch is the previous status alone.
  const sbPatch = async (id: string, patch: RequirementPatch): Promise<void> => {
    const before = indexRef.current.requirementById.get(id);
    let it: Requirement;
    try {
      it = await mutations.patchRequirement(id, patch);
    } catch {
      return; // the mutation layer has toasted
    }
    if (patch.status && before && patch.status !== before.status) {
      const prev: RequirementPatch = { status: before.status };
      toast(`${it.human_id} → ${it.status}`, { undo: () => void sbPatch(id, prev) });
    }
    await refresh(true);
  };

  // A failed load renders the error, as the roadmap and epics pages do,
  // rather than a "Loading…" that never ends.
  if (data === null) {
    return <div className="page board-page muted">{error ? <div className="status-banner warn">{error}</div> : "Loading…"}</div>;
  }

  if (gone || !sprint) {
    return (
      <div className="page board-page">
        {error && <div className="status-banner warn">{error}</div>}
        <div className="viewbar">
          <Link className="btn mini-x" to={paths.roadmap}>
            ← Roadmap
          </Link>
          <span className="hempty">That sprint no longer exists.</span>
        </div>
      </div>
    );
  }

  // A done sprint is read-only on the board; so is a viewer.
  const canMove = sprint.state !== "done" && canWrite;

  return (
    <div className="page board-page">
      {error && <div className="status-banner warn">{error}</div>}
      <SprintBoardHeader
        sprint={sprint}
        requirements={requirements}
        refresh={refresh}
        onComments={() => setComments({ type: "sprint", id: sprint.id, label: `${sprint.human_id} · ${sprint.name}` })}
      />
      <div className="sb-layout">
        <section className="sb-board">
          {requirements.length === 0 && (
            <div className="hempty sb-empty">
              Nothing in {sprint.human_id} yet — drag requirements in from the backlog on the release page.
            </div>
          )}
          {REQUIREMENT_STATUSES.map((st) => (
            <KanbanLane
              key={st}
              status={st}
              requirements={requirements.filter((r) => r.status === st)}
              canMove={canMove}
              onMove={(r, patch) => void sbPatch(r.id, patch)}
              onOpen={openDrawer}
            />
          ))}
        </section>
        <aside className="sb-side">
          <AgentCard sprint={sprint} live={live} refresh={refresh} onOpen={openDrawer} />
          <QuestionsCard live={live} refresh={refresh} onOpen={openDrawer} />
          <ActivityFeedCard live={live} />
        </aside>
      </div>
      <RequirementDrawer
        open={openRequirement !== null}
        requirement={openRequirement}
        onClose={closeDrawer}
        onSaved={() => void refresh(true)}
      />
      <CommentsPanel target={comments} onClose={() => setComments(null)} />
    </div>
  );
}
