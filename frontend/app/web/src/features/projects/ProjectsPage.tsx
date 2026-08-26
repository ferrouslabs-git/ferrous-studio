// Projects in the active workspace. Viewers get a read-only list; writers can
// create, rename, archive and delete. Write affordances are hidden for
// viewers but the server enforces data:write regardless.
import { FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { errorMessage } from "../../core/api";
import { useLoad } from "../../core/useLoad";
import { createProject, deleteProject, listProjects, Project, updateProject } from "./projectsApi";

export function ProjectsPage() {
  const { orgId } = useParams();
  const { activeOrg, activeSpace, spaces, canWrite, selectOrg } = useSession();

  // The URL names an organisation; make it the active one if it is not already.
  if (orgId && activeOrg && orgId !== activeOrg.id) {
    void selectOrg(orgId);
  }

  const projects = useLoad(async () => (activeSpace ? listProjects() : []), [activeSpace?.id]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createProject(name.trim());
      setName("");
      await projects.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await projects.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!activeSpace) {
    return (
      <div className="page">
        <div className="empty">
          No workspace yet. {canWrite ? <Link to={`/orgs/${activeOrg?.id}`}>Create one in the organisation settings.</Link> : "Ask an organisation admin to add you to one."}
        </div>
      </div>
    );
  }

  const visible = (projects.data ?? []).filter((p) => showArchived || p.status === "active");

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Projects</h1>
        <span className="sub">
          {activeSpace.name}
          {spaces.length > 1 && " workspace"}
        </span>
        <span className="shell-spacer" />
        <label className="row muted" style={{ fontSize: 12 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {canWrite && (
        <form className="row" onSubmit={create}>
          <input
            className="input"
            required
            placeholder="New project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn primary">Create project</button>
        </form>
      )}
      {error && <div className="status-banner warn">{error}</div>}

      {projects.loading ? (
        <div className="empty">Loading…</div>
      ) : projects.error ? (
        <div className="empty error">{projects.error}</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <b>No projects yet.</b> {canWrite ? "Create one above to start wireframing." : "Nothing has been shared with you here."}
        </div>
      ) : (
        <div className="card-grid">
          {visible.map((p) => (
            <ProjectCard key={p.id} project={p} canWrite={canWrite} act={act} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  canWrite,
  act,
}: {
  project: Project;
  canWrite: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const archived = project.status === "archived";
  return (
    <div className="card">
      <Link to={`/projects/${project.id}`} style={{ color: "inherit", textDecoration: "none" }}>
        <h3>{project.name}</h3>
      </Link>
      <p>{project.description || "No description"}</p>
      <div className="meta">
        {archived && <span className="badge">archived</span>}
        <span className="muted" style={{ fontSize: 11 }}>
          Updated {new Date(project.updated_at).toLocaleDateString()}
        </span>
        <span className="shell-spacer" />
        <Link to={`/projects/${project.id}`} className="btn small">
          Open
        </Link>
        {canWrite && (
          <>
            <button
              className="btn small ghost"
              title="Rename"
              onClick={() => {
                const next = prompt("Project name", project.name);
                if (next && next.trim() && next.trim() !== project.name) {
                  void act(() => updateProject(project.id, { name: next.trim() }));
                }
              }}
            >
              Rename
            </button>
            <button
              className="btn small ghost"
              onClick={() => void act(() => updateProject(project.id, { status: archived ? "active" : "archived" }))}
            >
              {archived ? "Restore" : "Archive"}
            </button>
            {archived && (
              <button
                className="btn small ghost"
                onClick={() => {
                  if (confirm(`Permanently delete "${project.name}"? This cannot be undone.`)) {
                    void act(() => deleteProject(project.id));
                  }
                }}
              >
                Delete
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
