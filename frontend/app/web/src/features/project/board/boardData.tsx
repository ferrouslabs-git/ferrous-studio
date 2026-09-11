// One in-memory copy of the project's board, shared by every board page --
// the reference app keeps a single `board` object and re-renders from it;
// this is that object as a React context. Loaded once per project, refreshed
// per kind after a write, upserted from write responses so a PATCH never
// needs a refetch to show. Pages read `useBoard()`; writes go through
// useBoardMutations().
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { useSession } from "../../../app/session";
import { getTenantUsers, TenantUser } from "../../../core/umApi";
import { useProject } from "../ProjectLayout";
import { Agent, listAgents } from "./agentsApi";
import { effectiveEpicId, effectiveReleaseId, sortEpics, sortFeatures, sortReleases, sortRequirements, sortSprints } from "./boardModel";
import { BoardComment, listAllBoardComments } from "./commentsApi";
import { DialogProvider } from "./dialogs";
import { BoardDoc, listBoardDocs } from "./docsApi";
import { Epic, listEpics } from "./epicsApi";
import { Feature, listFeatures } from "./featuresApi";
import { boardPaths, BoardPaths } from "./paths";
import { listReleases, Release } from "./releasesApi";
import { listRequirements, Requirement } from "./requirementsApi";
import { listSprints, Sprint } from "./sprintsApi";
import { ToastProvider } from "./toast";

export interface BoardData {
  releases: Release[];
  epics: Epic[];
  features: Feature[];
  sprints: Sprint[];
  requirements: Requirement[];
  docs: BoardDoc[];
  agents: Agent[];
  comments: BoardComment[];
}

export type BoardKind = keyof BoardData;

const ALL_KINDS: BoardKind[] = ["releases", "epics", "features", "sprints", "requirements", "docs", "agents", "comments"];

// A failure loading these is not fatal: the roadmap is still worth showing
// without agent chips or comment counts.
const OPTIONAL: Set<BoardKind> = new Set(["agents", "comments"]);

const LOADERS: { [K in BoardKind]: (projectId: string) => Promise<BoardData[K]> } = {
  releases: listReleases,
  epics: listEpics,
  features: listFeatures,
  sprints: listSprints,
  requirements: listRequirements,
  docs: listBoardDocs,
  agents: listAgents,
  comments: listAllBoardComments,
};

const EMPTY: BoardData = { releases: [], epics: [], features: [], sprints: [], requirements: [], docs: [], agents: [], comments: [] };

type Entity = { id: string };

export interface BoardIndex {
  releaseById: Map<string, Release>;
  epicById: Map<string, Epic>;
  featureById: Map<string, Feature>;
  sprintById: Map<string, Sprint>;
  requirementById: Map<string, Requirement>;
  docById: Map<string, BoardDoc>;
  agentById: Map<string, Agent>;
  /** Epics in id order. */
  epics: Epic[];
  /** Releases in roadmap order: unshipped by derived date, then shipped. */
  releases: Release[];
  /** Sprints in timeline order (sortSprints). */
  sprints: Sprint[];
  featuresOf: (epicId: string) => Feature[];
  /** Requirements whose EFFECTIVE epic is this one (direct, or via a feature). */
  epicRequirements: (epicId: string) => Requirement[];
  featureRequirements: (featureId: string) => Requirement[];
  /** Every requirement whose effective release is this one; null = in no release. */
  releaseBacklog: (releaseId: string | null) => Requirement[];
  sprintRequirements: (sprintId: string) => Requirement[];
  /** This epic's docs, most recently updated first (updated_at desc). */
  epicDocs: (epicId: string) => BoardDoc[];
  effectiveEpicId: (r: Requirement) => string | null;
  effectiveReleaseId: (r: Requirement) => string | null;
  epicName: (epicId: string | null) => string;
  memberName: (userId: string | null | undefined) => string;
  commentsOf: (entityId: string) => BoardComment[];
  commentCount: (entityId: string) => number;
  /** The human id of any board entity, for feed links and diffs. */
  humanIdOf: (entityType: string, entityId: string) => string | null;
}

