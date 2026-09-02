// Browser-style back/forward history over the active page id. Every page
// switch is a "visit": it appends to the trail and discards any forward
// branch, exactly as a browser address bar does. Back/forward step over
// entries whose page has since been deleted (and over the page already on
// screen), so stale trail entries never become dead stops.
//
// This is navigation history, not edit history — undo/redo of document edits
// lives in model/history.ts and is deliberately a separate stack.
import { useCallback, useMemo, useState } from "react";
import type { PageSummary } from "../projects/projectsApi";

type Trail = { stack: string[]; index: number };

export function usePageNav(
  pages: readonly PageSummary[],
  activePageId: string | null,
  setActivePageId: (id: string | null) => void,
) {
  const [trail, setTrail] = useState<Trail>({ stack: [], index: -1 });

  /** Switch page and record the step; a repeat visit of the current entry is a no-op. */
  const visit = useCallback(
    (id: string) => {
      setActivePageId(id);
      setTrail((t) => {
        if (t.stack[t.index] === id) return t;
        const stack = [...t.stack.slice(0, t.index + 1), id];
        return { stack, index: stack.length - 1 };
      });
    },
    [setActivePageId],
  );

  /** Nearest live entry from the cursor in `dir`, or -1 when there is none. */
  const target = useCallback(
    (t: Trail, dir: -1 | 1): number => {
      const alive = new Set(pages.map((p) => p.id));
      for (let i = t.index + dir; i >= 0 && i < t.stack.length; i += dir) {
        if (alive.has(t.stack[i]) && t.stack[i] !== activePageId) return i;
      }
      return -1;
    },
    [pages, activePageId],
  );

  const step = useCallback(
    (dir: -1 | 1) => {
      const i = target(trail, dir);
      if (i < 0) return;
      setActivePageId(trail.stack[i]);
      setTrail({ stack: trail.stack, index: i });
    },
    [trail, target, setActivePageId],
  );

  const back = useCallback(() => step(-1), [step]);
  const forward = useCallback(() => step(1), [step]);
  const canBack = useMemo(() => target(trail, -1) >= 0, [trail, target]);
  const canForward = useMemo(() => target(trail, 1) >= 0, [trail, target]);

  return { visit, back, forward, canBack, canForward };
}
