// The sprint board's filter bar: find a requirement by its number (or any
// word in its title) and narrow the lanes to one epic or one feature. A
// sprint is a flat queue of work drawn from anywhere on the board, so "which
// epic is this card from?" is a question the lanes cannot answer on their
// own -- hence the epic and feature shown on every card, and these two
// selects over them.
//
// The filter narrows what the LANES show, never what the sprint contains:
// the header's progress figures still count the whole sprint, and the bar
// says how many cards are hidden so a filtered board is never mistaken for
// an empty one.
import { useBoard } from "../../board/boardData";
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
  // Picking an epic narrows the feature list to that epic's; with no epic
  // picked, every feature is offered under its own epic's heading.
  const epics = index.epics;
  const featureEpics = filter.epicId && filter.epicId !== NO_PARENT ? epics.filter((e) => e.id === filter.epicId) : epics;

  // Changing the epic drops a feature that no longer sits under it, rather
  // than leaving the two disagreeing and the board silently empty.
  const setEpic = (epicId: string) => {
    const feature = filter.featureId ? index.featureById.get(filter.featureId) : undefined;
    const keep = filter.featureId === NO_PARENT || !epicId || epicId === NO_PARENT || feature?.epic_id === epicId;
    onChange({ ...filter, epicId, featureId: keep ? filter.featureId : "" });
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
      <select className="mini" aria-label="filter by epic" value={filter.epicId} onChange={(e) => setEpic(e.target.value)}>
        <option value="">All epics</option>
        {epics.map((e) => (
          <option key={e.id} value={e.id}>
            {e.human_id} · {e.title}
          </option>
        ))}
        <option value={NO_PARENT}>No epic</option>
      </select>
      <select
        className="mini"
        aria-label="filter by feature"
        value={filter.featureId}
        onChange={(e) => onChange({ ...filter, featureId: e.target.value })}
      >
        <option value="">All features</option>
        {featureEpics.map((e) => {
          const features = index.featuresOf(e.id);
          return features.length === 0 ? null : (
            <optgroup key={e.id} label={`${e.human_id} · ${e.title}`}>
              {features.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.human_id} · {f.title}
                </option>
              ))}
            </optgroup>
          );
        })}
        <option value={NO_PARENT}>No feature</option>
      </select>
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
