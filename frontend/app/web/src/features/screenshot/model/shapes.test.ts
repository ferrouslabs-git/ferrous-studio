import { describe, expect, it } from "vitest";
import {
  arrowHead,
  boundsOf,
  clampPoint,
  distanceToSegment,
  extendDraft,
  fitScale,
  hitTest,
  newShape,
  normRect,
  pathD,
  Shape,
  simplify,
  strokeScale,
  toImagePoint,
  translateShape,
} from "./shapes";

const IMAGE = { width: 1000, height: 500 };
const STYLE = { colour: "#FF3B30", step: 1 };

describe("normRect", () => {
  it("puts a rectangle right whichever way it was dragged", () => {
    const forwards = normRect({ x: 10, y: 20 }, { x: 40, y: 60 });
    const backwards = normRect({ x: 40, y: 60 }, { x: 10, y: 20 });
    expect(forwards).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(backwards).toEqual(forwards);
  });

  it("survives a click with no drag", () => {
    expect(normRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});

describe("toImagePoint", () => {
  const rect = { x: 100, y: 50, width: 500, height: 250 };

  it("maps a displayed position to image pixels at any scale", () => {
    // The element is half the image's size, so the centre of one is the
    // centre of the other.
    expect(toImagePoint(350, 175, rect, IMAGE)).toEqual({ x: 500, y: 250 });
  });

  it("clamps a drag that leaves the image", () => {
    expect(toImagePoint(-999, -999, rect, IMAGE)).toEqual({ x: 0, y: 0 });
    expect(toImagePoint(9999, 9999, rect, IMAGE)).toEqual({ x: 1000, y: 500 });
  });

  it("does not divide by zero before layout has happened", () => {
    expect(toImagePoint(10, 10, { x: 0, y: 0, width: 0, height: 0 }, IMAGE)).toEqual({ x: 0, y: 0 });
  });
});

describe("fitScale", () => {
  it("shrinks a large image to fit", () => {
    expect(fitScale({ width: 2000, height: 1000 }, { width: 1000, height: 1000 })).toBe(0.5);
  });

  it("never magnifies a small one", () => {
    expect(fitScale({ width: 100, height: 100 }, { width: 1000, height: 1000 })).toBe(1);
  });
});

describe("strokeScale", () => {
  it("grows with the image so annotations read the same when fitted", () => {
    expect(strokeScale({ width: 1000, height: 500 })).toBe(1);
    expect(strokeScale({ width: 2560, height: 1440 })).toBeCloseTo(2.56);
  });

  it("never goes below 1, so a tiny capture keeps a visible line", () => {
    expect(strokeScale({ width: 200, height: 100 })).toBe(1);
  });
});

describe("extendDraft", () => {
  it("grows each kind by its own end", () => {
    const to = { x: 90, y: 90 };
    const arrow = extendDraft(newShape("arrow", { x: 0, y: 0 }, STYLE, IMAGE), to);
    const box = extendDraft(newShape("rect", { x: 0, y: 0 }, STYLE, IMAGE), to);
    const line = extendDraft(newShape("freehand", { x: 0, y: 0 }, STYLE, IMAGE), to);
    expect(arrow.kind === "arrow" && arrow.to).toEqual(to);
    expect(box.kind === "rect" && box.b).toEqual(to);
    expect(line.kind === "freehand" && line.points).toHaveLength(2);
  });

  it("leaves text alone -- it is placed, not dragged", () => {
    const text = newShape("text", { x: 5, y: 5 }, STYLE, IMAGE);
    expect(extendDraft(text, { x: 90, y: 90 })).toBe(text);
  });

  it("never mutates the shape it was given", () => {
    const arrow = newShape("arrow", { x: 0, y: 0 }, STYLE, IMAGE) as Extract<Shape, { kind: "arrow" }>;
    extendDraft(arrow, { x: 90, y: 90 });
    expect(arrow.to).toEqual({ x: 0, y: 0 });
  });
});

describe("translateShape", () => {
  it("moves every point of a freehand stroke together", () => {
    const line = extendDraft(newShape("freehand", { x: 10, y: 10 }, STYLE, IMAGE), { x: 20, y: 20 });
    const moved = translateShape(line, 5, -5);
    expect(moved.kind === "freehand" && moved.points).toEqual([
      { x: 15, y: 5 },
      { x: 25, y: 15 },
    ]);
  });

  it("moves both ends of an arrow, keeping its direction", () => {
    const arrow = extendDraft(newShape("arrow", { x: 0, y: 0 }, STYLE, IMAGE), { x: 10, y: 0 });
    const moved = translateShape(arrow, 3, 4);
    expect(moved.kind === "arrow" && moved.from).toEqual({ x: 3, y: 4 });
    expect(moved.kind === "arrow" && moved.to).toEqual({ x: 13, y: 4 });
  });
});

describe("arrowHead", () => {
  it("sits at the tip and points along the shaft", () => {
    const [tip, left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(tip).toEqual({ x: 100, y: 0 });
    // Both barbs sit behind the tip, symmetrically about the shaft.
    expect(left.x).toBeLessThan(100);
    expect(right.x).toBeCloseTo(left.x);
    expect(left.y).toBeCloseTo(-right.y);
  });

  it("still produces a head for a zero-length drag", () => {
    const [tip, left, right] = arrowHead({ x: 5, y: 5 }, { x: 5, y: 5 }, 4);
    expect(tip).toEqual({ x: 5, y: 5 });
    expect(Number.isFinite(left.x) && Number.isFinite(right.y)).toBe(true);
  });

  it("scales with the stroke width", () => {
    const thin = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 2);
    const thick = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 8);
    expect(100 - thick[1].x).toBeGreaterThan(100 - thin[1].x);
  });
});

describe("distanceToSegment", () => {
  it("measures perpendicular distance to the middle", () => {
    expect(distanceToSegment({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10);
  });

  it("measures to the nearer end when past it", () => {
    expect(distanceToSegment({ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10);
  });

  it("handles a degenerate segment", () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe("hitTest", () => {
  const box = (id: string, a: { x: number; y: number }, b: { x: number; y: number }): Shape => ({
    id,
    kind: "rect",
    colour: "#fff",
    a,
    b,
    width: 2,
  });

  it("returns the topmost shape, not the first drawn", () => {
    const shapes = [
      box("under", { x: 0, y: 0 }, { x: 100, y: 100 }),
      box("over", { x: 0, y: 0 }, { x: 100, y: 100 }),
    ];
    expect(hitTest(shapes, { x: 0, y: 50 }, 3)).toBe("over");
  });

  it("hits a hollow rectangle on its edge only, so you can click through it", () => {
    const shapes = [box("frame", { x: 0, y: 0 }, { x: 100, y: 100 })];
    expect(hitTest(shapes, { x: 0, y: 50 }, 3)).toBe("frame");
    expect(hitTest(shapes, { x: 50, y: 50 }, 3)).toBeNull();
  });

  it("hits a redaction bar anywhere, because it is solid", () => {
    const shapes: Shape[] = [{ id: "r", kind: "redact", colour: "#000", a: { x: 0, y: 0 }, b: { x: 100, y: 100 } }];
    expect(hitTest(shapes, { x: 50, y: 50 }, 3)).toBe("r");
  });

  it("returns null on empty space", () => {
    expect(hitTest([box("b", { x: 0, y: 0 }, { x: 10, y: 10 })], { x: 500, y: 500 }, 3)).toBeNull();
  });
});

describe("simplify", () => {
  it("drops points closer together than the threshold", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 50, y: 0 },
    ];
    expect(simplify(points, 10)).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);
  });

  it("always keeps the last point, so a stroke ends where the finger did", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 101, y: 0 },
    ];
    const kept = simplify(points, 10);
    expect(kept[kept.length - 1]).toEqual({ x: 101, y: 0 });
  });

  it("leaves a two-point stroke alone", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    expect(simplify(points, 10)).toEqual(points);
  });
});

describe("boundsOf", () => {
  it("bounds a freehand stroke by its extremes", () => {
    const line: Shape = {
      id: "f",
      kind: "freehand",
      colour: "#fff",
      width: 2,
      points: [
        { x: 10, y: 40 },
        { x: 30, y: 5 },
        { x: 20, y: 60 },
      ],
    };
    expect(boundsOf(line)).toEqual({ x: 10, y: 5, width: 20, height: 55 });
  });

  it("puts a text box above its baseline", () => {
    const text: Shape = { id: "t", kind: "text", colour: "#fff", at: { x: 10, y: 100 }, text: "hi", size: 20 };
    const bounds = boundsOf(text);
    expect(bounds.y).toBe(80);
    expect(bounds.width).toBeGreaterThan(0);
  });
});

describe("clampPoint", () => {
  it("keeps a point inside the image", () => {
    expect(clampPoint({ x: -5, y: 9999 }, IMAGE)).toEqual({ x: 0, y: 500 });
  });
});

describe("pathD", () => {
  it("writes a move followed by lines", () => {
    expect(
      pathD([
        { x: 0, y: 0 },
        { x: 10.04, y: 20 },
      ]),
    ).toBe("M 0 0 L 10 20");
  });

  it("is empty for no points", () => {
    expect(pathD([])).toBe("");
  });
});
