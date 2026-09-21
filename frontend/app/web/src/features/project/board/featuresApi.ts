// Client for a project's board features (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";
import type { RequirementStatus } from "./requirementsApi";

export interface Feature {
  id: string;
  human_id: string;
  epic_id: string;
  title: string;
  // Rolled up by the server from this feature's own requirements.
  // Read-only, as Epic.status is.
  status: RequirementStatus;
  /** Who is looking after the feature; null is unassigned. */
  assignee_id: string | null;
  created_at: string;
  updated_at: string;
}

/** The PATCH body. ``title`` is required by the server -- the route has only
 *  ever taken a rename, and an older client sends nothing else. */
export interface FeaturePatch {
  title: string;
  assignee_id?: string | null;
  clear_assignee?: boolean;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/features`;

export const listFeatures = (projectId: string) => apiGet<Feature[]>(base(projectId));
export const createFeature = (projectId: string, epicId: string, title: string) =>
  apiPost<Feature>(base(projectId), { epic_id: epicId, title });
export const updateFeature = (projectId: string, featureId: string, patch: FeaturePatch) =>
  apiPatch<Feature>(`${base(projectId)}/${featureId}`, patch);
export const deleteFeature = (projectId: string, featureId: string) => apiDelete(`${base(projectId)}/${featureId}`);
