// Client for a project's board sprints (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

export type SprintState = "planned" | "active" | "done";

export interface Sprint {
  id: string;
  human_id: string;
  name: string;
  goal: string;
  start_date: string | null;
  end_date: string | null;
  state: SprintState;
  release_id: string | null;
  capacity_hours: number | null;
  created_at: string;
  updated_at: string;
}

export interface SprintInput {
  name: string;
  goal: string;
  start_date: string | null;
  end_date: string | null;
  release_id: string | null;
  capacity_hours: number | null;
}

export interface SprintUpdateResult {
  sprint: Sprint;
  returned_to_backlog: number;
}

export interface BurndownPoint {
  day: string;
  remaining: number | null;
  ideal: number | null;
}

export interface Burndown {
  sprint_id: string;
  note: string | null;
  total_start: number;
  points: BurndownPoint[];
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/sprints`;

export const listSprints = (projectId: string) => apiGet<Sprint[]>(base(projectId));
export const createSprint = (projectId: string, input: SprintInput) => apiPost<Sprint>(base(projectId), input);
export const updateSprint = (
  projectId: string,
  sprintId: string,
  patch: Partial<SprintInput> & { state?: SprintState; clear_release?: boolean },
) => apiPatch<SprintUpdateResult>(`${base(projectId)}/${sprintId}`, patch);
export const deleteSprint = (projectId: string, sprintId: string) => apiDelete(`${base(projectId)}/${sprintId}`);
export const getBurndown = (projectId: string, sprintId: string) =>
  apiGet<Burndown>(`${base(projectId)}/${sprintId}/burndown`);
