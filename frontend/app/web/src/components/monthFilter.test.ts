import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inMonth, localMonthOf, monthFilter, monthLabel, monthsOf } from "./monthFilter";

// Month bucketing follows the viewer's time zone; pin one with a summer offset
// so the edges of a month are exercised.
beforeAll(() => {
  vi.stubEnv("TZ", "Europe/London");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("localMonthOf", () => {
  it("reads naive server timestamps as UTC and buckets them locally", () => {
    // 23:30 UTC on 31 March is 00:30 BST on 1 April.
    expect(localMonthOf("2026-03-31T23:30:00")).toBe("2026-04");
    expect(localMonthOf("2026-03-31T22:30:00Z")).toBe("2026-03");
    // GMT in winter: no shift.
    expect(localMonthOf("2026-01-31T23:30:00")).toBe("2026-01");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(localMonthOf("not a date")).toBeNull();
  });
});

describe("inMonth", () => {
  it("passes everything when no month is chosen", () => {
    expect(inMonth("2026-03-01T10:00:00", "")).toBe(true);
  });

  it("matches only the chosen month", () => {
    expect(inMonth("2026-03-15T10:00:00", "2026-03")).toBe(true);
    expect(inMonth("2026-04-15T10:00:00", "2026-03")).toBe(false);
    expect(inMonth("2026-03-31T23:30:00", "2026-03")).toBe(false);
    expect(inMonth("2026-03-31T23:30:00", "2026-04")).toBe(true);
  });
});

describe("monthsOf", () => {
  it("lists distinct months newest first, across years", () => {
    expect(
      monthsOf(["2025-12-02T09:00:00", "2026-02-10T09:00:00", "2026-02-20T09:00:00", "2026-01-05T09:00:00", "bad"]),
    ).toEqual(["2026-02", "2026-01", "2025-12"]);
  });
});

describe("monthFilter", () => {
  it("offers All time then each month with a British label", () => {
    const f = monthFilter({
      label: "Filter by month created",
      value: "",
      onChange: () => {},
      timestamps: ["2026-03-15T10:00:00", "2026-10-01T10:00:00"],
    });
    expect(f.options).toEqual([
      { value: "", label: "All time" },
      { value: "2026-10", label: "October 2026" },
      { value: "2026-03", label: "March 2026" },
    ]);
    expect(f.defaultValue).toBeUndefined();
  });

  it("keeps a selected month listed after its last row has gone", () => {
    const f = monthFilter({ label: "x", value: "2026-05", onChange: () => {}, timestamps: ["2026-10-01T10:00:00"] });
    expect(f.options.map((o) => o.value)).toEqual(["", "2026-10", "2026-05"]);
  });

  it("labels a month key", () => {
    expect(monthLabel("2025-12")).toBe("December 2025");
  });
});
