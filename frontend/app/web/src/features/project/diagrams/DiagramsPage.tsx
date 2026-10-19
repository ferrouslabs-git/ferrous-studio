// A project's diagrams. Creating one goes straight into the editor.
import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AutosaveFooter, closeAfterSave } from "../../../components/AutosaveStatus";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { ListTable, NameCell } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { errorMessage } from "../../../core/api";
import { useIsPhone } from "../../../core/breakpoints";
import { formatDate } from "../../../core/format";
import { useAutosave } from "../../../core/useAutosave";
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
  // A phone gets the viewer, never the editor (DiagramEditorPage), so the name opens that.
  const isPhone = useIsPhone();
  const diagrams = useLoad(() => listDiagrams(project.id), [project.id]);
  /** The drawer's subject: a diagram being renamed, or null for a new one. */
  const [drawer, setDrawer] = useState<{ diagram: DiagramSummary | null } | null>(null);
  const [deleting, setDeleting] = useState<DiagramSummary | null>(null);

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");

  const base = `/orgs/${orgId}/projects/${project.id}/diagrams`;

  const openDrawer = (d: DiagramSummary | null) => setDrawer({ diagram: d });

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
          { header: "Diagram", className: "primary", render: (d) => <NameCell to={isPhone ? `${base}/${d.id}/view` : `${base}/${d.id}`}>{d.name}</NameCell> },
          { header: "Kind", render: (d) => <span className="badge accent">{diagramKindLabel(d.kind)}</span> },
          { header: "Updated", className: "muted when", render: (d) => formatDate(d.updated_at) },
        ]}
        rows={visible}
        rowKey={(d) => d.id}
        rowLabel={(d) => d.name}
        actions={(d) => [
          { label: "Open", onSelect: () => navigate(`${base}/${d.id}`) },
          { label: "View", onSelect: () => navigate(`${base}/${d.id}/view`) },
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

      {drawer && (
        <DiagramDrawer
          key={drawer.diagram?.id ?? "new"}
          projectId={project.id}
          diagram={drawer.diagram}
          onSaved={diagrams.reload}
          onCreated={(id) => navigate(`${base}/${id}`)}
          onClose={() => setDrawer(null)}
        />
      )}

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

interface DiagramDraft {
  name: string;
  kind: DiagramKind;
}

/**
 * Create a diagram (with a Create button, then into the editor) or rename
 * one (saved as you go). Mounted only while open, so closing flushes.
 */
function DiagramDrawer({
  projectId,
  diagram,
  onSaved,
  onCreated,
  onClose,
}: {
  projectId: string;
  diagram: DiagramSummary | null;
  onSaved: () => Promise<unknown>;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const auto = useAutosave<DiagramDraft>(
    { name: diagram?.name ?? "", kind: diagram?.kind ?? "freeform" },
    {
      enabled: diagram !== null,
      validate: (d) => (d.name.trim() ? null : { name: "A diagram needs a name." }),
      save: async (d) => {
        if (!diagram) return;
        await updateDiagram(projectId, diagram.id, { name: d.name.trim(), kind: d.kind });
        await onSaved();
      },
    },
  );
  const { name, kind } = auto.value;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const created = await createDiagram(projectId, { name: name.trim(), kind });
      onCreated(created.id);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      title={diagram ? "Rename diagram" : "New diagram"}
      description={diagram ? undefined : "Opens in the editor once created."}
      onClose={diagram ? () => void closeAfterSave(auto, onClose) : onClose}
      onSubmit={diagram ? (e) => e.preventDefault() : create}
      footer={
        diagram ? (
          <AutosaveFooter auto={auto} onClose={onClose} />
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Create diagram"}
            </button>
          </>
        )
      }
    >
      <Field label="Name" error={auto.fieldErrors.name}>
        <input
          className="input"
          required
          placeholder="e.g. Order lifecycle"
          aria-invalid={!!auto.fieldErrors.name}
          value={name}
          onChange={(e) => auto.set({ name: e.target.value })}
          onBlur={() => void auto.flush()}
        />
      </Field>
      <Field label="Kind" hint="Only a label; every diagram has the full UML palette.">
        <select
          className="select"
          value={kind}
          onChange={(e) => auto.set({ kind: e.target.value as DiagramKind }, { immediate: true })}
        >
          {DIAGRAM_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </Field>
      {formError && <div className="status-banner warn">{formError}</div>}
    </Drawer>
  );
}
