import { describe, expect, it } from "vitest";
import type { Epic } from "./epicsApi";
import type { Feature } from "./featuresApi";
import type { Release } from "./releasesApi";
import type { Requirement } from "./requirementsApi";
import type { Sprint } from "./sprintsApi";
import {
  effectiveEpicId,
  effectiveReleaseId,
  nextSprintDefaults,
  numSuffix,
  recentVelocity,
  releaseDue,
  releaseSchedule,
  reorderPatches,
  shipGaps,
  sortReleases,
  sortSprints,
  spOrdered,
  sprintsOf,
} from "./boardModel";

const sprint = (o: Partial<Sprint> & { id: string; human_id: string }): Sprint => ({
  name: o.id,
  goal: "",
  start_date: null,
  end_date: null,
  status: "NotStarted",
  closed_at: null,
  release_id: null,
  capacity_hours: null,
  created_at: "",
  updated_at: "",
  ...o,
});
const req = (o: Partial<Requirement> & { id: string; human_id: string }): Requirement => ({
  title: o.id,
  body: "",
  epic_id: null,
  feature_id: null,
  status: "NotStarted",
  blocked_from: null,
  priority: "Medium",
  assignee_id: null,
  release_id: null,
  sprint_id: null,
  estimate_hours: null,
  queue_position: null,
  effective_epic_id: null,
  effective_release_id: null,
  created_at: "",
  updated_at: "",
  ...o,
});
const release = (o: Partial<Release> & { id: string; human_id: string }): Release => ({
  title: o.id,
  date: null,
  description: "",
  status: "NotStarted",
  shipped_at: null,
  progress: { total: 0, done: 0, in_progress: 0, to_test: 0, pct: 0, hours: 0, hours_done: 0, estimated: 0, unestimated: 0, coverage: 1 },
  created_at: "",
  updated_at: "",
  ...o,
});

describe("ids and inheritance", () => {
  it("reads the trailing number of a human id", () => {
    expect(numSuffix("E12")).toBe(12);
    expect(numSuffix("REQ-7")).toBe(7);
    expect(numSuffix("x")).toBe(0);
  });
  it("derives the effective epic from the feature and the release from the epic", () => {
    const epics = new Map<string, Epic>([
      ["e1", { id: "e1", human_id: "E1", title: "", summary: "", status: "NotStarted", release_id: "r1", assignee_id: null, created_at: "", updated_at: "" }],
    ]);
    const features = new Map<string, Feature>([
      ["f1", { id: "f1", human_id: "F1", epic_id: "e1", title: "", status: "NotStarted", assignee_id: null, created_at: "", updated_at: "" }],
    ]);
    const viaFeature = req({ id: "a", human_id: "REQ-1", feature_id: "f1" });
    expect(effectiveEpicId(viaFeature, features)).toBe("e1");
    expect(effectiveReleaseId(viaFeature, epics, features)).toBe("r1");
    const own = req({ id: "b", human_id: "REQ-2", epic_id: "e1", release_id: "r9" });
    expect(effectiveReleaseId(own, epics, features)).toBe("r9");
    expect(effectiveReleaseId(req({ id: "c", human_id: "REQ-3" }), epics, features)).toBeNull();
  });
});

describe("releases", () => {
  const sprints = [
    sprint({ id: "s1", human_id: "S1", release_id: "r1", end_date: "2026-10-01" }),
    sprint({ id: "s2", human_id: "S2", release_id: "r1", end_date: "2026-11-15" }),
    sprint({ id: "s3", human_id: "S3", release_id: "r2" }),
  ];
  it("dates a release by the end of its last sprint, and names that sprint", () => {
    expect(releaseSchedule("r1", sprints)).toMatchObject({ date: "2026-11-15", sprints: 2 });
    expect(releaseSchedule("r1", sprints).last?.id).toBe("s2");
    expect(releaseSchedule("r2", sprints)).toMatchObject({ date: null, sprints: 1 });
    expect(releaseSchedule("r3", sprints)).toMatchObject({ date: null, sprints: 0 });
  });
  it("sorts unshipped by date (unscheduled last) then shipped, most recent first", () => {
    const rs = [
      release({ id: "r2", human_id: "REL2" }),
      release({ id: "shipped-old", human_id: "REL3", shipped_at: "2026-01-01T00:00:00" }),
      release({ id: "r1", human_id: "REL1" }),
      release({ id: "shipped-new", human_id: "REL4", shipped_at: "2026-06-01T00:00:00" }),
    ];
    expect(sortReleases(rs, sprints).map((r) => r.id)).toEqual(["r1", "r2", "shipped-new", "shipped-old"]);
  });
  it("describes how due a release is", () => {
    const now = new Date("2026-11-01T12:00:00");
    expect(releaseDue(release({ id: "r1", human_id: "REL1" }), sprints, now)).toEqual({ cls: "due-ok", label: "15d left" });
    expect(releaseDue(release({ id: "r2", human_id: "REL2" }), sprints, now).cls).toBe("due-none");
    expect(releaseDue(release({ id: "r1", human_id: "REL1", shipped_at: "2026-10-30T10:00:00" }), sprints, now).cls).toBe("due-shipped");
    expect(releaseDue(release({ id: "r1", human_id: "REL1" }), sprints, new Date("2026-11-20T12:00:00"))).toEqual({
      cls: "due-over",
      label: "4d overdue",
    });
    expect(releaseDue(release({ id: "r1", human_id: "REL1" }), sprints, new Date("2026-11-15T23:59:59")).label).toBe("due today");
  });
  it("lists what is still open before going live", () => {
    const r = release({ id: "r1", human_id: "REL1" });
    const backlog = [req({ id: "a", human_id: "REQ-1", status: "Done" }), req({ id: "b", human_id: "REQ-2" })];
    const live = [sprint({ id: "s1", human_id: "S1", release_id: "r1" })];
    expect(shipGaps(r, backlog, live)).toEqual(["1 requirement is not Done", "1 sprint still open (S1)"]);
    expect(shipGaps(r, [backlog[0]], [])).toEqual([]);
  });
});

