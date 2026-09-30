// The app's width bands, for the few places that must change what they
// render rather than how it is laid out (a wireframe opens as its preview on
// a phone; the sprint board shows one lane). Layout itself belongs in CSS,
// whose media queries repeat these numbers -- CSS cannot read them from here,
// so each such query is tagged with the constant's name to grep for.
//
//   phone   <= PHONE_MAX   one column; canvas editors become viewers
//   narrow  <= NARROW_MAX  the sidebar is a top strip (shell.css)
//
// The board's own 1320px stacking point lives with its layouts in board.css.
import { useSyncExternalStore } from "react";

export const PHONE_MAX = 600;
export const NARROW_MAX = 820;

export const PHONE_QUERY = `(max-width: ${PHONE_MAX}px)`;
export const NARROW_QUERY = `(max-width: ${NARROW_MAX}px)`;
/** A finger rather than a mouse: no hover, and a larger contact area. */
export const TOUCH_QUERY = "(hover: none), (pointer: coarse)";

function mediaList(query: string): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
}

/** Whether a media query matches, kept current as the window changes. False
 *  where there is no window: the landing page is prerendered on the server. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = mediaList(query);
      if (!list) return () => {};
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => mediaList(query)?.matches ?? false,
    () => false,
  );
}

export const useIsPhone = (): boolean => useMediaQuery(PHONE_QUERY);
export const useIsNarrow = (): boolean => useMediaQuery(NARROW_QUERY);
export const useIsTouch = (): boolean => useMediaQuery(TOUCH_QUERY);
