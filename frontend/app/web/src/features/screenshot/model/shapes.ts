// The annotation shapes a screenshot can carry, and the geometry that acts on
// them. Pure: no DOM, no React, no canvas -- everything here takes numbers and
// returns numbers, which is what makes it testable in the node environment
// vitest runs in (see shapes.test.ts, and features/studio/model/* for the same
// split between a tested model and an untested surface).
//
// COORDINATE SPACE. Every point is in *natural image pixels*. The editor's SVG
// carries viewBox="0 0 W H" and is CSS-sized to the fitted box, so the browser
// performs every scale conversion and nothing here has to know how big the
// screenshot is drawn on screen. flatten() then paints at 1:1. A resize, or a
// Fit/100% toggle, moves no shape.

export interface Point {
  x: number;
  y: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ShapeKind = "arrow" | "rect" | "freehand" | "text" | "redact";

interface ShapeBase {
  id: string;
  colour: string;
}

export interface ArrowShape extends ShapeBase {
  kind: "arrow";
  from: Point;
  to: Point;
  width: number;
}

/** `a`/`b` are the raw drag corners, in whichever order they were drawn;
 *  normRect puts them right at read time so a drag can go any direction. */
export interface RectShape extends ShapeBase {
  kind: "rect";
  a: Point;
  b: Point;
  width: number;
}

export interface FreehandShape extends ShapeBase {
  kind: "freehand";
  points: Point[];
  width: number;
}

export interface TextShape extends ShapeBase {
  kind: "text";
  at: Point;
  text: string;
  size: number;
}

/** A solid bar burned into the flattened image. Never a removable overlay --
 *  see the invariant in ScreenshotEditor.tsx. `colour` is unused. */
export interface RedactShape extends ShapeBase {
  kind: "redact";
  a: Point;
  b: Point;
}

export type Shape = ArrowShape | RectShape | FreehandShape | TextShape | RedactShape;

/** Six swatches rather than a colour input: a fixed set keeps annotations
 *  legible against arbitrary screenshots, and picking is one click. */
export const PALETTE = ["#FF3B30", "#FFCC00", "#34C759", "#0A84FF", "#FFFFFF", "#111111"] as const;

export const DEFAULT_COLOUR = PALETTE[0];

/** Small / medium / large, before scaling. Indices, not values, are stored in
 *  the editor's style state. */
export const STROKE_STEPS = [2, 4, 7] as const;
export const FONT_STEPS = [16, 24, 34] as const;

export interface Style {
  colour: string;
  /** Index into STROKE_STEPS / FONT_STEPS. */
  step: number;
}

/**
 * How much to multiply a nominal stroke or font size by, for this image.
 *
 * Sizes scale with the image's own longest edge rather than with the screen, so
 * the same annotation reads identically on an 800px capture and a 2560px one.
 * A screen-relative width would come out hairline-thin on a large screenshot
 * viewed fitted, which is exactly when annotation matters most.
 */
export function strokeScale(image: ImageSize): number {
  return Math.max(1, Math.max(image.width, image.height) / 1000);
}

export function strokeWidth(image: ImageSize, step: number): number {
  return STROKE_STEPS[clampStep(step, STROKE_STEPS.length)] * strokeScale(image);
}

export function fontSize(image: ImageSize, step: number): number {
  return FONT_STEPS[clampStep(step, FONT_STEPS.length)] * strokeScale(image);
}

function clampStep(step: number, length: number): number {
  return Math.min(length - 1, Math.max(0, Math.round(step)));
}

/** Corners in either order to a positive-width rectangle. */
export function normRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function clampPoint(p: Point, image: ImageSize): Point {
  return {
    x: Math.min(image.width, Math.max(0, p.x)),
    y: Math.min(image.height, Math.max(0, p.y)),
  };
}

/**
 * A pointer position in client coordinates, as a point in the image.
 *
 * Reads the live element rect, so it is correct at any zoom and after any
 * scroll without being told which. The caller must keep the element's aspect
 * ratio equal to the image's -- otherwise the SVG's preserveAspectRatio
 * letterboxes, rect and viewBox disagree, and every click lands offset.
 */
export function toImagePoint(clientX: number, clientY: number, rect: Rect, image: ImageSize): Point {
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  return clampPoint(
    {
      x: ((clientX - rect.x) / rect.width) * image.width,
      y: ((clientY - rect.y) / rect.height) * image.height,
    },
    image,
  );
}

/** Scale that fits `image` inside `viewport`, never magnifying past 1:1 -- a
 *  small capture stays crisp rather than being blown up and soft. */
export function fitScale(image: ImageSize, viewport: ImageSize): number {
  if (image.width === 0 || image.height === 0) return 1;
  return Math.min(1, viewport.width / image.width, viewport.height / image.height);
}

let idSeq = 0;

/** Editor-local ids; shapes are never persisted, so these need only be unique
 *  within one editing session. */
export function nextShapeId(): string {
  idSeq += 1;
  return `s${idSeq}`;
}

/** A zero-extent shape at the drag's start, to be grown by extendDraft. */
export function newShape(kind: ShapeKind, at: Point, style: Style, image: ImageSize): Shape {
  const id = nextShapeId();
  const width = strokeWidth(image, style.step);
  switch (kind) {
    case "arrow":
      return { id, kind, colour: style.colour, from: at, to: at, width };
    case "rect":
      return { id, kind, colour: style.colour, a: at, b: at, width };
    case "freehand":
      return { id, kind, colour: style.colour, points: [at], width };
    case "text":
      return { id, kind, colour: style.colour, at, text: "", size: fontSize(image, style.step) };
    case "redact":
      return { id, kind, colour: "#000000", a: at, b: at };
  }
}

/** Where a drag has reached. Returns a new shape; never mutates. */
export function extendDraft(shape: Shape, to: Point): Shape {
  switch (shape.kind) {
    case "arrow":
      return { ...shape, to };
    case "rect":
    case "redact":
      return { ...shape, b: to };
    case "freehand":
      return { ...shape, points: [...shape.points, to] };
    case "text":
      return shape;
  }
}

export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  const move = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  switch (shape.kind) {
    case "arrow":
      return { ...shape, from: move(shape.from), to: move(shape.to) };
    case "rect":
    case "redact":
      return { ...shape, a: move(shape.a), b: move(shape.b) };
    case "freehand":
      return { ...shape, points: shape.points.map(move) };
    case "text":
      return { ...shape, at: move(shape.at) };
  }
}

