// Client for a project's board sprints (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";
import type { Agent } from "./agentsApi";
import type { BoardComment } from "./commentsApi";
import type { BoardEvent } from "./eventsApi";
import type { Requirement } from "./requirementsApi";

export type SprintState = "planned" | "active" | "done";
export const SPRINT_STATES: SprintState[] = ["planned", "active", "done"];

export interface Sprint {
  id: string;
  human_id: string;
  name: string;
  goal: string;
  start_date: string | null;
  end_date: string | null;
  state: SprintState;
  // A sprint always belongs to a release (the server refuses one without);
  // null only on rows from before that rule, which the UI files on request.
  release_id: string | null;
  // Hours the sprint can hold; null reads as the reference's default of 80.
  capacity_hours: number | null;
  created_at: string;
  updated_at: string;
}

export interface SprintInput {
  name: string;
  goal: string;
  start_date: string | null;
  end_date: string | null;
  release_id: string;
  capacity_hours: number | null;
}

export type SprintPatch = Partial<Omit<SprintInput, "release_id">> & {
  release_id?: string;
  state?: SprintState;
};

export interface SprintUpdateResult {
  sprint: Sprint;
  // Populated only on a -> done transition: how many unfinished requirements
  // were returned to the backlog.
  returned_to_backlog: number;
}

// Day-by-day burndown, reconstructed from sprint-membership history and
// status events. Parallel arrays over `dates`; the "actual" series are null
// for days after today. Hours series sum estimate_hours; an unestimated
// requirement counts 0 there, which is only honest alongside
// unestimated_count -- the UI shows item counts unless coverage is complete.
export interface Burndown {
  sprint_id: string;
  note: string | null;
  dates: string[];
  remaining: (number | null)[];
  ideal: number[];
  total: number;
  remaining_hours: (number | null)[];
  ideal_hours: number[];
  total_hours: number;
  scope: (number | null)[];
  scope_hours: (number | null)[];
  estimated_count: number;
  unestimated_count: number;
}

export interface SprintQuestion {
  requirement: Pick<Requirement, "id" | "human_id" | "title" | "epic_id" | "priority" | "blocked_from">;
  comment: BoardComment;
}

// Everything the sprint board polls for in one round trip.
export interface SprintActivity {
  sprint: Sprint;
  requirements: Requirement[];
  agents: Agent[];
  events: BoardEvent[];
  questions: SprintQuestion[];
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/sprints`;

export const listSprints = (projectId: string) => apiGet<Sprint[]>(base(projectId));
export const getSprint = (projectId: string, sprintId: string) => apiGet<Sprint>(`${base(projectId)}/${sprintId}`);
export const createSprint = (projectId: string, input: SprintInput) => apiPost<Sprint>(base(projectId), input);
export const updateSprint = (projectId: string, sprintId: string, patch: SprintPatch) =>
  apiPatch<SprintUpdateResult>(`${base(projectId)}/${sprintId}`, patch);
export const deleteSprint = (projectId: string, sprintId: string) => apiDelete(`${base(projectId)}/${sprintId}`);
export const getBurndown = (projectId: string, sprintId: string) =>
  apiGet<Burndown>(`${base(projectId)}/${sprintId}/burndown`);
export const getSprintActivity = (projectId: string, sprintId: string, limit = 60) =>
  apiGet<SprintActivity>(`${base(projectId)}/${sprintId}/activity?limit=${limit}`);
