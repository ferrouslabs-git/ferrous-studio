import { describe, expect, it } from "vitest";
import { HISTORY_LIMIT, ShapeHistory } from "./history";
import { Shape } from "./shapes";

const shape = (id: string): Shape => ({
  id,
  kind: "rect",
  colour: "#fff",
  a: { x: 0, y: 0 },
  b: { x: 1, y: 1 },
  width: 2,
});

describe("ShapeHistory", () => {
  it("starts empty with nothing to undo", () => {
    const history = new ShapeHistory();
    expect(history.shapes).toEqual([]);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("walks back and forward through pushed states", () => {
    const history = new ShapeHistory();
    history.push([shape("a")]);
    history.push([shape("a"), shape("b")]);

    expect(history.shapes).toHaveLength(2);
    expect(history.undo()).toHaveLength(1);
    expect(history.undo()).toHaveLength(0);
    expect(history.canUndo()).toBe(false);
    expect(history.redo()).toHaveLength(1);
    expect(history.redo()).toHaveLength(2);
    expect(history.canRedo()).toBe(false);
  });

  it("returns null rather than throwing at either end", () => {
    const history = new ShapeHistory();
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  it("discards the redo branch once you draw again", () => {
    const history = new ShapeHistory();
    history.push([shape("a")]);
    history.push([shape("a"), shape("b")]);
    history.undo();

    history.push([shape("a"), shape("c")]);

    expect(history.canRedo()).toBe(false);
    expect(history.shapes.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("caps the stack, dropping the oldest states", () => {
    const history = new ShapeHistory();
    for (let i = 0; i < HISTORY_LIMIT + 20; i += 1) history.push([shape(`s${i}`)]);

    // Still usable, still bounded, and the newest state is intact.
    expect(history.shapes.map((s) => s.id)).toEqual([`s${HISTORY_LIMIT + 19}`]);
    let steps = 0;
    while (history.undo()) steps += 1;
    expect(steps).toBe(HISTORY_LIMIT - 1);
  });

  it("keeps an initial state as the floor", () => {
    const history = new ShapeHistory([shape("seed")]);
    expect(history.canUndo()).toBe(false);
    history.push([]);
    expect(history.undo()).toEqual([shape("seed")]);
  });

  it("forgets the timeline when the image is replaced", () => {
    const history = new ShapeHistory();
    history.push([shape("a")]);
    history.push([shape("a"), shape("b")]);

    history.reset();

    expect(history.shapes).toEqual([]);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });
});
