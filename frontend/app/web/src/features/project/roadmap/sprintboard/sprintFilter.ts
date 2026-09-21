// What the sprint board's filter bar means, with no React in it -- the same
// split as boardModel.ts against the pages: the rule that decides whether a
// card is shown is worth testing on its own, and a test that had to import
// the component would drag the session and its auth redirect in with it.
import type { Requirement } from "../../board/requirementsApi";

/** Sentinel for "filed under nothing", selectable like any other option. */
export const NO_PARENT = "__none__";

export interface SprintFilterState {
  /** Matched against the requirement's id and title. */
  query: string;
  /** Epic ids and/or NO_PARENT. Empty means every epic, never none. */
  epicIds: Set<string>;
  /** Feature ids and/or NO_PARENT. Empty means every feature. */
  featureIds: Set<string>;
}

export const NO_SPRINT_FILTER: SprintFilterState = { query: "", epicIds: new Set(), featureIds: new Set() };

export const isFiltering = (f: SprintFilterState): boolean =>
  f.query.trim() !== "" || f.epicIds.size > 0 || f.featureIds.size > 0;

/** Ids compare loosely: "REQ-7", "req 7" and "7" all find REQ-7. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Whether a card survives the filter. Given the effective epic rather than
 * the board: a requirement can carry its epic through its feature, and
 * filtering on the literal column would hide it from its own epic.
 *
 * An empty selection means "all", not "none" -- a filter that started by
 * hiding the whole board would be a trap, and it is also why there is no
 * invalid state to guard against here. Several selections are a union: the
 * question being asked is "show me these epics", not "show me work in every
 * one of them at once", which nothing could satisfy.
 */
export function matchesSprintFilter(
  r: Requirement,
  filter: SprintFilterState,
  effectiveEpicId: (r: Requirement) => string | null,
): boolean {
  if (filter.epicIds.size > 0 && !filter.epicIds.has(effectiveEpicId(r) ?? NO_PARENT)) return false;
  if (filter.featureIds.size > 0 && !filter.featureIds.has(r.feature_id ?? NO_PARENT)) return false;
  const q = filter.query.trim().toLowerCase();
  if (!q) return true;
  return r.human_id.toLowerCase().includes(q) || squash(r.human_id).includes(squash(q)) || r.title.toLowerCase().includes(q);
}