/**
 * The box a shape occupies, for the selection outline.
 *
 * Text is approximate: measuring glyphs needs a canvas, and this is only ever
 * used to draw a dashed outline and to hit-test, where being a few pixels wide
 * costs nothing. 0.55em per character is a reasonable mean for the UI stack.
 */
export function boundsOf(shape: Shape): Rect {
  switch (shape.kind) {
    case "arrow":
      return normRect(shape.from, shape.to);
    case "rect":
    case "redact":
      return normRect(shape.a, shape.b);
    case "freehand": {
      const xs = shape.points.map((p) => p.x);
      const ys = shape.points.map((p) => p.y);
      return normRect({ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) });
    }
    case "text":
      return {
        x: shape.at.x,
        y: shape.at.y - shape.size,
        width: Math.max(shape.size, shape.text.length * shape.size * 0.55),
        height: shape.size * 1.25,
      };
  }
}

/** The three points of an arrowhead at `to`, pointing away from `from`. */
export function arrowHead(from: Point, to: Point, width: number): [Point, Point, Point] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  // A zero-length drag has no direction; point right so the head is still
  // visible rather than collapsing to a dot.
  const ux = length === 0 ? 1 : dx / length;
  const uy = length === 0 ? 0 : dy / length;
  const size = width * 3.2;
  // Perpendicular, for the two barbs.
  const px = -uy;
  const py = ux;
  const baseX = to.x - ux * size;
  const baseY = to.y - uy * size;
  const half = size * 0.5;
  return [
    { x: to.x, y: to.y },
    { x: baseX + px * half, y: baseY + py * half },
    { x: baseX - px * half, y: baseY - py * half },
  ];
}

/** Shortest distance from `p` to the segment `a`-`b`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // Projection of p onto the line, clamped to the segment.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `p` to the outline of `r` (0 when on it, growing inward and
 *  outward alike) -- what makes a hollow rectangle clickable on its edge only. */
function distanceToRectEdge(p: Point, r: Rect): number {
  const corners: Point[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
  return Math.min(
    ...corners.map((corner, i) => distanceToSegment(p, corner, corners[(i + 1) % corners.length])),
  );
}

function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/**
 * The topmost shape under `p`, or null.
 *
 * Walks backwards, because later shapes paint over earlier ones and the one you
 * can see is the one you meant. A hollow rectangle is hit on its *edge* only,
 * so you can click through a big empty box to whatever it was drawn around;
 * a redaction bar and a text run are solid, since both are filled.
 */
export function hitTest(shapes: readonly Shape[], p: Point, tolerance: number): string | null {
  for (let i = shapes.length - 1; i >= 0; i -= 1) {
    const shape = shapes[i];
    if (hits(shape, p, tolerance)) return shape.id;
  }
  return null;
}

function hits(shape: Shape, p: Point, tolerance: number): boolean {
  switch (shape.kind) {
    case "arrow":
      return distanceToSegment(p, shape.from, shape.to) <= tolerance + shape.width;
    case "rect":
      return distanceToRectEdge(p, normRect(shape.a, shape.b)) <= tolerance + shape.width;
    case "redact":
      return contains(normRect(shape.a, shape.b), p);
    case "text":
      return contains(boundsOf(shape), p);
    case "freehand":
      return shape.points.some(
        (point, i) => i > 0 && distanceToSegment(p, shape.points[i - 1], point) <= tolerance + shape.width,
      );
  }
}

/**
 * Drop points closer together than `minDist`.
 *
 * A pointermove fires far more often than a stroke needs, and every kept point
 * is a segment both renderers have to draw. The last point is always kept so
 * the stroke ends where the finger did.
 */
export function simplify(points: readonly Point[], minDist: number): Point[] {
  if (points.length <= 2) return [...points];
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minDist) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** An SVG path for a freehand stroke. The canvas renderer walks the same
 *  points, so the two stay in step by construction. */
export function pathD(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const [head, ...rest] = points;
  return `M ${round(head.x)} ${round(head.y)}` + rest.map((p) => ` L ${round(p.x)} ${round(p.y)}`).join("");
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
