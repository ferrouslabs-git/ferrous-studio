// What the design pages say about a design, derived from what the API returns:
// the status badge, which revision is on show, what may link out to Figma.
// Pure, and kept apart from designsApi.ts (which reaches the network) so it
// can be tested on its own.
import { formatDateTime } from "../../../core/format";

export interface Design {
  id: string;
  project_id: string;
  wireframe_id: string;
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
  wireframe_id: string;
  name: string;
  brief: string;
  reference_document_ids: string[];
}

/** What a person may change afterwards: the brief, and how the design is filed. */
export type DesignPatch = Partial<Pick<Design, "name" | "brief" | "reference_document_ids" | "status">>;

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
