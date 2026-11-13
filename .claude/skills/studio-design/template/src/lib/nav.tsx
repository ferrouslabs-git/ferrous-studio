// Navigation by wireframe page id.
//
// Every link in the wireframe is a `LinkTarget { pageId, regionId? }`. This
// module turns one into a route change, so page components never hard-code a
// path: `const go = useGo(); <button onClick={() => go("page-orders")}>`.
import { useCallback } from "react";
import { Location, useLocation, useNavigate } from "react-router-dom";
import { PAGES, PageEntry } from "../pages";

/** The wireframe's sentinel target: go back to the page visited before. */
export const BACK = "@back";

const byId = new Map(PAGES.map((page) => [page.id, page]));

/** The absolute hash path of a page: its own path under its parents'. */
export function pathOf(pageId: string): string {
  const parts: string[] = [];
  let page: PageEntry | undefined = byId.get(pageId);
  for (let depth = 0; page && depth < 16; depth += 1) {
    parts.unshift(page.path);
    page = page.parentId ? byId.get(page.parentId) : undefined;
  }
  const joined = parts.join("/").replace(/\/+/g, "/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

/** Where an overlay was opened from, carried in router state so the page
 *  underneath keeps rendering while the overlay is up. */
export interface OverlayState {
  background?: Location;
}

/** `go(pageId)` follows a wireframe link. An overlay page opens over the
 *  current one; "@back" returns to the previous page; an unknown id does
 *  nothing, like a link whose target page was deleted. */
export function useGo(): (pageId: string, regionId?: string) => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(
    (pageId: string, regionId?: string) => {
      if (pageId === BACK) {
        navigate(-1);
        return;
      }
      const page = byId.get(pageId);
      if (!page) return;
      const background = (location.state as OverlayState | null)?.background ?? location;
      navigate(
        { pathname: pathOf(pageId), hash: regionId ? `#${regionId}` : undefined },
        page.presentation ? { state: { background } satisfies OverlayState } : undefined,
      );
    },
    [navigate, location],
  );
}
