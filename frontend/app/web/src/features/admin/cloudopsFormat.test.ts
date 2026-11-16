import { describe, expect, it } from "vitest";
import { barHeights, dayLabel, peak, share, usd } from "./cloudopsFormat";

describe("usd", () => {
  it("formats with a thousands separator and two decimals", () => {
    expect(usd(1234.5)).toBe("$1,234.50");
    expect(usd(0)).toBe("$0.00");
  });
  it("makes credits unmistakable with a leading minus", () => {
    expect(usd(-33.29)).toBe("-$33.29");
  });
});

describe("share", () => {
  it("is a whole percent, or <1% for a sliver", () => {
    expect(share(30, 120)).toBe("25%");
    expect(share(0.5, 120)).toBe("<1%");
  });
  it("is a dash when there is nothing to compare against", () => {
    expect(share(5, 0)).toBe("—");
  });
});

describe("daily chart scaling", () => {
  const a = [{ date: "2026-11-01", amount: 2 }, { date: "2026-11-02", amount: 4 }];
  const b = [{ date: "2026-10-31", amount: 8 }];
  it("scales both months to the busiest day of either", () => {
    expect(peak(a, b)).toBe(8);
    expect(barHeights(a, 8)).toEqual([0.25, 0.5]);
    expect(barHeights(b, 8)).toEqual([1]);
  });
  it("draws nothing, not NaN, when there is no spend", () => {
    expect(barHeights(a, 0)).toEqual([0, 0]);
    expect(peak([])).toBe(0);
  });
  it("never lets a refund draw a bar below the axis", () => {
    expect(barHeights([{ date: "2026-11-03", amount: -3 }], 8)).toEqual([0]);
  });
});

describe("dayLabel", () => {
  it("reads like a person would say it", () => {
    expect(dayLabel("2026-11-16")).toBe("16 Nov");
    expect(dayLabel("2026-01-02")).toBe("2 Jan");
  });
});
