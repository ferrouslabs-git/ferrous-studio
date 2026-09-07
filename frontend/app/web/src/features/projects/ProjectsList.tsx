// The projects list, shared by an organisation's own list and the platform-wide
// admin one. One row per project showing its current version, with the older
// versions expanding beneath it and carrying their own controls.
//
// Both listings return every version as its own row -- a version *is* a project
// row -- so both need the same grouping, the same expander, the same drawers
// and the same rules about which controls a frozen version may still offer. The
// only differences are the admin listing naming an organisation per row, and
// having to say which organisation each call runs against: `optsOf`.
import { FormEvent, ReactNode, useMemo, useState } from "react";
import { ConfirmDrawer } from "../../components/ConfirmDrawer";
import { Drawer, Field } from "../../components/Drawer";
import { NameCell } from "../../components/ListTable";
import { RowMenu, RowMenuItem } from "../../components/RowMenu";
import { errorMessage, RequestOptions } from "../../core/api";
import { formatDate } from "../../core/format";
import { ProjectFormDrawer } from "./ProjectFormDrawer";
import {
  createProjectVersion,
  deleteProject,
  Project,
  unlockProject,
  updateProject,
} from "./projectsApi";

/** A project and every version of it, newest version first. */
export interface Lineage<P extends Project = Project> {
  head: P;
  versions: P[];
}

/**
 * Group a flat project list by lineage.
 *
 * A version is just another project row, so the raw list contains every
 * version of every project. The list shows the newest version of each as the
 * project's own row and the rest expand beneath it, which keeps the list about
 * projects rather than history.
 */
