import { describe, expect, it } from "vitest";
import type { KanbanItem } from "./kanbanApi";
import { addDays, formatWeek, isoDate, matchesFilter, mondayOf, NO_FILTER, parseFilter, parseIsoDate, UNASSIGNED } from "./kanbanModel";

const item = (over: Partial<KanbanItem> = {}): KanbanItem => ({
  id: "r1",
  human_id: "FS-REQ-1",
  title: "A requirement",
  status: "NotStarted",
  priority: "Medium",
  assignee: null,
  project_id: "p2",
  project_name: "Project",
  lineage_id: "p1",
  account_id: "a1",
  account_name: "Org",
  sprint: { id: "s1", human_id: "FS-S1", name: "Sprint 1", start_date: "2026-11-23", end_date: "2026-11-29" },
  ...over,
});

describe("week arithmetic", () => {
  it("finds the Monday of any day, Sunday included", () => {
    expect(isoDate(mondayOf(new Date(2026, 10, 25)))).toBe("2026-11-23");
    expect(isoDate(mondayOf(new Date(2026, 10, 23)))).toBe("2026-11-23");
    expect(isoDate(mondayOf(new Date(2026, 10, 29)))).toBe("2026-11-23");
  });

  it("steps whole weeks across a month and a year", () => {
    expect(isoDate(addDays(new Date(2026, 10, 30), 7))).toBe("2026-12-07");
    expect(isoDate(addDays(new Date(2026, 11, 28), 7))).toBe("2027-01-04");
  });

  it("parses only real dates", () => {
    expect(isoDate(parseIsoDate("2026-11-23")!)).toBe("2026-11-23");
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("next week")).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
  });

  it("formats the range compactly", () => {
    expect(formatWeek(new Date(2026, 10, 23))).toBe("23 – 29 Nov 2026");
    expect(formatWeek(new Date(2026, 10, 30))).toBe("30 Nov – 6 Dec 2026");
    expect(formatWeek(new Date(2025, 11, 29))).toBe("29 Dec 2025 – 4 Jan 2026");
  });
});

describe("the saved filter", () => {
  it("reads back defensively", () => {
    expect(parseFilter(null)).toEqual(NO_FILTER);
    expect(parseFilter("not json")).toEqual(NO_FILTER);
    expect(parseFilter('{"lineages":[{"id":"p1","name":"P"},{"id":3}],"assignees":"x"}')).toEqual({
      lineages: [{ id: "p1", name: "P" }],
      assignees: [],
    });
  });

  it("lets everything through when nothing is picked", () => {
    expect(matchesFilter(item(), NO_FILTER)).toBe(true);
  });

  it("matches projects by lineage, not by version", () => {
    const f = { lineages: [{ id: "p1", name: "P" }], assignees: [] };
    expect(matchesFilter(item(), f)).toBe(true);
    expect(matchesFilter(item({ lineage_id: "other" }), f)).toBe(false);
  });

  it("treats Unassigned as an assignee", () => {
    const f = { lineages: [], assignees: [{ id: UNASSIGNED, name: "Unassigned" }] };
    expect(matchesFilter(item(), f)).toBe(true);
    expect(matchesFilter(item({ assignee: { id: "u1", name: "Ann" } }), f)).toBe(false);
    const g = { lineages: [], assignees: [{ id: "u1", name: "Ann" }] };
    expect(matchesFilter(item({ assignee: { id: "u1", name: "Ann" } }), g)).toBe(true);
  });
});
