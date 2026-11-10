// Browser-style back/forward history over the active page id. Every page
// switch is a "visit": it appends to the trail and discards any forward
// branch, exactly as a browser address bar does. Back/forward step over
// entries whose page has since been deleted (and over the page already on
// screen), so stale trail entries never become dead stops.
//
// A visit may carry a region focus (a link to one region of a page — see
// model/regionFocus.ts). It lives on the trail entry, so back/forward bring
// back exactly the view that was left, and a plain visit keeps it only for
// a page placed under the focused one.
//
// This is navigation history, not edit history — undo/redo of document edits
// lives in model/history.ts and is deliberately a separate stack.
import { useCallback, useMemo, useRef, useState } from "react";
import type { PageSummary } from "../projects/projectsApi";
import { inheritsFocus, RegionFocus, sameFocus } from "./model/regionFocus";

type Entry = { id: string; focus: RegionFocus | null };
type Trail = { stack: Entry[]; index: number };

export function usePageNav(
  pages: readonly PageSummary[],
  activePageId: string | null,
  setActivePageId: (id: string | null) => void,
) {
  const [trail, setTrail] = useState<Trail>({ stack: [], index: -1 });
  // Read at visit time, so `visit` keeps one identity across page-list reloads.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  /** Switch page and record the step; a repeat visit of the current entry is
   *  a no-op. `focus` narrows the view to one region; left out, the current
   *  focus carries over when `id` is placed under the focused page. */
  const visit = useCallback(
    (id: string, focus?: RegionFocus | null) => {
      setActivePageId(id);
      setTrail((t) => {
        const current = t.stack[t.index];
        const next = focus !== undefined ? focus : current && inheritsFocus(id, current.focus, pagesRef.current) ? current.focus : null;
        if (current && current.id === id && sameFocus(current.focus, next)) return t;
        const stack = [...t.stack.slice(0, t.index + 1), { id, focus: next }];
        return { stack, index: stack.length - 1 };
      });
    },
    [setActivePageId],
  );

  /** Nearest live entry from the cursor in `dir`, or -1 when there is none.
   *  The page on screen is skipped unless the entry shows it differently. */
  const target = useCallback(
    (t: Trail, dir: -1 | 1): number => {
      const alive = new Set(pages.map((p) => p.id));
      const here = t.stack[t.index]?.focus ?? null;
      for (let i = t.index + dir; i >= 0 && i < t.stack.length; i += dir) {
        const entry = t.stack[i];
        if (alive.has(entry.id) && (entry.id !== activePageId || !sameFocus(entry.focus, here))) return i;
      }
      return -1;
    },
    [pages, activePageId],
  );

  const step = useCallback(
    (dir: -1 | 1) => {
      const i = target(trail, dir);
      if (i < 0) return;
      setActivePageId(trail.stack[i].id);
      setTrail({ stack: trail.stack, index: i });
    },
    [trail, target, setActivePageId],
  );

  const back = useCallback(() => step(-1), [step]);
  const forward = useCallback(() => step(1), [step]);
  const canBack = useMemo(() => target(trail, -1) >= 0, [trail, target]);
  const canForward = useMemo(() => target(trail, 1) >= 0, [trail, target]);

  /** The region focus of the view on screen. A page opened outside the trail
   *  (the first landing) has none. */
  const current = trail.stack[trail.index];
  const focus = current && current.id === activePageId ? current.focus : null;

  return { visit, back, forward, canBack, canForward, focus };
}
