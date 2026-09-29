// The vocabulary itself: what a note's body is, and the promise that every
// palette entry actually draws something.
import { describe, expect, it } from "vitest";
import { STENCILS_XML } from "./umlStencils";
import { vertexStyleFor } from "./umlStyles";
import { labelHangsOutsideShape, labelWrapsInsideShape, noteBody, PALETTE } from "./umlTypes";

/** Shape names maxGraph registers itself (registerDefaultShapes). */
const BUILT_IN = new Set(["actor", "arrow", "arrowConnector", "cloud", "connector", "cylinder", "doubleEllipse", "ellipse", "hexagon", "image", "label", "line", "rectangle", "rhombus", "swimlane", "triangle"]);

describe("noteBody", () => {
  it("is the label, which is what in-place editing writes", () => {
    expect(noteBody({ label: "Chase legal", text: "" })).toBe("Chase legal");
  });

  it("falls back to the attribute older notes kept their body in", () => {
    expect(noteBody({ label: "", text: "Chase legal" })).toBe("Chase legal");
  });

  it("prefers the label once the note has been rewritten", () => {
    expect(noteBody({ label: "New", text: "Stale" })).toBe("New");
  });
});

describe("labelWrapsInsideShape", () => {
  it("wraps the label of every shape that carries its text inside itself", () => {
    for (const type of ["lifeline", "usecase", "action", "rect", "roundRect", "swimlane", "boundary", "cloud", "text"]) {
      expect(labelWrapsInsideShape(type), type).toBe(true);
    }
  });

  it("leaves a label that hangs below its shape on one line", () => {
    expect(labelWrapsInsideShape("actor")).toBe(false);
    expect(labelWrapsInsideShape("decision")).toBe(false);
  });

  it("is false for shapes with no label, and for anything that is not a node type", () => {
    for (const type of ["start", "end", "fork", "activation"]) expect(labelWrapsInsideShape(type), type).toBe(false);
    expect(labelWrapsInsideShape("association")).toBe(false);
    expect(labelWrapsInsideShape("")).toBe(false);
  });
});

describe("labelHangsOutsideShape", () => {
  it("is true only for the shapes whose label hangs below them", () => {
    expect(labelHangsOutsideShape("decision")).toBe(true);
    expect(labelHangsOutsideShape("actor")).toBe(true);
    for (const type of ["action", "usecase", "diamond", "association", ""]) expect(labelHangsOutsideShape(type), type).toBe(false);
  });

  it("backs those labels with the canvas so a connector underneath cannot strike through them", () => {
    expect(vertexStyleFor("decision").labelBackgroundColor).toBeTruthy();
    expect(vertexStyleFor("actor").labelBackgroundColor).toBeTruthy();
  });
});

describe("the palette", () => {
  it("draws every entry with a shape that is registered or stencilled", () => {
    for (const entry of PALETTE) {
      const shape = vertexStyleFor(entry.type).shape;
      expect(shape, entry.type).toBeTruthy();
      if (!BUILT_IN.has(shape as string)) {
        expect(STENCILS_XML, entry.type).toContain(`name="${shape}"`);
      }
    }
  });

  it("has no duplicate types", () => {
    expect(new Set(PALETTE.map((p) => p.type)).size).toBe(PALETTE.length);
  });
});
