// Visiting a page through navigation (a followed link, the page switcher, a
// level-one nav item) lands on its nav-driven default child, all the way
// down: a detail page whose tabs link into its lower region opens on the
// first tab, and a level-one item whose page carries a level-two nav opens
// that nav's first item (see defaultChildPage). Back/forward are untouched —
// they replay exactly where the user was.
import { MutableRefObject, useCallback, useRef } from "react";
import type { PageSummary } from "../projects/projectsApi";
import { defaultChildPage } from "./model/navOrder";
import { normalizePage } from "./model/positions";
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

/** `visit` that descends to the default child first. Only the latest call
 *  wins, so two quick clicks never land out of order. */
export function useLandingVisit(
  visit: (id: string) => void,
  pages: readonly PageSummary[],
  fetchPage: PageFetcher,
  cache?: MutableRefObject<Map<string, PageRecord>>,
): (id: string) => void {
  const latest = useRef(0);
  return useCallback(
    (id: string) => {
      const token = ++latest.current;
      void resolveLanding(id, pages, fetchPage, cache).then((target) => {
        if (token === latest.current) visit(target);
      });
    },
    [visit, pages, fetchPage, cache],
  );
}
