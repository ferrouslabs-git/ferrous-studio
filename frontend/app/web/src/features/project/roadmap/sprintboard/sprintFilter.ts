// What the sprint board's filter bar means, with no React in it -- the same
// split as boardModel.ts against the pages: the rule that decides whether a
// card is shown is worth testing on its own, and a test that had to import
// the component would drag the session and its auth redirect in with it.
import type { Requirement } from "../../board/requirementsApi";

/** Sentinel for "filed under nothing": distinct from "" (no filter). */
export const NO_PARENT = "__none__";

export interface SprintFilterState {
  /** Matched against the requirement's id and title. */
  query: string;
  /** An epic id, NO_PARENT, or "" for every epic. */
  epicId: string;
  /** A feature id, NO_PARENT, or "" for every feature. */
  featureId: string;
}

export const NO_SPRINT_FILTER: SprintFilterState = { query: "", epicId: "", featureId: "" };

export const isFiltering = (f: SprintFilterState): boolean =>
  f.query.trim() !== "" || f.epicId !== "" || f.featureId !== "";

/** Ids compare loosely: "REQ-7", "req 7" and "7" all find REQ-7. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Whether a card survives the filter. Given the effective epic rather than
 * the board: a requirement can carry its epic through its feature, and
 * filtering on the literal column would hide it from its own epic.
 */
export function matchesSprintFilter(
  r: Requirement,
  filter: SprintFilterState,
  effectiveEpicId: (r: Requirement) => string | null,
): boolean {
  if (filter.epicId) {
    const eid = effectiveEpicId(r);
    if (filter.epicId === NO_PARENT ? eid !== null : eid !== filter.epicId) return false;
  }
  if (filter.featureId) {
    if (filter.featureId === NO_PARENT ? r.feature_id !== null : r.feature_id !== filter.featureId) return false;
  }
  const q = filter.query.trim().toLowerCase();
  if (!q) return true;
  return r.human_id.toLowerCase().includes(q) || squash(r.human_id).includes(squash(q)) || r.title.toLowerCase().includes(q);
}
