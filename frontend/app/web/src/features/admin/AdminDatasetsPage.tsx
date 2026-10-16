// Super admin: the platform's default datasets — the reusable value lists
// (addresses, names, statuses…) every project can bind wireframe columns and
// dropdowns to. Rows created here appear in every project's dataset picker
// under "Standard"; projects cannot edit them, only bind to them.
//
// Every write here is also enforced server-side (platform admin only).
import { FormEvent, useMemo, useState } from "react";
import { AutosaveFooter, closeAfterSave } from "../../components/AutosaveStatus";
import { Confirmation, ConfirmationDrawer } from "../../components/ConfirmDrawer";
import { Drawer, Field } from "../../components/Drawer";
import { ListTable, NameCell } from "../../components/ListTable";
import { ListToolbar, matches } from "../../components/ListToolbar";
import { errorMessage } from "../../core/api";
import { useAutosave } from "../../core/useAutosave";
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

      {editing && (
        <EditDatasetDrawer
          key={editing === "new" ? "new" : editing.id}
          dataset={editing}
          onClose={() => setEditing(null)}
          onSaved={datasets.reload}
        />
      )}

      <ConfirmationDrawer pending={confirming} onClose={() => setConfirming(null)} />
    </div>
  );
}

// ── Create / edit ──────────────────────────────────────────────────────────

interface DatasetDraft {
  name: string;
  kind: DataKind;
  values: string;
}

const toInput = (d: DatasetDraft) => ({
  name: d.name.trim(),
  kind: d.kind,
  values: d.values.split("\n").map((v) => v.trim()).filter(Boolean),
});

/**
 * Create a dataset (with a Create button) or edit one (saved as you go).
 * Mounted only while open, so closing flushes a pending save.
 */
function EditDatasetDrawer({
  dataset,
  onClose,
  onSaved,
}: {
  dataset: Dataset | "new";
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const existing = dataset === "new" ? null : dataset;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auto = useAutosave<DatasetDraft>(
    existing
      ? { name: existing.name, kind: existing.kind, values: existing.values.join("\n") }
      : { name: "", kind: "text", values: "" },
    {
      enabled: existing !== null,
      validate: (d) => (d.name.trim() ? null : { name: "A dataset needs a name." }),
      save: async (d) => {
        if (!existing) return;
        await updatePlatformDataset(existing.id, toInput(d));
        await onSaved();
      },
    },
  );
  const { name, kind, values } = auto.value;
  const flush = () => void auto.flush();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createPlatformDataset(toInput(auto.value));
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
      title={existing ? "Edit dataset" : "New dataset"}
      description="Available to every project as a bindable value list."
      onClose={existing ? () => void closeAfterSave(auto, onClose) : onClose}
      onSubmit={existing ? (e) => e.preventDefault() : create}
      footer={
        existing ? (
          <AutosaveFooter auto={auto} onClose={onClose} />
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Create dataset"}
            </button>
          </>
        )
      }
    >
      <Field label="Name" error={auto.fieldErrors.name}>
        <input
          className="input"
          required
          aria-invalid={!!auto.fieldErrors.name}
          value={name}
          onChange={(e) => auto.set({ name: e.target.value })}
          onBlur={flush}
        />
      </Field>
      <Field label="Data kind">
        <select
          className="select"
          value={kind}
          onChange={(e) => auto.set({ kind: e.target.value as DataKind }, { immediate: true })}
        >
          {DATA_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </Field>
      <Field label="Values">
        <textarea
          className="input"
          rows={10}
          placeholder="One value per line"
          value={values}
          onChange={(e) => auto.set({ values: e.target.value })}
          onBlur={flush}
        />
      </Field>
      {error && <div className="status-banner warn">{error}</div>}
    </Drawer>
  );
}