export function toLineages<P extends Project>(projects: P[]): Lineage<P>[] {
  const byLineage = new Map<string, P[]>();
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
export function versionTitle(project: Project): string {
  return `v${project.version_no}${project.version_label ? ` · ${project.version_label}` : ""}`;
}

export interface ProjectsListProps<P extends Project> {
  lineages: Lineage<P>[];
  canWrite: boolean;
  loading?: boolean;
  error?: string | null;
  /** Shown in place of the table when there are no rows. */
  empty: ReactNode;
  /** Re-read the listing after a change. */
  reload: () => Promise<unknown>;
  /** Where a version opens. */
  hrefOf: (project: P) => string;
  /** Opening needs work first (the admin listing switches organisation). */
  onOpen?: (project: P) => void;
  /** An extra column after the project, for the platform-wide listing. */
  orgColumn?: { header: string; render: (project: P) => ReactNode };
  /**
   * Which organisation a row's calls run against, when not the active one.
   *
   * A platform admin resolves a scope context for any organisation without
   * being a member of it, which is what lets the admin listing act on a row
   * without first switching the whole session over to its organisation.
   */
  optsOf?: (project: P) => RequestOptions | undefined;
}

export function ProjectsList<P extends Project>({
  lineages,
  canWrite,
  loading,
  error: loadError,
  empty,
  reload,
  hrefOf,
  onOpen,
  orgColumn,
  optsOf,
}: ProjectsListProps<P>) {
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<P | null>(null);
  const [relabelling, setRelabelling] = useState<P | null>(null);
  const [versionOf, setVersionOf] = useState<P | null>(null);
  const [deleting, setDeleting] = useState<P | null>(null);
  const optsFor = (project: P) => (optsOf ? optsOf(project) : undefined);

  const run = (project: P, call: (opts?: RequestOptions) => Promise<unknown>) => {
    setError(null);
    void (async () => {
      try {
        await call(optsFor(project));
        await reload();
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  };

  // How many versions the project being deleted has, so the drawer can say
  // whether the rest of the lineage survives it.
  const deletingSiblings = deleting
    ? lineages.find((l) => l.head.lineage_id === deleting.lineage_id)?.versions.length ?? 1
    : 1;

  const actions: LineageActions<P> = {
    run,
    onEdit: setEditing,
    onRelabel: setRelabelling,
    onNewVersion: setVersionOf,
    onDelete: setDeleting,
  };

  return (
    <>
      {error && <div className="status-banner warn">{error}</div>}

      <section className="section list-panel">
        {loading ? (
          <div className="empty">Loading…</div>
        ) : loadError ? (
          <div className="empty error">{loadError}</div>
        ) : lineages.length === 0 ? (
          <div className="empty">{empty}</div>
        ) : (
          <table className="data-table list-table">
            <thead>
              <tr>
                {/* The expander column carries no heading of its own. */}
                <th className="expand" />
                <th>Project</th>
                {orgColumn && <th>{orgColumn.header}</th>}
                <th>Version</th>
                <th>Status</th>
                <th>Updated</th>
                {/* Unlabelled: the heading would be twice the width of the "⋯"
                    column it names, and each button says which version it acts
                    on in its own accessible name. */}
                {canWrite && <th className="actions" />}
              </tr>
            </thead>
            {lineages.map((lineage) => (
              <LineageRows
                key={lineage.head.lineage_id}
                lineage={lineage}
                canWrite={canWrite}
                hrefOf={hrefOf}
                onOpen={onOpen}
                orgColumn={orgColumn}
                actions={actions}
              />
            ))}
          </table>
        )}
      </section>

      <ProjectFormDrawer
        open={editing !== null}
        project={editing}
        opts={editing ? optsFor(editing) : undefined}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />

      {relabelling && (
        <RenameVersionDrawer
          key={relabelling.id}
          project={relabelling}
          opts={optsFor(relabelling)}
          onClose={() => setRelabelling(null)}
          onSaved={reload}
        />
      )}

      {versionOf && (
        <NewVersionDrawer
          key={versionOf.id}
          project={versionOf}
          opts={optsFor(versionOf)}
          onClose={() => setVersionOf(null)}
          onSaved={reload}
        />
      )}

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete version"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteProject(deleting.id, optsFor(deleting));
          await reload();
        }}
      >
        {deleting && (
          <>
            <p>
              Permanently delete <b>{deleting.name}</b>
              {deletingSiblings > 1 ? ` ${versionTitle(deleting)}` : ""}? Its personas, use cases, diagrams,
              wireframes and documents go with it. This cannot be undone.
            </p>
            {deletingSiblings > 1 && <p className="muted">Other versions of this project are not affected.</p>}
          </>
        )}
      </ConfirmDrawer>
    </>
  );
}

/**
 * Rename one version.
 *
 * Separate from editing the project because they are different things: the
 * name, description and rationale belong to the project and are part of what a
 * version froze, while the label names this version within the lineage and
 * stays editable even while it is locked -- a frozen version is exactly the one
 * someone later wants to call "As signed off".
 */
function RenameVersionDrawer<P extends Project>({
  project,
  opts,
  onClose,
  onSaved,
}: {
  project: P;
  opts?: RequestOptions;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [label, setLabel] = useState(project.version_label ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = label.trim() || null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateProject(project.id, { version_label: next }, opts);
      onClose();
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      title="Rename version"
      description={`v${project.version_no} of ${project.name}.`}
      onClose={onClose}
      onSubmit={save}
      width={420}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving || next === (project.version_label ?? null)}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <Field label="Label">
        <input
          className="input"
          placeholder="e.g. Post-review"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>
      {error && <div className="status-banner warn">{error}</div>}
    </Drawer>
  );
}

/**
 * Copy a version into a new one.
 *
 * The idempotency key is minted when the drawer opens rather than when the
 * request is sent, so a retry after a timeout reuses it and the server returns
 * the version it already made instead of copying the project twice.
 */
function NewVersionDrawer<P extends Project>({
  project,
  opts,
  onClose,
  onSaved,
}: {
  project: P;
  opts?: RequestOptions;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [label, setLabel] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createProjectVersion(project.id, { key, label: label.trim() || null }, opts);
      onClose();
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      title="New version"
      description={
        `Copies everything in ${project.name} — personas, use cases, diagrams, wireframes and documents — ` +
        (project.locked_at !== null
          ? `into a new version branched from ${versionTitle(project)}, which stays frozen.`
          : `into a new version. ${versionTitle(project)} is locked so it stays a record of what was agreed.`)
      }
      onClose={onClose}
      onSubmit={save}
      width={420}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving}>
            {saving ? "Copying…" : "Create version"}
          </button>
        </>
      }
    >
      <Field label="Label">
        <input
          className="input"
          placeholder="e.g. Post-review"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>
      {error && <div className="status-banner warn">{error}</div>}
    </Drawer>
  );
}

interface LineageActions<P extends Project> {
  run: (project: P, call: (opts?: RequestOptions) => Promise<unknown>) => void;
  onEdit: (project: P) => void;
  onRelabel: (project: P) => void;
  onNewVersion: (project: P) => void;
  onDelete: (project: P) => void;
}

/**
 * The one word the list says about a version.
 *
 * A version can be archived and locked at once, but the column says one thing:
 * archived first, because an archived version is out of the way whether or not
 * it is frozen; then locked, which is what matters about a version still in
 * play. The lock is never lost -- the menu offers Unlock wherever one applies.
 */
export function versionStatus(project: Project): { label: string; tone: string; detail?: string } {
  const locked = project.locked_at !== null;
  if (project.status === "archived") {
    return { label: "Archived", tone: "muted", detail: locked ? "Archived and locked" : undefined };
  }
  if (locked) return { label: "Locked", tone: "accent" };
  return { label: "Active", tone: "good" };
}

