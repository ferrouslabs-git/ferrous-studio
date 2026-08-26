// Client for /api/studio/* (backend/app/studio/router.py). All calls run
// under the active workspace scope set by the session provider.
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../core/api";
import { OpBatch, OpBatchResult, PageDocument, PageRecord } from "../studio/model/types";

export interface Project {
  id: string;
  space_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  status: "active" | "archived";
  schema_version: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PageSummary {
  id: string;
  name: string;
  route: string | null;
  pos: string;
  version: number;
}

export interface ProjectDetail extends Project {
  custom_components: unknown[];
  pages: PageSummary[];
}

export interface ProjectVersion {
  id: string;
  label: string | null;
  reason: string;
  created_by: string | null;
  created_at: string;
}

export const listProjects = () => apiGet<Project[]>("/studio/projects");
export const createProject = (name: string, description?: string) =>
  apiPost<ProjectDetail>("/studio/projects", { name, description: description ?? null });
export const getProject = (id: string) => apiGet<ProjectDetail>(`/studio/projects/${id}`);
export const updateProject = (id: string, patch: Partial<Pick<Project, "name" | "description" | "status">>) =>
  apiPatch<Project>(`/studio/projects/${id}`, patch);
export const deleteProject = (id: string) => apiDelete(`/studio/projects/${id}`);
export const replaceCustomComponents = (id: string, customComponents: unknown[]) =>
  apiPut<Project>(`/studio/projects/${id}/custom-components`, { custom_components: customComponents });
export const getProjectExport = (id: string) => apiGet<Record<string, unknown>>(`/studio/projects/${id}/export`);

export const getPage = (projectId: string, pageId: string) =>
  apiGet<PageRecord>(`/studio/projects/${projectId}/pages/${pageId}`);
export const createPage = (
  projectId: string,
  page: { id?: string; name: string; route?: string | null; pos: string; document?: PageDocument },
) => apiPost<PageRecord>(`/studio/projects/${projectId}/pages`, page);
export const deletePage = (projectId: string, pageId: string) =>
  apiDelete(`/studio/projects/${projectId}/pages/${pageId}`);

/** The op-batch endpoint. Throws ApiError(409) with an OpConflictBody on conflict. */
export const sendOpBatch = (projectId: string, batch: OpBatch) =>
  apiPost<OpBatchResult>(`/studio/projects/${projectId}/ops`, {
    client_batch_id: batch.clientBatchId,
    page_id: batch.pageId,
    base_version: batch.baseVersion,
    ops: batch.ops,
  });

export const listVersions = (projectId: string) =>
  apiGet<ProjectVersion[]>(`/studio/projects/${projectId}/versions`);
export const createVersion = (projectId: string, label?: string) =>
  apiPost<ProjectVersion>(`/studio/projects/${projectId}/versions`, { label: label ?? null });