export interface BoardContextValue {
  projectId: string;
  paths: BoardPaths;
  data: BoardData | null;
  error: string | null;
  members: TenantUser[];
  currentUserId: string | null;
  /** The organisation role, not narrowed by the version lock (see ProjectLayout). */
  canWrite: boolean;
  /** Creating, starting, stopping, renaming and deleting agents (board:tokens). */
  canManageAgents: boolean;
  /** Refetch these kinds (default: all). Rejects on a required kind's failure; agents/comments fall back to []. */
  reload: (kinds?: BoardKind[]) => Promise<void>;
  /** Upsert by id (appends a row not yet on the board). */
  replace: <K extends BoardKind>(kind: K, item: BoardData[K][number]) => void;
  /** Drop the row with this id from that kind. */
  remove: (kind: BoardKind, id: string) => void;
  /** Lookups over data; built over an empty board until the first load lands, so data === null is the loading check. */
  index: BoardIndex;
}

const BoardContext = createContext<BoardContextValue | null>(null);

/** The project's shared board -- rows, lookups and the write hooks' host -- for any page beneath BoardProvider. */
export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error("useBoard must be used inside BoardProvider");
  return ctx;
}

function upsert<T extends Entity>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}

function buildIndex(data: BoardData, members: TenantUser[]): BoardIndex {
  const releaseById = new Map(data.releases.map((r) => [r.id, r]));
  const epicById = new Map(data.epics.map((e) => [e.id, e]));
  const featureById = new Map(data.features.map((f) => [f.id, f]));
  const sprintById = new Map(data.sprints.map((s) => [s.id, s]));
  const requirementById = new Map(data.requirements.map((r) => [r.id, r]));
  const docById = new Map(data.docs.map((d) => [d.id, d]));
  const agentById = new Map(data.agents.map((a) => [a.id, a]));
  const memberById = new Map(members.map((m) => [m.user_id, m]));

  const effEpic = (r: Requirement) => effectiveEpicId(r, featureById);
  const effRelease = (r: Requirement) => effectiveReleaseId(r, epicById, featureById);

  const requirementsByEpic = new Map<string, Requirement[]>();
  const requirementsByFeature = new Map<string, Requirement[]>();
  const requirementsBySprint = new Map<string, Requirement[]>();
  const backlogByRelease = new Map<string | null, Requirement[]>();
  for (const r of sortRequirements(data.requirements)) {
    const eid = effEpic(r);
    if (eid) requirementsByEpic.set(eid, [...(requirementsByEpic.get(eid) ?? []), r]);
    if (r.feature_id) requirementsByFeature.set(r.feature_id, [...(requirementsByFeature.get(r.feature_id) ?? []), r]);
    if (r.sprint_id) requirementsBySprint.set(r.sprint_id, [...(requirementsBySprint.get(r.sprint_id) ?? []), r]);
    const rid = effRelease(r);
    backlogByRelease.set(rid, [...(backlogByRelease.get(rid) ?? []), r]);
  }
  const featuresByEpic = new Map<string, Feature[]>();
  for (const f of sortFeatures(data.features)) featuresByEpic.set(f.epic_id, [...(featuresByEpic.get(f.epic_id) ?? []), f]);
  const docsByEpic = new Map<string, BoardDoc[]>();
  for (const d of [...data.docs].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))) {
    if (d.epic_id) docsByEpic.set(d.epic_id, [...(docsByEpic.get(d.epic_id) ?? []), d]);
  }
  const commentsByEntity = new Map<string, BoardComment[]>();
  for (const c of [...data.comments].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))) {
    commentsByEntity.set(c.entity_id, [...(commentsByEntity.get(c.entity_id) ?? []), c]);
  }

  const none: never[] = [];
  return {
    releaseById,
    epicById,
    featureById,
    sprintById,
    requirementById,
    docById,
    agentById,
    epics: sortEpics(data.epics),
    releases: sortReleases(data.releases, data.sprints),
    sprints: sortSprints(data.sprints),
    featuresOf: (epicId) => featuresByEpic.get(epicId) ?? none,
    epicRequirements: (epicId) => requirementsByEpic.get(epicId) ?? none,
    featureRequirements: (featureId) => requirementsByFeature.get(featureId) ?? none,
    releaseBacklog: (releaseId) => backlogByRelease.get(releaseId) ?? none,
    sprintRequirements: (sprintId) => requirementsBySprint.get(sprintId) ?? none,
    epicDocs: (epicId) => docsByEpic.get(epicId) ?? none,
    effectiveEpicId: effEpic,
    effectiveReleaseId: effRelease,
    epicName: (epicId) => (epicId ? epicById.get(epicId)?.title ?? "—" : "—"),
    memberName: (userId) => {
      if (!userId) return "system";
      const m = memberById.get(userId);
      return m?.name || m?.email || "Someone";
    },
    commentsOf: (entityId) => commentsByEntity.get(entityId) ?? none,
    commentCount: (entityId) => commentsByEntity.get(entityId)?.length ?? 0,
    humanIdOf: (entityType, entityId) => {
      switch (entityType) {
        case "release":
          return releaseById.get(entityId)?.human_id ?? null;
        case "epic":
          return epicById.get(entityId)?.human_id ?? null;
        case "feature":
          return featureById.get(entityId)?.human_id ?? null;
        case "sprint":
          return sprintById.get(entityId)?.human_id ?? null;
        case "requirement":
          return requirementById.get(entityId)?.human_id ?? null;
        case "doc":
          return docById.get(entityId)?.human_id ?? null;
        case "agent":
          return agentById.get(entityId)?.name ?? null;
        default:
          return null;
      }
    },
  };
}

