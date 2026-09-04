// Client for a wireframe's developer annotations: notes (flat) and tasks
// (resolvable), pinned to a region, component or element of a page
// (backend app/studio/annotations.py). Target ids are the document's own
// bare uids -- the studio strips its `el:` address prefix before sending.
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

export type AnnotationKind = "note" | "task";
export type AnnotationTargetKind = "region" | "cmp" | "element";

export interface WireframeAnnotation {
  id: string;
  wireframe_id: string;
  page_id: string;
  kind: AnnotationKind;
  /** Human-facing number, unique per wireframe per kind and never reused. */
  seq: number;
  target_kind: AnnotationTargetKind;
  target_id: string;
  /** Owning component; element targets only. */
  target_cmp_id: string | null;
  /** Display snapshot taken at creation, for targets no longer on a canvas. */
  target_label: string;
  text: string;
  created_by: string | null;
  author_name: string | null;
  author_email: string | null;
  updated_by: string | null;
  /** Task lifecycle; null = open. Always null for notes. */
  resolved_at: string | null;
  resolved_by: string | null;
  resolver_name: string | null;
  resolver_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnnotationInput {
  page_id: string;
  kind: AnnotationKind;
  target_kind: AnnotationTargetKind;
  target_id: string;
  target_cmp_id?: string | null;
  target_label: string;
  text: string;
}

/** The reference shown and searched everywhere: N-3 for notes, T-7 for tasks. */
export const annotationRef = (a: Pick<WireframeAnnotation, "kind" | "seq">): string =>
  `${a.kind === "task" ? "T" : "N"}-${a.seq}`;

const base = (projectId: string, wireframeId: string) =>
  `/studio/projects/${projectId}/wireframes/${wireframeId}/annotations`;

export const listWireframeAnnotations = (projectId: string, wireframeId: string) =>
  apiGet<WireframeAnnotation[]>(base(projectId, wireframeId));
export const createWireframeAnnotation = (projectId: string, wireframeId: string, input: AnnotationInput) =>
  apiPost<WireframeAnnotation>(base(projectId, wireframeId), input);
export const updateWireframeAnnotation = (
  projectId: string,
  wireframeId: string,
  annotationId: string,
  patch: { text?: string; resolved?: boolean },
) => apiPatch<WireframeAnnotation>(`${base(projectId, wireframeId)}/${annotationId}`, patch);
export const deleteWireframeAnnotation = (projectId: string, wireframeId: string, annotationId: string) =>
  apiDelete(`${base(projectId, wireframeId)}/${annotationId}`);
