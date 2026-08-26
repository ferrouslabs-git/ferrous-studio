// Save-state indicator. Deliberately prominent when work is unsaved: this is
// crash-recovery UI, and a quiet dot misleads.
import { OutboxSnapshot } from "./outbox";

export function SyncStatus({ snapshot, onRetry }: { snapshot: OutboxSnapshot; onRetry: () => void }) {
  if (snapshot.pending === 0) {
    return <span className="badge good">Saved</span>;
  }
  if (snapshot.phase === "syncing" && snapshot.attempt === 0) {
    return <span className="badge accent">Saving… ({snapshot.pending})</span>;
  }
  return (
    <span className="status-banner warn" style={{ padding: "4px 10px", borderRadius: 6, border: 0 }}>
      ▲ {snapshot.pending} unsaved change{snapshot.pending === 1 ? "" : "s"}
      {snapshot.offline ? " — offline" : snapshot.lastError ? ` — ${snapshot.lastError}` : ""}
      <button className="btn small" onClick={onRetry}>
        Retry now
      </button>
    </span>
  );
}
