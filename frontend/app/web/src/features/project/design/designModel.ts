// What the design pages say about a design, derived from what the API returns:
// the status badge, which revision is on show, what may link out to Figma.
// Pure, and kept apart from designsApi.ts (which reaches the network) so it
// can be tested on its own.
import { formatDateTime } from "../../../core/format";
import type { InterfaceType, Wireframe } from "../wireframes/wireframesApi";

export interface Design {
  id: string;
  project_id: string;
  /** Every active wireframe of the project, including ones added later. */
  all_wireframes: boolean;
  /** The wireframes picked, in order; empty when all_wireframes. */
  wireframe_ids: string[];
  name: string;
  brief: string;
  reference_document_ids: string[];
  figma_url: string | null;
  published_url: string | null;
  current_revision_id: string | null;
  status: "active" | "archived";
  pos: string;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export type DesignOrigin = "figma_make" | "claude_code";

export interface DesignRevision {
  id: string;
  design_id: string;
  revision_no: number;
  origin: DesignOrigin;
  summary: string | null;
  source_hash: string;
  html_bytes: number;
  source_bytes: number | null;
  status: "pending" | "uploaded";
  created_at: string;
}

export interface DesignInput {
  all_wireframes: boolean;
  wireframe_ids: string[];
  name: string;
  brief: string;
  reference_document_ids: string[];
}

/** What a person may change afterwards: the brief, and how the design is filed. */
export type DesignPatch = Partial<
  Pick<Design, "name" | "brief" | "reference_document_ids" | "all_wireframes" | "wireframe_ids" | "status">
>;

/**
 * The wireframes a design is for, in order, as the server resolves them for
 * the brief: "all" is every active wireframe now; otherwise the ones picked,
 * minus any since deleted (counted in `missing`).
 */
export function designWireframes(
  design: Pick<Design, "all_wireframes" | "wireframe_ids">,
  wireframes: Wireframe[],
): { wireframes: Wireframe[]; missing: number } {
  if (design.all_wireframes) {
    return { wireframes: wireframes.filter((w) => w.status === "active"), missing: 0 };
  }
  const byId = new Map(wireframes.map((w) => [w.id, w]));
  const found = design.wireframe_ids.map((id) => byId.get(id)).filter((w): w is Wireframe => !!w);
  return { wireframes: found, missing: design.wireframe_ids.length - found.length };
}

/** The list's one-line answer to "which wireframes?". */
export function wireframeSummary(
  design: Pick<Design, "all_wireframes" | "wireframe_ids">,
  wireframes: Wireframe[],
): string {
  if (design.all_wireframes) return "All wireframes";
  const { wireframes: found } = designWireframes(design, wireframes);
  if (found.length === 0) return "Deleted wireframes";
  if (found.length <= 2) return found.map((w) => w.name).join(", ");
  return `${found[0].name} and ${found.length - 1} more`;
}

/** The device kinds a design's wireframes are drawn on, each once, in order. */
export function interfaceTypesOf(wireframes: Pick<Wireframe, "interface_type">[]): InterfaceType[] {
  return [...new Set(wireframes.map((w) => w.interface_type))];
}

/** Whether a design has ever been built: it has a revision on show, or none. */
export type DesignState = "not_generated" | "synced";

export const designState = (design: Pick<Design, "current_revision_id">): DesignState =>
  design.current_revision_id ? "synced" : "not_generated";

export const DESIGN_STATE_LABEL: Record<DesignState, string> = {
  not_generated: "Not generated",
  synced: "Synced",
};

export const ORIGIN_LABEL: Record<DesignOrigin, string> = {
  figma_make: "Figma Make",
  claude_code: "Claude Code",
};

/** "Revision 3 · 13 Nov 2026, 14:05 · Figma Make", marking the one on show. */
export function revisionLabel(revision: DesignRevision, currentId: string | null): string {
  const parts = [`Revision ${revision.revision_no}`, formatDateTime(revision.created_at), ORIGIN_LABEL[revision.origin]];
  if (revision.id === currentId) parts.push("Current");
  return parts.join(" · ");
}

/**
 * The revision to show: the one picked, while it still exists; otherwise the
 * design's current one; otherwise the newest. Null when there are none.
 * `revisions` arrive newest first.
 */
export function shownRevision(
  revisions: DesignRevision[],
  pickedId: string | null,
  currentId: string | null,
): DesignRevision | null {
  return (
    revisions.find((r) => r.id === pickedId) ?? revisions.find((r) => r.id === currentId) ?? revisions[0] ?? null
  );
}

/**
 * Only Figma's own https addresses become a link. The server already holds a
 * design's URLs to this rule; checking again here means a link is never built
 * from a value the page has not looked at.
 */
export function figmaHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const onFigma = ["figma.com", "figma.site"].some((h) => host === h || host.endsWith(`.${h}`));
    return parsed.protocol === "https:" && onFigma ? parsed.toString() : null;
  } catch {
    return null;
  }
}
