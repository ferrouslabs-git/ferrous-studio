// A project's wireframes: name, user types and personas it is designed for,
// interface type. Opening one takes you into the studio.
import { FormEvent, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { errorMessage } from "../../../core/api";
import { useLoad } from "../../../core/useLoad";
import { listPersonas } from "../personas/personasApi";
import { useProject } from "../ProjectLayout";
import { listActors } from "../usecases/useCasesApi";
import {
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
  const data = useLoad(
    () => Promise.all([listWireframes(project.id), listPersonas(project.id), listActors(project.id)]),
    [project.id],
  );
  const [editing, setEditing] = useState<Wireframe | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<Wireframe | null>(null);
  const [name, setName] = useState("");
  const [interfaceType, setInterfaceType] = useState<InterfaceType>("desktop");
  const [personaIds, setPersonaIds] = useState<string[]>([]);
  const [actorIds, setActorIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Copy JSON: which row just copied (for the "Copied" flash) and any failure.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  // Snapshots drawer: which wireframe's history is open, its snapshots, and
  // the snapshot awaiting restore confirmation.
  const [snapsFor, setSnapsFor] = useState<Wireframe | null>(null);
  const [snaps, setSnaps] = useState<ProjectVersion[] | null>(null);
  const [snapsError, setSnapsError] = useState<string | null>(null);
  // Captured with its display title so the confirm text survives the
  // snapshot list being cleared while the drawers close.
  const [restoring, setRestoring] = useState<{ version: ProjectVersion; title: string } | null>(null);

  const [wireframes, personas, actors] = data.data ?? [[], [], []];
  const personaNames = new Map(personas.map((p) => [p.id, p.name]));
  const actorNames = new Map(actors.map((a) => [a.id, a.name]));
  const base = `/orgs/${orgId}/projects/${project.id}/wireframes`;

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

  const copyJson = async (w: Wireframe) => {
    setCopyError(null);
    try {
      const doc = await getWireframeExport(project.id, w.id);
      await navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
      setCopiedId(w.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === w.id ? null : cur)), 2200);
    } catch (err) {
      setCopyError(errorMessage(err));
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

  // The API returns snapshots newest first; manual ones are numbered
  // oldest-first so they match the "v3" readout in the studio's top bar.
  const snapNumbers = useMemo(() => {
    const numbers = new Map<string, number>();
    if (snaps) {
      let n = snaps.filter((v) => v.reason === "manual").length;
      for (const v of snaps) if (v.reason === "manual") numbers.set(v.id, n--);
    }
    return numbers;
  }, [snaps]);

  const snapshotTitle = (v: ProjectVersion) => {
    if (v.reason !== "manual") return AUTO_SNAPSHOT_TITLES[v.reason] ?? "Automatic backup";
    const number = `v${snapNumbers.get(v.id)}`;
    return v.label ? `${number} · ${v.label}` : number;
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Wireframes</h1>
        <span className="sub">{wireframes.length} in this project</span>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={() => openDrawer(null)}>
            New wireframe
          </button>
        )}
      </div>

      {copyError && (
        <div className="status-banner warn">
          {copyError}{" "}
          <button className="btn small ghost" onClick={() => setCopyError(null)}>
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
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>User types</th>
                <th>Personas</th>
                <th>Interface</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {wireframes.map((w) => (
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
                  <td className="muted">{new Date(w.updated_at).toLocaleDateString()}</td>
                  <td className="actions">
                    <Link to={`${base}/${w.id}`} className="btn small">
                      Open
                    </Link>{" "}
                    <button className="btn small ghost" onClick={() => void copyJson(w)}>
                      {copiedId === w.id ? "Copied" : "Copy JSON"}
                    </button>{" "}
                    <button className="btn small ghost" onClick={() => openSnapshots(w)}>
                      Snapshots
                    </button>{" "}
                    {canWrite && (
                      <>
                        <button className="btn small ghost" onClick={() => openDrawer(w)}>
                          Edit
                        </button>{" "}
                        <button className="btn small ghost" onClick={() => setDeleting(w)}>
                          Delete
                        </button>
                      </>
                    )}
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

      <Drawer open={snapsFor !== null} title="Snapshots" description={snapsFor?.name} onClose={closeSnapshots}>
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
                  <b>{snapshotTitle(v)}</b>
                  <span className="muted">{new Date(v.created_at).toLocaleString()}</span>
                </div>
                {canWrite && (
                  <button className="btn small ghost" onClick={() => setRestoring({ version: v, title: snapshotTitle(v) })}>
                    Restore
                  </button>
                )}
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

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete wireframe"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteWireframe(project.id, deleting.id);
          await data.reload();
        }}
      >
        <p>
          Permanently delete <b>{deleting?.name}</b>, including all of its pages and snapshots? This cannot be undone.
        </p>
      </ConfirmDrawer>
    </div>
  );
}

export function interfaceLabel(t: InterfaceType): string {
  return INTERFACE_TYPES.find((x) => x.value === t)?.label ?? t;
}

/** The server saves these around restores/conflicts; only "manual" snapshots
 *  come from the user's own Save snapshot button. */
const AUTO_SNAPSHOT_TITLES: Record<string, string> = {
  before_restore: "Backup before a restore",
  before_conflict: "Backup before a conflict",
  before_replay: "Backup before a replay",
  after_replay: "Backup after a replay",
};

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
