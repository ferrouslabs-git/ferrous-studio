// Super admin: the platform's default datasets — the reusable value lists
// (addresses, names, statuses…) every project can bind wireframe columns and
// dropdowns to. Rows created here appear in every project's dataset picker
// under "Standard"; projects cannot edit them, only bind to them.
//
// Every write here is also enforced server-side (platform admin only).
import { FormEvent, useEffect, useState } from "react";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { useLoad } from "../../core/useLoad";
import {
  createPlatformDataset,
  Dataset,
  deletePlatformDataset,
  listPlatformDatasets,
  updatePlatformDataset,
} from "../project/datasets/datasetsApi";
import { DATA_KINDS, DataKind } from "../studio/catalog";

export function AdminDatasetsPage() {
  const datasets = useLoad(listPlatformDatasets, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** null = closed; a Dataset = editing it; "new" = creating. */
  const [editing, setEditing] = useState<Dataset | "new" | null>(null);

  const remove = async (dataset: Dataset) => {
    if (!confirm(`Delete "${dataset.name}"? Elements bound to it fall back to their own sample values.`)) return;
    setBusy(dataset.id);
    setError(null);
    try {
      await deletePlatformDataset(dataset.id);
      await datasets.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Datasets</h1>
        <span className="sub">Default value lists available to every project</span>
        <span className="shell-spacer" />
        <button className="btn primary" onClick={() => setEditing("new")}>New dataset</button>
      </div>

      <section className="section">
        {error && <div className="status-banner warn">{error}</div>}

        {datasets.loading ? (
          <div className="empty">Loading…</div>
        ) : datasets.error ? (
          <div className="empty error">{datasets.error}</div>
        ) : (datasets.data ?? []).length === 0 ? (
          <div className="empty">No default datasets yet. Create one above.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Data kind</th>
                <th>Values</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(datasets.data ?? []).map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td className="muted">{d.kind}</td>
                  <td className="muted">
                    {d.values.slice(0, 3).join(", ")}
                    {d.values.length > 3 ? ` … (${d.values.length})` : ""}
                  </td>
                  <td className="actions">
                    <button className="btn small ghost" disabled={busy === d.id} onClick={() => setEditing(d)}>
                      Edit
                    </button>{" "}
                    <button className="btn small ghost" disabled={busy === d.id} onClick={() => void remove(d)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <EditDatasetDrawer
        dataset={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void datasets.reload();
        }}
      />
    </div>
  );
}

// ── Create / edit ──────────────────────────────────────────────────────────

function EditDatasetDrawer({
  dataset,
  onClose,
  onSaved,
}: {
  dataset: Dataset | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DataKind>("text");
  const [values, setValues] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the drawer opens on a different dataset.
  useEffect(() => {
    if (dataset === "new") {
      setName("");
      setKind("text");
      setValues("");
      setError(null);
    } else if (dataset) {
      setName(dataset.name);
      setKind(dataset.kind);
      setValues(dataset.values.join("\n"));
      setError(null);
    }
  }, [dataset]);

  if (!dataset) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input = {
      name: name.trim(),
      kind,
      values: values.split("\n").map((v) => v.trim()).filter(Boolean),
    };
    try {
      if (dataset === "new") await createPlatformDataset(input);
      else await updatePlatformDataset(dataset.id, input);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      title={dataset === "new" ? "New dataset" : "Edit dataset"}
      description="Available to every project as a bindable value list."
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving || !name.trim()}>
            {saving ? "Saving…" : dataset === "new" ? "Create dataset" : "Save changes"}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Data kind">
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as DataKind)}>
          {DATA_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Field>
      <Field label="Values">
        <textarea
          className="input"
          rows={10}
          placeholder="One value per line"
          value={values}
          onChange={(e) => setValues(e.target.value)}
        />
      </Field>
      {error && <div className="status-banner warn">{error}</div>}
    </Drawer>
  );
}
