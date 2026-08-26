// Fractional-index positions. Lists in the document are kept sorted by `pos`
// in memory; inserting between two neighbours never renumbers anything else,
// so two people inserting into the same region concurrently both succeed.
import { generateKeyBetween } from "fractional-indexing";
import { produce } from "immer";
import { byPos, PageLike } from "./applyOps";
import { ComponentNode, Frame, REGION_ORDER } from "./types";

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

/** Frames, regions and components sorted by pos with the invariant repaired. */
export function normalizePage<T extends PageLike>(page: T): T {
  return produce(page, (draft) => {
    fixList(draft.document.frames as Frame[]);
    for (const frame of draft.document.frames) {
      if (frame.layoutMode === "regions") {
        const layout = frame.layout;
        for (const r of REGION_ORDER) {
          if (!Array.isArray(layout.regions[r])) layout.regions[r] = [];
          fixList(layout.regions[r] as ComponentNode[]);
        }
        layout.options = {
          smartDock: typeof layout.options?.smartDock === "boolean" ? layout.options.smartDock : true,
          mainFlow: ["stack", "two-col", "three-col"].includes(layout.options?.mainFlow) ? layout.options.mainFlow : "stack",
        };
      } else {
        if (!Array.isArray(frame.layout.components)) frame.layout.components = [];
        fixList(frame.layout.components as ComponentNode[]);
      }
    }
  });
}

export { byPos };
