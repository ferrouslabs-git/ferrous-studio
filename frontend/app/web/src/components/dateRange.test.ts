import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inDateRange, localDayOf } from "./dateRange";

// Days follow the viewer's time zone; pin one with a summer offset so the
// edges of a day are exercised.
beforeAll(() => {
  vi.stubEnv("TZ", "Europe/London");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe("localDayOf", () => {
  it("reads naive server timestamps as UTC and buckets them locally", () => {
    // 23:30 UTC on 31 March is 00:30 BST on 1 April.
    expect(localDayOf("2026-03-31T23:30:00")).toBe("2026-04-01");
    expect(localDayOf("2026-03-31T22:30:00Z")).toBe("2026-03-31");
    // GMT in winter: no shift.
    expect(localDayOf("2026-01-31T23:30:00")).toBe("2026-01-31");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(localDayOf("not a date")).toBeNull();
  });
});

describe("inDateRange", () => {
  it("passes everything when neither end is set", () => {
    expect(inDateRange("2026-03-01T10:00:00", "", "")).toBe(true);
    expect(inDateRange("garbage", "", "")).toBe(true);
  });

  it("includes both end days", () => {
    expect(inDateRange("2026-03-01T00:10:00Z", "2026-03-01", "2026-03-31")).toBe(true);
    expect(inDateRange("2026-03-31T20:00:00Z", "2026-03-01", "2026-03-31")).toBe(true);
    expect(inDateRange("2026-02-28T12:00:00Z", "2026-03-01", "2026-03-31")).toBe(false);
  });

  it("uses the local day at the edges", () => {
    // 00:30 BST on 1 April: outside a March range, inside an April one.
    expect(inDateRange("2026-03-31T23:30:00", "2026-03-01", "2026-03-31")).toBe(false);
    expect(inDateRange("2026-03-31T23:30:00", "2026-04-01", "")).toBe(true);
  });

  it("leaves either end open", () => {
    expect(inDateRange("2020-01-01T12:00:00Z", "", "2026-03-31")).toBe(true);
    expect(inDateRange("2030-01-01T12:00:00Z", "2026-03-01", "")).toBe(true);
    expect(inDateRange("2026-02-01T12:00:00Z", "2026-03-01", "")).toBe(false);
  });

  it("excludes an unparseable timestamp once a range is set", () => {
    expect(inDateRange("garbage", "2026-03-01", "")).toBe(false);
  });
});
