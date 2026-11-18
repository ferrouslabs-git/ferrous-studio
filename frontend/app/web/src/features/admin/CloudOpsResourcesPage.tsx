// Super admin: every ECS service with its state, size, estimated cost, web addresses and auto-wake settings, and
// (INT-REQ-14, phase 3) the controls to start or stop a non-production service and tune its auto-wake.
//
// One compact row per service (name, environment, state, instances, start/stop switch); everything else about a
// service is in its Details panel. Production can be started and stopped too (stopping it needs its name typed), except
// the service Studio itself runs as: its row shows "Protected", since stopping it would switch this page off. Every
// change is confirmed first, sent to the guarded control function, refused again on the server for Studio's own
// service, and written to the audit log beneath the list. The state is read live from AWS each time the page opens.
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
      <i aria-hidden="true" />
      {STATE_LABEL[row.state]}
    </span>
  );
}

const PROTECTED_TEXT = "Runs Studio itself: change it in the AWS console.";

/** The environment as a short tag; production stands out. */
function EnvTag({ row }: { row: ServiceRow }) {
  return <span className={row.production ? "cloudops-env prod" : "cloudops-env"}>{row.production ? "production" : row.environment}</span>;
}

/**
 * Start/stop as one slide switch: on for a service that is up (or coming up), off for one that is asleep or stopped.
 * It only asks the page to start or stop; the page's confirmation does the rest, so nothing changes on a click alone.
 */
