// One sprint row: the bar spans its real dates and fills by committed-vs-
// capacity; the crew chips are the agents assigned to it (running = pulsing).
// An undated sprint still gets a row -- with its crew -- so nothing planned
// is invisible, just unpositioned. Ported from the reference app's
// tlSprintRow (static/js/timeline.js).
import { useNavigate } from "react-router-dom";
import { useBoard } from "../../board/boardData";
import { DeliveryStatusChip } from "../../board/chips";
import { DELIVERY_STATUS_LABEL } from "../../board/constants";
import { DEFAULT_CAPACITY_HOURS } from "../../board/constants";
import { fmtEffort, rollup } from "../../board/effort";
import { Icon } from "../../board/icons";
import type { Sprint } from "../../board/sprintsApi";
import { CrewChip } from "./CrewChip";
import { TimelineRow } from "./TimelineRow";
import { tlBarStyle, type TimeWindow } from "./timelineMath";

export function SprintRow({ sprint, w }: { sprint: Sprint; w: TimeWindow | null }) {
  const { data, index, paths } = useBoard();
  const navigate = useNavigate();
  const p = rollup(index.sprintRequirements(sprint.id));
  const cap = sprint.capacity_hours ?? DEFAULT_CAPACITY_HOURS;
  const over = p.hours > cap;
  const fill = cap > 0 ? Math.min(100, (100 * p.hours) / cap) : 0;
  const crew = (data?.agents ?? []).filter((a) => a.sprint_id === sprint.id);
  // Hovering a running agent names the requirement it is on.
  const crewChips = crew.map((a) => <CrewChip key={a.id} agent={a} showWork />);
  const start = sprint.start_date;
  const end = sprint.end_date;

  return (
    <TimelineRow
      cls={`tl-sprint tl-sp-${sprint.closed_at ? "closed" : "open"}`}
      id={sprint.id}
      pre={<Icon name="timer" small />}
      label={`${sprint.human_id} · ${sprint.name}`}
      onClick={() => navigate(paths.sprint(sprint.id))}
      meta={
        <>
          <DeliveryStatusChip status={sprint.status} />
          <span className={`sp-cap-fig${over ? " over" : ""}`}>
            {fmtEffort(p.hours)} / {fmtEffort(cap)}
          </span>
        </>
      }
    >
      {w && start && end ? (
        <div
          className={`tl-bar tl-bar-sprint${over ? " tl-over" : ""}`}
          style={tlBarStyle(w, start, end)}
          title={
            `${sprint.name} · ${DELIVERY_STATUS_LABEL[sprint.status]}${sprint.closed_at ? " · closed" : ""} · ${start} → ${end} — committed ${fmtEffort(p.hours)} of ${fmtEffort(cap)}` +
            (over ? " (over capacity)" : "") +
            (crew.length ? ` · ${crew.length} agent(s)` : "")
          }
        >
          <span className="tl-fill" style={{ width: `${fill}%` }} />
          <span className="tl-crew">{crewChips}</span>
        </div>
      ) : (
        <>
          <span className="tl-nodate">no dates</span>
          {crew.length ? <span className="tl-crew">{crewChips}</span> : null}
        </>
      )}
    </TimelineRow>
  );
}
