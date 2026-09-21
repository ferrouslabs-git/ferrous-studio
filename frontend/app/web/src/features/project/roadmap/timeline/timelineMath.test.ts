import { describe, expect, it } from "vitest";
import type { Requirement } from "../../board/requirementsApi";
import type { Sprint } from "../../board/sprintsApi";
import { epicExtent, isLate, releaseExtent, tlBarStyle, tlPct, tlTicks, tlWindow, TL_DAY } from "./timelineMath";

const sprint = (id: string, start: string | null, end: string | null): Sprint => ({
  id,
  human_id: id,
  name: id,
  goal: "",
  start_date: start,
  end_date: end,
  status: "NotStarted",
  closed_at: null,
  release_id: "r1",
  capacity_hours: null,
  created_at: "",
  updated_at: "",
});
const req = (id: string, sprintId: string | null): Requirement => ({
  id,
  human_id: id,
  title: "",
  body: "",
  epic_id: "e1",
  feature_id: null,
  status: "NotStarted",
  blocked_from: null,
  priority: "Medium",
  assignee_id: null,
  release_id: null,
  sprint_id: sprintId,
  estimate_hours: null,
  queue_position: null,
  effective_epic_id: "e1",
  effective_release_id: null,
  created_at: "",
  updated_at: "",
});

describe("extents", () => {
  const byId = new Map<string, Sprint>([
    ["s1", sprint("s1", "2026-09-01", "2026-09-14")],
    ["s2", sprint("s2", "2026-09-15", "2026-09-28")],
    ["s3", sprint("s3", null, null)],
  ]);
  it("spans the dated sprints holding an epic's requirements", () => {
    expect(epicExtent([req("a", "s2"), req("b", "s1"), req("c", "s3"), req("d", null)], byId)).toEqual({
      start: "2026-09-01",
      end: "2026-09-28",
      sprints: 2,
    });
  });
  it("gives an epic with nothing scheduled no bar at all", () => {
    expect(epicExtent([req("c", "s3"), req("d", null)], byId)).toBeNull();
  });
  it("spans a release across its epics and its own sprints", () => {
    expect(
      releaseExtent([null, { start: "2026-09-10", end: "2026-09-12", sprints: 1 }], [sprint("s9", "2026-08-01", "2026-08-10")]),
    ).toEqual({ start: "2026-08-01", end: "2026-09-12" });
    expect(releaseExtent([null], [sprint("s3", null, null)])).toBeNull();
  });
  it("flags work running past the release target", () => {
    expect(isLate({ start: "2026-09-01", end: "2026-09-28", sprints: 1 }, "2026-09-20")).toBe(true);
    expect(isLate({ start: "2026-09-01", end: "2026-09-18", sprints: 1 }, "2026-09-20")).toBe(false);
    expect(isLate(null, "2026-09-20")).toBe(false);
  });
});

describe("window", () => {
  it("is null with nothing dated, else pads the dated span and includes today", () => {
    expect(tlWindow([sprint("s3", null, null)])).toBeNull();
    const now = new Date("2026-09-11T00:00:00").getTime();
    const w = tlWindow([sprint("s1", "2026-09-01", "2026-09-14")], now);
    expect(w).not.toBeNull();
    expect(w!.lo).toBe(new Date("2026-09-01T00:00:00").getTime() - 3 * TL_DAY);
    expect(w!.hi).toBe(new Date("2026-09-14T00:00:00").getTime() + 7 * TL_DAY);
    const later = tlWindow([sprint("s1", "2026-09-01", "2026-09-14")], new Date("2026-12-01T00:00:00").getTime());
    expect(later!.hi).toBe(new Date("2026-12-01T00:00:00").getTime() + 7 * TL_DAY);
  });
  it("positions dates as clamped percentages and gives bars a minimum width", () => {
    const w = { lo: 0, hi: 100 * TL_DAY, span: 100 * TL_DAY };
    expect(tlPct(w, 50 * TL_DAY)).toBe(50);
    expect(tlPct(w, -5 * TL_DAY)).toBe(0);
    expect(tlPct(w, 500 * TL_DAY)).toBe(100);
    const style = tlBarStyle(w, "1970-01-11", "1970-01-11");
    expect(style.width).toBe("0.6%");
  });
  it("puts a tick on the first of each month inside the window", () => {
    // The window opens three days before 1 September, so September's first
    // day is inside it; the labels are the locale's short month names.
    const w = tlWindow([sprint("s1", "2026-09-01", "2026-11-14")], new Date("2026-09-11T00:00:00").getTime())!;
    const ticks = tlTicks(w);
    expect(ticks.map((t) => t.label)).toEqual(
      [new Date(2026, 8, 1), new Date(2026, 9, 1), new Date(2026, 10, 1)].map((d) => d.toLocaleString("en-GB", { month: "short" })),
    );
    expect(ticks[0].pct).toBeGreaterThan(0);
    expect(ticks[2].pct).toBeLessThan(100);
  });
});
