import { describe, expect, it } from "vitest";
import { EST_PRESETS, effortSummary, fmtEffort, rollup, statusWeight } from "./effort";

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
});

describe("statusWeight and rollup", () => {
  it("credits Done fully, Review three quarters, Doing half, the rest nothing", () => {
    expect(statusWeight("Done")).toBe(1);
    expect(statusWeight("Review")).toBe(0.75);
    expect(statusWeight("Doing")).toBe(0.5);
    expect(statusWeight("Todo")).toBe(0);
    expect(statusWeight("Blocked")).toBe(0);
  });
  it("rolls counts, a weighted percentage, hours and coverage together", () => {
    const p = rollup([
      { status: "Done", estimate_hours: 8 },
      { status: "Review", estimate_hours: 4 },
      { status: "Doing", estimate_hours: null },
      { status: "Todo" },
    ]);
    expect(p).toMatchObject({ total: 4, done: 1, doing: 1, review: 1, estimated: 2, unestimated: 2 });
    expect(p.pct).toBe(Math.round((100 * (1 + 0.75 + 0.5)) / 4));
    expect(p.hours).toBe(12);
    expect(p.hours_done).toBe(8 + 3);
    expect(p.coverage).toBe(0.5);
  });
  it("treats an empty set as fully covered so nothing reads as 0% estimated", () => {
    expect(rollup([])).toMatchObject({ total: 0, pct: 0, coverage: 1 });
  });
});

describe("effortSummary", () => {
  it("says nothing for an empty set and admits a wholly unestimated one", () => {
    expect(effortSummary(rollup([]))).toEqual({ text: "", partial: false });
    expect(effortSummary(rollup([{ status: "Todo" }]))).toEqual({ text: "not estimated", partial: true });
  });
  it("states the sum at full coverage and admits the gap otherwise", () => {
    expect(effortSummary(rollup([{ status: "Todo", estimate_hours: 16 }]))).toEqual({ text: "2d", partial: false });
    expect(effortSummary(rollup([{ status: "Todo", estimate_hours: 16 }, { status: "Todo" }]))).toEqual({
      text: "2d · 1/2 estimated",
      partial: true,
    });
  });
  it("keeps the preset ladder in hours, ascending", () => {
    expect(EST_PRESETS).toEqual([...EST_PRESETS].sort((a, b) => a - b));
  });
});
