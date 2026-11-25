// One sprint row: the bar spans its real dates and fills by progress; the
// crew chips are the agents assigned to it (running = pulsing).
// An undated sprint still gets a row -- with its crew -- so nothing planned
// is invisible, just unpositioned. Ported from the reference app's
// tlSprintRow (static/js/timeline.js).
import { useNavigate } from "react-router-dom";
import { useBoard } from "../../board/boardData";
import { DeliveryStatusChip } from "../../board/chips";
import { DELIVERY_STATUS_LABEL } from "../../board/constants";
import { rollup } from "../../board/effort";
import { Icon } from "../../board/icons";
import type { Sprint } from "../../board/sprintsApi";
import { CrewChip } from "./CrewChip";
import { TimelineRow } from "./TimelineRow";
import { tlBarStyle, type TimeWindow } from "./timelineMath";

export function SprintRow({ sprint, w }: { sprint: Sprint; w: TimeWindow | null }) {
  const { data, index, paths } = useBoard();
  const navigate = useNavigate();
  const p = rollup(index.sprintRequirements(sprint.id));
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
      hid={sprint.human_id}
      of={{ type: "sprint", id: sprint.id }}
      label={sprint.name}
      onClick={() => navigate(paths.sprint(sprint.id))}
      meta={
        <>
          <DeliveryStatusChip status={sprint.status} />
          <span className="tl-fig">
            {p.done}/{p.total} · {p.pct}%
          </span>
        </>
      }
    >
      {w && start && end ? (
        <div
          className="tl-bar tl-bar-sprint"
          style={tlBarStyle(w, start, end)}
          title={
            `${sprint.name} · ${DELIVERY_STATUS_LABEL[sprint.status]}${sprint.closed_at ? " · closed" : ""} · ${start} → ${end} — ${p.done}/${p.total} done` +
            (crew.length ? ` · ${crew.length} agent(s)` : "")
          }
        >
          <span className="tl-fill" style={{ width: `${p.pct}%` }} />
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
