// Client for a project's board releases (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

export interface Release {
  id: string;
  human_id: string;
  title: string;
  release_date: string | null;
  description: string;
  created_at: string;
  updated_at: string;
}

export type ReleaseInput = Pick<Release, "title" | "release_date" | "description">;

const base = (projectId: string) => `/studio/projects/${projectId}/board/releases`;

export const listReleases = (projectId: string) => apiGet<Release[]>(base(projectId));
export const createRelease = (projectId: string, input: ReleaseInput) => apiPost<Release>(base(projectId), input);
export const updateRelease = (projectId: string, releaseId: string, patch: Partial<ReleaseInput>) =>
  apiPatch<Release>(`${base(projectId)}/${releaseId}`, patch);
export const deleteRelease = (projectId: string, releaseId: string) => apiDelete(`${base(projectId)}/${releaseId}`);
