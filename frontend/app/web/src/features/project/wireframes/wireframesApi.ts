// Client for a project's wireframes and everything that hangs off one:
// pages, op batches, version snapshots (backend app/studio/wireframes.py).
// `base()` is the single point of change if the backend paths move.
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, RequestOptions } from "../../../core/api";
import { OpBatch, OpBatchResult, PageDocument, PageRecord } from "../../studio/model/types";
import type { PageSummary } from "../../projects/projectsApi";

// A tablet's orientation is part of its interface type rather than a field of
// its own: a wireframe is still described by one value, and `tablet` keeps
// meaning the portrait tablet it has always drawn. Phones are only ever
// designed portrait, so mobile has no landscape counterpart.
export type InterfaceType = "desktop" | "tablet" | "tablet_landscape" | "mobile";

export const INTERFACE_TYPES: { value: InterfaceType; label: string }[] = [
  { value: "desktop", label: "Desktop" },
  { value: "tablet", label: "Tablet (portrait)" },
  { value: "tablet_landscape", label: "Tablet (landscape)" },
  { value: "mobile", label: "Mobile" },
];

/** Classes for the device stage: the device itself plus, where it has one, its
 *  orientation. Landscape is a modifier so it overrides only the screen
 *  dimensions and inherits the rest of the tablet frame (see studio.css). */
export function deviceClass(t: InterfaceType): string {
  return t === "tablet_landscape" ? "tablet landscape" : t;
}

export interface Wireframe {
  id: string;
  project_id: string;
  name: string;
  interface_type: InterfaceType;
  status: "active" | "archived";
  pos: string;
  /** Page the studio and preview open on; null follows the shell's first nav link. */
  landing_page_id: string | null;
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

/** One page of a snapshot, rebuilt server-side into the shape the canvas
 *  renders. There is nothing to edit against, so no version columns. */
export type SnapshotPage = Pick<PageRecord, "id" | "name" | "route" | "pos" | "placement" | "presentation" | "document">;

/** A snapshot ready to render: the wireframe chrome as it stood when the
 *  snapshot was taken, plus every page it captured. */
export interface VersionPreview extends ProjectVersion {
  wireframe_name: string;
  interface_type: InterfaceType;
  landing_page_id: string | null;
  pages: SnapshotPage[];
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
  patch: Partial<Pick<Wireframe, "name" | "interface_type" | "status" | "pos" | "landing_page_id">>,
) => apiPatch<Wireframe>(base(projectId, wireframeId), patch);
export const setWireframePersonas = (projectId: string, wireframeId: string, personaIds: string[]) =>
  apiPut<Wireframe>(`${base(projectId, wireframeId)}/personas`, { persona_ids: personaIds });
export const setWireframeActors = (projectId: string, wireframeId: string, actorIds: string[]) =>
  apiPut<Wireframe>(`${base(projectId, wireframeId)}/actors`, { actor_ids: actorIds });
export const deleteWireframe = (projectId: string, wireframeId: string) => apiDelete(base(projectId, wireframeId));
export const getWireframeExport = (projectId: string, wireframeId: string) =>
  apiGet<Record<string, unknown>>(`${base(projectId, wireframeId)}/export`);

// ── Pages ─────────────────────────────────────────────────────────────────

export const getWireframePage = (projectId: string, wireframeId: string, pageId: string, opts?: RequestOptions) =>
  apiGet<PageRecord>(`${base(projectId, wireframeId)}/pages/${pageId}`, opts);
export const createWireframePage = (
  projectId: string,
  wireframeId: string,
  page: {
    id?: string;
    name: string;
    route?: string | null;
    pos: string;
    placement?: { page_id: string; region_id: string };
    presentation?: "modal" | "drawer" | "drawer-left";
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
/** Replace the wireframe's pages with a snapshot's; the server keeps an
 *  automatic backup of the current state first. */
export const restoreWireframeVersion = (projectId: string, wireframeId: string, versionId: string) =>
  apiPost<void>(`${base(projectId, wireframeId)}/versions/${versionId}/restore`, {});
/** A snapshot's pages, rendered without restoring anything. */
export const getWireframeVersionPreview = (projectId: string, wireframeId: string, versionId: string) =>
  apiGet<VersionPreview>(`${base(projectId, wireframeId)}/versions/${versionId}/preview`);
/** Create a NEW wireframe from a snapshot, leaving this one untouched. Page
 *  ids are reminted server-side, so the copy's links stay inside the copy. */
export const copyWireframeVersion = (projectId: string, wireframeId: string, versionId: string, name: string) =>
  apiPost<WireframeDetail>(`${base(projectId, wireframeId)}/versions/${versionId}/copy`, { name });
