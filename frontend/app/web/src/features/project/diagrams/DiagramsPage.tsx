// A project's diagrams. Creating one goes straight into the editor.
import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { ListTable, NameCell } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { errorMessage } from "../../../core/api";
import { formatDate } from "../../../core/format";
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

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");

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

  const all = diagrams.data ?? [];
  const visible = useMemo(
    () => all.filter((d) => (!kindFilter || d.kind === kindFilter) && matches(query, d.name)),
    [all, query, kindFilter],
  );
  const filtered = query.trim() !== "" || kindFilter !== "";

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Diagrams</h1>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={() => openDrawer(null)}>
            New diagram
          </button>
        )}
      </div>

      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search by name", label: "Search diagrams" }}
        filters={[
          {
            label: "Filter by kind",
            value: kindFilter,
            onChange: setKindFilter,
            options: [{ value: "", label: "All kinds" }, ...DIAGRAM_KINDS.map((k) => ({ value: k.value, label: k.label }))],
          },
        ]}
        count={{ visible: visible.length, total: all.length, noun: ["diagram", "diagrams"] }}
      />

      <ListTable
        columns={[
          { header: "Diagram", className: "primary", render: (d) => <NameCell to={`${base}/${d.id}`}>{d.name}</NameCell> },
          { header: "Kind", render: (d) => <span className="badge accent">{diagramKindLabel(d.kind)}</span> },
          { header: "Updated", className: "muted when", render: (d) => formatDate(d.updated_at) },
        ]}
        rows={visible}
        rowKey={(d) => d.id}
        rowLabel={(d) => d.name}
        actions={(d) => [
          { label: "Open", onSelect: () => navigate(`${base}/${d.id}`) },
          ...(canWrite
            ? [
                { label: "Rename", onSelect: () => openDrawer(d) },
                { label: "Delete", danger: true, onSelect: () => setDeleting(d) },
              ]
            : []),
        ]}
        loading={diagrams.loading}
        error={diagrams.error}
        empty={
          filtered ? (
            "No diagrams match these filters."
          ) : (
            <>
              <b>No diagrams yet.</b> {canWrite ? "Sketch use cases, flows or entities in UML." : "Nothing here yet."}
            </>
          )
        }
      />

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
