// Client for a project's board features (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

export interface Feature {
  id: string;
  human_id: string;
  epic_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/features`;

export const listFeatures = (projectId: string, epicId?: string) =>
  apiGet<Feature[]>(epicId ? `${base(projectId)}?epic_id=${epicId}` : base(projectId));
export const createFeature = (projectId: string, epicId: string, title: string) =>
  apiPost<Feature>(base(projectId), { epic_id: epicId, title });
export const updateFeature = (projectId: string, featureId: string, title: string) =>
  apiPatch<Feature>(`${base(projectId)}/${featureId}`, { title });
export const deleteFeature = (projectId: string, featureId: string) => apiDelete(`${base(projectId)}/${featureId}`);