function PowerSwitch({ row, actions }: { row: ServiceRow; actions: RowActions }) {
  if (row.protected) {
    return (
      <span className="cloudops-lock" title={PROTECTED_TEXT}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        Protected
      </span>
    );
  }
  const on = canStop(row.state);
  const label = row.state === "asleep" ? "Asleep" : row.state === "stopped" ? "Off" : STATE_LABEL[row.state];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${on ? "Stop" : "Start"} ${row.service}`}
      className={`cloudops-switch ${row.state}`}
      disabled={!on && !canStart(row.state)}
      onClick={() => (on ? actions.onStop(row) : actions.onStart(row))}
    >
      <span className="cloudops-switch-label">{label}</span>
      <span className="cloudops-switch-thumb" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 4v7" />
          <path d="M7 7.5a7 7 0 1 0 10 0" />
        </svg>
      </span>
    </button>
  );
}

/** Everything about one service that does not need to be in its row. */
export function DetailsDrawer({ row, onClose, actions }: { row: ServiceRow | null; onClose: () => void; actions?: RowActions }) {
  return (
    <Drawer
      open={row !== null}
      title={row?.service ?? ""}
      onClose={onClose}
      footer={
        row && actions && !row.production ? (
          <>
            <button type="button" className="btn ghost" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="btn"
              disabled={Boolean(row.autowake.follows)}
              title={row.autowake.follows ? `Follows ${row.autowake.follows}` : undefined}
              onClick={() => {
                onClose();
                actions.onAutoWake(row);
              }}
            >
              Auto-wake…
            </button>
          </>
        ) : undefined
      }
    >
      {row && (
        <dl className="cloudops-details">
          <dt>App / environment</dt>
          <dd>
            {row.app} / {row.environment}
            {row.app_source === "name" && <span className="muted"> (from the name, not tagged)</span>}
          </dd>
          <dt>State</dt>
          <dd>
            <StatePill row={row} />
            <div className="muted cloudops-note">{row.state_detail}</div>
          </dd>
          <dt>Instances</dt>
          <dd>
            {row.running} running of {row.desired}
          </dd>
          <dt>Size</dt>
          <dd>{sizeLabel(row.vcpu, row.memory_gb)} each</dd>
          <dt>≈ Cost now</dt>
          <dd>{perMonth(row.cost.now)}</dd>
          <dt>≈ If running</dt>
          <dd>{perMonth(row.cost.when_running)}</dd>
          <dt>Web address</dt>
          <dd>
            <Addresses row={row} />
          </dd>
          <dt>Auto-wake</dt>
          <dd>{autowakeText(row.autowake)}</dd>
          {row.protected && (
            <>
              <dt>Changes</dt>
              <dd>{PROTECTED_TEXT}</dd>
            </>
          )}
        </dl>
      )}
    </Drawer>
  );
}

type Filter = "all" | "prod" | "non";

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

/** The recent actions, newest first: who did what to which service, and whether it worked, was refused or failed. */
export function ActionsLog({ rows }: { rows: ActionRow[] | null }) {
  return (
    <section className="cloudops-log" aria-label="Recent actions">
      <h2>Recent actions</h2>
      {rows === null ? (
        <p className="muted">Not loaded.</p>
      ) : rows.length === 0 ? (
        <p className="muted">Nothing has been changed from this panel yet.</p>
      ) : (
        <ol>
          {rows.map((r) => (
            <li key={r.id}>
              <time>{formatDateTime(r.created_at)}</time>
              <span className="cloudops-log-what">
                <b>{r.service}</b> {(ACTION_LABEL[r.action] ?? r.action).toLowerCase()}{" "}
                <span className={`cloudops-result ${r.status}`}>{r.status === "ok" ? "Done" : r.status === "refused" ? "Refused" : "Failed"}</span>
                {r.message && <span className="muted cloudops-note"> {r.message}</span>}
              </span>
              <span className="cloudops-log-who">{r.user_email}</span>
            </li>
          ))}
        </ol>
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
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [details, setDetails] = useState<ServiceRow | null>(null);
  const q = query.trim().toLowerCase();
  const rows = (report?.services ?? []).filter(
    (r) => (filter === "all" || (filter === "prod") === r.production) && (!q || r.service.toLowerCase().includes(q)),
  );
  const totalsTitle = report
    ? `${report.pricing_note} If every service were on: ${usd(report.totals.when_all_running)} a month.`
    : undefined;

  return (
    <div className="page stack cloudops-resources">
      <div className="cloudops-head">
        <h1>Resources</h1>
        {report && counts && (
          <div className="cloudops-chips" data-testid="state-counts">
            <span className="cloudops-chip">{report.services.length} services</span>
            <span className="cloudops-chip running">
              <i aria-hidden="true" />
              {counts.running} running
            </span>
            <span className="cloudops-chip off">
              <i aria-hidden="true" />
              {counts.asleep + counts.stopped} off
            </span>
            <span className="cloudops-chip starting">
              <i aria-hidden="true" />
              {counts.starting} starting
            </span>
            <span className="cloudops-chip unhealthy">
              <i aria-hidden="true" />
              {counts.unhealthy} unhealthy
            </span>
          </div>
        )}
        <span className="shell-spacer" />
        {report && (
          <strong className="cloudops-spend" title={totalsTitle}>
            {perMonth(report.totals.now)}
          </strong>
        )}
        <button className="btn" onClick={onReload} disabled={loading}>
          {loading ? "Loading…" : "Reload"}
        </button>
      </div>

      {error && <div className="status-banner warn">{error}</div>}
      {notice && <div className="status-banner">{notice}</div>}
      {data && !data.enabled && (
        <div className="status-banner warn">CloudOps is switched off in this environment. It runs in production only.</div>
      )}

      {report && (
        <>
          <div className="cloudops-tools">
            <div className="cloudops-seg" role="group" aria-label="Filter">
              {(
                [
                  ["all", "All"],
                  ["prod", "Production"],
                  ["non", "Non-production"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {label}
                </button>
              ))}
            </div>
            <input
              className="input cloudops-search"
              type="search"
              placeholder="Search services"
              aria-label="Search services"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className={actions ? "cloudops-list" : "cloudops-list readonly"} role="table" aria-label="Services">
            <div className="cloudops-row cloudops-row-head" role="row">
              <span role="columnheader">Service</span>
              <span role="columnheader" className="cloudops-col-env">
                Env
              </span>
              <span role="columnheader">State</span>
              <span role="columnheader">Inst.</span>
              {actions && <span role="columnheader">Action</span>}
              <span role="columnheader" aria-label="Details" />
            </div>
            {rows.map((r) => (
              <div key={r.service} className="cloudops-row" role="row">
                <span role="cell" className="cloudops-name">
                  {r.service}
                </span>
                <span role="cell" className="cloudops-col-env">
                  <EnvTag row={r} />
                </span>
                <span role="cell">
                  <StatePill row={r} />
                </span>
                <span role="cell" className="cloudops-inst">
                  <b>{r.running}</b> / {r.desired}
                </span>
                {actions && (
                  <span role="cell">
                    <PowerSwitch row={r} actions={actions} />
                  </span>
                )}
                <span role="cell">
                  <button type="button" className="cloudops-details-btn" aria-label={`Details for ${r.service}`} onClick={() => setDetails(r)}>
                    Details
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </span>
              </div>
            ))}
            {rows.length === 0 && <p className="muted cloudops-empty">No services match.</p>}
          </div>
        </>
      )}
      {actions && log !== undefined && <ActionsLog rows={log} />}
      <DetailsDrawer row={details} onClose={() => setDetails(null)} actions={actions} />
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
          <>
            <p>
              Stop <b>{row.service}</b>? Its web address will stop working until it is started again
              {row.autowake.enabled ? ", or until someone visits it and it wakes by itself" : ""}.
            </p>
            {row.production && (
              <Field label={`Type ${row.service} to stop this production service`}>
                <input id="cloudops-confirm-name" className="input" autoComplete="off" spellCheck={false} />
              </Field>
            )}
          </>
        ),
        run: async () => {
          // A production service only stops once its name has been typed: a stray click must not take a live app down.
          if (row.production) {
            const typed = (document.getElementById("cloudops-confirm-name") as HTMLInputElement | null)?.value.trim();
            if (typed !== row.service) throw new Error(`Type ${row.service} exactly to stop it.`);
          }
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
