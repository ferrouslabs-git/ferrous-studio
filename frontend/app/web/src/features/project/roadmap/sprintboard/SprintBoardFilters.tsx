// The sprint board's filter bar: find a requirement by its number (or any
// word in its title) and narrow the lanes to a set of epics or features. A
// sprint is a flat queue of work drawn from anywhere on the board, so "which
// epic is this card from?" is a question the lanes cannot answer on their
// own -- hence the epic and feature shown on every card, and these two
// pickers over them.
//
// Both take several at once (2026-09-21): one epic at a time could not answer
// "what is left across these two epics", which is the real question whenever
// a sprint spans more than one.
//
// The filter narrows what the LANES show, never what the sprint contains:
// the header's progress figures still count the whole sprint, and the bar
// says how many cards are hidden so a filtered board is never mistaken for
// an empty one.
import { useMemo } from "react";
import { useBoard } from "../../board/boardData";
import { MultiSelect, MultiSelectOption } from "../../board/MultiSelect";
import { isFiltering, NO_PARENT, NO_SPRINT_FILTER, SprintFilterState } from "./sprintFilter";

interface SprintBoardFiltersProps {
  filter: SprintFilterState;
  onChange: (next: SprintFilterState) => void;
  /** Every requirement in the sprint, and how many of them are shown. */
  total: number;
  shown: number;
}

export function SprintBoardFilters({ filter, onChange, total, shown }: SprintBoardFiltersProps) {
  const { index } = useBoard();

  const epicOptions = useMemo<MultiSelectOption[]>(
    () => [
      ...index.epics.map((e) => ({ value: e.id, label: `${e.human_id} · ${e.title}` })),
      { value: NO_PARENT, label: "No epic" },
    ],
    [index.epics],
  );

  /** Every feature under these epics; all of them when nothing is picked. */
  const featuresUnder = (epicIds: Set<string>) => {
    const epics = epicIds.size > 0 ? index.epics.filter((e) => epicIds.has(e.id)) : index.epics;
    return epics.flatMap((e) => index.featuresOf(e.id).map((f) => ({ feature: f, epic: e })));
  };

  // Picking epics narrows the feature list to theirs. Each feature names its
  // epic underneath rather than sitting under a group heading: a checklist
  // has no optgroups, and "F2 · Mapping rules" alone repeats across epics.
  const featureOptions = useMemo<MultiSelectOption[]>(
    () => [
      ...featuresUnder(filter.epicIds).map(({ feature, epic }) => ({
        value: feature.id,
        label: `${feature.human_id} · ${feature.title}`,
        hint: `${epic.human_id} · ${epic.title}`,
      })),
      { value: NO_PARENT, label: "No feature" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, filter.epicIds],
  );

  // Changing the epics drops any feature that no longer sits under one of
  // them, rather than leaving the two disagreeing and the board silently
  // empty. "No feature" survives: it belongs to no epic by definition.
  const setEpics = (epicIds: Set<string>) => {
    const allowed = new Set(featuresUnder(epicIds).map(({ feature }) => feature.id));
    const featureIds = new Set([...filter.featureIds].filter((id) => id === NO_PARENT || allowed.has(id)));
    onChange({ ...filter, epicIds, featureIds });
  };

  return (
    <div className="viewbar sb-filters">
      <input
        className="q2 sb-q-find"
        type="search"
        placeholder="find a requirement…"
        aria-label="find a requirement by number or title"
        value={filter.query}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
      />
      <MultiSelect
        allLabel="All epics"
        countLabel="epics"
        ariaLabel="filter by epic"
        options={epicOptions}
        selected={filter.epicIds}
        onChange={setEpics}
      />
      <MultiSelect
        allLabel="All features"
        countLabel="features"
        ariaLabel="filter by feature"
        options={featureOptions}
        selected={filter.featureIds}
        onChange={(featureIds) => onChange({ ...filter, featureIds })}
      />
      {isFiltering(filter) && (
        <button type="button" className="btn mini-x" onClick={() => onChange(NO_SPRINT_FILTER)}>
          Clear
        </button>
      )}
      <span className="tk-right">
        <span className="viewbar-count">{isFiltering(filter) ? `${shown} of ${total} shown` : `${total} in this sprint`}</span>
      </span>
    </div>
  );
}
