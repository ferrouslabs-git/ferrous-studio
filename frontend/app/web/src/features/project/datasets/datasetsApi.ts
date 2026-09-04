// Client for reusable datasets: the value lists wireframe elements (list
// columns, dropdowns) bind to instead of hand-typed samples (backend
// app/studio/datasets.py). A project's listing merges the platform defaults
// (scope "platform", read-only here) with the project's own rows; the
// /admin routes manage the platform defaults and need no organisation scope.
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";
import type { DataKind } from "../../studio/catalog";

export type DatasetScope = "platform" | "project";

export interface Dataset {
  id: string;
  name: string;
  kind: DataKind;
  values: string[];
  pos: string;
  scope: DatasetScope;
  created_at: string;
  updated_at: string;
}

export interface DatasetInput {
  name: string;
  kind: DataKind;
  values: string[];
}

const base = (projectId: string) => `/studio/projects/${projectId}/datasets`;

export const listDatasets = (projectId: string) => apiGet<Dataset[]>(base(projectId));
export const createDataset = (projectId: string, input: DatasetInput) =>
  apiPost<Dataset>(base(projectId), input);
export const updateDataset = (projectId: string, datasetId: string, patch: Partial<DatasetInput>) =>
  apiPatch<Dataset>(`${base(projectId)}/${datasetId}`, patch);
export const deleteDataset = (projectId: string, datasetId: string) =>
  apiDelete(`${base(projectId)}/${datasetId}`);

// ── Platform defaults (super admin) ─────────────────────────────────────────

const ADMIN = "/studio/admin/datasets";

export const listPlatformDatasets = () => apiGet<Dataset[]>(ADMIN, { scope: null });
export const createPlatformDataset = (input: DatasetInput) => apiPost<Dataset>(ADMIN, input, { scope: null });
export const updatePlatformDataset = (datasetId: string, patch: Partial<DatasetInput>) =>
  apiPatch<Dataset>(`${ADMIN}/${datasetId}`, patch, { scope: null });
export const deletePlatformDataset = (datasetId: string) => apiDelete(`${ADMIN}/${datasetId}`, { scope: null });
