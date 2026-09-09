// Organisation ▸ GitHub: connect the organisation's GitHub App once, shared
// by every project in it. Everyone in the organisation may see this page;
// only an admin (or a platform admin) sees Connect/Disconnect.
//
// Installing leaves the app entirely: `startConnect` returns a URL, the
// browser navigates to GitHub, and the user comes back here with a ?github=
// outcome that `useConnectOutcome` turns into a banner and then clears.
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { Confirmation, ConfirmationDrawer } from "../../components/ConfirmDrawer";
import { errorMessage } from "../../core/api";
import { formatDateTime } from "../../core/format";
import { useLoad } from "../../core/useLoad";
import { CONNECT_OUTCOMES, disconnectGitHub, getConnection, startConnect } from "./githubApi";

export function OrgGitHubPage() {
  const { orgId = "" } = useParams();
  const { orgs, user, activeOrg, selectOrg } = useSession();
  const org = orgs.find((o) => o.id === orgId);

  // Scoped calls run under the active organisation; keep it in step with the
  // URL (deep links, back/forward).
  useEffect(() => {
    if (org && activeOrg && org.id !== activeOrg.id) void selectOrg(org.id);
  }, [org, activeOrg, selectOrg]);

  const isPlatformAdmin = !!user?.is_platform_admin;
  // Read from the URL's organisation rather than the session's active one,
  // for the same reason OrgPage does: on a deep link the active scope can
  // still be catching up (the effect above).
  const canManage = isPlatformAdmin || org?.role === "account_admin";

  const outcome = useConnectOutcome();
  const connection = useLoad(() => getConnection(), []);
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
      const { url } = await startConnect();
      // A full navigation, not a new tab: GitHub returns the browser to this
      // page, and a popup would land the result somewhere the user is not.
      window.location.href = url;
      // Nothing after this matters -- the page is on its way out.
      await new Promise(() => {});
    });

  if (!org && !isPlatformAdmin) {
    return (
      <div className="page">
        <div className="empty">You are not a member of this organisation.</div>
      </div>
    );
  }

  const data = connection.data;

  return (
    <div className="page">
      <div className="page-head">
        {/* No sidebar names the organisation for a platform admin, who has
            no organisation menu -- so the heading does it here instead. */}
        <h1>GitHub{isPlatformAdmin && org ? ` · ${org.name}` : ""}</h1>
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
            <span className="muted">GitHub is not configured for this deployment.</span>
          ) : !data.connected ? (
            <div className="repo-connect">
              <span className="muted">This organisation is not connected to GitHub.</span>
              {canManage && (
                <button className="btn primary" disabled={busy} onClick={connect}>
                  Connect GitHub
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="details-grid">
                <div className="details-label">Account</div>
                <div className="details-value">
                  {data.account_login ?? "Unknown"}{" "}
                  <span className="badge">{data.account_type === "Organization" ? "Organization" : "User"}</span>
                </div>

                <div className="details-label">Repositories</div>
                <div className="details-value">
                  {data.repository_selection === "all" ? "All repositories" : "Selected repositories"}
                </div>

                <div className="details-label">Connected</div>
                <div className="details-value">{data.connected_at ? formatDateTime(data.connected_at) : "Unknown"}</div>
              </div>

              <div className="repo-footer">
                <span className="shell-spacer" />
                {data.manage_url && (
                  <a className="btn ghost" href={data.manage_url} target="_blank" rel="noreferrer noopener">
                    Manage on GitHub
                  </a>
                )}
                {canManage && (
                  <button
                    className="btn ghost"
                    disabled={busy}
                    onClick={() =>
                      setConfirming({
                        title: "Disconnect GitHub",
                        confirmLabel: "Disconnect",
                        body: (
                          <p>
                            Disconnect from <b>{data.account_login ?? "GitHub"}</b>? This uninstalls the App from
                            GitHub as well, so connecting again will ask you to choose an account and repositories
                            from scratch. Projects keep their repository links and report them as disconnected until
                            the organisation connects again.
                          </p>
                        ),
                        run: () => run(disconnectGitHub),
                      })
                    }
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <ConfirmationDrawer pending={confirming} onClose={() => setConfirming(null)} />
    </div>
  );
}

/**
 * The ?github= outcome GitHub sent us back with, shown once.
 *
 * Cleared from the URL as soon as it is read, so a refresh or a shared link
 * does not replay a message about something that already happened. Unknown
 * values are dropped rather than shown -- the query string is whatever was in
 * the address bar.
 */
function useConnectOutcome() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("github");
  const [outcome, setOutcome] = useState(() => (raw ? CONNECT_OUTCOMES[raw] ?? null : null));

  useEffect(() => {
    if (!raw) return;
    setOutcome(CONNECT_OUTCOMES[raw] ?? null);
    const next = new URLSearchParams(params);
    next.delete("github");
    setParams(next, { replace: true });
    // `params` and `setParams` change identity on every render; this runs for
    // the value that arrived, which is what `raw` tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  return outcome;
}
