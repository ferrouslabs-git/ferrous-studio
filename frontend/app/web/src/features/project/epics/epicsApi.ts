// Client for a project's board epics (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

// Where the epic itself sits in the agreed Definition-of-Done lifecycle --
// distinct from the live done/doing progress rolled up from its
// requirements. Replaces the old Now/Next/Later phase, which "never
// represented real planning" (ported from software-management's own
// change). The route refuses a transition into "Done" unless every
// requirement under the epic is itself Done.
export type EpicStatus = "Readiness" | "Implementation" | "ReleasedToUAT" | "HumanValidation" | "Done";
export const EPIC_STATUSES: EpicStatus[] = ["Readiness", "Implementation", "ReleasedToUAT", "HumanValidation", "Done"];

export interface Epic {
  id: string;
  human_id: string;
  title: string;
  summary: string;
  status: EpicStatus;
  release_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EpicCreateInput {
  title: string;
  summary: string;
  release_id: string | null;
}

export type EpicInput = EpicCreateInput;

export interface EpicProgress {
  done: number;
  doing: number;
  total: number;
  pct: number;
}

export interface BoardSummary {
  epics: { epic: Epic; progress: EpicProgress }[];
  status_counts: Record<string, number>;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/epics`;

export const listEpics = (projectId: string) => apiGet<Epic[]>(base(projectId));
export const createEpic = (projectId: string, input: EpicInput) => apiPost<Epic>(base(projectId), input);
export const updateEpic = (
  projectId: string,
  epicId: string,
  patch: Partial<EpicInput> & { status?: EpicStatus; clear_release?: boolean },
) => apiPatch<Epic>(`${base(projectId)}/${epicId}`, patch);
export const deleteEpic = (projectId: string, epicId: string) => apiDelete(`${base(projectId)}/${epicId}`);

export const getBoardSummary = (projectId: string) =>
  apiGet<BoardSummary>(`/studio/projects/${projectId}/board/summary`);
