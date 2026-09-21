// Every write the board pages make, in one place: call the API, fold the
// response into the shared board (or refresh the kinds a cascade touched),
// and say what happened in a toast. Failures toast the server's reason --
// written for a human ("a sprint must belong to a release") -- and rethrow
// so a caller can stop a sequence. Confirmations belong to the pages; this
// layer never asks.
import { useMemo, useRef } from "react";
import { errorMessage } from "../../../core/api";
import { Agent, createAgent, deleteAgent, updateAgent } from "./agentsApi";
import { useBoard } from "./boardData";
import { reorderPatches, sameRef, spOrdered } from "./boardModel";
import { BoardComment, BoardEntityType, createBoardComment, deleteBoardComment } from "./commentsApi";
import { DELIVERY_STATUS_LABEL } from "./constants";
import { BoardDoc, BoardDocInput, createBoardDoc, deleteBoardDoc, updateBoardDoc } from "./docsApi";
import { createEpic, deleteEpic, Epic, EpicInput, EpicPatch, updateEpic } from "./epicsApi";
import { createFeature, deleteFeature, Feature, FeaturePatch, updateFeature } from "./featuresApi";
import { createRelease, deleteRelease, Release, ReleaseCreateInput, ReleaseUpdateInput, updateRelease } from "./releasesApi";
import { createRequirement, deleteRequirement, Requirement, RequirementInput, RequirementPatch, updateRequirement } from "./requirementsApi";
import { createSprint, DeliveryStatus, deleteSprint, Sprint, SprintInput, SprintPatch, SprintUpdateResult, updateSprint } from "./sprintsApi";
import { useToast } from "./toast";

