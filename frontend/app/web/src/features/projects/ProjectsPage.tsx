// Projects in the active organisation. Viewers get a read-only list; writers can
// create, rename, archive and delete. Write affordances are hidden for
// viewers but the server enforces data:write regardless.
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { useLoad } from "../../core/useLoad";
import { createProject, deleteProject, listProjects, Project, projectPath, updateProject } from "./projectsApi";

export function ProjectsPage() {
  const { orgId } = useParams();
  const { activeOrg, canWrite, selectOrg } = useSession();

  // The URL names an organisation; make it the active one if it is not already
  // (deep links, back/forward). The sidebar switcher navigates here itself.
  useEffect(() => {
    if (orgId && activeOrg && orgId !== activeOrg.id) void selectOrg(orgId);
  }, [orgId, activeOrg, selectOrg]);

  const projects = useLoad(async () => (activeOrg ? listProjects() : []), [activeOrg?.id]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rationale, setRationale] = useState("");
  const [editing, setEditing] = useState<Project | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">("active");

  const openDrawer = (project: Project | null) => {
    setEditing(project);
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setRationale(project?.rationale ?? "");
    setFormError(null);
    setDrawerOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      rationale: rationale.trim() || null,
    };
    try {
      if (editing) {
        await updateProject(editing.id, body);
      } else {
        await createProject(body);
      }
      setDrawerOpen(false);
      await projects.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const unchanged =
    editing !== null &&
    name.trim() === editing.name &&
    description.trim() === (editing.description ?? "") &&
    rationale.trim() === (editing.rationale ?? "");

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await projects.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!activeOrg) {
    return (
      <div className="page">
        <div className="empty">No organisation selected. Ask an administrator to add you to one.</div>
      </div>
    );
  }

  const all = projects.data ?? [];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q);
    });
  }, [all, query, statusFilter]);
  const filtered = query.trim() !== "" || statusFilter !== "active";

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Projects</h1>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={() => openDrawer(null)}>
            New project
          </button>
        )}
      </div>

      <div className="toolbar">
        <input
          className="input search"
          type="search"
          placeholder="Search by name or description"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search projects"
        />
        <select
          className="select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "active" | "archived" | "all")}
          aria-label="Filter by status"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        {filtered && (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              setQuery("");
              setStatusFilter("active");
            }}
          >
            Clear
          </button>
        )}
        <span className="muted" style={{ fontSize: 12 }}>
          {filtered ? `${visible.length} of ${all.length}` : all.length}
        </span>
      </div>

      {error && <div className="status-banner warn">{error}</div>}

      <Drawer
        open={drawerOpen}
        title={editing ? "Edit project" : "New project"}
        description={editing ? "Pages and components are unaffected." : undefined}
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setDrawerOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !name.trim() || unchanged}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create project"}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input
            className="input"
            required
            placeholder="e.g. Customer portal"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Description" hint="Optional. Shown on the project card.">
          <textarea
            className="input textarea"
            rows={3}
            placeholder="What this project covers"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Rationale" hint="Why the project exists: the problem, the outcome sought. Editable later in Project details.">
          <textarea
            className="input textarea"
            rows={4}
            placeholder="e.g. Supplier invoices take three systems and a week to approve; we want same-day approval in one place."
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      {projects.loading ? (
        <div className="empty">Loading…</div>
      ) : projects.error ? (
        <div className="empty error">{projects.error}</div>
      ) : visible.length === 0 && filtered ? (
        <div className="empty">No projects match these filters.</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <b>No projects yet.</b> {canWrite ? "Create one to start wireframing." : "Nothing has been shared with you here."}
        </div>
      ) : (
        <div className="card-grid">
          {visible.map((p) => (
            <ProjectCard key={p.id} project={p} orgId={activeOrg.id} canWrite={canWrite} act={act} onEdit={() => openDrawer(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

// British date, independent of the browser locale: "27 Aug 2026".
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function ProjectCard({
  project,
  orgId,
  canWrite,
  act,
  onEdit,
}: {
  project: Project;
  orgId: string;
  canWrite: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onEdit: () => void;
}) {
  const archived = project.status === "archived";
  // A project is its own workspace, so it opens in a new tab; the list stays.
  const href = projectPath(orgId, project.id);
  return (
    <div className="card project">
      <Link to={href} target="_blank" rel="noopener" style={{ color: "inherit", textDecoration: "none" }}>
        <h3>{project.name}</h3>
      </Link>
      <p>{project.description || "No description"}</p>
      <div className="card-foot">
        {archived && <span className="badge">archived</span>}
        <span className="muted when">Updated {formatDate(project.updated_at)}</span>
        <div className="card-actions">
          <Link to={href} target="_blank" rel="noopener" className="btn small" title="Opens in a new tab">
            Open ↗
          </Link>
          {canWrite && (
            <>
              <button className="btn small ghost" onClick={onEdit}>
                Edit
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
    </div>
  );
}
