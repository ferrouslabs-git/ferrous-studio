// Super admin: every project on the platform, whichever organisation owns it.
// Oversight rather than management -- editing a project still happens inside
// its own organisation, which is what opening one here switches you to.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSession } from "../../app/session";
import { errorMessage } from "../../core/api";
import { useLoad } from "../../core/useLoad";
import { AdminProject, listAllProjects, projectPath } from "../projects/projectsApi";

export function AdminProjectsPage() {
  const projects = useLoad(listAllProjects, []);
  const [showAllVersions, setShowAllVersions] = useState(false);
  const { selectOrg } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // Opening a project switches this session to its organisation first, so the
  // sidebar and scope stay in step with the project's URL.
  const open = async (project: AdminProject) => {
    setError(null);
    try {
      await selectOrg(project.account_id);
      navigate(projectPath(project.account_id, project.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const everything = projects.data ?? [];
  // Every version is a project row, so without this the table grows a row each
  // time anyone versions anything. Newest version per project by default.
  const newest = useMemo(() => {
    const heads = new Map<string, (typeof everything)[number]>();
    for (const project of everything) {
      const current = heads.get(project.lineage_id);
      if (!current || project.version_no > current.version_no) heads.set(project.lineage_id, project);
    }
    return [...heads.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [everything]);
  const all = showAllVersions ? everything : newest;
  const active = all.filter((p) => p.status === "active").length;
  const hidden = everything.length - newest.length;

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Projects</h1>
        <span className="sub">
          {all.length} across the platform{all.length > 0 && ` · ${active} active`}
        </span>
        {hidden > 0 && (
          <>
            <span className="shell-spacer" />
            <button className="btn small ghost" onClick={() => setShowAllVersions((v) => !v)}>
              {showAllVersions ? "Newest versions only" : `Show all versions (${hidden} older)`}
            </button>
          </>
        )}
      </div>

      {error && <div className="status-banner warn">{error}</div>}

      <section className="section">
        {projects.loading ? (
          <div className="empty">Loading…</div>
        ) : projects.error ? (
          <div className="empty error">{projects.error}</div>
        ) : all.length === 0 ? (
          <div className="empty">
            <b>No projects yet.</b> They appear here as soon as any organisation creates one.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Organisation</th>
                <th>Description</th>
                <th>Version</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {all.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button className="btn small ghost" onClick={() => void open(p)}>
                      {p.name}
                    </button>
                  </td>
                  <td>
                    <Link to={`/orgs/${p.account_id}/projects`}>{p.account_name}</Link>
                  </td>
                  <td className="muted">{p.description || "—"}</td>
                  <td className="muted">
                    v{p.version_no}
                    {p.locked_at !== null && <span className="badge">locked</span>}
                  </td>
                  <td>
                    <span className={`badge ${p.status === "active" ? "good" : ""}`}>{p.status}</span>
                  </td>
                  <td className="muted">{new Date(p.updated_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
