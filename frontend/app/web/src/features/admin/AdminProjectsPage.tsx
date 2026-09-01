// Super admin: every project on the platform, whichever organisation owns it.
// Oversight rather than management -- editing a project still happens inside
// its own organisation, which is what opening one here switches you to.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../../app/session";
import { errorMessage } from "../../core/api";
import { useLoad } from "../../core/useLoad";
import { AdminProject, listAllProjects, projectPath } from "../projects/projectsApi";

export function AdminProjectsPage() {
  const projects = useLoad(listAllProjects, []);
  const { selectOrg } = useSession();
  const [error, setError] = useState<string | null>(null);

  // A project opens in its own tab under its organisation's URL; the
  // ProjectLayout there resolves the scope from the URL, so nothing has to
  // be switched here first. Selecting the organisation just keeps this tab's
  // sidebar in step.
  const open = async (project: AdminProject) => {
    setError(null);
    try {
      await selectOrg(project.account_id);
      window.open(projectPath(project.account_id, project.id), "_blank", "noopener");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const all = projects.data ?? [];
  const active = all.filter((p) => p.status === "active").length;

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Projects</h1>
        <span className="sub">
          {all.length} across the platform{all.length > 0 && ` · ${active} active`}
        </span>
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
