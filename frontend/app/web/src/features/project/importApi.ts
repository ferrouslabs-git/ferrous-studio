// Client for POST /studio/projects/{id}/import (backend
// app/studio/importing.py): the inverse of a project/wireframe export.
import { apiPost } from "../../core/api";

export interface ImportedWireframe {
  id: string;
  name: string;
  pages: number;
}

export interface ImportedDiagram {
  id: string;
  name: string;
}

export interface ImportCounts {
  created: number;
  matched: number;
}

export interface ImportResult {
  wireframes: ImportedWireframe[];
  diagrams: ImportedDiagram[];
  actors: ImportCounts;
  use_cases: ImportCounts;
  datasets: ImportCounts;
  warnings: string[];
}

export interface BundleError {
  path: string;
  message: string;
}

/** The 422 body's shape: `err.body` on the thrown ApiError, not nested under
 *  a second "detail" key (the route returns this JSONResponse directly). */
export interface BundleValidationFailure {
  errors: BundleError[];
}

export const importBundle = (projectId: string, bundle: unknown) =>
  apiPost<ImportResult>(`/studio/projects/${projectId}/import`, bundle);
