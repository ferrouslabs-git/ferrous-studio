// The Activity card in the sprint board's side column: the last forty
// events on this sprint and everything in it, from the activity poll.
import { EventRow } from "../../board/EventRow";
import type { SprintActivity } from "../../board/sprintsApi";

export function ActivityFeedCard({ live }: { live: SprintActivity | null }) {
  return (
    <div className="hcard sb-feed">
      <h3>Activity</h3>
      <div className="body">
        {live === null ? (
          <div className="sb-card-empty">loading…</div>
        ) : live.events.length === 0 ? (
          <div className="sb-card-empty">Nothing yet.</div>
        ) : (
          live.events.slice(0, 40).map((e) => <EventRow key={e.id} event={e} compact />)
        )}
      </div>
    </div>
  );
}
