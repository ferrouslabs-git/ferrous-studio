// Client for a project's wireframes and everything that hangs off one:
// pages, op batches, version snapshots (backend app/studio/wireframes.py).
// `base()` is the single point of change if the backend paths move.
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../../core/api";
import { OpBatch, OpBatchResult, PageDocument, PageRecord } from "../../studio/model/types";
import type { PageSummary } from "../../projects/projectsApi";

export type InterfaceType = "desktop" | "tablet" | "mobile";

export const INTERFACE_TYPES: { value: InterfaceType; label: string }[] = [
  { value: "desktop", label: "Desktop" },
  { value: "tablet", label: "Tablet" },
  { value: "mobile", label: "Mobile" },
];

export interface Wireframe {
  id: string;
  project_id: string;
  name: string;
  interface_type: InterfaceType;
  pos: string;
  /** Personas this wireframe is designed for (Personas section). */
  persona_ids: string[];
  /** User types (use case diagram actors) this wireframe is designed for. */
  actor_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface WireframeDetail extends Wireframe {
  pages: PageSummary[];
}

export interface WireframeInput {
  name: string;
  interface_type: InterfaceType;
  persona_ids: string[];
  actor_ids: string[];
}

export interface ProjectVersion {
  id: string;
  label: string | null;
  reason: string;
  created_by: string | null;
  created_at: string;
}

const list = (projectId: string) => `/studio/projects/${projectId}/wireframes`;
const base = (projectId: string, wireframeId: string) => `${list(projectId)}/${wireframeId}`;

export const listWireframes = (projectId: string) => apiGet<Wireframe[]>(list(projectId));
export const createWireframe = (projectId: string, input: WireframeInput) =>
  apiPost<WireframeDetail>(list(projectId), input);
export const getWireframe = (projectId: string, wireframeId: string) =>
  apiGet<WireframeDetail>(base(projectId, wireframeId));
export const updateWireframe = (
  projectId: string,
  wireframeId: string,
  patch: Partial<Pick<Wireframe, "name" | "interface_type" | "pos">>,
) => apiPatch<Wireframe>(base(projectId, wireframeId), patch);
export const setWireframePersonas = (projectId: string, wireframeId: string, personaIds: string[]) =>
  apiPut<Wireframe>(`${base(projectId, wireframeId)}/personas`, { persona_ids: personaIds });
export const setWireframeActors = (projectId: string, wireframeId: string, actorIds: string[]) =>
  apiPut<Wireframe>(`${base(projectId, wireframeId)}/actors`, { actor_ids: actorIds });
export const deleteWireframe = (projectId: string, wireframeId: string) => apiDelete(base(projectId, wireframeId));
export const getWireframeExport = (projectId: string, wireframeId: string) =>
  apiGet<Record<string, unknown>>(`${base(projectId, wireframeId)}/export`);

// ── Pages ─────────────────────────────────────────────────────────────────

export const getWireframePage = (projectId: string, wireframeId: string, pageId: string) =>
  apiGet<PageRecord>(`${base(projectId, wireframeId)}/pages/${pageId}`);
export const createWireframePage = (
  projectId: string,
  wireframeId: string,
  page: {
    id?: string;
    name: string;
    route?: string | null;
    pos: string;
    placement?: { page_id: string; region_id: string };
    document?: PageDocument;
  },
) => apiPost<PageRecord>(`${base(projectId, wireframeId)}/pages`, page);
export const deleteWireframePage = (projectId: string, wireframeId: string, pageId: string) =>
  apiDelete(`${base(projectId, wireframeId)}/pages/${pageId}`);

/** The op-batch endpoint. Throws ApiError(409) with an OpConflictBody on conflict. */
export const sendWireframeOpBatch = (projectId: string, wireframeId: string, batch: OpBatch) =>
  apiPost<OpBatchResult>(`${base(projectId, wireframeId)}/ops`, {
    client_batch_id: batch.clientBatchId,
    page_id: batch.pageId,
    base_version: batch.baseVersion,
    ops: batch.ops,
  });

// ── Versions ──────────────────────────────────────────────────────────────

export const listWireframeVersions = (projectId: string, wireframeId: string) =>
  apiGet<ProjectVersion[]>(`${base(projectId, wireframeId)}/versions`);
export const createWireframeVersion = (projectId: string, wireframeId: string, label?: string) =>
  apiPost<ProjectVersion>(`${base(projectId, wireframeId)}/versions`, { label: label ?? null });
