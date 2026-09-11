// Client for a project's board epics (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";
import type { Rollup } from "./effort";

// Where the epic itself sits in the agreed Definition-of-Done lifecycle --
// distinct from the live done/doing progress rolled up from its
// requirements. The route refuses a transition into "Done" unless every
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
  status?: EpicStatus;
  release_id: string | null;
}

export type EpicInput = EpicCreateInput;

export interface EpicPatch {
  title?: string;
  summary?: string;
  status?: EpicStatus;
  release_id?: string | null;
  clear_release?: boolean;
}

export interface BoardSummary {
  epics: { epic: Epic; progress: Rollup }[];
  status_counts: Record<string, number>;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/epics`;

export const listEpics = (projectId: string) => apiGet<Epic[]>(base(projectId));
export const getEpic = (projectId: string, epicId: string) => apiGet<Epic>(`${base(projectId)}/${epicId}`);
export const createEpic = (projectId: string, input: EpicInput) => apiPost<Epic>(base(projectId), input);
export const updateEpic = (projectId: string, epicId: string, patch: EpicPatch) =>
  apiPatch<Epic>(`${base(projectId)}/${epicId}`, patch);
export const deleteEpic = (projectId: string, epicId: string) => apiDelete(`${base(projectId)}/${epicId}`);

export const getBoardSummary = (projectId: string) =>
  apiGet<BoardSummary>(`/studio/projects/${projectId}/board/summary`);
