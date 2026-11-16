// Super admin: every ECS service with its state, size, estimated cost, web addresses and auto-wake settings, and
// (INT-REQ-14, phase 3) the controls to start or stop a non-production service and tune its auto-wake.
//
// Production is never changed from here: a production row has no buttons and says where to go instead. Every change
// is sent to the guarded control function, refused again on the server if it is production, and written to the audit
// log shown beneath the table. The state is read live from AWS each time the page opens.
import { FormEvent, useState } from "react";
import { Confirmation, ConfirmationDrawer } from "../../components/ConfirmDrawer";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { formatDateTime } from "../../core/format";
import { useLoad } from "../../core/useLoad";
import {
  ActionRow,
  ResourcesResponse,
  ServiceRow,
  getResources,
  listActions,
  setAutowake,
  setKeepAwake,
  startService,
  stopService,
} from "./cloudopsApi";
import { ACTION_LABEL, STATE_LABEL, autowakeText, canStart, canStop, countStates, parseIdle, perMonth, sizeLabel, toIsoUtc, usd } from "./cloudopsFormat";

/** What the table asks the page to do. Left out, the table is read-only and shows no controls. */
export interface RowActions {
  onStart: (row: ServiceRow) => void;
  onStop: (row: ServiceRow) => void;
  onAutoWake: (row: ServiceRow) => void;
}

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

function Controls({ row, actions }: { row: ServiceRow; actions: RowActions }) {
  if (row.production) return <span className="muted">Production: change it in the AWS console.</span>;
  return (
    <div className="cloudops-controls">
      {canStart(row.state) && (
        <button className="btn" onClick={() => actions.onStart(row)}>
          Start
        </button>
      )}
      {canStop(row.state) && (
        <button className="btn" onClick={() => actions.onStop(row)}>
          Stop
        </button>
      )}
      <button className="btn ghost" onClick={() => actions.onAutoWake(row)} disabled={Boolean(row.autowake.follows)} title={row.autowake.follows ? `Follows ${row.autowake.follows}` : undefined}>
        Auto-wake…
      </button>
    </div>
  );
}

