// Sizes an element to fill the viewport from wherever it starts down to the
// bottom of the window, so the columns inside it can scroll independently
// instead of the whole page scrolling as one (the epic page's split layout).
//
// The top is measured, not assumed: what sits above the layout -- the lock
// banner on a frozen version, the page's own padding -- varies, and a fixed
// offset would either cut the columns off or leave the page scrolling a
// little as well. Re-measured whenever the window or anything above resizes.
// Below `minWidth` the columns stack, and the page scrolls as normal.
import { useCallback, useEffect, useRef } from "react";

/** The least space left under the layout, so the panels' bottom edges and shadows stay visible. */
const MIN_BOTTOM_GAP = 12;

export function useFillViewport<T extends HTMLElement>(minWidth: number): (el: T | null) => void {
  const node = useRef<T | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  const measure = useCallback(() => {
    const el = node.current;
    if (!el) return;
    if (window.innerWidth < minWidth) {
      el.style.removeProperty("height");
      el.classList.remove("fills-viewport");
      return;
    }
    const top = el.getBoundingClientRect().top + window.scrollY;
    // The page's own bottom padding is the gap: any less and the window
    // scrolls that last strip too, a third scroll behind the two columns.
    const padding = el.parentElement ? parseFloat(getComputedStyle(el.parentElement).paddingBottom) || 0 : 0;
    const height = `${Math.max(240, Math.floor(window.innerHeight - top - Math.max(padding, MIN_BOTTOM_GAP)))}px`;
    // Setting the height resizes the page this watches; only write a change,
    // so that one pass settles it rather than feeding the observer.
    if (el.style.height !== height) el.style.height = height;
    el.classList.add("fills-viewport");
  }, [minWidth]);

  useEffect(() => () => cleanup.current?.(), []);

  return useCallback(
    (el: T | null) => {
      cleanup.current?.();
      cleanup.current = null;
      node.current = el;
      if (!el) return;
      measure();
      // Anything above the layout changing height (a banner appearing, the
      // heading wrapping) moves its top, so watch the page it sits in.
      const ro = new ResizeObserver(measure);
      if (el.parentElement) ro.observe(el.parentElement);
      for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) ro.observe(sib);
      window.addEventListener("resize", measure);
      cleanup.current = () => {
        ro.disconnect();
        window.removeEventListener("resize", measure);
      };
    },
    [measure],
  );
}
