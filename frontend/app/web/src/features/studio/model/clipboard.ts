// Cut/copy/paste for components and elements. A clipboard item is a deep
// snapshot taken at copy time (later edits to the original must not leak
// into a paste); pasting clones it AGAIN with fresh ids, so one copy pastes
// any number of times. Ids are identity in the shared database, so a paste
// remaps everything id-keyed inside a component: element links (props.links,
// keyed `el:<id>`) and list cells (props.rows, keyed by column element id).
//
// The clipboard lives in localStorage (same origin), not the OS clipboard:
// no permission prompts, and copying a component never clobbers text the
// user has copied elsewhere — while paste still works across pages,
// wireframes and browser tabs. A read validates the stored envelope (another
// tab, or an older build, may have written it) and falls back to this tab's
// in-memory copy where storage is unavailable.
//
// The envelope records where the copy came from: pasting into a DIFFERENT
// wireframe strips page links (page ids never resolve across wireframes;
// only the `@back` sentinel keeps meaning). Dataset bindings and custom
// component ids travel as-is — a dangling one already renders gracefully
// (sample values / a "definition no longer exists" card).
import { elementMeta } from "../catalog";
import {
  ActionContext,
  ActionResult,
  elementLink,
  elKey,
  EL_PREFIX,
  findElement,
  isElKey,
  LinksProp,
  locateCmp,
} from "./actions";
import { PageLike } from "./applyOps";
import { byPos, posAfterLast, posAtIndex } from "./positions";
import { uid } from "./regions";
import { firstRegionId } from "./tree";
import { BACK_PAGE_ID, ComponentNode, ElementNode, LinkTarget } from "./types";

export type ClipboardItem =
  | { kind: "cmp"; label: string; node: ComponentNode }
  | {
      kind: "element";
      /** The element's own text at copy time (falls back to the type name). */
      label: string;
      /** The type's catalogue name, for messages about the type itself. */
      typeLabel: string;
      node: ElementNode;
      /** The link the element carried — links live on the host component. */
      link: LinkTarget | null;
      /** A column's cell values by row index — cells also live on the host. */
      cells: string[] | null;
    };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// ── Storage ─────────────────────────────────────────────────────────────────

/** The envelope written to localStorage: the item plus where it came from,
 *  so a paste can tell whether the source wireframe's page links still mean
 *  anything. `v` guards against payloads from older builds in other tabs. */
export interface StoredClipboard {
  v: 1;
  projectId: string;
  wireframeId: string;
  item: ClipboardItem;
}

const STORE_KEY = "studio.clipboard";

/** This tab's copy of the last snapshot, for when storage is unavailable. */
let memoryFallback: StoredClipboard | null = null;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const isNodeLike = (v: unknown): v is ElementNode =>
  isRecord(v) && typeof v.id === "string" && typeof v.type === "string" && typeof v.label === "string" && typeof v.pos === "string";

function isStoredClipboard(v: unknown): v is StoredClipboard {
  if (!isRecord(v) || v.v !== 1 || typeof v.projectId !== "string" || typeof v.wireframeId !== "string") return false;
  const item = v.item;
  if (!isRecord(item) || typeof item.label !== "string" || !isNodeLike(item.node)) return false;
  if (item.kind === "cmp") {
    const elements = (item.node as ComponentNode).elements;
    return elements === undefined || (Array.isArray(elements) && elements.every(isNodeLike));
  }
  if (item.kind !== "element" || typeof item.typeLabel !== "string") return false;
  if (item.link !== null && !(isRecord(item.link) && typeof item.link.pageId === "string")) return false;
  return item.cells === null || (Array.isArray(item.cells) && item.cells.every((c) => typeof c === "string"));
}

export function storeClipboard(item: ClipboardItem, source: { projectId: string; wireframeId: string }): void {
  const entry: StoredClipboard = { v: 1, projectId: source.projectId, wireframeId: source.wireframeId, item };
  memoryFallback = entry;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(entry));
  } catch {
    // Storage unavailable (private mode, quota): the in-memory copy still
    // serves this tab.
  }
}

