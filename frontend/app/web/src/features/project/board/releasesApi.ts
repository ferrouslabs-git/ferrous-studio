// Client for a project's board releases (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";
import type { Rollup } from "./effort";
import type { DeliveryStatus } from "./sprintsApi";

export interface Release {
  id: string;
  human_id: string;
  title: string;
  // Derived, not settable -- the end of the latest sprint filed under this
  // release. Null means no sprint with an end date is filed under it yet.
  date: string | null;
  description: string;
  // Same free-moving vocabulary a sprint uses. "DeployedToLive" is what
  // shipping means here -- it replaced a separate "Mark shipped" toggle on
  // 2026-09-14.
  status: DeliveryStatus;
  // Stamped by the server the first time status reaches DeployedToLive, and
  // never cleared by moving away again: the date it first went out stays
  // true. Not settable.
  shipped_at: string | null;
  progress: Rollup;
  created_at: string;
  updated_at: string;
}

export type ReleaseCreateInput = Pick<Release, "title" | "description">;
export type ReleaseUpdateInput = Partial<Pick<Release, "title" | "description" | "status">>;

const base = (projectId: string) => `/studio/projects/${projectId}/board/releases`;

export const listReleases = (projectId: string) => apiGet<Release[]>(base(projectId));
export const getRelease = (projectId: string, releaseId: string) => apiGet<Release>(`${base(projectId)}/${releaseId}`);
export const createRelease = (projectId: string, input: ReleaseCreateInput) => apiPost<Release>(base(projectId), input);
export const updateRelease = (projectId: string, releaseId: string, patch: ReleaseUpdateInput) =>
  apiPatch<Release>(`${base(projectId)}/${releaseId}`, patch);
export const deleteRelease = (projectId: string, releaseId: string) => apiDelete(`${base(projectId)}/${releaseId}`);
