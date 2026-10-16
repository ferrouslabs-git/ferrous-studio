// Nav-driven page order: which pages a document's nav bars link to, in the
// order the bars draw them. Feeds two behaviours: a wireframe whose shell
// carries a nav bar opens on the first linked page (the bare shell page is a
// redundant landing), and the page switcher lists nav-linked pages in nav
// order rather than raw pos order.
import { NavAlign, navAlign } from "../catalog";
import { elementLink, elKey, EL_PREFIX } from "./actions";
import { byPos } from "./positions";
import { regionIds } from "./tree";
import { BACK_PAGE_ID, ComponentNode, ElementNode, LinkTarget, PageDocument } from "./types";

/** Sub-items (FS-REQ-64) by the nav item they nest under: each belongs to
 *  the nearest nav item before it in pos order. A sub-item with no item
 *  before it has no parent and draws as an ordinary item. */
export function navSubItems(elements: readonly ElementNode[]): Map<string, ElementNode[]> {
  const out = new Map<string, ElementNode[]>();
  let parent: ElementNode | null = null;
  for (const el of byPos(elements)) {
    if (el.type === "nav-item") parent = el;
    else if (el.type === "nav-sub-item" && parent) {
      const list = out.get(parent.id) ?? [];
      list.push(el);
      out.set(parent.id, list);
    }
  }
  return out;
}

/** Where a nav bar's element goes: its own link, or — for a parent item
 *  with none — its first linked sub-item's, so the parent opens what its
 *  first child does. */
export function navEffectiveLink(cmp: ComponentNode, key: string, index: number | null): LinkTarget | null {
  const own = elementLink(cmp, key, index);
  if (own || cmp.type !== "navbar" || index != null || !key.startsWith(EL_PREFIX)) return own;
  const id = key.slice(EL_PREFIX.length);
  for (const sub of navSubItems(cmp.elements ?? []).get(id) ?? []) {
    const link = elementLink(cmp, elKey(sub.id), null);
    if (link) return link;
  }
  return null;
}

/** Nav-item elements of one nav bar in the order the bar draws them: pos
 *  order down a vertical rail; left → centre → right zones, each in pos
 *  order, across a horizontal bar (mirrors the Schematic's zoning). Sub-items
 *  follow their parent wherever it sits. */
function navItemsInDrawOrder(cmp: ComponentNode): ElementNode[] {
  const els = byPos(cmp.elements ?? []);
  const subs = navSubItems(els);
  const nested = new Set([...subs.values()].flat().map((e) => e.id));
  const top = els.filter((e) => (e.type === "nav-item" || e.type === "nav-sub-item") && !nested.has(e.id));
  const ordered =
    cmp.layout === "vertical"
      ? top
      : (["left", "centre", "right"] as NavAlign[]).flatMap((zone) => top.filter((e) => navAlign(e) === zone));
  return ordered.flatMap((e) => [e, ...(subs.get(e.id) ?? [])]);
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

/** The page a page opens onto (FS-REQ-57, FS-REQ-62): the first page its own
 *  nav bars link to that is placed inside it. A page whose region is an
 *  outlet for its nav never shows that region bare — following a link to
 *  it, or to a level-one nav item, lands on the first child the nav names,
 *  so content is never added to (or shown from) an orphaned region. Overlay
 *  pages float rather than fill a region, so they are never the default. */
export function defaultChildPage(
  doc: PageDocument,
  pageId: string,
  pages: readonly { id: string; placement: { page_id: string } | null; presentation?: string | null }[],
): string | null {
  const byId = new Map(pages.map((p) => [p.id, p]));
  for (const id of navLinkedPageIds(doc)) {
    const target = byId.get(id);
    if (target && target.placement?.page_id === pageId && !target.presentation) return id;
  }
  return null;
}

/** The label of the nav item that routes to `pageId` (FS-REQ-58), searched
 *  across the given documents (the page's shells); null when no nav bar
 *  links to it. A component added to the page takes it as its title. */
export function navRouteLabel(pageId: string, docs: readonly PageDocument[]): string | null {
  for (const doc of docs) {
    for (const regionId of regionIds(doc.root)) {
      for (const cmp of doc.regions[regionId] ?? []) {
        if (cmp.type !== "navbar") continue;
        for (const el of navItemsInDrawOrder(cmp)) {
          if (elementLink(cmp, elKey(el.id), null)?.pageId === pageId && el.label.trim()) return el.label.trim();
        }
      }
    }
  }
  return null;
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
