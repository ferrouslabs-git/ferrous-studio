// Super admin: the platform's default datasets — the reusable value lists
// (addresses, names, statuses…) every project can bind wireframe columns and
// dropdowns to. Rows created here appear in every project's dataset picker
// under "Standard"; projects cannot edit them, only bind to them.
//
// Every write here is also enforced server-side (platform admin only).
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Confirmation, ConfirmationDrawer } from "../../components/ConfirmDrawer";
import { Drawer, Field } from "../../components/Drawer";
import { ListTable, NameCell } from "../../components/ListTable";
import { ListToolbar, matches } from "../../components/ListToolbar";
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

/** The first few values, as the line beneath a dataset's name. */
function valuesPreview(values: string[]): string {
  const shown = values.slice(0, 3).join(", ");
  return values.length > 3 ? `${shown}, …` : shown;
}

export function AdminDatasetsPage() {
  const datasets = useLoad(listPlatformDatasets, []);
  /** null = closed; a Dataset = editing it; "new" = creating. */
  const [editing, setEditing] = useState<Dataset | "new" | null>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");

  const all = datasets.data ?? [];
  const visible = useMemo(
    () => all.filter((d) => (!kindFilter || d.kind === kindFilter) && matches(query, d.name, d.values.join(" "))),
    [all, query, kindFilter],
  );
  const filtered = query.trim() !== "" || kindFilter !== "";

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Datasets</h1>
        <span className="shell-spacer" />
        <button className="btn primary" onClick={() => setEditing("new")}>
          New dataset
        </button>
      </div>

      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search by name or value", label: "Search datasets" }}
        filters={[
          {
            label: "Filter by data kind",
            value: kindFilter,
            onChange: setKindFilter,
            options: [{ value: "", label: "All data kinds" }, ...DATA_KINDS.map((k) => ({ value: k, label: k }))],
          },
        ]}
        count={{ visible: visible.length, total: all.length, noun: ["dataset", "datasets"] }}
      />

      <ListTable
        columns={[
          {
            header: "Dataset",
            className: "primary",
            render: (d) => (
              <NameCell sub={valuesPreview(d.values)} onOpen={() => setEditing(d)}>
                {d.name}
              </NameCell>
            ),
          },
          { header: "Data kind", render: (d) => <span className="badge muted">{d.kind}</span> },
          { header: "Values", className: "num", render: (d) => d.values.length },
        ]}
        rows={visible}
        rowKey={(d) => d.id}
        rowLabel={(d) => d.name}
        actions={(d) => [
          { label: "Edit", onSelect: () => setEditing(d) },
          {
            label: "Delete",
            danger: true,
            onSelect: () =>
              setConfirming({
                title: "Delete dataset",
                body: (
                  <p>
                    Delete <b>{d.name}</b>? Elements bound to it fall back to their own sample values.
                  </p>
                ),
                run: async () => {
                  await deletePlatformDataset(d.id);
                  await datasets.reload();
                },
              }),
          },
        ]}
        loading={datasets.loading}
        error={datasets.error}
        empty={
          filtered ? (
            "No datasets match these filters."
          ) : (
            <>
              <b>No default datasets yet.</b> Create one to offer every project a standard value list.
            </>
          )
        }
      />

      <EditDatasetDrawer
        dataset={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void datasets.reload();
        }}
      />

      <ConfirmationDrawer pending={confirming} onClose={() => setConfirming(null)} />
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
