import { describe, expect, it } from "vitest";
import { closeSprintMessage, sprintDue } from "./boardModel";
import type { Requirement } from "./requirementsApi";
import type { Sprint } from "./sprintsApi";

const sprint = (o: Partial<Sprint>): Sprint => ({
  id: "s1",
  human_id: "S1",
  name: "Sprint 1",
  goal: "",
  start_date: null,
  end_date: null,
  status: "InProgress",
  closed_at: null,
  release_id: null,
  capacity_hours: null,
  ...o,
} as Sprint);

const req = (status: Requirement["status"]): Requirement => ({ id: status, status } as Requirement);

// Midday, so the "23:59:59 of the end date" rule is what decides the day count.
const now = new Date("2026-09-11T12:00:00");

describe("sprintDue", () => {
  it("is null for an undated sprint", () => {
    expect(sprintDue(sprint({}), now)).toBeNull();
  });

  it("counts days left up to the end of the end date, rounding up", () => {
    expect(sprintDue(sprint({ end_date: "2026-09-21" }), now)).toEqual({ cls: "due-ok", label: "11d left" });
    expect(sprintDue(sprint({ end_date: "2026-09-11" }), now)).toEqual({ cls: "due-soon", label: "1d left" });
  });

  it("flags three days or fewer as soon, and the past as over", () => {
    expect(sprintDue(sprint({ end_date: "2026-09-13" }), now)?.cls).toBe("due-soon");
    expect(sprintDue(sprint({ end_date: "2026-09-14" }), now)?.cls).toBe("due-ok");
    expect(sprintDue(sprint({ end_date: "2026-09-08" }), now)).toEqual({ cls: "due-over", label: "2d over" });
  });
});

describe("closeSprintMessage", () => {
  it("asks plainly when everything is done", () => {
    expect(closeSprintMessage(sprint({ name: "Sprint 2" }), [req("Done"), req("Done")])).toBe("Close Sprint 2?");
  });

  it("counts every requirement that is not Done as unfinished", () => {
    const rs = [req("Done"), req("NotStarted"), req("InProgress"), req("ToTest"), req("Blocked")];
    expect(closeSprintMessage(sprint({ name: "Sprint 2" }), rs)).toBe(
      "Close Sprint 2?\n4 unfinished requirement(s) return to the backlog.",
    );
  });
});
