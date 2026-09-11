// One line of the activity feed or an entity's History tab: a glyph for the
// verb, who did it, a link to the entity, what changed, and when.
import { formatDateTime } from "../../../core/format";
import { useBoard } from "./boardData";
import { EV_GLYPH, eventVerb, evSummary, relTime } from "./events";
import type { BoardEvent } from "./eventsApi";
import { useGoTo } from "./useGoTo";

export function EventRow({ event, compact = false }: { event: BoardEvent; compact?: boolean }) {
  const { index } = useBoard();
  const goTo = useGoTo();
  const label = index.humanIdOf(event.entity_type, event.entity_id) ?? event.entity_type;
  // Turn the uuids in a diff back into the names a human recognises.
  const resolve = (field: string, v: unknown): string | null => {
    if (typeof v !== "string") return null;
    switch (field) {
      case "release_id":
        return index.releaseById.get(v)?.human_id ?? null;
      case "epic_id":
        return index.epicById.get(v)?.human_id ?? null;
      case "feature_id":
        return index.featureById.get(v)?.human_id ?? null;
      case "sprint_id":
        return index.sprintById.get(v)?.human_id ?? null;
      case "assignee_id":
        return index.memberName(v);
      default:
        return null;
    }
  };
  return (
    <div className={`ev${compact ? " compact" : ""}`}>
      <span className="ev-ico">{EV_GLYPH[eventVerb(event.action)]}</span>
      <span className="who">{index.memberName(event.actor_id)}</span>
      <button type="button" className="lnk" onClick={() => goTo(event.entity_type, event.entity_id)}>
        {label}
      </button>
      <span className="what" title={evSummary(event, resolve)}>
        {evSummary(event, resolve)}
      </span>
      <span className="when" title={formatDateTime(event.created_at)}>
        {relTime(event.created_at)}
      </span>
    </div>
  );
}