function StatusBadge({ project }: { project: Project }) {
  const { label, tone, detail } = versionStatus(project);
  return (
    <span className={`badge ${tone}`} title={detail}>
      {label}
    </span>
  );
}

/**
 * The controls one version offers, current or old.
 *
 * Which of them appear is dictated by the server rather than by taste: a locked
 * version accepts only its name, label and status, and DELETE refuses it with a
 * 423 -- so Delete waits until a version is both archived and unlocked, and
 * Unlock is offered wherever a lock is in the way. Branching from a frozen
 * version is explicitly allowed, so New version needs no such guard.
 */
function menuItems<P extends Project>(project: P, isHead: boolean, a: LineageActions<P>): RowMenuItem[] {
  const archived = project.status === "archived";
  const locked = project.locked_at !== null;
  const items: RowMenuItem[] = [];
  // The description and rationale belong to the project, so they are edited
  // from the project's own row rather than from each version beneath it.
  if (isHead) items.push({ label: "Edit details", onSelect: () => a.onEdit(project) });
  items.push({ label: "Rename version", onSelect: () => a.onRelabel(project) });
  items.push({ label: "New version", onSelect: () => a.onNewVersion(project) });
  if (locked) {
    items.push({ label: "Unlock", onSelect: () => a.run(project, (o) => unlockProject(project.id, o)) });
  }
  items.push({
    label: archived ? "Restore" : "Archive",
    onSelect: () =>
      a.run(project, (o) => updateProject(project.id, { status: archived ? "active" : "archived" }, o)),
  });
  if (archived && !locked) items.push({ label: "Delete", danger: true, onSelect: () => a.onDelete(project) });
  return items;
}

/**
 * One project as a group of rows: its current version, then -- once expanded --
 * every older version beneath it.
 *
 * A <tbody> per lineage rather than loose rows, so the group is a single unit
 * to the browser and to assistive technology, and so the boundary between one
 * project and the next survives however many versions are showing.
 */
function LineageRows<P extends Project>({
  lineage,
  canWrite,
  hrefOf,
  onOpen,
  orgColumn,
  actions,
}: {
  lineage: Lineage<P>;
  canWrite: boolean;
  hrefOf: (project: P) => string;
  onOpen?: (project: P) => void;
  orgColumn?: { header: string; render: (project: P) => ReactNode };
  actions: LineageActions<P>;
}) {
  const { head, versions } = lineage;
  const older = versions.slice(1);
  const [expanded, setExpanded] = useState(false);
  // Versions branch rather than chain, so a parent is looked up by id rather
  // than assumed to be the version numbered one below.
  const byId = useMemo(() => new Map(versions.map((v) => [v.id, v])), [versions]);
  const parentOf = (version: P) => {
    const parent = version.parent_project_id ? byId.get(version.parent_project_id) : null;
    return parent ? `from v${parent.version_no}` : "original";
  };

  // The project name and every version title open that version. Opening can
  // need work first (the admin listing switches organisation), so it is a
  // button then rather than a link.
  const opener = (project: P) => (onOpen ? { onOpen: () => onOpen(project) } : { to: hrefOf(project) });

  const rowMenu = (project: P, isHead: boolean) =>
    canWrite ? (
      <td className="actions">
        <RowMenu label={`Actions for ${versionTitle(project)}`} items={menuItems(project, isHead, actions)} />
      </td>
    ) : null;

  return (
    <tbody className={expanded ? "lineage expanded" : "lineage"}>
      <tr>
        <td className="expand">
          {older.length > 0 && (
            <button
              type="button"
              className="row-toggle"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Hide" : "Show"} older versions of ${head.name}`}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "▾" : "▸"}
            </button>
          )}
        </td>
        <td className="primary">
          <NameCell sub={head.description} {...opener(head)}>
            {head.name}
          </NameCell>
        </td>
        {orgColumn && <td className="nowrap">{orgColumn.render(head)}</td>}
        <td>
          <span className="badge accent">{versionTitle(head)}</span>
        </td>
        <td>
          <StatusBadge project={head} />
        </td>
        <td className="muted when">{formatDate(head.updated_at)}</td>
        {rowMenu(head, true)}
      </tr>

      {expanded &&
        older.map((version) => (
          <tr key={version.id} className="version-row">
            <td className="expand" />
            <td className="primary sub-name">
              <NameCell {...opener(version)}>{versionTitle(version)}</NameCell>
            </td>
            {orgColumn && <td />}
            <td className="muted">{parentOf(version)}</td>
            <td>
              <StatusBadge project={version} />
            </td>
            <td className="muted when">{formatDate(version.updated_at)}</td>
            {rowMenu(version, false)}
          </tr>
        ))}
    </tbody>
  );
}
