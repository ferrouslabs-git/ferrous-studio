// Client for the project-level part of /api/studio/* (backend
// app/studio/projects.py). All calls run under the active organisation scope
// set by the session provider. Pages, ops and versions belong to a wireframe
// now -- see features/project/wireframes/wireframesApi.ts.
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../core/api";
import { Wireframe } from "../project/wireframes/wireframesApi";

export interface Project {
  id: string;
  account_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  rationale: string | null;
  status: "active" | "archived";
  schema_version: string;
  /** Concurrency counter for custom_components -- not the version number. */
  version: number;
  /** Shared by every version of this project; equal to `id` on the original. */
  lineage_id: string;
  /** The version this one was copied from; null on the original. */
  parent_project_id: string | null;
  version_no: number;
  version_label: string | null;
  /** Set while this version is frozen. Non-null means the whole project is read-only. */
  locked_at: string | null;
  locked_by: string | null;
  created_at: string;
  updated_at: string;
}

/** One version in a project's lineage, as the switcher and the list show it. */
export interface ProjectVersionSummary {
  id: string;
  name: string;
  version_no: number;
  version_label: string | null;
  parent_project_id: string | null;
  status: "active" | "archived";
  locked_at: string | null;
  updated_at: string;
}

export interface PageSummary {
  id: string;
  name: string;
  route: string | null;
  pos: string;
  /** Child pages render inside a region of their parent (the outlet model). */
  placement: { page_id: string; region_id: string } | null;
  /** Links to this page open it as an overlay; null navigates as usual. */
  presentation: "modal" | "drawer" | "drawer-left" | null;
  version: number;
}

export interface SectionCounts {
  personas: number;
  diagrams: number;
  wireframes: number;
  documents: number;
}

export interface ProjectDetail extends Project {
  custom_components: unknown[];
  wireframes: Wireframe[];
  counts: SectionCounts;
}

export interface ProjectInput {
  name: string;
  description?: string | null;
  rationale?: string | null;
}

export const listProjects = () => apiGet<Project[]>("/studio/projects");

/** A project as the platform-wide listing returns it: with its owning organisation. */
export interface AdminProject extends Project {
  account_name: string;
}
/** Platform admins only. Spans organisations, so it deliberately sends no scope. */
export const listAllProjects = () => apiGet<AdminProject[]>("/studio/admin/projects", { scope: null });
export const createProject = (input: ProjectInput) =>
  apiPost<ProjectDetail>("/studio/projects", {
    name: input.name,
    description: input.description ?? null,
    rationale: input.rationale ?? null,
  });
export const getProject = (id: string) => apiGet<ProjectDetail>(`/studio/projects/${id}`);
export const updateProject = (
  id: string,
  patch: Partial<Pick<Project, "name" | "description" | "rationale" | "status">>,
) => apiPatch<Project>(`/studio/projects/${id}`, patch);
export const deleteProject = (id: string) => apiDelete(`/studio/projects/${id}`);
export const replaceCustomComponents = (id: string, customComponents: unknown[]) =>
  apiPut<Project>(`/studio/projects/${id}/custom-components`, { custom_components: customComponents });
export const getProjectExport = (id: string) => apiGet<Record<string, unknown>>(`/studio/projects/${id}/export`);

/** Every version of this project, oldest first. */
export const listProjectVersions = (id: string) =>
  apiGet<ProjectVersionSummary[]>(`/studio/projects/${id}/versions`);

/**
 * Copy the whole project into a new version, freezing this one.
 *
 * `key` makes the call safe to retry: the server returns the version a key
 * already created rather than copying again, so a double-click or a retry
 * after a timeout cannot leave two versions quietly diverging.
 */
export const createProjectVersion = (id: string, input: { key: string; label?: string | null; lockSource?: boolean }) =>
  apiPost<ProjectDetail>(`/studio/projects/${id}/versions`, {
    key: input.key,
    label: input.label ?? null,
    lock_source: input.lockSource ?? true,
  });

export const unlockProject = (id: string) => apiPost<Project>(`/studio/projects/${id}/unlock`, {});
export const lockProject = (id: string) => apiPost<Project>(`/studio/projects/${id}/lock`, {});

/** Where a project opens. Lives here so every "Open" link agrees. */
export const projectPath = (orgId: string, projectId: string) => `/orgs/${orgId}/projects/${projectId}`;
