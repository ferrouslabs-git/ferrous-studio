// Client for a project's board requirements (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

// Blocked is a flag, not a stage on the normal path -- a requirement can be
// blocked from any of Todo/Doing/Review. blocked_from records which one, so
// unblocking (setting status back to it) returns the item there instead of
// losing that context; it's computed by the server on the transition, never
// sent directly. Ported from software-management (static/js/core.js).
export type RequirementStatus = "Todo" | "Doing" | "Review" | "Blocked" | "Done";
export const REQUIREMENT_STATUSES: RequirementStatus[] = ["Todo", "Doing", "Review", "Blocked", "Done"];

export type RequirementPriority = "Low" | "Medium" | "High" | "Urgent";
export const REQUIREMENT_PRIORITIES: RequirementPriority[] = ["Low", "Medium", "High", "Urgent"];

export interface Requirement {
  id: string;
  human_id: string;
  title: string;
  body: string;
  epic_id: string | null;
  feature_id: string | null;
  status: RequirementStatus;
  blocked_from: RequirementStatus | null;
  priority: RequirementPriority;
  assignee_id: string | null;
  release_id: string | null;
  sprint_id: string | null;
  // Hours; null means "not estimated", which is distinct from zero.
  estimate_hours: number | null;
  // The agent work order within its sprint: null = not ordered, lower = earlier.
  // Positions repeat across sprints and are cleared when a requirement leaves one.
  queue_position: number | null;
  effective_epic_id: string | null;
  effective_release_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RequirementInput {
  title: string;
  body: string;
  epic_id: string | null;
  feature_id: string | null;
  status: RequirementStatus;
  priority: RequirementPriority;
  assignee_id: string | null;
  release_id: string | null;
  sprint_id: string | null;
  estimate_hours?: number | null;
}

export interface RequirementPatch extends Partial<RequirementInput> {
  clear_epic?: boolean;
  clear_feature?: boolean;
  clear_assignee?: boolean;
  clear_release?: boolean;
  clear_sprint?: boolean;
  // Null is meaningful for both: it clears the value, so neither needs a clear_ flag.
  estimate_hours?: number | null;
  queue_position?: number | null;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/requirements`;

export const listRequirements = (
  projectId: string,
  filters?: { status?: string; epic_id?: string; feature_id?: string; sprint_id?: string },
) => {
  const params = new URLSearchParams(filters as Record<string, string>).toString();
  return apiGet<Requirement[]>(params ? `${base(projectId)}?${params}` : base(projectId));
};
export const getRequirement = (projectId: string, requirementId: string) =>
  apiGet<Requirement>(`${base(projectId)}/${requirementId}`);
export const createRequirement = (projectId: string, input: RequirementInput) =>
  apiPost<Requirement>(base(projectId), input);
export const updateRequirement = (projectId: string, requirementId: string, patch: RequirementPatch) =>
  apiPatch<Requirement>(`${base(projectId)}/${requirementId}`, patch);
export const deleteRequirement = (projectId: string, requirementId: string) =>
  apiDelete(`${base(projectId)}/${requirementId}`);
export const claimRequirement = (projectId: string, requirementId: string) =>
  apiPost<Requirement>(`${base(projectId)}/${requirementId}/claim`, {});
