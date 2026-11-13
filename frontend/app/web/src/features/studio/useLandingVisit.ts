// Visiting a page through navigation (a followed link, the page switcher, a
// level-one nav item) lands on its nav-driven default child, all the way
// down: a detail page whose tabs link into its lower region opens on the
// first tab, and a level-one item whose page carries a level-two nav opens
// that nav's first item (see defaultChildPage). Back/forward are untouched —
// they replay exactly where the user was.
import { MutableRefObject, useCallback, useRef } from "react";
import type { PageSummary } from "../projects/projectsApi";
import type { HostOverride } from "./model/linkHost";
import { defaultChildPage, navLinkedPageIds } from "./model/navOrder";
import { normalizePage } from "./model/positions";
import type { RegionFocus } from "./model/regionFocus";
import { PageRecord } from "./model/types";
import { PageFetcher } from "./usePageDocument";

/** Nav nesting deeper than this is a cycle, not a design. */
const MAX_DEPTH = 8;

/** Resolve `pageId` to the page navigation should open (pure apart from the
 *  fetches; a failed fetch stops the descent where it is). */
export async function resolveLanding(
  pageId: string,
  pages: readonly PageSummary[],
  fetchPage: PageFetcher,
  cache?: MutableRefObject<Map<string, PageRecord>>,
): Promise<string> {
  let id = pageId;
  const seen = new Set<string>([id]);
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    let record = cache?.current.get(id);
    if (!record) {
      try {
        record = normalizePage(await fetchPage(id));
      } catch {
        return id;
      }
      cache?.current.set(record.id, record);
    }
    const child = defaultChildPage(record.document, id, pages);
    if (!child || seen.has(child)) return id;
    seen.add(child);
    id = child;
  }
  return id;
}

/** Where a link to ONE region of `pageId` lands. A region other pages are
 *  placed in is an outlet, never shown bare: the link opens the page placed
 *  there — the first the page's nav names, else the first placed — and on
 *  down to that page's own default. A region with nothing placed in it opens
 *  the page itself. */
export async function resolveRegionLanding(
  pageId: string,
  regionId: string,
  pages: readonly PageSummary[],
  fetchPage: PageFetcher,
  cache?: MutableRefObject<Map<string, PageRecord>>,
): Promise<string> {
  const placed = pages.filter(
    (p) => p.placement?.page_id === pageId && p.placement.region_id === regionId && !p.presentation,
  );
  if (!placed.length) return pageId;
  let first = placed[0].id;
  let record = cache?.current.get(pageId);
  if (!record) {
    try {
      record = normalizePage(await fetchPage(pageId));
      cache?.current.set(record.id, record);
    } catch {
      record = undefined;
    }
  }
  if (record) first = navLinkedPageIds(record.document).find((id) => placed.some((p) => p.id === id)) ?? first;
  return resolveLanding(first, pages, fetchPage, cache);
}

/** `visit` that descends to the default child first. Only the latest call
 *  wins, so two quick clicks never land out of order. A `focus` (a link to
 *  one region) descends into that region only; `focus` and `host` are handed
 *  on to `visit` with the page landed on. */
export function useLandingVisit(
  visit: (id: string, focus?: RegionFocus | null, host?: HostOverride | null) => void,
  pages: readonly PageSummary[],
  fetchPage: PageFetcher,
  cache?: MutableRefObject<Map<string, PageRecord>>,
): (id: string, focus?: RegionFocus | null, host?: HostOverride | null) => void {
  const latest = useRef(0);
  return useCallback(
    (id: string, focus?: RegionFocus | null, host?: HostOverride | null) => {
      const token = ++latest.current;
      const landing = focus
        ? resolveRegionLanding(id, focus.regionId, pages, fetchPage, cache)
        : resolveLanding(id, pages, fetchPage, cache);
      void landing.then((target) => {
        if (token === latest.current) visit(target, focus, host);
      });
    },
    [visit, pages, fetchPage, cache],
  );
}
