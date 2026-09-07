// The vocabulary itself: what a note's body is, and the promise that every
// palette entry actually draws something.
import { describe, expect, it } from "vitest";
import { STENCILS_XML } from "./umlStencils";
import { vertexStyleFor } from "./umlStyles";
import { noteBody, PALETTE } from "./umlTypes";

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
