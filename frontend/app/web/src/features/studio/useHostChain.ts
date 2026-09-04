// Ancestor shells for a child page: walk `placement` upwards, fetching each
// parent, outermost first. Shared by the editor and preview so both render
// the same shell around a child page.
//
// A placement whose region has been removed from the parent's tree falls
// back to the parent's main content region (fallbackRegionId), so the shell
// — nav, header, panels — stays around the child and navigation only ever
// swaps the region it lands in. A placement whose parent page is gone ends
// the chain instead: that page renders top-level, matching what deleting a
// page promises ("pages linked inside its regions become top-level").
//
// The chain keeps the full PageRecord of each ancestor, not just its
// document: shells are editable in the studio, so edits (and outbox ACKs,
// and conflict reloads) must be able to update an ancestor in place through
// `update`. The preview only reads `levels`.
//
// Ancestors resolve through the caller's page cache (usePageDocument) when
// one is given: sibling pages share their shells, so a page switch usually
// rebuilds the chain without touching the network — synchronously, in fact,
// which keeps the shell chrome from flickering on navigation.
import { MutableRefObject, useCallback, useEffect, useMemo, useState } from "react";
import { HostLevel } from "./components/Canvas";
import { normalizePage } from "./model/positions";
import { fallbackRegionId, regionIds } from "./model/tree";
import { PageRecord } from "./model/types";
import { PageFetcher } from "./usePageDocument";

interface StoredLevel {
  record: PageRecord;
  /** The region the child's placement names — may since have been removed
   *  from the parent's tree, so the render-time regionId re-resolves. */
  placementRegionId: string;
}

export interface HostChain {
  /** What the canvases render: document + outlet region, outermost first. */
  levels: HostLevel[];
  /** The live ancestor rows, parallel to `levels`. */
  records: PageRecord[];
  /** Replace one ancestor's record (an edit, a version ACK, a conflict
   *  reload). A pageId not in the chain is ignored. */
  update(pageId: string, next: (prev: PageRecord) => PageRecord): void;
}

export function useHostChain(
  fetchPage: PageFetcher,
  page: PageRecord | null,
  cache?: MutableRefObject<Map<string, PageRecord>>,
): HostChain {
  const [stored, setStored] = useState<StoredLevel[]>([]);

  useEffect(() => {
    // Mid-switch the outgoing page is still rendered, so its shells must
    // stay too: only a RESOLVED page decides — a top-level one drops them,
    // a child page keeps the previous chain until its own has resolved.
    if (!page) return;
    if (!page.placement) {
      setStored([]);
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      const levels: StoredLevel[] = [];
      const seen = new Set<string>([page.id]);
      let placement = page.placement;
      while (placement && !seen.has(placement.page_id) && levels.length < 6) {
        try {
          let parent = cache?.current.get(placement.page_id) ?? null;
          if (!parent) {
            parent = normalizePage(await fetchPage(placement.page_id, { signal: controller.signal }));
            cache?.current.set(parent.id, parent);
          }
          levels.unshift({ record: parent, placementRegionId: placement.region_id });
          seen.add(parent.id);
          placement = parent.placement;
        } catch {
          break;
        }
      }
      if (!controller.signal.aborted) setStored(levels);
    };
    void load();
    return () => controller.abort();
  }, [page?.id, page?.placement, fetchPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(
    (pageId: string, next: (prev: PageRecord) => PageRecord) => {
      setStored((prev) => {
        if (!prev.some((l) => l.record.id === pageId)) return prev;
        return prev.map((l) => {
          if (l.record.id !== pageId) return l;
          const record = next(l.record);
          // Keep the cached copy current, so revisiting the shell page (or
          // rebuilding the chain) paints this edit rather than a stale fetch.
          cache?.current.set(record.id, record);
          return { ...l, record };
        });
      });
    },
    [cache],
  );

  return useMemo(() => {
    const levels = stored.map(({ record, placementRegionId }) => ({
      pageId: record.id,
      doc: record.document,
      regionId: regionIds(record.document.root).includes(placementRegionId)
        ? placementRegionId
        : fallbackRegionId(record.document.root),
    }));
    return { levels, records: stored.map((l) => l.record), update };
  }, [stored, update]);
}
