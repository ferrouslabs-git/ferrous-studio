import { describe, expect, it } from "vitest";
import { niceAxisTop } from "./Schematic";

describe("niceAxisTop", () => {
  it("rounds the maximum up so three steps land on round numbers", () => {
    expect(niceAxisTop(92)).toBe(120); // steps of 40
    expect(niceAxisTop(60)).toBe(60); // steps of 20
    expect(niceAxisTop(7)).toBe(7.5); // steps of 2.5
    expect(niceAxisTop(1200)).toBe(1200); // steps of 400
    expect(niceAxisTop(9)).toBe(9); // steps of 3
    expect(niceAxisTop(1)).toBe(1.2); // steps of 0.4
  });

  it("never sits below the data", () => {
    for (const m of [1, 3, 9, 13, 47, 99, 101, 333, 12408]) expect(niceAxisTop(m)).toBeGreaterThanOrEqual(m);
  });
});
