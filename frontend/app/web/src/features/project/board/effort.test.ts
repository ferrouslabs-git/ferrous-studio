import { describe, expect, it } from "vitest";
import { EST_PRESETS, fmtEffort, rollup, statusWeight } from "./effort";

describe("fmtEffort", () => {
  it("renders hours below a day and days from a day up, one decimal at most", () => {
    expect(fmtEffort(6)).toBe("6h");
    expect(fmtEffort(12)).toBe("1.5d");
    expect(fmtEffort(40)).toBe("5d");
    expect(fmtEffort(8.04)).toBe("1d");
  });
  it("never renders a missing estimate as zero", () => {
    expect(fmtEffort(null)).toBe("—");
    expect(fmtEffort(undefined)).toBe("—");
    expect(fmtEffort(Number.NaN)).toBe("—");
    expect(fmtEffort(0)).toBe("0h");
  });
  it("keeps the preset ladder in hours, ascending", () => {
    expect(EST_PRESETS).toEqual([...EST_PRESETS].sort((a, b) => a - b));
  });
});

describe("statusWeight and rollup", () => {
  it("credits Done fully, Review three quarters, Doing half, the rest nothing", () => {
    expect(statusWeight("Done")).toBe(1);
    expect(statusWeight("ToTest")).toBe(0.75);
    expect(statusWeight("InProgress")).toBe(0.5);
    expect(statusWeight("NotStarted")).toBe(0);
    expect(statusWeight("Blocked")).toBe(0);
  });
  it("counts requirements and weights the percentage, with no hours (FS-REQ-106)", () => {
    const p = rollup([{ status: "Done" }, { status: "ToTest" }, { status: "InProgress" }, { status: "NotStarted" }]);
    expect(p).toEqual({ total: 4, done: 1, in_progress: 1, to_test: 1, pct: Math.round((100 * (1 + 0.75 + 0.5)) / 4) });
  });
  it("rolls an empty set up to zero", () => {
    expect(rollup([])).toEqual({ total: 0, done: 0, in_progress: 0, to_test: 0, pct: 0 });
  });
});
