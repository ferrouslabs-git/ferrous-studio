import { describe, expect, it } from "vitest";
import { clampScale, MAX_VIEW_SCALE, MIN_VIEW_SCALE, zoomAbout } from "./viewGestures";

// maxGraph draws graph point g at screen (g + t) * s.
const screenOf = (g: { x: number; y: number }, s: number, t: { x: number; y: number }) => ({ x: (g.x + t.x) * s, y: (g.y + t.y) * s });

describe("zoomAbout", () => {
  it("keeps the point under the fingers where it was", () => {
    const s = 0.5;
    const t = { x: 40, y: -20 };
    const at = { x: 180, y: 90 };
    const g = { x: at.x / s - t.x, y: at.y / s - t.y };
    const next = zoomAbout(s, t, at, 2);
    const back = screenOf(g, 2, next);
    expect(back.x).toBeCloseTo(at.x);
    expect(back.y).toBeCloseTo(at.y);
  });

  it("changes nothing when the scale does not", () => {
    expect(zoomAbout(1, { x: 5, y: 7 }, { x: 100, y: 100 }, 1)).toEqual({ x: 5, y: 7 });
  });
});

describe("clampScale", () => {
  it("holds a pinch inside the viewer's range", () => {
    expect(clampScale(100)).toBe(MAX_VIEW_SCALE);
    expect(clampScale(0.001)).toBe(MIN_VIEW_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });
});