export function useBoardMutations() {
  const board = useBoard();
  const toast = useToast();
  // The board value changes on every write; read it through a ref so the
  // mutation functions keep one identity for the life of the page.
  const boardRef = useRef(board);
  boardRef.current = board;
  const projectId = board.projectId;

  return useMemo(() => {
    const b = () => boardRef.current;
    const fail = (err: unknown): never => {
      toast(errorMessage(err), { type: "err", ttl: 6000 });
      throw err;
    };

    // ── requirements ──────────────────────────────────────────────────────
    // opts.undo: a status change is toasted with an Undo -- the epic page's
    // pane (RequirementPane). The sprint board deliberately leaves it off and
    // toasts its own in sbPatch, so that its Undo also forces the activity
    // poll. opts.saved: "<id> saved" is toasted -- the drawer's whole-form
    // Save, as the reference's #dSave does; a field-by-field patch stays
    // silent.
    async function patchRequirement(id: string, patch: RequirementPatch, opts: { undo?: boolean; saved?: boolean } = {}): Promise<Requirement> {
      const before = b().index.requirementById.get(id);
      try {
        const it = await updateRequirement(projectId, id, patch);
        b().replace("requirements", it);
        if (opts.saved) toast(`${it.human_id} saved`);
        if (opts.undo && patch.status && before && before.status !== it.status) {
          // The undo re-enters with undo on, so an undo can itself be undone
          // (the reference's rqpPatch re-toasts the same way).
          toast(`${it.human_id} → ${it.status}`, { undo: () => void patchRequirement(id, { status: before.status }, { undo: true }) });
        }
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function createRequirementM(input: RequirementInput): Promise<Requirement> {
      try {
        const it = await createRequirement(projectId, input);
        b().replace("requirements", it);
        toast(`${it.human_id} created`);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function deleteRequirementM(r: Requirement): Promise<void> {
      try {
        await deleteRequirement(projectId, r.id);
        b().remove("requirements", r.id);
        toast(`${r.human_id} deleted`);
        void b().reload(["comments"]);
      } catch (err) {
        fail(err);
      }
    }

    // Moving a requirement into, out of, or between sprints is one PATCH.
    // The queue position is scoped to a sprint, so it is cleared on every
    // move: the requirement lands at the end of its new order.
    async function moveRequirementToSprint(r: Requirement, sprintId: string | null): Promise<void> {
      if (sameRef(r.sprint_id, sprintId)) return;
      const from = r.sprint_id ? b().index.sprintById.get(r.sprint_id) : null;
      try {
        const it = await updateRequirement(
          projectId,
          r.id,
          sprintId ? { sprint_id: sprintId, queue_position: null } : { clear_sprint: true, queue_position: null },
        );
        b().replace("requirements", it);
        const target = sprintId ? b().index.sprintById.get(sprintId) : null;
        toast(
          target
            ? `${r.human_id} → ${target.human_id} · ${target.name}${!target.closed_at && it.status === "NotStarted" ? " — agents can pick it up" : ""}`
            : `${r.human_id} back in the backlog${from ? ` (from ${from.human_id})` : ""}`,
        );
      } catch (err) {
        fail(err);
      }
    }

    // Reflow one sprint's order around a requirement's new 1-based slot --
    // one PATCH per requirement whose position changes, as the reference does.
    async function reorderQueue(sprintId: string, r: Requirement, newPos: number): Promise<void> {
      const ordered = spOrdered(b().index.sprintRequirements(sprintId));
      try {
        for (const p of reorderPatches(ordered, r, newPos)) {
          const it = await updateRequirement(projectId, p.id, { queue_position: p.queue_position });
          b().replace("requirements", it);
        }
      } catch (err) {
        fail(err);
      }
    }

    // ── epics ─────────────────────────────────────────────────────────────
    async function createEpicM(input: EpicInput): Promise<Epic> {
      try {
        const it = await createEpic(projectId, input);
        b().replace("epics", it);
        toast(`${it.human_id} created`);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function patchEpic(id: string, patch: EpicPatch): Promise<Epic> {
      try {
        const it = await updateEpic(projectId, id, patch);
        b().replace("epics", it);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function deleteEpicM(epic: Epic): Promise<void> {
      try {
        await deleteEpic(projectId, epic.id);
        b().remove("epics", epic.id);
        toast(`${epic.human_id} deleted`);
        await b().reload(["features", "requirements", "docs", "comments"]);
      } catch (err) {
        fail(err);
      }
    }

    // Moving an epic between releases is ONE patch: a requirement's release
    // is derived from its epic, so the release's backlog, progress and
    // effort follow. A requirement with its OWN release set stays where it
    // is, and the toast says how many did.
    async function assignEpicToRelease(epicId: string, releaseId: string | null): Promise<void> {
      const epic = b().index.epicById.get(epicId);
      if (!epic || sameRef(epic.release_id, releaseId)) return;
      try {
        const it = await updateEpic(projectId, epicId, releaseId ? { release_id: releaseId } : { clear_release: true });
        b().replace("epics", it);
        const strays = b()
          .data?.requirements.filter((r) => r.release_id && r.release_id !== releaseId && b().index.effectiveEpicId(r) === epicId).length ?? 0;
        const rel = releaseId ? b().index.releaseById.get(releaseId) : null;
        toast(
          rel
            ? `${it.human_id} → ${rel.human_id} · ${rel.title}${strays ? ` — ${strays} requirement(s) keep their own release` : ""}`
            : `${it.human_id} moved to Unassigned`,
        );
      } catch (err) {
        fail(err);
      }
    }

    // ── features ──────────────────────────────────────────────────────────
    async function createFeatureM(epicId: string, title: string): Promise<Feature> {
      try {
        const it = await createFeature(projectId, epicId, title);
        b().replace("features", it);
        toast(`${it.human_id} created`);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function patchFeature(id: string, patch: FeaturePatch): Promise<Feature> {
      try {
        const it = await updateFeature(projectId, id, patch);
        b().replace("features", it);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function deleteFeatureM(feature: Feature): Promise<void> {
      try {
        await deleteFeature(projectId, feature.id);
        b().remove("features", feature.id);
        toast(`${feature.human_id} deleted`);
        await b().reload(["requirements", "comments"]);
      } catch (err) {
        fail(err);
      }
    }

    // ── releases ──────────────────────────────────────────────────────────
    async function createReleaseM(input: ReleaseCreateInput): Promise<Release> {
      try {
        const it = await createRelease(projectId, input);
        b().replace("releases", it);
        toast(`${it.human_id} created — add its epics, then plan sprints under it`);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function patchRelease(id: string, patch: ReleaseUpdateInput): Promise<Release> {
      try {
        const it = await updateRelease(projectId, id, patch);
        b().replace("releases", it);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    // A release's status moves freely -- nothing here refuses a step back.
    // Reaching "Deployed to Live" is what the server reads as shipped.
    async function setReleaseStatus(release: Release, status: DeliveryStatus): Promise<void> {
      const it = await patchRelease(release.id, { status });
      toast(status === "DeployedToLive" ? `${it.human_id} is live 🎉` : `${it.human_id} → ${DELIVERY_STATUS_LABEL[status]}`);
    }

    async function deleteReleaseM(release: Release): Promise<void> {
      try {
        await deleteRelease(projectId, release.id);
        const board = b();
        board.remove("releases", release.id);
        // Unlink in memory at once, as the reference does, so the Roadmap
        // never draws a beat in which epics and sprints still point at a
        // release that is gone; the refetch then brings the server's truth.
        const data = board.data;
        for (const e of data?.epics ?? []) if (e.release_id === release.id) board.replace("epics", { ...e, release_id: null });
        for (const s of data?.sprints ?? []) if (s.release_id === release.id) board.replace("sprints", { ...s, release_id: null });
        for (const r of data?.requirements ?? []) if (r.release_id === release.id) board.replace("requirements", { ...r, release_id: null });
        for (const c of data?.comments ?? []) if (c.entity_id === release.id) board.remove("comments", c.id);
        toast(`${release.human_id} deleted — linked epics kept`);
        void board.reload(["epics", "sprints", "requirements", "comments"]);
      } catch (err) {
        fail(err);
      }
    }

    // ── sprints ───────────────────────────────────────────────────────────
    async function createSprintM(input: SprintInput): Promise<Sprint> {
      try {
        const it = await createSprint(projectId, input);
        b().replace("sprints", it);
        toast(`${it.human_id} created — drag requirements in, then ▶ Start`);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function patchSprint(id: string, patch: SprintPatch): Promise<SprintUpdateResult> {
      try {
        const res = await updateSprint(projectId, id, patch);
        b().replace("sprints", res.sprint);
        return res;
      } catch (err) {
        return fail(err);
      }
    }

    // A sprint's status is a free label with no side effects at all -- so
    // this only reports the move.
    async function setSprintStatus(sprint: Sprint, status: DeliveryStatus): Promise<SprintUpdateResult> {
      const res = await patchSprint(sprint.id, { status });
      toast(`${sprint.human_id} → ${DELIVERY_STATUS_LABEL[status]}`);
      return res;
    }

    // ✓ Close / ↺ Reopen -- the control that does something. Closing returns
    // unfinished work to the backlog server-side, so the requirements are
    // refreshed after it.
    async function setSprintClosed(sprint: Sprint, closed: boolean): Promise<SprintUpdateResult> {
      const res = await patchSprint(sprint.id, { closed });
      if (closed) {
        await b().reload(["requirements"]);
        toast(
          `${sprint.human_id} closed${res.returned_to_backlog ? ` — ${res.returned_to_backlog} requirement(s) back in the backlog` : ""}`,
        );
      } else toast(`${sprint.human_id} reopened — its agents can pick work up again`);
      return res;
    }

    async function deleteSprintM(sprint: Sprint): Promise<void> {
      try {
        await deleteSprint(projectId, sprint.id);
        b().remove("sprints", sprint.id);
        toast(`${sprint.human_id} deleted — requirements back in the backlog`);
        await b().reload(["requirements", "agents", "comments"]);
      } catch (err) {
        fail(err);
      }
    }

    // ── docs ──────────────────────────────────────────────────────────────
    async function createDocM(input: BoardDocInput): Promise<BoardDoc> {
      try {
        const it = await createBoardDoc(projectId, input);
        b().replace("docs", it);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function patchDoc(id: string, patch: Partial<BoardDocInput> & { clear_epic?: boolean }): Promise<BoardDoc> {
      try {
        const it = await updateBoardDoc(projectId, id, patch);
        b().replace("docs", it);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function deleteDocM(doc: BoardDoc): Promise<void> {
      try {
        await deleteBoardDoc(projectId, doc.id);
        b().remove("docs", doc.id);
        toast(`${doc.human_id} deleted`);
        void b().reload(["comments"]);
      } catch (err) {
        fail(err);
      }
    }

    // ── comments ──────────────────────────────────────────────────────────
    async function postComment(entityType: BoardEntityType, entityId: string, body: string): Promise<BoardComment> {
      try {
        const it = await createBoardComment(projectId, entityType, entityId, body);
        b().replace("comments", it);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function deleteCommentM(commentId: string): Promise<void> {
      try {
        await deleteBoardComment(projectId, commentId);
        b().remove("comments", commentId);
      } catch (err) {
        fail(err);
      }
    }

    // ── agents ────────────────────────────────────────────────────────────
    async function createAgentM(name: string, sprintId: string | null): Promise<Agent> {
      try {
        const it = await createAgent(projectId, name, sprintId);
        b().replace("agents", it);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function patchAgent(id: string, patch: Parameters<typeof updateAgent>[2]): Promise<Agent> {
      try {
        const it = await updateAgent(projectId, id, patch);
        b().replace("agents", it);
        return it;
      } catch (err) {
        return fail(err);
      }
    }

    async function deleteAgentM(agent: Agent): Promise<void> {
      try {
        await deleteAgent(projectId, agent.id);
        b().remove("agents", agent.id);
        toast(`${agent.name} deleted`);
      } catch (err) {
        fail(err);
      }
    }

    return {
      patchRequirement,
      createRequirement: createRequirementM,
      deleteRequirement: deleteRequirementM,
      moveRequirementToSprint,
      reorderQueue,
      createEpic: createEpicM,
      patchEpic,
      deleteEpic: deleteEpicM,
      assignEpicToRelease,
      createFeature: createFeatureM,
      patchFeature,
      deleteFeature: deleteFeatureM,
      createRelease: createReleaseM,
      patchRelease,
      setReleaseStatus,
      deleteRelease: deleteReleaseM,
      createSprint: createSprintM,
      patchSprint,
      setSprintStatus,
      setSprintClosed,
      deleteSprint: deleteSprintM,
      createDoc: createDocM,
      patchDoc,
      deleteDoc: deleteDocM,
      postComment,
      deleteComment: deleteCommentM,
      createAgent: createAgentM,
      patchAgent,
      deleteAgent: deleteAgentM,
    };
  }, [projectId, toast]);
}

export type BoardMutations = ReturnType<typeof useBoardMutations>;
