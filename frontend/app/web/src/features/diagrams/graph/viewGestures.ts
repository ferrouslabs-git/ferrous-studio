// Looking round a diagram without editing it: one finger (or the mouse) drags
// the drawing, two fingers pinch to zoom about the point between them. The
// editor pans on the wheel and never on a drag -- a drag there selects -- so
// this is only attached to a graph that has been disabled for viewing.
import type { BaseGraph } from "@maxgraph/core";

export const MIN_VIEW_SCALE = 0.1;
export const MAX_VIEW_SCALE = 4;

interface Point {
  x: number;
  y: number;
}

/**
 * The translate that keeps the drawing under `at` (container pixels) still
 * while the scale changes. maxGraph draws a graph point g at (g + t) * s, so
 * the point under `at` is at / s - t, and holding it there solves for t'.
 */
export function zoomAbout(scale: number, translate: Point, at: Point, nextScale: number): Point {
  const gx = at.x / scale - translate.x;
  const gy = at.y / scale - translate.y;
  return { x: at.x / nextScale - gx, y: at.y / nextScale - gy };
}

export function clampScale(s: number): number {
  return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, s));
}

/** Attach pan and pinch to the graph's container; returns the detach. */
export function attachViewGestures(graph: BaseGraph, el: HTMLElement): () => void {
  const pointers = new Map<number, Point>();
  // The centre of the fingers down and how far apart they are, as last seen.
  let last: { c: Point; spread: number } | null = null;

  const snapshot = () => {
    const ps = [...pointers.values()];
    if (!ps.length) return null;
    const c = { x: ps.reduce((n, p) => n + p.x, 0) / ps.length, y: ps.reduce((n, p) => n + p.y, 0) / ps.length };
    const spread = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    return { c, spread };
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    el.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last = snapshot();
    e.preventDefault();
  };

  const move = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = snapshot();
    if (!now || !last) return;
    const view = graph.getView();
    const s = view.scale;
    const t = view.translate;
    const rect = el.getBoundingClientRect();
    let next = s;
    let tx = t.x;
    let ty = t.y;
    if (pointers.size > 1 && last.spread > 0 && now.spread > 0) {
      next = clampScale(s * (now.spread / last.spread));
      const at = { x: last.c.x - rect.left, y: last.c.y - rect.top };
      ({ x: tx, y: ty } = zoomAbout(s, t, at, next));
    }
    tx += (now.c.x - last.c.x) / next;
    ty += (now.c.y - last.c.y) / next;
    view.scaleAndTranslate(next, tx, ty);
    last = now;
  };

  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    last = snapshot();
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
  };
}
