// The page document as stored per row in project_pages, and the op
// vocabulary sent to POST /api/studio/projects/{id}/ops. Mirrors
// backend/app/studio/ops.py and schemas.py -- keep them in step.

export const REGION_ORDER = ["header", "sidebar", "main", "right", "footer"] as const;
export type RegionName = (typeof REGION_ORDER)[number];

export type MainFlow = "stack" | "two-col" | "three-col";

export interface ComponentNode {
  id: string;
  type: string;
  label: string;
  /** Fractional index; lists are sorted by this, never by array position. */
  pos: string;
  props?: Record<string, unknown>;
  customId?: string;
}

export interface RegionsLayout {
  regions: Record<RegionName, ComponentNode[]>;
  options: { smartDock: boolean; mainFlow: MainFlow };
}

export interface FlatLayout {
  components: ComponentNode[];
}

export type Frame =
  | { id: string; label: string; pos: string; layoutMode: "regions"; layout: RegionsLayout }
  | { id: string; label: string; pos: string; layoutMode: "flat"; layout: FlatLayout };

export interface PageDocument {
  frames: Frame[];
}

/** A project_pages row as returned by GET .../pages/{id}. */
export interface PageRecord {
  id: string;
  project_id: string;
  name: string;
  route: string | null;
  pos: string;
  document: PageDocument;
  entity_versions: Record<string, number>;
  version: number;
  updated_at: string;
}

// ── Ops ─────────────────────────────────────────────────────────────────────

/** Empty = the page itself; frame only = that frame; both = a component. */
export interface Target {
  frame?: string;
  cmp?: string;
}

export type Op =
  | { op: "set"; target?: Target; path: string; value: unknown }
  | { op: "insert"; target?: Target; into: { region?: RegionName; list?: "frames" | "components" }; value: Record<string, unknown> & { id: string } }
  | { op: "remove"; target: Target }
  | { op: "move"; target: Target; to: { region?: RegionName; pos: string } };

export interface OpBatch {
  clientBatchId: string;
  pageId: string;
  baseVersion: number;
  ops: Op[];
}

export interface OpBatchResult {
  page_id: string;
  version: number;
}

export interface OpConflictBody {
  detail: "conflict";
  page_id: string;
  version: number;
  conflicts: { entity_id: string; current_version: number }[];
}

export function isConflictBody(body: unknown): body is OpConflictBody {
  return !!body && typeof body === "object" && (body as { detail?: unknown }).detail === "conflict";
}

export const PAGE_ENTITY_KEY = "page";
