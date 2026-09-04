// Landing page for a wireframe: when no page is open (first visit, or the
// open page was deleted), open the wireframe's chosen landing page if one is
// set and still exists; otherwise fetch the first page — the shell — and
// open the first page its nav bars link to. A shell whose only job is to
// hold the nav is a redundant landing; a wireframe with no choice and no
// linked nav opens the first page as before. Returns the fetched shell
// document so callers can reuse it (the page switcher orders itself by the
// same nav).
import { MutableRefObject, useEffect, useState } from "react";
import type { PageSummary } from "../projects/projectsApi";
import { firstNavTarget } from "./model/navOrder";
import { normalizePage } from "./model/positions";
import { PageDocument, PageRecord } from "./model/types";
import { PageFetcher } from "./usePageDocument";

export function useNavLanding(
  fetchPage: PageFetcher,
  pages: readonly PageSummary[],
  activePageId: string | null,
  visit: (id: string) => void,
  landingPageId: string | null = null,
  /** Page cache to seed with the fetched shell (see usePageDocument): the
   *  shell is usually the host chain's outermost level, so the first
   *  child-page visit then builds its chain without another fetch. */
  cache?: MutableRefObject<Map<string, PageRecord>>,
): PageDocument | null {
  const [shellDoc, setShellDoc] = useState<PageDocument | null>(null);
  const missing = !!activePageId && !pages.some((p) => p.id === activePageId);

  useEffect(() => {
    if (!pages.length || (activePageId && !missing)) return;
    // An explicit choice that still resolves needs no shell fetch to decide;
    // a dangling one (page deleted since) falls back to the nav.
    const chosen = landingPageId && pages.some((p) => p.id === landingPageId) ? landingPageId : null;
    let cancelled = false;
    const fallback = pages[0].id;
    fetchPage(fallback)
      .then((p) => {
        if (cancelled) return;
        const record = normalizePage(p);
        cache?.current.set(record.id, record);
        setShellDoc(record.document);
        visit(chosen ?? firstNavTarget(record.document, pages) ?? fallback);
      })
      .catch(() => {
        // The landing choice is a nicety; a failed fetch still lands somewhere.
        if (!cancelled) visit(chosen ?? fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, pages, activePageId, missing, visit, landingPageId, cache]);

  return shellDoc;
}
