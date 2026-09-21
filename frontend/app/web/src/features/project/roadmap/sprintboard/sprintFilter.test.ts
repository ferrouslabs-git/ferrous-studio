import { describe, expect, it } from "vitest";
import type { Requirement } from "../../board/requirementsApi";
import { isFiltering, matchesSprintFilter, NO_PARENT, NO_SPRINT_FILTER, SprintFilterState } from "./sprintFilter";

const req = (o: Partial<Requirement>): Requirement =>
  ({ id: "r", human_id: "REQ-7", title: "Search bar for requirement number", feature_id: null, ...o } as Requirement);

type FilterInput = { query?: string; epicIds?: string[]; featureIds?: string[] };
const filter = (o: FilterInput): SprintFilterState => ({
  query: o.query ?? "",
  epicIds: new Set(o.epicIds ?? []),
  featureIds: new Set(o.featureIds ?? []),
});

// The effective epic is the board's to work out (a requirement can carry its
// epic through its feature); here it is stubbed per requirement.
const epicOf = (map: Record<string, string | null>) => (r: Requirement) => map[r.id] ?? null;
const noEpics = () => null;

describe("matchesSprintFilter", () => {
  it("keeps everything with no filter set", () => {
    expect(matchesSprintFilter(req({}), NO_SPRINT_FILTER, noEpics)).toBe(true);
    expect(isFiltering(NO_SPRINT_FILTER)).toBe(false);
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
    expect(matchesSprintFilter(r, filter({ epicIds: ["e1"] }), through)).toBe(true);
    expect(matchesSprintFilter(r, filter({ epicIds: ["e2"] }), through)).toBe(false);
  });

  it("treats several selections as a union, not an intersection", () => {
    const through = epicOf({ a: "e1", b: "e2", c: "e3" });
    const two = filter({ epicIds: ["e1", "e2"] });
    expect(matchesSprintFilter(req({ id: "a" }), two, through)).toBe(true);
    expect(matchesSprintFilter(req({ id: "b" }), two, through)).toBe(true);
    expect(matchesSprintFilter(req({ id: "c" }), two, through)).toBe(false);
  });

  it("unions features the same way", () => {
    const two = filter({ featureIds: ["f1", "f2"] });
    expect(matchesSprintFilter(req({ feature_id: "f1" }), two, noEpics)).toBe(true);
    expect(matchesSprintFilter(req({ feature_id: "f2" }), two, noEpics)).toBe(true);
    expect(matchesSprintFilter(req({ feature_id: "f3" }), two, noEpics)).toBe(false);
  });

  it("offers 'filed under nothing' as its own choice, alongside real ones", () => {
    const through = epicOf({ r1: "e1", r2: null });
    const mixed = filter({ epicIds: ["e1", NO_PARENT] });
    expect(matchesSprintFilter(req({ id: "r1" }), mixed, through)).toBe(true);
    expect(matchesSprintFilter(req({ id: "r2" }), mixed, through)).toBe(true);
    expect(matchesSprintFilter(req({ id: "r3" }), mixed, epicOf({ r3: "e9" }))).toBe(false);

    expect(matchesSprintFilter(req({ feature_id: null }), filter({ featureIds: [NO_PARENT] }), noEpics)).toBe(true);
    expect(matchesSprintFilter(req({ feature_id: "f1" }), filter({ featureIds: [NO_PARENT] }), noEpics)).toBe(false);
  });

  it("requires every part of the filter at once", () => {
    const r = req({ id: "r1", feature_id: "f1" });
    const through = epicOf({ r1: "e1" });
    expect(matchesSprintFilter(r, filter({ query: "7", epicIds: ["e1"], featureIds: ["f1"] }), through)).toBe(true);
    expect(matchesSprintFilter(r, filter({ query: "7", epicIds: ["e1"], featureIds: ["f2"] }), through)).toBe(false);
  });

  it("knows when it is narrowing anything", () => {
    expect(isFiltering(filter({ query: "  " }))).toBe(false);
    expect(isFiltering(filter({ epicIds: ["e1"] }))).toBe(true);
    expect(isFiltering(filter({ featureIds: [NO_PARENT] }))).toBe(true);
  });
});
