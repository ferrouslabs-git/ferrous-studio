// Client for a project's board epics (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";
import type { Rollup } from "./effort";

import type { RequirementStatus } from "./requirementsApi";

export interface Epic {
  id: string;
  human_id: string;
  title: string;
  summary: string;
  // Rolled up by the server from every requirement under this epic --
  // attached directly, or through one of its features. Read-only: it moves
  // by moving the work, which is why no input type below accepts it.
  status: RequirementStatus;
  release_id: string | null;
  /** Who is looking after the epic; null is unassigned. */
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EpicInput {
  title: string;
  summary: string;
  release_id: string | null;
  assignee_id?: string | null;
}

export interface EpicPatch {
  title?: string;
  summary?: string;
  release_id?: string | null;
  clear_release?: boolean;
  // Null on the wire means "leave it alone", as it does for release_id;
  // clearing an assignment is the flag.
  assignee_id?: string | null;
  clear_assignee?: boolean;
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
