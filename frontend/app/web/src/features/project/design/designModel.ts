// What the design pages say about a design, derived from what the API returns:
// the status badge, what may be framed, what may link out to Figma. Pure, and
// kept apart from designsApi.ts (which reaches the network) so it can be
// tested on its own.
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
  /** The Figma Make file: the design itself. */
  figma_url: string | null;
  /** The site published from the Make file: what the design page frames. */
  published_url: string | null;
  status: "active" | "archived";
  pos: string;
  created_at: string;
  updated_at: string;
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

/** Where a design has got to: nothing yet, a Make file, or a published site. */
export type DesignState = "not_generated" | "in_figma" | "published";

export const designState = (design: Pick<Design, "figma_url" | "published_url">): DesignState =>
  publishedSite(design.published_url) ? "published" : design.figma_url ? "in_figma" : "not_generated";

export const DESIGN_STATE_LABEL: Record<DesignState, string> = {
  not_generated: "Not generated",
  in_figma: "In Figma",
  published: "Published",
};

const onHost = (url: string | null, hosts: string[]): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const allowed = hosts.some((h) => host === h || host.endsWith(`.${h}`));
    return parsed.protocol === "https:" && allowed && !parsed.username && !parsed.password ? parsed.toString() : null;
  } catch {
    return null;
  }
};

/**
 * Only Figma's own https addresses become a link. The server already holds a
 * design's URLs to this rule; checking again here means a link is never built
 * from a value the page has not looked at.
 */
export const figmaHref = (url: string | null): string | null => onHost(url, ["figma.com", "figma.site"]);

/**
 * The published site to frame: a subdomain of figma.site only, the one host
 * Studio's CSP lets a frame load from. Anything else is not framed at all.
 */
export function publishedSite(url: string | null): string | null {
  const href = onHost(url, ["figma.site"]);
  return href && new URL(href).hostname.toLowerCase() !== "figma.site" ? href : null;
}

/** The site's address with a cache-buster, so Sync fetches it afresh. */
export function freshSiteUrl(site: string, stamp: number): string {
  const url = new URL(site);
  url.searchParams.set("studio_sync", String(stamp));
  return url.toString();
}
