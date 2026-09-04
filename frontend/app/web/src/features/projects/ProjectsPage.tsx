// Projects in the active organisation. Viewers get a read-only list; writers can
// create, rename, archive and delete. Write affordances are hidden for
// viewers but the server enforces data:write regardless.
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { ConfirmDrawer } from "../../components/ConfirmDrawer";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { useLoad } from "../../core/useLoad";
import {
  createProject,
  createProjectVersion,
  deleteProject,
  listProjects,
  Project,
  projectPath,
  updateProject,
} from "./projectsApi";

/** A project and every version of it, newest version first. */
interface Lineage {
  head: Project;
  versions: Project[];
}

/**
 * Group the flat project list by lineage.
 *
 * A version is just another project row, so the raw list contains every
 * version of every project. The card shows the newest version of each and the
 * rest hang off it, which keeps the list about projects rather than history.
 */
function toLineages(projects: Project[]): Lineage[] {
  const byLineage = new Map<string, Project[]>();
  for (const project of projects) {
    const group = byLineage.get(project.lineage_id);
    if (group) group.push(project);
    else byLineage.set(project.lineage_id, [project]);
  }
  return [...byLineage.values()]
    .map((group) => {
      const versions = [...group].sort((a, b) => b.version_no - a.version_no);
      return { head: versions[0], versions };
    })
    .sort((a, b) => b.head.updated_at.localeCompare(a.head.updated_at));
}

/** "v3" or "v3 · Post-review", matching how wireframe snapshots read. */
function versionTitle(project: Project): string {
  return `v${project.version_no}${project.version_label ? ` · ${project.version_label}` : ""}`;
}

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
  // Versioning: the source project, the label, and the idempotency key. The key
  // is minted when the drawer opens, not when the request is sent, so a retry
  // after a timeout reuses it and the server returns the version it already
  // made instead of copying the project twice.
  const [versionOf, setVersionOf] = useState<Project | null>(null);
  const [versionLabel, setVersionLabel] = useState("");
  const [versionKey, setVersionKey] = useState("");
  const [versioning, setVersioning] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);

  const openDrawer = (project: Project | null) => {
    setEditing(project);
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setRationale(project?.rationale ?? "");
    setFormError(null);
    setDrawerOpen(true);
  };

  const openVersionDrawer = (project: Project) => {
    setVersionOf(project);
    setVersionLabel("");
    setVersionKey(crypto.randomUUID());
    setVersionError(null);
  };

  const createVersion = async (e: FormEvent) => {
    e.preventDefault();
    if (!versionOf) return;
    setVersioning(true);
    setVersionError(null);
    try {
      await createProjectVersion(versionOf.id, { key: versionKey, label: versionLabel.trim() || null });
      setVersionOf(null);
      await projects.reload();
    } catch (err) {
      setVersionError(errorMessage(err));
    } finally {
      setVersioning(false);
    }
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

  const all = projects.data ?? [];
  const lineages = useMemo(() => toLineages(all), [all]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    // A lineage shows if any of its versions matches: searching for a project
    // should find it whichever version happens to be newest.
    return lineages.filter(({ versions }) =>
      versions.some((p) => {
        if (statusFilter !== "all" && p.status !== statusFilter) return false;
        if (!q) return true;
        return p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q);
      }),
    );
  }, [lineages, query, statusFilter]);
  const filtered = query.trim() !== "" || statusFilter !== "active";

  // After the hooks, never before: an early return above them would change the
  // hook count between renders the moment the active organisation clears.
  if (!activeOrg) {
    return (
      <div className="page">
        <div className="empty">No organisation selected. Ask an administrator to add you to one.</div>
      </div>
    );
  }

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
          {filtered ? `${visible.length} of ${lineages.length}` : lineages.length}
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

      <Drawer
        open={versionOf !== null}
        title="New version"
        description={
          versionOf
            ? `Copies everything in ${versionOf.name} — personas, use cases, diagrams, wireframes and documents — into a new version. ${versionTitle(versionOf)} is locked so it stays a record of what was agreed.`
            : undefined
        }
        onClose={() => setVersionOf(null)}
        onSubmit={createVersion}
        width={420}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setVersionOf(null)} disabled={versioning}>
              Cancel
            </button>
            <button className="btn primary" disabled={versioning}>
              {versioning ? "Copying…" : "Create version"}
            </button>
          </>
        }
      >
        <Field label="Label">
          <input
            className="input"
            placeholder="e.g. Post-review"
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
          />
        </Field>
        {versionError && <div className="status-banner warn">{versionError}</div>}
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
          {visible.map((lineage) => (
            <ProjectCard
              key={lineage.head.lineage_id}
              lineage={lineage}
              orgId={activeOrg.id}
              canWrite={canWrite}
              act={act}
              onEdit={() => openDrawer(lineage.head)}
              onNewVersion={() => openVersionDrawer(lineage.head)}
            />
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
  lineage,
  orgId,
  canWrite,
  act,
  onEdit,
  onNewVersion,
}: {
  lineage: Lineage;
  orgId: string;
  canWrite: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onEdit: () => void;
  onNewVersion: () => void;
}) {
  const { head, versions } = lineage;
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const archived = head.status === "archived";
  const locked = head.locked_at !== null;
  const href = projectPath(orgId, head.id);
  const older = versions.slice(1);

  return (
    <div className="card project">
      <Link to={href} style={{ color: "inherit", textDecoration: "none" }}>
        <h3>{head.name}</h3>
      </Link>
      <p>{head.description || "No description"}</p>

      {older.length > 0 && (
        <div className="version-list">
          <button type="button" className="btn small ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide" : "Show"} {versions.length} versions
          </button>
          {expanded &&
            versions.map((version) => (
              <Link key={version.id} to={projectPath(orgId, version.id)} className="version-row">
                <b>{versionTitle(version)}</b>
                {version.id === head.id && <span className="badge">newest</span>}
                {version.locked_at !== null && <span className="badge">locked</span>}
                {version.status === "archived" && <span className="badge">archived</span>}
                <span className="muted when">Updated {formatDate(version.updated_at)}</span>
              </Link>
            ))}
        </div>
      )}

      <div className="card-foot">
        {archived && <span className="badge">archived</span>}
        {locked && <span className="badge">locked</span>}
        {versions.length > 1 && <span className="badge">{versionTitle(head)}</span>}
        <span className="muted when">Updated {formatDate(head.updated_at)}</span>
        <div className="card-actions">
          <Link to={href} className="btn small">
            Open
          </Link>
          {canWrite && (
            <>
              <button className="btn small ghost" onClick={onEdit}>
                Edit
              </button>
              <button className="btn small ghost" onClick={onNewVersion}>
                New version
              </button>
              <button
                className="btn small ghost"
                onClick={() => void act(() => updateProject(head.id, { status: archived ? "active" : "archived" }))}
              >
                {archived ? "Restore" : "Archive"}
              </button>
              {archived && (
                <button className="btn small ghost" onClick={() => setDeleting(true)}>
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDrawer
        open={deleting}
        title="Delete version"
        onClose={() => setDeleting(false)}
        onConfirm={() => act(() => deleteProject(head.id))}
      >
        <p>
          Permanently delete <b>{head.name}</b>
          {versions.length > 1 ? ` ${versionTitle(head)}` : ""}? Its personas, use cases, diagrams, wireframes and
          documents go with it. This cannot be undone.
        </p>
        {versions.length > 1 && <p className="muted">Other versions of this project are not affected.</p>}
      </ConfirmDrawer>
    </div>
  );
}
