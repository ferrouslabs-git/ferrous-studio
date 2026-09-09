// The Repository section of the project details page: point this project at
// one repository through the organisation's GitHub connection.
//
// Connecting the organisation itself lives on Organisation ▸ GitHub now (see
// features/orgs/OrgGitHubPage.tsx) -- this section only offers to link,
// change or unlink, and says where to go when there is nothing to link yet.
import { useCallback, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { formatDateTime } from "../../core/format";
import { useLoad } from "../../core/useLoad";
import {
  ProjectRepository,
  getConnection,
  getProjectRepository,
  linkRepository,
  listRepositories,
  unlinkRepository,
} from "../orgs/githubApi";
import { useProject } from "./ProjectLayout";

export function RepositorySection() {
  const { project, reload } = useProject();
  const { orgId = "" } = useParams();
  // Lock-exempt, like the backend routes: which repository a project builds
  // into is filing, not content, so a locked version stays changeable here
  // even though useProject().canWrite is narrowed by the lock.
  const { canWrite, canManageIntegrations } = useSession();

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

  return (
    <section className="section">
      <div className="section-head">
        <h2>Repository</h2>
        <span className="shell-spacer" />
        {canWrite && connection.data?.connected && (
          <>
            <button className="btn ghost" disabled={busy} onClick={() => setPicking(true)}>
              {project.repo_id ? "Change" : "Link repository"}
            </button>
            {project.repo_id && (
              <button className="btn ghost" disabled={busy} onClick={() => run(() => unlinkRepository(project.id))}>
                Unlink
              </button>
            )}
          </>
        )}
      </div>

      <div className="section-body stack">
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
            {canManageIntegrations && (
              <Link className="btn ghost" to={`/orgs/${orgId}/github`}>
                Connect under Organisation
              </Link>
            )}
          </div>
        ) : (
          <>
            <RepositoryDetail repository={repository.data} loading={repository.loading} />
            <ConnectionFooter
              login={connection.data.account_login}
              selection={connection.data.repository_selection}
              manageUrl={connection.data.manage_url}
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

/** Which GitHub account this project reads through -- connecting and
 *  disconnecting that account happens on the organisation's own page. */
function ConnectionFooter({
  login,
  selection,
  manageUrl,
}: {
  login: string | null;
  selection: string | null;
  manageUrl: string | null;
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