/**
 * Layout route: loads the board for the project in the URL and provides it,
 * with the board's toasts and dialogs, to every page beneath.
 */
export function BoardProvider({ children }: { children?: ReactNode }) {
  const { project, orgId, canWriteBoard } = useProject();
  const { user, canManageBoardTokens } = useSession();
  const projectId = project.id;

  const [data, setData] = useState<BoardData | null>(null);
  const [members, setMembers] = useState<TenantUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  // A project switch while a load is in flight must not land the old
  // project's rows in the new one's state.
  const generation = useRef(0);

  const reload = useCallback(
    async (kinds: BoardKind[] = ALL_KINDS) => {
      const gen = generation.current;
      const results = await Promise.all(
        kinds.map((k) =>
          LOADERS[k](projectId).catch((err: unknown) => {
            if (OPTIONAL.has(k)) return [] as BoardData[typeof k];
            throw err;
          }),
        ),
      );
      if (gen !== generation.current) return;
      setData((prev) => {
        const next = { ...(prev ?? EMPTY) } as BoardData;
        kinds.forEach((k, i) => {
          (next as Record<BoardKind, unknown[]>)[k] = results[i] as unknown[];
        });
        return next;
      });
    },
    [projectId],
  );

  useEffect(() => {
    generation.current += 1;
    const gen = generation.current;
    setData(null);
    setError(null);
    reload().catch((err: unknown) => {
      if (gen === generation.current) setError(err instanceof Error ? err.message : "Could not load the board.");
    });
    getTenantUsers(orgId, "active")
      .then((list) => {
        if (gen === generation.current) setMembers(list);
      })
      .catch(() => {
        // Members are a lookup for names; a viewer may not be allowed the list.
      });
  }, [projectId, orgId, reload]);

  const replace = useCallback(<K extends BoardKind>(kind: K, item: BoardData[K][number]) => {
    setData((prev) => (prev ? { ...prev, [kind]: upsert(prev[kind] as Entity[], item as Entity) } : prev));
  }, []);

  const remove = useCallback((kind: BoardKind, id: string) => {
    setData((prev) => (prev ? { ...prev, [kind]: (prev[kind] as Entity[]).filter((x) => x.id !== id) } : prev));
  }, []);

  const index = useMemo(() => buildIndex(data ?? EMPTY, members), [data, members]);
  const paths = useMemo(() => boardPaths(orgId, projectId), [orgId, projectId]);

  const value = useMemo<BoardContextValue>(
    () => ({
      projectId,
      paths,
      data,
      error,
      members,
      currentUserId: user?.id ?? null,
      canWrite: canWriteBoard,
      canManageAgents: canManageBoardTokens,
      reload,
      replace,
      remove,
      index,
    }),
    [projectId, paths, data, error, members, user?.id, canWriteBoard, canManageBoardTokens, reload, replace, remove, index],
  );

  return (
    <BoardContext.Provider value={value}>
      <ToastProvider>
        <DialogProvider>{children ?? <Outlet />}</DialogProvider>
      </ToastProvider>
    </BoardContext.Provider>
  );
}
