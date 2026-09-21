import { describe, expect, it } from "vitest";
import type { Requirement } from "../../board/requirementsApi";
import { matchesSprintFilter, NO_PARENT, NO_SPRINT_FILTER, SprintFilterState } from "./sprintFilter";

const req = (o: Partial<Requirement>): Requirement =>
  ({ id: "r", human_id: "REQ-7", title: "Search bar for requirement number", feature_id: null, ...o } as Requirement);

const filter = (o: Partial<SprintFilterState>): SprintFilterState => ({ ...NO_SPRINT_FILTER, ...o });

// The effective epic is the board's to work out (a requirement can carry its
// epic through its feature); here it is stubbed per requirement.
const epicOf = (map: Record<string, string | null>) => (r: Requirement) => map[r.id] ?? null;
const noEpics = () => null;

describe("matchesSprintFilter", () => {
  it("keeps everything with no filter set", () => {
    expect(matchesSprintFilter(req({}), NO_SPRINT_FILTER, noEpics)).toBe(true);
  });

  it("finds a requirement by its number, however it is typed", () => {
    for (const query of ["7", "REQ-7", "req 7", "req-7", "REQ7"]) {
      expect(matchesSprintFilter(req({}), filter({ query }), noEpics)).toBe(true);
    }
    expect(matchesSprintFilter(req({}), filter({ query: "8" }), noEpics)).toBe(false);
  });

  it("falls back to the title", () => {
    expect(matchesSprintFilter(req({}), filter({ query: "search bar" }), noEpics)).toBe(true);
    expect(matchesSprintFilter(req({}), filter({ query: "burndown" }), noEpics)).toBe(false);
  });

  it("filters on the EFFECTIVE epic, not the column", () => {
    const r = req({ id: "r1", epic_id: null, feature_id: "f1" });
    const through = epicOf({ r1: "e1" });
    expect(matchesSprintFilter(r, filter({ epicId: "e1" }), through)).toBe(true);
    expect(matchesSprintFilter(r, filter({ epicId: "e2" }), through)).toBe(false);
  });

  it("filters on the feature", () => {
    expect(matchesSprintFilter(req({ feature_id: "f1" }), filter({ featureId: "f1" }), noEpics)).toBe(true);
    expect(matchesSprintFilter(req({ feature_id: "f1" }), filter({ featureId: "f2" }), noEpics)).toBe(false);
  });

  it("offers 'filed under nothing' as its own choice", () => {
    expect(matchesSprintFilter(req({ id: "r1" }), filter({ epicId: NO_PARENT }), noEpics)).toBe(true);
    expect(matchesSprintFilter(req({ id: "r1" }), filter({ epicId: NO_PARENT }), epicOf({ r1: "e1" }))).toBe(false);
    expect(matchesSprintFilter(req({ feature_id: null }), filter({ featureId: NO_PARENT }), noEpics)).toBe(true);
    expect(matchesSprintFilter(req({ feature_id: "f1" }), filter({ featureId: NO_PARENT }), noEpics)).toBe(false);
  });

  it("requires every part of the filter at once", () => {
    const r = req({ id: "r1", feature_id: "f1" });
    const through = epicOf({ r1: "e1" });
    expect(matchesSprintFilter(r, filter({ query: "7", epicId: "e1", featureId: "f1" }), through)).toBe(true);
    expect(matchesSprintFilter(r, filter({ query: "7", epicId: "e1", featureId: "f2" }), through)).toBe(false);
  });
});
