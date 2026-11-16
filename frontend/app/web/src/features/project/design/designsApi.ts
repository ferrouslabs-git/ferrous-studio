// Client for a project's high-fidelity designs (backend app/studio/designs.py).
//
// Studio authors only the brief -- which wireframes, a name, the aesthetics
// text and the reference images. The design itself lives in a Figma Make file
// and Studio frames the site published from it, so there is deliberately no
// call here that changes a design's content. See docs/high-fidelity-design.md.
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";
import type { Design, DesignInput, DesignPatch } from "./designModel";

export * from "./designModel";

const base = (projectId: string) => `/studio/projects/${projectId}/designs`;

export const listDesigns = (projectId: string) => apiGet<Design[]>(base(projectId));
export const getDesign = (projectId: string, designId: string) => apiGet<Design>(`${base(projectId)}/${designId}`);
export const createDesign = (projectId: string, input: DesignInput) => apiPost<Design>(base(projectId), input);
export const updateDesign = (projectId: string, designId: string, patch: DesignPatch) =>
  apiPatch<Design>(`${base(projectId)}/${designId}`, patch);
export const deleteDesign = (projectId: string, designId: string) => apiDelete(`${base(projectId)}/${designId}`);
