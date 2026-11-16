import { describe, expect, it } from "vitest";
import type { ServiceRow } from "./cloudopsApi";
import { autowakeText, barHeights, countStates, dayLabel, peak, perMonth, share, sizeLabel, usd } from "./cloudopsFormat";

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


describe("resources formatting", () => {
  it("shows the monthly estimate and the size plainly", () => {
    expect(perMonth(12.66)).toBe("$12.66/mo");
    expect(sizeLabel(0.25, 0.5)).toBe("0.25 vCPU · 0.5 GB");
  });

  it("says what the auto-wake tags amount to", () => {
    const off = { enabled: false, idle_minutes: null, keep_awake_until: null, follows: null };
    expect(autowakeText(off)).toBe("Off");
    expect(autowakeText({ ...off, enabled: true })).toBe("On · sleeps after 60 min idle");
    expect(autowakeText({ ...off, enabled: true, idle_minutes: 90 })).toBe("On · sleeps after 90 min idle");
    expect(autowakeText({ ...off, follows: "fnai-uat" })).toBe("Follows fnai-uat");
  });

  it("mentions keep-awake only while it is still in the future", () => {
    const a = { enabled: true, idle_minutes: 60, keep_awake_until: "2026-11-20T18:00:00Z", follows: null };
    expect(autowakeText(a, new Date("2026-11-19T00:00:00Z"))).toContain("awake until 2026-11-20 18:00:00 UTC");
    expect(autowakeText(a, new Date("2026-11-21T00:00:00Z"))).not.toContain("awake until");
  });

  it("counts services by state", () => {
    const rows = [{ state: "running" }, { state: "running" }, { state: "asleep" }] as ServiceRow[];
    expect(countStates(rows)).toEqual({ running: 2, asleep: 1, stopped: 0, starting: 0, unhealthy: 0 });
  });
});