describe("sprints", () => {
  it("orders open before closed, newest first within each, ignoring status", () => {
    const ss = [
      sprint({ id: "s1", human_id: "S1", closed_at: "2026-09-01T00:00:00" }),
      sprint({ id: "s2", human_id: "S2", status: "DeployedToLive" }),
      sprint({ id: "s3", human_id: "S3" }),
      sprint({ id: "s4", human_id: "S4", status: "InProgress" }),
    ];
    expect(sortSprints(ss).map((s) => s.id)).toEqual(["s4", "s3", "s2", "s1"]);
  });
  it("lists a release's sprints by start date with undated ones last", () => {
    const ss = [
      sprint({ id: "s1", human_id: "S1", release_id: "r1" }),
      sprint({ id: "s2", human_id: "S2", release_id: "r1", start_date: "2026-03-01" }),
      sprint({ id: "s3", human_id: "S3", release_id: "r1", start_date: "2026-01-01" }),
      sprint({ id: "s4", human_id: "S4", release_id: null }),
    ];
    expect(sprintsOf("r1", ss).map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
    expect(sprintsOf(null, ss).map((s) => s.id)).toEqual(["s4"]);
  });
  it("orders the work queue by position with unordered items last", () => {
    const rs = [
      req({ id: "a", human_id: "REQ-3" }),
      req({ id: "b", human_id: "REQ-1", queue_position: 2 }),
      req({ id: "c", human_id: "REQ-2", queue_position: 1 }),
    ];
    expect(spOrdered(rs).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
  it("reflows only the not-started items around a new slot and reports the changed ones", () => {
    const rs = [
      req({ id: "a", human_id: "REQ-1", queue_position: 1 }),
      req({ id: "b", human_id: "REQ-2", queue_position: 2 }),
      req({ id: "c", human_id: "REQ-3", queue_position: 3, status: "InProgress" }),
      req({ id: "d", human_id: "REQ-4", queue_position: 4 }),
    ];
    expect(reorderPatches(spOrdered(rs), rs[3], 1)).toEqual([
      { id: "d", queue_position: 1 },
      { id: "a", queue_position: 2 },
      { id: "b", queue_position: 3 },
    ]);
    expect(reorderPatches(spOrdered(rs), rs[0], 99)).toEqual([
      { id: "b", queue_position: 1 },
      { id: "d", queue_position: 2 },
      { id: "a", queue_position: 3 },
    ]);
  });
  it("averages delivered hours over the last finished sprints, skipping empty ones", () => {
    const ss = [
      sprint({ id: "s1", human_id: "S1", closed_at: "2026-09-01T00:00:00" }),
      sprint({ id: "s2", human_id: "S2", closed_at: "2026-09-02T00:00:00" }),
      sprint({ id: "s3", human_id: "S3", closed_at: "2026-09-03T00:00:00" }),
      sprint({ id: "s4", human_id: "S4", closed_at: "2026-09-04T00:00:00" }),
    ];
    const rs = [
      req({ id: "a", human_id: "REQ-1", sprint_id: "s4", status: "Done", estimate_hours: 8 }),
      req({ id: "b", human_id: "REQ-2", sprint_id: "s3", status: "Done", estimate_hours: 16 }),
      req({ id: "c", human_id: "REQ-3", sprint_id: "s1", status: "Done", estimate_hours: 100 }),
    ];
    expect(recentVelocity(ss, rs)).toEqual({ hours: 12, n: 2 });
    expect(recentVelocity(ss, [])).toBeNull();
  });
  it("defaults a new sprint to the day after the last one ends, two weeks long", () => {
    const today = new Date("2026-09-11T09:00:00");
    expect(nextSprintDefaults([], today)).toEqual({ start: "2026-09-11", end: "2026-09-24" });
    expect(nextSprintDefaults([sprint({ id: "s1", human_id: "S1", end_date: "2026-09-20" })], today)).toEqual({
      start: "2026-09-21",
      end: "2026-10-04",
    });
    expect(nextSprintDefaults([sprint({ id: "s1", human_id: "S1", end_date: "2026-01-01" })], today).start).toBe("2026-09-11");
  });
});
