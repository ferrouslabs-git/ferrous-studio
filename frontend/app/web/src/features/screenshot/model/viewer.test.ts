import { describe, expect, it } from "vitest";
import { stepIndex } from "../ScreenshotViewer";

describe("stepIndex", () => {
  it("moves forward and back", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, -1, 3)).toBe(1);
  });
  it("wraps at both ends", () => {
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
  });
  it("stays put with one or none", () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, -1, 0)).toBe(0);
  });
});