/** The latest snapshot from any tab; this tab's own copy when storage is
 *  unavailable or holds something unrecognisable. */
export function readClipboard(): StoredClipboard | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isStoredClipboard(parsed)) return parsed;
    }
  } catch {
    // Fall through to the in-memory copy.
  }
  return memoryFallback;
}

// ── Snapshots (copy) ────────────────────────────────────────────────────────

export function copyComponentItem(cmp: ComponentNode): ClipboardItem {
  return { kind: "cmp", label: cmp.label || cmp.type, node: clone(cmp) };
}

/** Snapshot one element, taking its component-held state (link, list cells)
 *  with it so a paste reproduces the element's behaviour, not just its look. */
export function copyElementItem(cmp: ComponentNode, elementId: string): ClipboardItem | null {
  const element = findElement(cmp, elementId);
  if (!element) return null;
  const typeLabel = elementMeta(cmp.type, element.type)?.label ?? element.type;
  const rows = Array.isArray(cmp.props?.rows) ? (cmp.props.rows as Record<string, string>[]) : null;
  const cells =
    element.type === "column" && rows?.some((row) => row && row[elementId] != null)
      ? rows.map((row) => (row && row[elementId]) || "")
      : null;
  return {
    kind: "element",
    label: element.label.trim() || typeLabel,
    typeLabel,
    node: clone(element),
    link: clone(elementLink(cmp, elKey(elementId), null)),
    cells,
  };
}

// ── Paste actions ───────────────────────────────────────────────────────────

/** Clone a snapshot with fresh ids, remapping the id-keyed side tables. An
 *  entry keyed by an id the copy does not contain is dead data and drops. */
function cloneComponentFresh(source: ComponentNode): ComponentNode {
  const cmp = clone(source);
  cmp.id = uid("c");
  const idMap = new Map<string, string>();
  for (const element of cmp.elements ?? []) {
    const next = uid("e");
    idMap.set(element.id, next);
    element.id = next;
  }
  const props = cmp.props;
  if (props?.links && typeof props.links === "object") {
    const links = props.links as LinksProp;
    const next: LinksProp = {};
    for (const [key, entry] of Object.entries(links)) {
      if (!isElKey(key)) next[key] = entry; // scalar prop keys are not ids
      else {
        const mapped = idMap.get(key.slice(EL_PREFIX.length));
        if (mapped) next[elKey(mapped)] = entry;
      }
    }
    if (Object.keys(next).length) props.links = next;
    else delete props.links;
  }
  if (Array.isArray(props?.rows)) {
    props.rows = (props.rows as unknown[]).map((row) => {
      const out: Record<string, unknown> = {};
      if (row && typeof row === "object") {
        for (const [columnId, value] of Object.entries(row as Record<string, unknown>)) {
          const mapped = idMap.get(columnId);
          if (mapped) out[mapped] = value;
        }
      }
      return out;
    });
  }
  return cmp;
}

/** Where a paste lands relative to where the copy was made. Links target
 *  pages by id, so they only survive within the source wireframe. */
export interface PasteScope {
  sameWireframe: boolean;
}

const SAME_SCOPE: PasteScope = { sameWireframe: true };

const keepsMeaning = (target: LinkTarget | null | undefined): boolean => !!target && target.pageId === BACK_PAGE_ID;

/** Drop links that point into another wireframe's pages (`@back` survives —
 *  it follows the visit history, not a page id). Returns how many went. */
function stripForeignLinks(cmp: ComponentNode): number {
  const links = cmp.props?.links as LinksProp | undefined;
  if (!links) return 0;
  let dropped = 0;
  for (const [key, entry] of Object.entries(links)) {
    if (Array.isArray(entry)) {
      const kept = entry.map((target) => {
        if (keepsMeaning(target)) return target;
        if (target) dropped++;
        return null;
      });
      if (kept.some(Boolean)) links[key] = kept;
      else delete links[key];
    } else if (!keepsMeaning(entry)) {
      delete links[key];
      dropped++;
    }
  }
  if (!Object.keys(links).length) delete cmp.props!.links;
  return dropped;
}

