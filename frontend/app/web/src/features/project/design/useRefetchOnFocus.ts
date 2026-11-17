// Re-runs a loader when the window comes back into view. A design changes
// outside Studio -- in Figma Make, then through a sync run in Claude Code -- so
// the person looking at it has always just been somewhere else; coming back
// should show what is there now without a reload.
import { useEffect, useRef } from "react";

/** Least time between two refetches, so a focus and a visibility change
 *  arriving together (they do, on a tab switch) cost one request. */
const MIN_GAP_MS = 2000;

export function useRefetchOnFocus(reload: () => unknown): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    let last = 0;
    const refetch = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < MIN_GAP_MS) return;
      last = now;
      void reloadRef.current();
    };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", refetch);
    };
  }, []);
}
