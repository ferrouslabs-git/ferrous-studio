// The page document as stored per row in project_pages, and the op
// vocabulary sent to POST .../wireframes/{id}/ops. Mirrors
// backend/app/studio/ops.py and schemas.py -- keep them in step.

/** How a layout node is sized along its parent split's axis.
 *  "auto" hugs content, a number is a fixed pixel size (set by dragging a
 *  divider), and { fr } grows with a weight, sharing leftover space. */
export type Size = "auto" | number | { fr: number };

/** A leaf of the layout tree: a rectangle components stack into. Its
 *  components live in PageDocument.regions[id], not on the node. */
export interface RegionNode {
  kind: "region";
  id: string;
  label?: string;
  size: Size;
  /** How the region lays out its components. Absent means "col" (a vertical
   *  stack, the default); "row" lines them up side by side and the region
   *  scrolls sideways once they no longer fit; "free" positions each
   *  component at its own props.x/y, anywhere in the region. */
  dir?: "row" | "col" | "free";
  /** Optional background colour (any CSS colour; set from the Inspector). */
  bg?: string;
}

/** An internal node: this rectangle is divided into 2+ children, side by
 *  side ("row") or stacked ("col"). Splits nest without limit. */
export interface SplitNode {
  kind: "split";
  id: string;
  dir: "row" | "col";
  size: Size;
  children: LayoutNode[];
}

export type LayoutNode = RegionNode | SplitNode;

/** A typed child of a component: a list column, a form field, a nav item.
 *  `label` is its primary visible text; `data` holds representative data
 *  keyed by the element type's dataFields in the catalogue (a column's data
 *  kind, a form field's placeholder, a canvas child's x/y position). Elements
 *  are addressed everywhere by the key `el:<id>` (see actions.ts). */
export interface ElementNode {
  id: string;
  type: string;
  label: string;
  /** Fractional index among siblings; lists are sorted by this. */
  pos: string;
  data?: Record<string, string>;
}

export interface ComponentNode {
  id: string;
  type: string;
  label: string;
  /** Fractional index; lists are sorted by this, never by array position. */
  pos: string;
  /** Which variant of the component this is (nav bar → links | tabs | …). */
  shape?: string;
  /** How the component lays out (nav bar → horizontal | vertical). */
  layout?: string;
  /** Typed children, in pos order. Only ever valid inside a component. */
  elements?: ElementNode[];
  props?: Record<string, unknown>;
  customId?: string;
}

/** One page = one layout tree plus the components of each region. The tree
 *  is authoritative for which regions exist; a region id missing from it is
 *  ignored on render and export. */
export interface PageDocument {
  root: LayoutNode;
  regions: Record<string, ComponentNode[]>;
}

/** A link an element (nav item, button, …) carries in props.links. The
 *  target is always a page; a page with a `placement` renders inside that
 *  region of its parent, so "region links" are links to placed pages.
 *  `BACK_PAGE_ID` is the one non-page target: return to the previously
 *  visited page, the way a form's Cancel or Save button behaves. */
export interface LinkTarget {
  pageId: string;
}

/** Sentinel `pageId`: follow the visit history backwards instead of going to
 *  a fixed page. Real page ids are server-generated UUIDs, so the sentinel
 *  cannot collide with one. */
export const BACK_PAGE_ID = "@back";

/** Where a child page renders: inside `region_id` of page `page_id`. */
export interface PagePlacement {
  page_id: string;
  region_id: string;
}

/** How a page opens when a link targets it: as an overlay over the page it
 *  was opened from, instead of navigating. Null is an ordinary page;
 *  "drawer" slides from the right edge, "drawer-left" from the left. */
export type PagePresentation = "modal" | "drawer" | "drawer-left";

/** Short badge text per presentation (page pickers, link menus). */
export const PRESENTATION_LABELS: Record<PagePresentation, string> = {
  modal: "modal",
  drawer: "drawer",
  "drawer-left": "left drawer",
};

/** A project_pages row as returned by GET .../pages/{id}. */
export interface PageRecord {
  id: string;
  project_id: string;
  name: string;
  route: string | null;
  pos: string;
  placement: PagePlacement | null;
  presentation: PagePresentation | null;
  document: PageDocument;
  entity_versions: Record<string, number>;
  version: number;
  updated_at: string;
}

// ── Ops ─────────────────────────────────────────────────────────────────────

/** Empty = the page itself; cmp = that component. */
export interface Target {
  cmp?: string;
}

export type Op =
  | { op: "set"; target?: Target; path: string; value: unknown }
  | { op: "insert"; into: { region: string }; value: Record<string, unknown> & { id: string } }
  | { op: "remove"; target: Target }
  | { op: "move"; target: Target; to: { region?: string; pos: string } };

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
/** entity_versions key stamped by `set path:"root"` (layout tree changes). */
export const LAYOUT_ENTITY_KEY = "layout";
