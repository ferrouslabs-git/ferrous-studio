// A project's wireframes: name, user types and personas it is designed for,
// interface type. Opening one takes you into the studio.
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { RowMenu } from "../../../components/RowMenu";
import { errorMessage } from "../../../core/api";
import { formatDateTime } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { ImportBundleDrawer } from "../ImportBundleDrawer";
import { listPersonas } from "../personas/personasApi";
import { useProject } from "../ProjectLayout";
import { listActors } from "../usecases/useCasesApi";
import { snapshotNumbers, snapshotTitle } from "./snapshots";
import {
  copyWireframeVersion,
  createWireframe,
  deleteWireframe,
  getWireframeExport,
  INTERFACE_TYPES,
  InterfaceType,
  listWireframes,
  listWireframeVersions,
  ProjectVersion,
  restoreWireframeVersion,
  setWireframeActors,
  setWireframePersonas,
  updateWireframe,
  Wireframe,
} from "./wireframesApi";

export function WireframesPage() {
  const { project, orgId, canWrite } = useProject();
  const navigate = useNavigate();
  const location = useLocation();
  const data = useLoad(
    () => Promise.all([listWireframes(project.id), listPersonas(project.id), listActors(project.id)]),
    [project.id],
  );
  const [editing, setEditing] = useState<Wireframe | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">("active");
  const [name, setName] = useState("");
  const [interfaceType, setInterfaceType] = useState<InterfaceType>("desktop");
  const [personaIds, setPersonaIds] = useState<string[]>([]);
  const [actorIds, setActorIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Row actions outside the drawers (Copy JSON, Archive/Restore): success
  // feedback as a toast, failures in the banner.
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Snapshots drawer: which wireframe's history is open, its snapshots, and
  // the snapshot awaiting restore confirmation.
  const [snapsFor, setSnapsFor] = useState<Wireframe | null>(null);
  const [snaps, setSnaps] = useState<ProjectVersion[] | null>(null);
  const [snapsError, setSnapsError] = useState<string | null>(null);
  // Captured with its display title so the confirm text survives the
  // snapshot list being cleared while the drawers close.
  const [restoring, setRestoring] = useState<{ version: ProjectVersion; title: string } | null>(null);
  // Snapshot being copied into a wireframe of its own, and the copy's name.
  const [copying, setCopying] = useState<{ version: ProjectVersion; title: string } | null>(null);
  const [copyName, setCopyName] = useState("");
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  // Archived wireframe awaiting delete confirmation.
  const [deleting, setDeleting] = useState<Wireframe | null>(null);
  const [importing, setImporting] = useState(false);

  const [wireframes, personas, actors] = data.data ?? [[], [], []];
  const personaNames = useMemo(() => new Map(personas.map((p) => [p.id, p.name])), [personas]);
  const actorNames = useMemo(() => new Map(actors.map((a) => [a.id, a.name])), [actors]);
  const base = `/orgs/${orgId}/projects/${project.id}/wireframes`;

  // Matches the name and the linked user type/persona names -- the columns the
  // table shows.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return wireframes.filter((w) => {
      if (statusFilter !== "all" && w.status !== statusFilter) return false;
      if (!q) return true;
      const linked = [
        ...w.actor_ids.map((id) => actorNames.get(id) ?? ""),
        ...w.persona_ids.map((id) => personaNames.get(id) ?? ""),
      ];
      return [w.name, ...linked].some((s) => s.toLowerCase().includes(q));
    });
  }, [wireframes, actorNames, personaNames, query, statusFilter]);
  const previewTarget = wireframes.find((w) => w.status !== "archived") ?? wireframes[0];

  const openDrawer = (w: Wireframe | null) => {
    setEditing(w);
    setName(w?.name ?? "");
    setInterfaceType(w?.interface_type ?? "desktop");
    setPersonaIds(w?.persona_ids ?? []);
    setActorIds(w?.actor_ids ?? []);
    setFormError(null);
    setDrawerOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await updateWireframe(project.id, editing.id, { name: name.trim(), interface_type: interfaceType });
        await setWireframePersonas(project.id, editing.id, personaIds);
        await setWireframeActors(project.id, editing.id, actorIds);
      } else {
        await createWireframe(project.id, {
          name: name.trim(),
          interface_type: interfaceType,
          persona_ids: personaIds,
          actor_ids: actorIds,
        });
      }
      setDrawerOpen(false);
      await data.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const toast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg((cur) => (cur === msg ? null : cur)), 2200);
  };

  const copyJson = async (w: Wireframe) => {
    setActionError(null);
    try {
      const doc = await getWireframeExport(project.id, w.id);
      await navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
      toast(`Copied the JSON for "${w.name}"`);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  // Archiving is reversible (Restore brings it back), so no confirmation. The
  // toast matters here: with the filter on Active, an archived row vanishes.
  const toggleArchived = async (w: Wireframe) => {
    setActionError(null);
    const restoring = w.status === "archived";
    try {
      await updateWireframe(project.id, w.id, { status: restoring ? "active" : "archived" });
      await data.reload();
      toast(`${restoring ? "Restored" : "Archived"} "${w.name}"`);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  };

  const toggle = (id: string) => (ids: string[]) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const togglePersona = (id: string) => setPersonaIds(toggle(id));
  const toggleActor = (id: string) => setActorIds(toggle(id));

  const openSnapshots = (w: Wireframe) => {
    setSnapsFor(w);
    setSnaps(null);
    setSnapsError(null);
    listWireframeVersions(project.id, w.id)
      .then(setSnaps)
      .catch((err) => setSnapsError(errorMessage(err)));
  };

  const closeSnapshots = () => {
    setSnapsFor(null);
    setSnaps(null);
    setSnapsError(null);
  };

  // Exiting snapshot preview comes back here asking for that wireframe's
  // snapshots again, so the next one is a click away rather than three. The
  // request is consumed on arrival: a reload must not reopen the drawer.
  const reopenSnapshotsFor = (location.state as { snapshotsFor?: string } | null)?.snapshotsFor;
  useEffect(() => {
    const wireframe = reopenSnapshotsFor ? wireframes.find((w) => w.id === reopenSnapshotsFor) : null;
    if (!wireframe) return;
    navigate(location.pathname, { replace: true, state: null });
    openSnapshots(wireframe);
  }, [reopenSnapshotsFor, wireframes]); // eslint-disable-line react-hooks/exhaustive-deps

  const snapNumbers = useMemo(() => snapshotNumbers(snaps ?? []), [snaps]);
  const titleOf = (v: ProjectVersion) => snapshotTitle(v, snapNumbers.get(v.id));

  /** Preview one snapshot, handing over its number — the preview cannot work
   *  it out from a single snapshot (see snapshots.ts). */
  const previewSnapshot = (w: Wireframe, v: ProjectVersion) =>
    navigate(`${base}/${w.id}/snapshots/${v.id}/preview`, { state: { snapshotTitle: titleOf(v) } });

  const openCopy = (w: Wireframe, v: ProjectVersion) => {
    setCopying({ version: v, title: titleOf(v) });
    // Names are capped at 255 server-side, and this default is two of them.
    setCopyName(`${w.name} (${titleOf(v)})`.slice(0, 255));
    setCopyError(null);
  };

  const copySnapshot = async (e: FormEvent) => {
    e.preventDefault();
    if (!snapsFor || !copying) return;
    setCopyBusy(true);
    setCopyError(null);
    try {
      const created = await copyWireframeVersion(project.id, snapsFor.id, copying.version.id, copyName.trim());
      setCopying(null);
      closeSnapshots();
      await data.reload();
      toast(`Created "${created.name}" from ${copying.title}`);
    } catch (err) {
      setCopyError(errorMessage(err));
    } finally {
      setCopyBusy(false);
    }
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Wireframes</h1>
        <span className="shell-spacer" />
        {previewTarget && (
          <Link to={`${base}/${previewTarget.id}/preview`} className="btn">
            Preview mode
          </Link>
        )}
        {canWrite && (
          <button className="btn ghost" onClick={() => setImporting(true)}>
            Import…
          </button>
        )}
        {canWrite && (
          <button className="btn primary" onClick={() => openDrawer(null)}>
            New wireframe
          </button>
        )}
      </div>

      {importing && (
        <ImportBundleDrawer
          projectId={project.id}
          orgId={orgId}
          onClose={() => setImporting(false)}
          onImported={data.reload}
        />
      )}

      <div className="toolbar">
        <input
          className="input search"
          type="search"
          placeholder="Search by name, user type or persona"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search wireframes"
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
      </div>

      {actionError && (
        <div className="status-banner warn">
          {actionError}{" "}
          <button className="btn small ghost" onClick={() => setActionError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <section className="section">
        {data.loading ? (
          <div className="empty">Loading…</div>
        ) : data.error ? (
          <div className="empty error">{data.error}</div>
        ) : wireframes.length === 0 ? (
          <div className="empty">
            <b>No wireframes yet.</b> {canWrite ? "Create one to start laying out screens." : "Nothing here yet."}
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">No wireframes match the current search and filter.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>User types</th>
                <th>Personas</th>
                <th>Interface</th>
                <th>Status</th>
                <th>Updated</th>
                <th className="actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((w) => (
                <tr key={w.id}>
                  <td>
                    <Link to={`${base}/${w.id}`}>{w.name}</Link>
                  </td>
                  <td>
                    <NameChips ids={w.actor_ids} names={actorNames} />
                  </td>
                  <td>
                    <NameChips ids={w.persona_ids} names={personaNames} />
                  </td>
                  <td>
                    <span className="badge accent">{interfaceLabel(w.interface_type)}</span>
                  </td>
                  <td>
                    <span className={w.status === "archived" ? "badge" : "badge good"}>
                      {w.status === "archived" ? "Archived" : "Active"}
                    </span>
                  </td>
                  <td className="muted">{new Date(w.updated_at).toLocaleDateString()}</td>
                  <td className="actions">
                    <RowMenu
                      label={`Actions for ${w.name}`}
                      items={[
                        { label: "Open", onSelect: () => navigate(`${base}/${w.id}`) },
                        { label: "Preview", onSelect: () => navigate(`${base}/${w.id}/preview`) },
                        { label: "Copy JSON", onSelect: () => void copyJson(w) },
                        { label: "Snapshots", onSelect: () => openSnapshots(w) },
                        { label: "Audit log", onSelect: () => navigate(`${base}/${w.id}/audit`) },
                        ...(canWrite
                          ? [
                              { label: "Edit", onSelect: () => openDrawer(w) },
                              {
                                label: w.status === "archived" ? "Restore" : "Archive",
                                onSelect: () => void toggleArchived(w),
                              },
                              // Hard delete only once archived -- archiving is
                              // the reversible step in front of it.
                              ...(w.status === "archived"
                                ? [{ label: "Delete", onSelect: () => setDeleting(w), danger: true }]
                                : []),
                            ]
                          : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Drawer
        open={drawerOpen}
        title={editing ? "Edit wireframe" : "New wireframe"}
        description={editing ? "Pages are unaffected." : "Starts with a blank Home page."}
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setDrawerOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create wireframe"}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input className="input" required placeholder="e.g. Customer onboarding" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Interface type">
          <select className="select" value={interfaceType} onChange={(e) => setInterfaceType(e.target.value as InterfaceType)}>
            {INTERFACE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="User types"
          hint={
            actors.length
              ? "Which user types from the use case diagram this wireframe serves."
              : "No user types yet — add them in the Use case diagram section."
          }
        >
          <div className="check-list">
            {actors.map((a) => (
              <label key={a.id} className="check-item">
                <input type="checkbox" checked={actorIds.includes(a.id)} onChange={() => toggleActor(a.id)} />
                <span>{a.name}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Personas" hint={personas.length ? "Who this wireframe is designed for." : "No personas yet — add them in the Personas section."}>
          <div className="check-list">
            {personas.map((p) => (
              <label key={p.id} className="check-item">
                <input type="checkbox" checked={personaIds.includes(p.id)} onChange={() => togglePersona(p.id)} />
                <span>
                  {p.name}
                  {p.role && <span className="muted"> · {p.role}</span>}
                </span>
              </label>
            ))}
          </div>
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      <Drawer open={snapsFor !== null} title="Snapshots" description={snapsFor?.name} onClose={closeSnapshots} width={560}>
        {snapsError ? (
          <div className="status-banner warn">{snapsError}</div>
        ) : snaps === null ? (
          <div className="empty">Loading…</div>
        ) : snaps.length === 0 ? (
          <div className="empty">
            <b>No snapshots yet.</b>
            {canWrite && " Save one from the studio's top bar."}
          </div>
        ) : (
          <div className="snapshot-list">
            {snaps.map((v) => (
              <div key={v.id} className="snapshot-row">
                <div className="snapshot-name">
                  <b>{titleOf(v)}</b>
                  <span className="muted">{formatDateTime(v.created_at)}</span>
                </div>
                <div className="snapshot-actions">
                  <button className="btn small ghost" onClick={() => snapsFor && previewSnapshot(snapsFor, v)}>
                    Preview
                  </button>
                  {canWrite && (
                    <>
                      <button className="btn small ghost" onClick={() => setRestoring({ version: v, title: titleOf(v) })}>
                        Restore
                      </button>
                      <button className="btn small ghost" onClick={() => snapsFor && openCopy(snapsFor, v)}>
                        New wireframe
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      <ConfirmDrawer
        open={restoring !== null}
        title="Restore snapshot"
        confirmLabel="Restore"
        onClose={() => setRestoring(null)}
        onConfirm={async () => {
          if (!snapsFor || !restoring) return;
          await restoreWireframeVersion(project.id, snapsFor.id, restoring.version.id);
          closeSnapshots();
          await data.reload();
        }}
      >
        <p>
          Replace the current pages of <b>{snapsFor?.name}</b> with <b>{restoring?.title}</b>? The current pages are kept
          as an automatic backup snapshot.
        </p>
      </ConfirmDrawer>

      <Drawer
        open={copying !== null}
        title="New wireframe from snapshot"
        description={copying?.title}
        onClose={() => setCopying(null)}
        onSubmit={copySnapshot}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setCopying(null)} disabled={copyBusy}>
              Cancel
            </button>
            <button className="btn primary" disabled={copyBusy || !copyName.trim()}>
              {copyBusy ? "Creating…" : "Create wireframe"}
            </button>
          </>
        }
      >
        <p className="confirm-body">
          Copies the pages <b>{snapsFor?.name}</b> had when <b>{copying?.title}</b> was saved into a new wireframe. The
          original is untouched.
        </p>
        <Field label="Name">
          <input className="input" required maxLength={255} value={copyName} onChange={(e) => setCopyName(e.target.value)} />
        </Field>
        {copyError && <div className="status-banner warn">{copyError}</div>}
      </Drawer>

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete wireframe"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteWireframe(project.id, deleting.id);
          await data.reload();
          toast(`Deleted "${deleting.name}"`);
        }}
      >
        <p>
          Permanently delete <b>{deleting?.name}</b>? Its pages and snapshots are deleted with it. This cannot be
          undone.
        </p>
      </ConfirmDrawer>

      <div className={`toast${toastMsg ? " show" : ""}`}>{toastMsg}</div>
    </div>
  );
}

export function interfaceLabel(t: InterfaceType): string {
  return INTERFACE_TYPES.find((x) => x.value === t)?.label ?? t;
}

function NameChips({ ids, names }: { ids: string[]; names: Map<string, string> }) {
  if (ids.length === 0) return <span className="muted">—</span>;
  return (
    <span className="chips">
      {ids.map((id) => (
        <span key={id} className="badge">
          {names.get(id) ?? "Unknown"}
        </span>
      ))}
    </span>
  );
}
