// Super admin: every ECS service with its state, size, estimated cost, web addresses and auto-wake settings
// (INT-REQ-14, phase 2). Read-only: there are no buttons that change anything yet; starting and stopping is a
// later phase with its own safeguards. The numbers are read live from AWS each time the page opens.
import { useLoad } from "../../core/useLoad";
import { ResourcesResponse, ServiceRow, getResources } from "./cloudopsApi";
import { STATE_LABEL, autowakeText, countStates, perMonth, sizeLabel, usd } from "./cloudopsFormat";

function StatePill({ row }: { row: ServiceRow }) {
  return (
    <span className={`cloudops-state ${row.state}`} title={row.state_detail}>
      {STATE_LABEL[row.state]}
    </span>
  );
}

function Addresses({ row }: { row: ServiceRow }) {
  if (row.urls.length === 0 && row.reached_via.length === 0) return <span className="muted">None (no web address)</span>;
  return (
    <>
      {row.urls.map((u) => (
        <div key={u}>
          <a href={u} target="_blank" rel="noreferrer">
            {u.replace(/^https?:\/\//, "")}
          </a>
        </div>
      ))}
      {row.reached_via.map((v) => (
        <div key={v} className="muted">
          Reached by {v}
        </div>
      ))}
    </>
  );
}

/** Everything the page shows, from data alone, so it can be rendered and tested without a server. */
export function ResourcesView({
  data,
  loading,
  error,
  onReload,
}: {
  data: ResourcesResponse | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const report = data?.resources ?? null;
  const counts = report ? countStates(report.services) : null;
  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Resources</h1>
        <span className="shell-spacer" />
        <button className="btn" onClick={onReload} disabled={loading}>
          {loading ? "Loading…" : "Reload"}
        </button>
      </div>
      <p className="muted">Read-only for now. This reads the live state of the ECS services each time the page opens; it cannot start, stop or change anything.</p>

      {error && <div className="status-banner warn">{error}</div>}
      {data && !data.enabled && (
        <div className="status-banner warn">CloudOps is switched off in this environment. It runs in production only.</div>
      )}

      {report && counts && (
        <>
          <p className="muted" data-testid="state-counts">
            {report.services.length} services: {counts.running} running, {counts.asleep + counts.stopped} off, {counts.starting} starting,{" "}
            {counts.unhealthy} unhealthy.
          </p>
          <div className="cloudops-section">
            <table className="data-table list-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>App / environment</th>
                  <th>State</th>
                  <th>Size</th>
                  <th className="num">≈ Cost now</th>
                  <th className="num">≈ If running</th>
                  <th>Web address</th>
                  <th>Auto-wake</th>
                </tr>
              </thead>
              <tbody>
                {report.services.map((r) => (
                  <tr key={r.service}>
                    <td>
                      {r.service}
                      {r.production && <span className="cloudops-badge"> production</span>}
                    </td>
                    <td>
                      {r.app} / {r.environment}
                      {r.app_source === "name" && <span className="muted"> (from the name, not tagged)</span>}
                    </td>
                    <td>
                      <StatePill row={r} />
                      <div className="muted cloudops-note">{r.state_detail}</div>
                    </td>
                    <td>{sizeLabel(r.vcpu, r.memory_gb)}</td>
                    <td className="num">{perMonth(r.cost.now)}</td>
                    <td className="num">{perMonth(r.cost.when_running)}</td>
                    <td>
                      <Addresses row={r} />
                    </td>
                    <td>{autowakeText(r.autowake)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={4}>Total, estimated</th>
                  <th className="num">{perMonth(report.totals.now)}</th>
                  <th className="num">{perMonth(report.totals.when_all_running)}</th>
                  <th colSpan={2} />
                </tr>
              </tfoot>
            </table>
            <p className="muted cloudops-note">
              {report.pricing_note} Running now: {usd(report.totals.now)} a month; if every service were on: {usd(report.totals.when_all_running)}.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export function CloudOpsResourcesPage() {
  const resources = useLoad(getResources, []);
  return <ResourcesView data={resources.data} loading={resources.loading} error={resources.error} onReload={() => void resources.reload()} />;
}
