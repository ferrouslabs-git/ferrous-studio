// The Repository section of the project details page: connect the organisation
// to GitHub once, then point this project at one repository.
//
// Three things can be true at the same time and the section has to be readable
// in all of them -- the deployment may have no GitHub App, the organisation may
// not have installed it, and the project may not be linked. They are handled in
// that order, because each only makes sense once the one before it holds.
//
// Installing leaves the app: `startConnect` returns a URL, the browser
// navigates to GitHub, and the user comes back to this page with a ?github=
// outcome that `useConnectOutcome` turns into a banner and then clears.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { formatDateTime } from "../../core/format";
import { useLoad } from "../../core/useLoad";
import {
  CONNECT_OUTCOMES,
  ProjectRepository,
  disconnectGitHub,
  getConnection,
  getProjectRepository,
  linkRepository,
  listRepositories,
  startConnect,
  unlinkRepository,
} from "./githubApi";
import { useProject } from "./ProjectLayout";

export function RepositorySection() {
  const { project, canWrite, reload } = useProject();
  const outcome = useConnectOutcome();

  const connection = useLoad(() => getConnection(), []);
  const repository = useLoad(() => getProjectRepository(project.id), [project.id, project.repo_id]);

  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Re-read both halves: linking changes the project, connecting changes both. */
  const refresh = useCallback(async () => {
    await Promise.all([connection.reload(), repository.reload(), reload()]);
  }, [connection.reload, repository.reload, reload]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      const { url } = await startConnect(project.id);
      // A full navigation, not a new tab: GitHub returns the browser to this
      // page, and a popup would land the result somewhere the user is not.
      window.location.href = url;
      // Nothing after this matters -- the page is on its way out.
      await new Promise(() => {});
    });

  return (
    <section className="section">
      <div className="section-head">
        <h2>Repository</h2>
        <span className="shell-spacer" />
        {canWrite && connection.data?.connected && (
          <button className="btn ghost" disabled={busy} onClick={() => setPicking(true)}>
            {project.repo_id ? "Change" : "Link repository"}
          </button>
        )}
      </div>

      <div className="section-body stack">
        {outcome && <div className={`status-banner ${outcome.tone === "ok" ? "" : "warn"}`}>{outcome.message}</div>}
        {error && <div className="status-banner warn">{error}</div>}

        {connection.loading && !connection.data ? (
          <span className="muted">Loading…</span>
        ) : connection.error ? (
          <div className="status-banner warn">{connection.error}</div>
        ) : !connection.data?.configured ? (
          <span className="muted">GitHub is not configured for this deployment.</span>
        ) : !connection.data.connected ? (
          <div className="repo-connect">
            <span className="muted">This organisation is not connected to GitHub.</span>
            {canWrite && (
              <button className="btn primary" disabled={busy} onClick={connect}>
                Connect GitHub
              </button>
            )}
          </div>
        ) : (
          <>
            <RepositoryDetail repository={repository.data} loading={repository.loading} />
            <ConnectionFooter
              login={connection.data.account_login}
              selection={connection.data.repository_selection}
              manageUrl={connection.data.manage_url}
              canWrite={canWrite}
              busy={busy}
              linked={!!project.repo_id}
              onUnlink={() => run(() => unlinkRepository(project.id))}
              onDisconnect={() => run(disconnectGitHub)}
            />
          </>
        )}
      </div>

      {picking && (
        <RepositoryPicker
          currentId={project.repo_id}
          onClose={() => setPicking(false)}
          onLink={async (repoId) => {
            await linkRepository(project.id, repoId);
            setPicking(false);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

/** The linked repository, or the reason it cannot be shown as linked. */
function RepositoryDetail({ repository, loading }: { repository: ProjectRepository | null; loading: boolean }) {
  if (!repository) return <span className="muted">{loading ? "Loading…" : "No repository linked."}</span>;
  if (repository.state === "unlinked") return <span className="muted">No repository linked.</span>;

  const name = repository.repo_full_name ?? "";
  const commit = repository.latest_commit;

  return (
    <div className="stack">
      {repository.message && <div className="status-banner warn">{repository.message}</div>}
      <div className="details-grid">
        <div className="details-label">Repository</div>
        <div className="details-value">
          {repository.html_url ? (
            <a className="repo-link" href={repository.html_url} target="_blank" rel="noreferrer noopener">
              {name}
            </a>
          ) : (
            name
          )}
          {repository.private && <span className="badge">private</span>}
        </div>

        {/* GitHub's, read live on every load -- we store no branch of our own. */}
        <div className="details-label">Default branch</div>
        <div className="details-value">
          {repository.default_branch ?? <span className="muted">Unknown</span>}
        </div>

        {repository.description && (
          <>
            <div className="details-label">About</div>
            <div className="details-value">{repository.description}</div>
          </>
        )}

        {commit && (
          <>
            <div className="details-label">Latest commit</div>
            <div className="details-value">
              <span className="repo-sha">{commit.sha}</span> {commit.message}
              <div className="muted">
                {commit.author ?? "Unknown author"}
                {commit.committed_at ? ` · ${formatDateTime(commit.committed_at)}` : ""}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Which GitHub account we are reading through, and the ways out. */
function ConnectionFooter({
  login,
  selection,
  manageUrl,
  canWrite,
  busy,
  linked,
  onUnlink,
  onDisconnect,
}: {
  login: string | null;
  selection: string | null;
  manageUrl: string | null;
  canWrite: boolean;
  busy: boolean;
  linked: boolean;
  onUnlink: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="repo-footer">
      <span className="muted">
        Connected to {login ?? "GitHub"}
        {selection === "selected" ? " · selected repositories" : selection === "all" ? " · all repositories" : ""}
      </span>
      <span className="shell-spacer" />
      {manageUrl && (
        <a className="btn ghost" href={manageUrl} target="_blank" rel="noreferrer noopener">
          Manage on GitHub
        </a>
      )}
      {canWrite && linked && (
        <button className="btn ghost" disabled={busy} onClick={onUnlink}>
          Unlink
        </button>
      )}
      {canWrite && (
        <button className="btn ghost" disabled={busy} onClick={onDisconnect}>
          Disconnect
        </button>
      )}
    </div>
  );
}

/** Pick one of the repositories the installation can see. */
function RepositoryPicker({
  currentId,
  onClose,
  onLink,
}: {
  currentId: number | null;
  onClose: () => void;
  onLink: (repoId: number) => Promise<void>;
}) {
  const repos = useLoad(() => listRepositories(), []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(currentId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = repos.data ?? [];
    const q = query.trim().toLowerCase();
    return q ? list.filter((r) => r.full_name.toLowerCase().includes(q)) : list;
  }, [repos.data, query]);

  const save = async () => {
    if (selected === null) return;
    setSaving(true);
    setError(null);
    try {
      await onLink(selected);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      title="Link repository"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving || selected === null} onClick={save}>
            {saving ? "Linking…" : "Link"}
          </button>
        </>
      }
    >
      <Field label="Search">
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="owner/name"
        />
      </Field>

      {repos.loading ? (
        <div className="muted">Loading repositories…</div>
      ) : repos.error ? (
        <div className="status-banner warn">{repos.error}</div>
      ) : filtered.length === 0 ? (
        <div className="muted">
          {(repos.data ?? []).length === 0
            ? "The installation can see no repositories."
            : "No repository matches that search."}
        </div>
      ) : (
        <div className="repo-list">
          {filtered.map((repo) => (
            <button
              type="button"
              key={repo.id}
              className={`repo-option${repo.id === selected ? " selected" : ""}`}
              onClick={() => setSelected(repo.id)}
            >
              <span className="repo-option-name">
                {repo.full_name}
                {repo.private && <span className="badge">private</span>}
              </span>
              {repo.description && <span className="muted">{repo.description}</span>}
            </button>
          ))}
        </div>
      )}

      {error && <div className="status-banner warn">{error}</div>}
    </Drawer>
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
