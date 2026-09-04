// One page of a wireframe, held for the canvas. Visiting a page fetches it,
// but the outgoing page stays rendered until the incoming server copy lands,
// so navigation never blanks the canvas. Every copy seen — fetches, edits,
// ACK version bumps, conflict rebases — is written through to a per-mount
// cache, so a revisit paints instantly from the cache while the fetch
// revalidates it. Shared by the editor and the preview.
//
// Callers must gate edits on "settled" (page.id === activePageId and no
// pendingPageId): mid-switch the canvas shows a copy the server is about to
// replace, and an edit against it would silently diverge from what arrives.
import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, RequestOptions } from "../../core/api";
import { getWireframePage } from "../project/wireframes/wireframesApi";
import { normalizePage } from "./model/positions";
import { PageRecord } from "./model/types";

/** Where a page comes from. The editor and live preview fetch the wireframe's
 *  current pages; snapshot preview resolves them from the snapshot it loaded,
 *  which is the whole reason this is a function and not a pair of ids.
 *
 *  MUST be identity-stable (useCallback/useMemo): the hooks below key their
 *  fetch effects on it, and a new identity per render would refetch forever.
 *  Its identity is also what "a different wireframe" means to them — changing
 *  it clears the page cache. */
export type PageFetcher = (pageId: string, opts?: RequestOptions) => Promise<PageRecord>;

/** The live pages of one wireframe. */
export function useLivePages(projectId: string, wireframeId: string): PageFetcher {
  return useCallback(
    (pageId, opts) => getWireframePage(projectId, wireframeId, pageId, opts),
    [projectId, wireframeId],
  );
}

export interface PageDocumentHandle {
  /** What the canvas renders: during a switch, the outgoing page (or a
   *  cached copy of the incoming one) until the server copy arrives. */
  page: PageRecord | null;
  /** Write-through setter: every update also refreshes the cache entry. */
  setPage: Dispatch<SetStateAction<PageRecord | null>>;
  /** Page id a fetch is in flight for; null once settled (or failed). */
  pendingPageId: string | null;
  /** Per-mount cache of every page copy seen; useHostChain reads and feeds
   *  it too, so shells repeat across sibling pages without refetching. */
  cache: MutableRefObject<Map<string, PageRecord>>;
  /** Forget one page (after a delete). */
  evict: (pageId: string) => void;
}

export function usePageDocument(
  fetchPage: PageFetcher,
  activePageId: string | null,
  handlers: {
    /** The visited page's server copy landed (raw kept for migration diffs). */
    onArrive?: (raw: PageRecord, normalised: PageRecord) => void;
    onError?: (message: string) => void;
  } = {},
): PageDocumentHandle {
  const [page, setPageState] = useState<PageRecord | null>(null);
  const [pendingPageId, setPendingPageId] = useState<string | null>(null);
  const cache = useRef(new Map<string, PageRecord>());
  // Handlers live in a ref so the fetch effect keys on ids alone.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // Another wireframe's pages must not linger under the new chrome. Declared
  // before the fetch effect so on a switch the clear runs first.
  useEffect(() => {
    const store = cache.current;
    return () => {
      store.clear();
      setPageState(null);
      setPendingPageId(null);
    };
  }, [fetchPage]);

  useEffect(() => {
    // No open page (e.g. it was just deleted): keep the outgoing page on
    // screen — useNavLanding is about to visit a replacement.
    if (!activePageId) return;
    const cached = cache.current.get(activePageId);
    // A revisit paints instantly from the cache; the fetch still revalidates.
    if (cached) setPageState(cached);
    setPendingPageId(activePageId);
    const controller = new AbortController();
    fetchPage(activePageId, { signal: controller.signal })
      .then((raw) => {
        if (controller.signal.aborted) return;
        const normalised = normalizePage(raw);
        cache.current.set(normalised.id, normalised);
        setPageState(normalised);
        setPendingPageId(null);
        handlersRef.current.onArrive?.(raw, normalised);
      })
      .catch((err) => {
        // A superseded switch aborts here; only a real failure surfaces. The
        // outgoing page stays visible (read-only, since it never settles) and
        // picking any page retries.
        if (controller.signal.aborted) return;
        setPendingPageId(null);
        handlersRef.current.onError?.(errorMessage(err));
      });
    return () => controller.abort();
  }, [fetchPage, activePageId]);

  /** Identity-stable (it feeds the outbox effect); writes through so edits,
   *  ACKs and rebases keep the cached copy current for the next revisit. */
  const setPage = useCallback((action: SetStateAction<PageRecord | null>) => {
    setPageState((prev) => {
      const next = typeof action === "function" ? action(prev) : action;
      if (next) cache.current.set(next.id, next);
      return next;
    });
  }, []);

  const evict = useCallback((pageId: string) => {
    cache.current.delete(pageId);
  }, []);

  return { page, setPage, pendingPageId, cache, evict };
}
