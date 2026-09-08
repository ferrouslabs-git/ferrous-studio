// Client for a project's board releases (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

export interface ReleaseProgress {
  done: number;
  doing: number;
  total: number;
  pct: number;
}

export interface Release {
  id: string;
  human_id: string;
  title: string;
  // Derived, not settable -- the end of the latest sprint filed under this
  // release. Null means no sprint with an end date is filed under it yet.
  date: string | null;
  description: string;
  shipped_at: string | null;
  progress: ReleaseProgress;
  created_at: string;
  updated_at: string;
}

export type ReleaseCreateInput = Pick<Release, "title" | "description">;
export type ReleaseUpdateInput = Partial<Pick<Release, "title" | "description">> & { shipped?: boolean };

const base = (projectId: string) => `/studio/projects/${projectId}/board/releases`;

export const listReleases = (projectId: string) => apiGet<Release[]>(base(projectId));
export const createRelease = (projectId: string, input: ReleaseCreateInput) => apiPost<Release>(base(projectId), input);
export const updateRelease = (projectId: string, releaseId: string, patch: ReleaseUpdateInput) =>
  apiPatch<Release>(`${base(projectId)}/${releaseId}`, patch);
export const deleteRelease = (projectId: string, releaseId: string) => apiDelete(`${base(projectId)}/${releaseId}`);
