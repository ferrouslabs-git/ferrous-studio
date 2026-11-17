// Navigation by wireframe page id.
//
// Every link in the wireframe is a `LinkTarget { pageId, regionId? }`. This
// module turns one into a route change, so page components never hard-code a
// path: `const go = useGo(); <button onClick={() => go(ORDERS)}>`.
//
// A page can have more than one registry entry (see src/pages.ts): its home
// placement, and a copy under each host that shows it. A link resolves to the
// copy nearest the page on show, so following it keeps the current shell.
import { ReactNode, useCallback } from "react";
import { Location, Navigate, useLocation, useNavigate, useOutlet } from "react-router-dom";
import { PAGES, PageEntry } from "../pages";

/** The wireframe's sentinel target: go back to the page visited before. */
export const BACK = "@back";

// Built on first use: pages.ts imports the page modules, which import this.
let byIdCache: Map<string, PageEntry> | undefined;
let bySourceCache: Map<string, PageEntry[]> | undefined;
function byId() {
  return (byIdCache ??= new Map(PAGES.map((page) => [page.id, page])));
}
function bySource() {
  if (!bySourceCache) {
    bySourceCache = new Map();
    for (const page of PAGES) {
      const list = bySourceCache.get(page.sourceId) ?? [];
      list.push(page);
      bySourceCache.set(page.sourceId, list);
    }
  }
  return bySourceCache;
}

export function pageById(id: string): PageEntry | undefined {
  return byId().get(id);
}

/** The absolute hash path of a registry entry: its own path under its parents'. */
export function pathOf(entryId: string): string {
  const parts: string[] = [];
  let page = byId().get(entryId);
  for (let depth = 0; page && depth < 16; depth += 1) {
    parts.unshift(page.path);
    page = page.parentId ? byId().get(page.parentId) : undefined;
  }
  const joined = parts.join("/").replace(/\/+/g, "/");
  const path = joined.startsWith("/") ? joined : `/${joined}`;
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

function sharedSegments(a: string, b: string): number {
  const x = a.split("/").filter(Boolean);
  const y = b.split("/").filter(Boolean);
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n += 1;
  return n;
}

/** The registry entry a link to `pageId` should open, seen from `from`: the
 *  copy of that page whose address shares most with the page on show. */
export function resolveEntry(pageId: string, from: string): PageEntry | undefined {
  const exact = byId().get(pageId);
  if (exact && exact.id !== exact.sourceId) return exact;
  const candidates = bySource().get(pageId) ?? (exact ? [exact] : []);
  let best: PageEntry | undefined;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = sharedSegments(pathOf(candidate.id), from);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** Where an overlay was opened from, carried in router state so the page
 *  underneath keeps rendering while the overlay is up. */
export interface OverlayState {
  background?: Location;
}

/** The location of the page on show: under an open overlay, the page it was
 *  opened over. */
export function useShownLocation(): Location {
  const location = useLocation();
  return (location.state as OverlayState | null)?.background ?? location;
}

/** `go(pageId)` follows a wireframe link. An overlay page opens over the
 *  current one; "@back" returns to the previous page; an unknown id does
 *  nothing, like a link whose target page was deleted. */
export function useGo(): (pageId: string, regionId?: string) => void {
  const navigate = useNavigate();
  const shown = useShownLocation();
  return useCallback(
    (pageId: string, regionId?: string) => {
      if (pageId === BACK) {
        navigate(-1);
        return;
      }
      const page = resolveEntry(pageId, shown.pathname);
      if (!page) return;
      navigate(
        { pathname: pathOf(page.id), hash: regionId ? `#${regionId}` : undefined },
        page.presentation ? { state: { background: shown } satisfies OverlayState } : undefined,
      );
    },
    [navigate, shown],
  );
}

/** The address a link to `pageId` opens, and whether that page (or one
 *  inside it) is the one on show: for nav items and tabs. */
export function usePageLink(pageId: string): { href: string; active: boolean } {
  const shown = useShownLocation();
  const page = resolveEntry(pageId, shown.pathname);
  const href = page ? pathOf(page.id) : shown.pathname;
  const active = !!page && (shown.pathname === href || (href !== "/" && shown.pathname.startsWith(`${href}/`)));
  return { href, active };
}

/** A host page's <Outlet />, or, when nothing is placed in it yet, a redirect
 *  to the page its nav lists first, so a host never shows an empty region. */
export function HostOutlet({ fallbackPageId }: { fallbackPageId: string }): ReactNode {
  const outlet = useOutlet();
  const shown = useShownLocation();
  if (outlet) return outlet;
  const page = resolveEntry(fallbackPageId, shown.pathname);
  return page ? <Navigate to={pathOf(page.id)} replace /> : null;
}