/** The recent actions, newest first: who did what to which service, and whether it worked, was refused or failed. */
export function ActionsLog({ rows }: { rows: ActionRow[] | null }) {
  return (
    <section className="cloudops-section" aria-label="Recent actions">
      <h2>Recent actions</h2>
      {rows === null ? (
        <p className="muted">Not loaded.</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nothing has been changed from this panel yet.</p>
      ) : (
        <table className="data-table list-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Service</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{formatDateTime(r.created_at)}</td>
                <td>{r.user_email}</td>
                <td>{ACTION_LABEL[r.action] ?? r.action}</td>
                <td>{r.service}</td>
                <td>
                  <span className={`cloudops-result ${r.status}`}>{r.status === "ok" ? "Done" : r.status === "refused" ? "Refused" : "Failed"}</span>
                  {r.message && <div className="muted cloudops-note">{r.message}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Everything the page shows, from data alone, so it can be rendered and tested without a server. */
export function ResourcesView({
  data,
  loading,
  error,
  onReload,
  actions,
  notice,
  log,
}: {
  data: ResourcesResponse | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  actions?: RowActions;
  notice?: string | null;
  log?: ActionRow[] | null;
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
      <p className="muted">
        {actions
          ? "Start or stop a non-production service and tune its auto-wake. Production services cannot be changed here. Every change is recorded below."
          : "Read-only. This reads the live state of the ECS services each time the page opens; it cannot start, stop or change anything."}
      </p>

      {error && <div className="status-banner warn">{error}</div>}
      {notice && <div className="status-banner">{notice}</div>}
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
                  {actions && <th>Actions</th>}
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
                    {actions && (
                      <td>
                        <Controls row={r} actions={actions} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={4}>Total, estimated</th>
                  <th className="num">{perMonth(report.totals.now)}</th>
                  <th className="num">{perMonth(report.totals.when_all_running)}</th>
                  <th colSpan={actions ? 3 : 2} />
                </tr>
              </tfoot>
            </table>
            <p className="muted cloudops-note">
              {report.pricing_note} Running now: {usd(report.totals.now)} a month; if every service were on: {usd(report.totals.when_all_running)}.
            </p>
          </div>
        </>
      )}
      {actions && log !== undefined && <ActionsLog rows={log} />}
    </div>
  );
}

/** The auto-wake settings for one service: on or off, how long idle before it sleeps, and keep-awake-until. */
export function AutoWakeDrawer({ row, onClose, onSaved }: { row: ServiceRow | null; onClose: () => void; onSaved: (message: string) => void }) {
  const [enabled, setEnabled] = useState(row?.autowake.enabled ?? false);
  const [idle, setIdle] = useState(row?.autowake.idle_minutes ? String(row.autowake.idle_minutes) : "");
  const [keep, setKeep] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idleCheck = parseIdle(idle);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!row) return;
    if (enabled && idleCheck.error) return setError(idleCheck.error);
    setBusy(true);
    setError(null);
    try {
      await setAutowake(row.service, enabled, enabled ? idleCheck.value : null);
      if (enabled && keep) await setKeepAwake(row.service, toIsoUtc(keep));
      onSaved(`Auto-wake settings saved for ${row.service}.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={row !== null}
      title={row ? `Auto-wake: ${row.service}` : ""}
      onClose={onClose}
      onSubmit={(e) => void save(e)}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || (enabled && Boolean(idleCheck.error))}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <Field label="Auto-wake" hint="When on, the service switches itself off after a quiet spell and starts again when someone opens its address or deploys.">
        <label className="row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Sleep when idle
        </label>
      </Field>
      <Field label="Idle minutes" hint="Blank uses the default of 60. From 5 to 1440." error={enabled ? idleCheck.error : undefined}>
        <input className="input" inputMode="numeric" value={idle} onChange={(e) => setIdle(e.target.value)} disabled={!enabled} placeholder="60" />
      </Field>
      <Field label="Keep awake until" hint="Optional. It will not be switched off before this time (up to 30 days ahead, in your local time).">
        <input className="input" type="datetime-local" value={keep} onChange={(e) => setKeep(e.target.value)} disabled={!enabled} />
      </Field>
      {error && <div className="status-banner warn">{error}</div>}
    </Drawer>
  );
}

export function CloudOpsResourcesPage() {
  const resources = useLoad(getResources, []);
  const log = useLoad(listActions, []);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = async (message: string) => {
    setNotice(message);
    await Promise.all([resources.reload(), log.reload()]);
  };

  const actions: RowActions = {
    onStart: (row) => {
      setActionError(null);
      setConfirming({
        title: `Start ${row.service}`,
        confirmLabel: "Start",
        danger: false,
        body: <p>Start <b>{row.service}</b>? It will cost about {usd(row.cost.per_task)} a month while it runs.</p>,
        run: async () => {
          await startService(row.service);
          await refresh(`Start requested for ${row.service}. It usually takes a minute or two to come up; press Reload to see.`);
        },
      });
    },
    onStop: (row) => {
      setActionError(null);
      setConfirming({
        title: `Stop ${row.service}`,
        confirmLabel: "Stop",
        danger: true,
        body: (
          <p>
            Stop <b>{row.service}</b>? Its web address will stop working until it is started again
            {row.autowake.enabled ? ", or until someone visits it and it wakes by itself" : ""}.
          </p>
        ),
        run: async () => {
          await stopService(row.service);
          await refresh(`Stop requested for ${row.service}.`);
        },
      });
    },
    onAutoWake: (row) => {
      setActionError(null);
      setEditing(row);
    },
  };

  return (
    <>
      <ResourcesView
        data={resources.data}
        loading={resources.loading}
        error={actionError ?? resources.error}
        onReload={() => void resources.reload().then(() => log.reload())}
        actions={actions}
        notice={notice}
        log={log.data}
      />
      <ConfirmationDrawer pending={confirming} onClose={() => setConfirming(null)} />
      {editing && (
        <AutoWakeDrawer
          key={editing.service}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={(m) => void refresh(m).catch((e) => setActionError(errorMessage(e)))}
        />
      )}
    </>
  );
}
