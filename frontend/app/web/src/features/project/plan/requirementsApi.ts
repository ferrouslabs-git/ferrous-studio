// Client for a project's board requirements (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

export type RequirementStatus = "Todo" | "Doing" | "Done";
export const REQUIREMENT_STATUSES: RequirementStatus[] = ["Todo", "Doing", "Done"];

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
  priority: RequirementPriority;
  assignee_id: string | null;
  release_id: string | null;
  sprint_id: string | null;
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
}

export interface RequirementPatch extends Partial<RequirementInput> {
  clear_epic?: boolean;
  clear_feature?: boolean;
  clear_assignee?: boolean;
  clear_release?: boolean;
  clear_sprint?: boolean;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/requirements`;

export const listRequirements = (
  projectId: string,
  filters?: { status?: string; epic_id?: string; feature_id?: string; sprint_id?: string },
) => {
  const params = new URLSearchParams(filters as Record<string, string>).toString();
  return apiGet<Requirement[]>(params ? `${base(projectId)}?${params}` : base(projectId));
};
export const createRequirement = (projectId: string, input: RequirementInput) =>
  apiPost<Requirement>(base(projectId), input);
export const updateRequirement = (projectId: string, requirementId: string, patch: RequirementPatch) =>
  apiPatch<Requirement>(`${base(projectId)}/${requirementId}`, patch);
export const deleteRequirement = (projectId: string, requirementId: string) =>
  apiDelete(`${base(projectId)}/${requirementId}`);
export const claimRequirement = (projectId: string, requirementId: string) =>
  apiPost<Requirement>(`${base(projectId)}/${requirementId}/claim`, {});
