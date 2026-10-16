// Client for reusable datasets: the value lists wireframe elements (list
// columns, dropdowns) bind to instead of hand-typed samples (backend
// app/studio/datasets.py). A project's listing merges the platform defaults
// (scope "platform", read-only here) with the project's own rows; the
// /admin routes manage the platform defaults and need no organisation scope.
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";
import type { DataKind } from "../../studio/catalog";
import { normaliseDatasetValues } from "./datasetValues";

export type DatasetScope = "platform" | "project";

export interface Dataset {
  id: string;
  name: string;
  kind: DataKind;
  values: string[];
  /** Other words an element label may use for this list (FS-REQ-61). */
  match_terms: string[];
  pos: string;
  scope: DatasetScope;
  created_at: string;
  updated_at: string;
}

export interface DatasetInput {
  name: string;
  kind: DataKind;
  values: string[];
  match_terms?: string[];
}

const base = (projectId: string) => `/studio/projects/${projectId}/datasets`;

/** Listings pass through normaliseDatasetValues, so a dataset saved as one
 *  comma-joined value reaches every element as separate values (FS-REQ-63). */
const normalised = (rows: Dataset[]): Dataset[] =>
  rows.map((d) => ({ ...d, values: normaliseDatasetValues(d.values ?? []) }));

export const listDatasets = (projectId: string) => apiGet<Dataset[]>(base(projectId)).then(normalised);
export const createDataset = (projectId: string, input: DatasetInput) =>
  apiPost<Dataset>(base(projectId), input);
export const updateDataset = (projectId: string, datasetId: string, patch: Partial<DatasetInput>) =>
  apiPatch<Dataset>(`${base(projectId)}/${datasetId}`, patch);
export const deleteDataset = (projectId: string, datasetId: string) =>
  apiDelete(`${base(projectId)}/${datasetId}`);

// ── Platform defaults (super admin) ─────────────────────────────────────────

const ADMIN = "/studio/admin/datasets";

export const listPlatformDatasets = () => apiGet<Dataset[]>(ADMIN, { scope: null }).then(normalised);
export const createPlatformDataset = (input: DatasetInput) => apiPost<Dataset>(ADMIN, input, { scope: null });
export const updatePlatformDataset = (datasetId: string, patch: Partial<DatasetInput>) =>
  apiPatch<Dataset>(`${ADMIN}/${datasetId}`, patch, { scope: null });
export const deletePlatformDataset = (datasetId: string) => apiDelete(`${ADMIN}/${datasetId}`, { scope: null });
