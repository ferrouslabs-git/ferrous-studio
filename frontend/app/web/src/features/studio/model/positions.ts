// Fractional-index positions. Lists in the document are kept sorted by `pos`
// in memory; inserting between two neighbours never renumbers anything else,
// so two people inserting into the same region concurrently both succeed.
import { generateKeyBetween } from "fractional-indexing";
import { produce } from "immer";
import type { PageLike } from "./applyOps";
import { migrateComponent } from "./migrate";
import { blankDocument, isLayoutNode, regionIds } from "./tree";
import { ComponentNode } from "./types";

export const posBetween = (a: string | null | undefined, b: string | null | undefined): string =>
  generateKeyBetween(a ?? null, b ?? null);

/** Position for a new item that should land at `index` of a pos-sorted list. */
export function posAtIndex(sorted: readonly { pos: string }[], index: number): string {
  const i = Math.max(0, Math.min(index, sorted.length));
  return posBetween(sorted[i - 1]?.pos, sorted[i]?.pos);
}

export const posAfterLast = (sorted: readonly { pos: string }[]): string =>
  posBetween(sorted[sorted.length - 1]?.pos, null);

/** Fresh strictly-increasing positions for a whole list (used when merging lists). */
export function reposition<T extends { pos: string }>(items: T[]): void {
  let prev: string | null = null;
  for (const item of items) {
    prev = posBetween(prev, null);
    item.pos = prev;
  }
}

/** Sort helper: lists are stored in insertion order and read in `pos` order. */
export function byPos<T extends { pos: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0));
}

function isStrictlySorted(items: readonly { pos: string }[]): boolean {
  for (let i = 1; i < items.length; i++) if (!(items[i - 1].pos < items[i].pos)) return false;
  return true;
}

function fixList<T extends { pos?: string }>(list: T[]): void {
  // Assign missing positions, then sort; if the result is not strictly
  // increasing (duplicates), renumber so the invariant holds.
  const missing = list.some((x) => typeof x.pos !== "string" || !x.pos);
  if (missing) reposition(list as { pos: string }[]);
  list.sort((a, b) => ((a.pos as string) < (b.pos as string) ? -1 : (a.pos as string) > (b.pos as string) ? 1 : 0));
  if (!isStrictlySorted(list as { pos: string }[])) reposition(list as { pos: string }[]);
}

/** True when a stored document predates the layout tree (the old frames
 *  format) or is empty; such pages reset to a blank single region. */
export function isLegacyDocument(doc: unknown): boolean {
  return !doc || typeof doc !== "object" || !isLayoutNode((doc as { root?: unknown }).root);
}

/** Repair invariants on a fetched page: a valid tree, one component list per
 *  tree region (sorted by pos), and no lists for regions the tree lost. A
 *  legacy or malformed document resets to a blank single region. */
export function normalizePage<T extends PageLike>(page: T): T {
  return produce(page, (draft) => {
    const doc = draft.document as unknown as Record<string, unknown>;
    delete doc.frames; // pre-tree format; content is not converted (greenfield reset)
    if (isLegacyDocument(draft.document)) {
      const blank = blankDocument();
      doc.root = blank.root;
      doc.regions = blank.regions;
      return;
    }
    if (!doc.regions || typeof doc.regions !== "object") doc.regions = {};
    const regions = doc.regions as Record<string, ComponentNode[]>;
    const ids = new Set(regionIds(draft.document.root));
    for (const id of Object.keys(regions)) if (!ids.has(id)) delete regions[id];
    for (const id of ids) {
      if (!Array.isArray(regions[id])) regions[id] = [];
      fixList(regions[id]);
      for (const cmp of regions[id]) {
        migrateComponent(cmp);
        if (cmp.elements) fixList(cmp.elements);
      }
    }
  });
}
