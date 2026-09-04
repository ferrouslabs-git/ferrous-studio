// Nav-driven page order: which pages a document's nav bars link to, in the
// order the bars draw them. Feeds two behaviours: a wireframe whose shell
// carries a nav bar opens on the first linked page (the bare shell page is a
// redundant landing), and the page switcher lists nav-linked pages in nav
// order rather than raw pos order.
import { NavAlign, navAlign } from "../catalog";
import { elementLink, elKey } from "./actions";
import { byPos } from "./positions";
import { regionIds } from "./tree";
import { BACK_PAGE_ID, ComponentNode, ElementNode, PageDocument } from "./types";

/** Nav-item elements of one nav bar in the order the bar draws them: pos
 *  order down a vertical rail; left → centre → right zones, each in pos
 *  order, across a horizontal bar (mirrors the Schematic's zoning). */
function navItemsInDrawOrder(cmp: ComponentNode): ElementNode[] {
  const els = byPos(cmp.elements ?? []);
  if (cmp.layout === "vertical") return els.filter((e) => e.type === "nav-item");
  const zones: Record<NavAlign, ElementNode[]> = { left: [], centre: [], right: [] };
  for (const el of els) zones[navAlign(el)].push(el);
  return [...zones.left, ...zones.centre, ...zones.right].filter((e) => e.type === "nav-item");
}

/** Every page the document's nav bars link to, in draw order: regions in
 *  reading order, nav bars in pos order within each region, items as drawn.
 *  A target keeps its first appearance only; @back is not a page. */
export function navLinkedPageIds(doc: PageDocument): string[] {
  const out: string[] = [];
  const seen = new Set<string>([BACK_PAGE_ID]);
  for (const regionId of regionIds(doc.root)) {
    for (const cmp of byPos(doc.regions[regionId] ?? [])) {
      if (cmp.type !== "navbar") continue;
      for (const el of navItemsInDrawOrder(cmp)) {
        const target = elementLink(cmp, elKey(el.id), null);
        if (target && !seen.has(target.pageId)) {
          seen.add(target.pageId);
          out.push(target.pageId);
        }
      }
    }
  }
  return out;
}

/** Where a wireframe opens: the first page its shell's nav links to. Null
 *  when there is no nav bar, no linked item, or no target that still exists
 *  — callers land on the first page instead. */
export function firstNavTarget(doc: PageDocument, pages: readonly { id: string }[]): string | null {
  const alive = new Set(pages.map((p) => p.id));
  return navLinkedPageIds(doc).find((id) => alive.has(id)) ?? null;
}

/** Reorder pages so the nav-linked ones appear in nav order. Only they move:
 *  each takes a slot the group already held in the incoming (pos) order, so
 *  the shell page stays first and unlinked pages keep their place. */
export function orderPagesByNav<T extends { id: string }>(pages: readonly T[], navIds: readonly string[]): T[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const ranked = navIds.filter((id) => byId.has(id));
  const rankedSet = new Set(ranked);
  let next = 0;
  return pages.map((p) => (rankedSet.has(p.id) ? byId.get(ranked[next++])! : p));
}
