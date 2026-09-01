// A project's diagrams. Creating one goes straight into the editor.
import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { errorMessage } from "../../../core/api";
import { useLoad } from "../../../core/useLoad";
import { useProject } from "../ProjectLayout";
import {
  createDiagram,
  deleteDiagram,
  DIAGRAM_KINDS,
  DiagramKind,
  diagramKindLabel,
  DiagramSummary,
  listDiagrams,
  updateDiagram,
} from "./diagramsApi";

export function DiagramsPage() {
  const { project, orgId, canWrite } = useProject();
  const navigate = useNavigate();
  const diagrams = useLoad(() => listDiagrams(project.id), [project.id]);
  const [editing, setEditing] = useState<DiagramSummary | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<DiagramSummary | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DiagramKind>("freeform");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const base = `/orgs/${orgId}/projects/${project.id}/diagrams`;

  const openDrawer = (d: DiagramSummary | null) => {
    setEditing(d);
    setName(d?.name ?? "");
    setKind(d?.kind ?? "freeform");
    setFormError(null);
    setDrawerOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await updateDiagram(project.id, editing.id, { name: name.trim(), kind });
        setDrawerOpen(false);
        await diagrams.reload();
      } else {
        const created = await createDiagram(project.id, { name: name.trim(), kind });
        navigate(`${base}/${created.id}`);
      }
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const list = diagrams.data ?? [];

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Diagrams</h1>
        <span className="sub">{list.length} in this project</span>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={() => openDrawer(null)}>
            New diagram
          </button>
        )}
      </div>

      <section className="section">
        {diagrams.loading ? (
          <div className="empty">Loading…</div>
        ) : diagrams.error ? (
          <div className="empty error">{diagrams.error}</div>
        ) : list.length === 0 ? (
          <div className="empty">
            <b>No diagrams yet.</b> {canWrite ? "Sketch use cases, flows or entities in UML." : "Nothing here yet."}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link to={`${base}/${d.id}`}>{d.name}</Link>
                  </td>
                  <td>
                    <span className="badge accent">{diagramKindLabel(d.kind)}</span>
                  </td>
                  <td className="muted">{new Date(d.updated_at).toLocaleString()}</td>
                  <td className="actions">
                    <Link to={`${base}/${d.id}`} className="btn small">
                      Open
                    </Link>{" "}
                    {canWrite && (
                      <>
                        <button className="btn small ghost" onClick={() => openDrawer(d)}>
                          Rename
                        </button>{" "}
                        <button className="btn small ghost" onClick={() => setDeleting(d)}>
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
        title={editing ? "Rename diagram" : "New diagram"}
        description={editing ? undefined : "Opens in the editor once created."}
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setDrawerOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create diagram"}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input className="input" required placeholder="e.g. Order lifecycle" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Kind" hint="Only a label; every diagram has the full UML palette.">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as DiagramKind)}>
            {DIAGRAM_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete diagram"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteDiagram(project.id, deleting.id);
          await diagrams.reload();
        }}
      >
        <p>
          Permanently delete <b>{deleting?.name}</b>? This cannot be undone.
        </p>
      </ConfirmDrawer>
    </div>
  );
}
