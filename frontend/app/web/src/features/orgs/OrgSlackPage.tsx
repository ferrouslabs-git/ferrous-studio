// Organisation ▸ Slack: connect the organisation's Slack workspace once and
// choose the channel board activity and agent approvals are posted to.
// Everyone in the organisation may see this page; only an admin (or a platform
// admin) sees the controls.
//
// Installing leaves the app entirely: `startSlackConnect` returns a URL, the
// browser navigates to Slack, and the user comes back here with a ?slack=
// outcome that `useConnectOutcome` turns into a banner and then clears.
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { Confirmation, ConfirmationDrawer } from "../../components/ConfirmDrawer";
import { errorMessage } from "../../core/api";
import { formatDateTime } from "../../core/format";
import { useLoad } from "../../core/useLoad";
import {
  CONNECT_OUTCOMES,
  disconnectSlack,
  getSlackConnection,
  listSlackChannels,
  setSlackChannel,
  startSlackConnect,
} from "./slackApi";

export function OrgSlackPage() {
  const { orgId = "" } = useParams();
  const { orgs, user, activeOrg, selectOrg } = useSession();
  const org = orgs.find((o) => o.id === orgId);

  // Scoped calls run under the active organisation; keep it in step with the URL.
  useEffect(() => {
    if (org && activeOrg && org.id !== activeOrg.id) void selectOrg(org.id);
  }, [org, activeOrg, selectOrg]);

  const isPlatformAdmin = !!user?.is_platform_admin;
  const canManage = isPlatformAdmin || org?.role === "account_admin";

  const outcome = useConnectOutcome();
  const connection = useLoad(() => getSlackConnection(), []);
  const data = connection.data;
  // Only an admin may list channels, and only once there is a connection.
  const channels = useLoad(
    () => (canManage && data?.connected ? listSlackChannels() : Promise.resolve([])),
    [canManage, data?.connected],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await connection.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      const { url } = await startSlackConnect();
      // A full navigation, not a new tab: Slack returns the browser to this page.
      window.location.href = url;
      await new Promise(() => {});
    });

  if (!org && !isPlatformAdmin) {
    return (
      <div className="page">
        <div className="empty">You are not a member of this organisation.</div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Slack{isPlatformAdmin && org ? ` · ${org.name}` : ""}</h1>
      </div>

      <section className="section">
        <div className="section-body stack">
          {outcome && <div className={`status-banner ${outcome.tone === "ok" ? "" : "warn"}`}>{outcome.message}</div>}
          {error && <div className="status-banner warn">{error}</div>}

          {connection.loading && !data ? (
            <span className="muted">Loading…</span>
          ) : connection.error ? (
            <div className="status-banner warn">{connection.error}</div>
          ) : !data?.configured ? (
            <span className="muted">
              Slack is not configured for this deployment{data?.missing.length ? ` (missing ${data.missing.join(", ")})` : ""}.
            </span>
          ) : !data.connected ? (
            <div className="repo-connect">
              <span className="muted">This organisation is not connected to Slack.</span>
              {canManage && (
                <button className="btn primary" disabled={busy} onClick={connect}>
                  Connect Slack
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="details-grid">
                <div className="details-label">Workspace</div>
                <div className="details-value">{data.team_name ?? "Unknown"}</div>

                <div className="details-label">Channel</div>
                <div className="details-value">
                  {canManage ? (
                    <select
                      value={data.channel_id ?? ""}
                      disabled={busy || channels.loading}
                      aria-label="Channel"
                      onChange={(e) => e.target.value && void run(() => setSlackChannel(e.target.value))}
                    >
                      <option value="">— choose a channel —</option>
                      {(channels.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          #{c.name}
                        </option>
                      ))}
                    </select>
                  ) : data.channel_name ? (
                    `#${data.channel_name}`
                  ) : (
                    "None chosen"
                  )}
                </div>

                <div className="details-label">Connected</div>
                <div className="details-value">{data.connected_at ? formatDateTime(data.connected_at) : "Unknown"}</div>
              </div>

              {channels.error && canManage && <div className="status-banner warn">{channels.error}</div>}

              {canManage && (
                <div className="repo-footer">
                  <span className="shell-spacer" />
                  <button className="btn ghost" disabled={busy} onClick={connect}>
                    Reconnect
                  </button>
                  <button
                    className="btn ghost"
                    disabled={busy}
                    onClick={() =>
                      setConfirming({
                        title: "Disconnect Slack",
                        confirmLabel: "Disconnect",
                        body: (
                          <p>
                            Disconnect from <b>{data.team_name ?? "Slack"}</b>? Updates stop, and any approval an agent
                            is waiting on can no longer be answered from Slack.
                          </p>
                        ),
                        run: () => run(disconnectSlack),
                      })
                    }
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <ConfirmationDrawer pending={confirming} onClose={() => setConfirming(null)} />
    </div>
  );
}

/** The ?slack= outcome Slack sent us back with, shown once and cleared from the URL. */
function useConnectOutcome() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("slack");
  const [outcome, setOutcome] = useState(() => (raw ? CONNECT_OUTCOMES[raw] ?? null : null));

  useEffect(() => {
    if (!raw) return;
    setOutcome(CONNECT_OUTCOMES[raw] ?? null);
    const next = new URLSearchParams(params);
    next.delete("slack");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  return outcome;
}