/** Insert a copied component at `atIndex` of `regionId` (end of the first
 *  region when unset), under fresh ids throughout. */
export function pasteComponent(
  draft: PageLike,
  _ctx: ActionContext,
  item: ClipboardItem,
  regionId: string | null = null,
  atIndex: number | null = null,
  scope: PasteScope = SAME_SCOPE,
): ActionResult | void {
  if (item.kind !== "cmp") return;
  const doc = draft.document;
  const id = regionId && regionId in doc.regions ? regionId : firstRegionId(doc.root);
  const list = (doc.regions[id] ??= []);
  const cmp = cloneComponentFresh(item.node);
  const dropped = scope.sameWireframe ? 0 : stripForeignLinks(cmp);
  const i = atIndex == null ? list.length : Math.max(0, Math.min(atIndex, list.length));
  cmp.pos = posAtIndex(list, i);
  list.splice(i, 0, cmp);
  return {
    selectCmpId: cmp.id,
    ...(dropped ? { toast: "Pasted without its links — they point at pages in another wireframe" } : {}),
  };
}

/** Insert a copied element into `cmpId`, honouring the destination's element
 *  vocabulary and `max` cap the way addElement does. */
export function pasteElement(
  draft: PageLike,
  _ctx: ActionContext,
  cmpId: string,
  item: ClipboardItem,
  scope: PasteScope = SAME_SCOPE,
): ActionResult | void {
  if (item.kind !== "element") return;
  const loc = locateCmp(draft.document, cmpId);
  const cmp = loc ? loc.list[loc.index] : null;
  if (!cmp) return;
  const meta = elementMeta(cmp.type, item.node.type);
  if (!meta) return { selectCmpId: cmpId, toast: `This component can't hold a ${item.typeLabel.toLowerCase()}` };
  const list = (cmp.elements ??= []);
  if (meta.max != null && list.filter((e) => e.type === item.node.type).length >= meta.max) {
    return { selectCmpId: cmpId, toast: `This component already has its ${meta.label.toLowerCase()}` };
  }
  const node = clone(item.node);
  node.id = uid("e");
  node.pos = posAfterLast(byPos(list));
  if (cmp.type === "canvas") {
    // Land beside the original rather than on top of it; a copy from a
    // stacking component has no position yet and takes the add cascade.
    const n = list.length;
    const x = node.data?.x != null ? Number(node.data.x) + 16 : 16 + (n % 8) * 24;
    const y = node.data?.y != null ? Number(node.data.y) + 16 : 16 + (n % 8) * 24;
    node.data = { ...node.data, x: String(x), y: String(y) };
  }
  list.push(node);
  // The element is authoritative for the header again (see migrateHeader).
  if (node.type === "header" && cmp.props && "title" in cmp.props) delete cmp.props.title;
  const linkSurvives = item.link && (scope.sameWireframe || keepsMeaning(item.link));
  if (item.link && linkSurvives) {
    const props = (cmp.props ??= {});
    const links = ((props.links as LinksProp | undefined) ?? (props.links = {})) as LinksProp;
    links[elKey(node.id)] = clone(item.link);
  }
  if (item.cells) {
    const props = (cmp.props ??= {});
    if (!Array.isArray(props.rows)) props.rows = [];
    const rows = props.rows as Record<string, string>[];
    item.cells.forEach((value, i) => {
      if (!value) return;
      while (rows.length <= i) rows.push({});
      rows[i][node.id] = value;
    });
  }
  return {
    selectElement: { cmpId, key: elKey(node.id), index: null },
    ...(item.link && !linkSurvives ? { toast: "Pasted without its link — it points at a page in another wireframe" } : {}),
  };
}
