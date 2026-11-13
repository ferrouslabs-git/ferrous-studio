// Client for a project's high-fidelity designs (backend app/studio/designs.py).
//
// Studio authors only the brief -- which wireframe, a name, the aesthetics
// text and the reference images. The design itself lives in a Figma Make file
// and reaches Studio as read-only revisions, so there is deliberately no call
// here that changes a design's content: no revision is created, edited or
// deleted from the browser. See docs/high-fidelity-design.md.
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";
import type { Design, DesignInput, DesignPatch, DesignRevision } from "./designModel";

export * from "./designModel";

const base = (projectId: string) => `/studio/projects/${projectId}/designs`;

export const listDesigns = (projectId: string) => apiGet<Design[]>(base(projectId));
export const getDesign = (projectId: string, designId: string) => apiGet<Design>(`${base(projectId)}/${designId}`);
export const createDesign = (projectId: string, input: DesignInput) => apiPost<Design>(base(projectId), input);
export const updateDesign = (projectId: string, designId: string, patch: DesignPatch) =>
  apiPatch<Design>(`${base(projectId)}/${designId}`, patch);
export const deleteDesign = (projectId: string, designId: string) => apiDelete(`${base(projectId)}/${designId}`);
export const listDesignRevisions = (projectId: string, designId: string) =>
  apiGet<DesignRevision[]>(`${base(projectId)}/${designId}/revisions`);
/** A short-lived URL serving the revision inline from storage, for the sandboxed frame. */
export const getRevisionViewUrl = (projectId: string, designId: string, revisionId: string) =>
  apiGet<{ url: string; expires_in: number }>(`${base(projectId)}/${designId}/revisions/${revisionId}/view`);
