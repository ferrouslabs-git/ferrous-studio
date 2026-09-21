// The sprint board: one sprint's kanban -- Not started / In progress / To
// test / Done / Blocked lanes -- over the full width, with a filter bar for
// finding a requirement by number and narrowing the lanes to one epic or
// feature. Reached from a sprint row on the Roadmap or a sprint card on the
// release page. Ported from the reference app's static/js/sprintboard.js.
//
// The agent column that stood beside the lanes (what each agent was working
// on, the questions they had asked, a live feed of everything that happened
// here) was removed on 2026-09-18: agents drive this board through the MCP
// now, and their chatter belonged on the board no more than a terminal does.
// The poll behind it stays -- it is what keeps a card fresh while an agent
// moves it, and the only thing that notices the sprint has been deleted --
// and it never redraws over a card in mid-drag or a field being typed in.
// `?req=<id>` opens the requirement drawer, so a card can be linked to and
// survives a reload.
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
import { KanbanLane } from "./sprintboard/KanbanLane";
import { SprintBoardHeader } from "./sprintboard/SprintBoardHeader";
import { SprintBoardFilters } from "./sprintboard/SprintBoardFilters";
import { matchesSprintFilter, NO_SPRINT_FILTER, SprintFilterState } from "./sprintboard/sprintFilter";

// A poll's redraw is held off while something in the view is being TYPED
// in -- the inline rename, the release select, the filter box -- so a
// requirement is never pulled out from under a half-typed word. The check is
// on text entry and never on a button: React keeps a clicked button focused,
// so testing focus alone would freeze the board until you clicked away.
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
  const { gone, refresh } = useSprintActivity(sprintId, busy);
  const [comments, setComments] = useState<CommentsTarget | null>(null);
  // The index changes on every write; a toast's Undo fires seconds later and
  // must see the requirement as it is THEN, not as it was when the toast rose.
  const indexRef = useRef(index);
  indexRef.current = index;

  const sprint = index.sprintById.get(sprintId) ?? null;
  const requirements = useMemo(() => spOrdered(index.sprintRequirements(sprintId)), [index, sprintId]);
  // The filter narrows the lanes only: the header's progress still counts
  // the whole sprint, because that is what the sprint is committed to.
  const [filter, setFilter] = useState<SprintFilterState>(NO_SPRINT_FILTER);
  const shown = useMemo(
    () => requirements.filter((r) => matchesSprintFilter(r, filter, index.effectiveEpicId)),
    [requirements, filter, index],
  );

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

  // One PATCH with the cross-epic board's undo toast, then the poll catches
  // up straight away rather than in ten seconds. The Undo re-enters this same
  // routine, so the reverting move gets its own toast (an undo can be undone)
  // and its own refresh -- the reference's sbPatch(rid, prev). The server
  // stamps blocked_from on a move into Blocked and clears it on the way out,
  // so the reverting patch is the previous status alone.
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
  const canMove = !sprint.closed_at && canWrite;

  return (
    <div className="page board-page">
      {error && <div className="status-banner warn">{error}</div>}
      <SprintBoardHeader
        sprint={sprint}
        requirements={requirements}
        refresh={refresh}
        onComments={() => setComments({ type: "sprint", id: sprint.id, label: `${sprint.human_id} · ${sprint.name}` })}
      />
      <SprintBoardFilters filter={filter} onChange={setFilter} total={requirements.length} shown={shown.length} />
      <div className="sb-layout">
        <section className="sb-board">
          {requirements.length === 0 && (
            <div className="hempty sb-empty">
              Nothing in {sprint.human_id} yet — drag requirements in from the backlog on the release page.
            </div>
          )}
          {requirements.length > 0 && shown.length === 0 && (
            <div className="hempty sb-empty">Nothing in {sprint.human_id} matches this filter.</div>
          )}
          {REQUIREMENT_STATUSES.map((st) => {
            const lane = shown.filter((r) => r.status === st);
            return (
              <KanbanLane
                key={st}
                status={st}
                requirements={lane}
                hidden={requirements.filter((r) => r.status === st).length - lane.length}
                canMove={canMove}
                onMove={(r, patch) => void sbPatch(r.id, patch)}
                onOpen={openDrawer}
              />
            );
          })}
        </section>
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
