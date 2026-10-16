// A project's personas: enough about each user archetype to design for them.
// The list shows who they are at a glance; the detail lives in the drawer.
import { FormEvent, useMemo, useState } from "react";
import { AutosaveFooter, closeAfterSave } from "../../../components/AutosaveStatus";
import { ComboBox } from "../../../components/ComboBox";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { cleanList, ListEditor } from "../../../components/ListEditor";
import { ListTable, NameCell } from "../../../components/ListTable";
import { ListToolbar, matches } from "../../../components/ListToolbar";
import { errorMessage } from "../../../core/api";
import { useAutosave } from "../../../core/useAutosave";
import { useLoad } from "../../../core/useLoad";
import { useProject } from "../ProjectLayout";
import {
  createPersona,
  deletePersona,
  INTERFACE_SUGGESTIONS,
  listPersonas,
  Persona,
  PersonaInput,
  updatePersona,
} from "./personasApi";

const EMPTY: PersonaInput = {
  name: "",
  role: "",
  primary_interface: "",
  traits: [],
  jobs_to_be_done: [],
  pain_points: [],
  feelings: [],
  notes: "",
};

export function PersonasPage() {
  const { project, canWrite } = useProject();
  const personas = useLoad(() => listPersonas(project.id), [project.id]);
  /** The drawer's subject: a persona being edited, or null for a new one. */
  const [drawer, setDrawer] = useState<{ persona: Persona | null } | null>(null);
  const [deleting, setDeleting] = useState<Persona | null>(null);

  const [query, setQuery] = useState("");
  const [interfaceFilter, setInterfaceFilter] = useState("");

  const openDrawer = (p: Persona | null) => setDrawer({ persona: p });

  const all = personas.data ?? [];
  // The interfaces in use, so the filter offers what is there rather than
  // every suggestion the form knows about.
  const interfaces = useMemo(
    () => Array.from(new Set(all.map((p) => p.primary_interface).filter((i): i is string => !!i))).sort(),
    [all],
  );
  const visible = useMemo(
    () =>
      all.filter(
        (p) =>
          (!interfaceFilter || p.primary_interface === interfaceFilter) &&
          matches(query, p.name, p.role, p.primary_interface, ...p.traits, ...p.jobs_to_be_done, ...p.pain_points),
      ),
    [all, query, interfaceFilter],
  );
  const filtered = query.trim() !== "" || interfaceFilter !== "";

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Personas</h1>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={() => openDrawer(null)}>
            New persona
          </button>
        )}
      </div>

      <ListToolbar
        search={{ value: query, onChange: setQuery, placeholder: "Search by name, role, trait or job", label: "Search personas" }}
        filters={[
          {
            label: "Filter by interface",
            value: interfaceFilter,
            onChange: setInterfaceFilter,
            options: [{ value: "", label: "All interfaces" }, ...interfaces.map((i) => ({ value: i, label: i }))],
          },
        ]}
        count={{ visible: visible.length, total: all.length, noun: ["persona", "personas"] }}
      />

      <ListTable
        columns={[
          {
            header: "Persona",
            className: "primary",
            render: (p) => (
              <NameCell sub={p.role ?? undefined} onOpen={canWrite ? () => openDrawer(p) : undefined}>
                {p.name}
              </NameCell>
            ),
          },
          {
            header: "Interface",
            render: (p) => (p.primary_interface ? <span className="badge accent">{p.primary_interface}</span> : <span className="muted">—</span>),
          },
          { header: "Jobs to be done", className: "wide", render: (p) => <Preview items={p.jobs_to_be_done} /> },
          { header: "Pain points", className: "wide", render: (p) => <Preview items={p.pain_points} /> },
        ]}
        rows={visible}
        rowKey={(p) => p.id}
        rowLabel={(p) => p.name}
        actions={(p) =>
          canWrite
            ? [
                { label: "Edit", onSelect: () => openDrawer(p) },
                { label: "Delete", danger: true, onSelect: () => setDeleting(p) },
              ]
            : null
        }
        loading={personas.loading}
        error={personas.error}
        empty={
          filtered ? (
            "No personas match these filters."
          ) : (
            <>
              <b>No personas yet.</b> {canWrite ? "Describe who you are designing for." : "Nothing here yet."}
            </>
          )
        }
      />

      {drawer && (
        <PersonaDrawer
          key={drawer.persona?.id ?? "new"}
          projectId={project.id}
          persona={drawer.persona}
          onSaved={personas.reload}
          onClose={() => setDrawer(null)}
        />
      )}

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete persona"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deletePersona(project.id, deleting.id);
          await personas.reload();
        }}
      >
        <p>
          Delete <b>{deleting?.name}</b>? Wireframes that reference this persona keep working but lose the link.
        </p>
      </ConfirmDrawer>
    </div>
  );
}

const toBody = (form: PersonaInput): PersonaInput => ({
  name: form.name.trim(),
  role: form.role?.trim() || null,
  primary_interface: form.primary_interface?.trim() || null,
  traits: cleanList(form.traits),
  jobs_to_be_done: cleanList(form.jobs_to_be_done),
  pain_points: cleanList(form.pain_points),
  feelings: cleanList(form.feelings),
  notes: form.notes?.trim() || null,
});

/**
 * Create a persona (with a Create button) or edit one (saved as you go).
 * Mounted only while open, so closing flushes a pending save.
 */
function PersonaDrawer({
  projectId,
  persona,
  onSaved,
  onClose,
}: {
  projectId: string;
  persona: Persona | null;
  onSaved: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const auto = useAutosave<PersonaInput>(
    persona
      ? {
          name: persona.name,
          role: persona.role ?? "",
          primary_interface: persona.primary_interface ?? "",
          traits: persona.traits,
          jobs_to_be_done: persona.jobs_to_be_done,
          pain_points: persona.pain_points,
          feelings: persona.feelings,
          notes: persona.notes ?? "",
        }
      : EMPTY,
    {
      enabled: persona !== null,
      validate: (f) => (f.name.trim() ? null : { name: "A persona needs a name." }),
      save: async (f) => {
        if (!persona) return;
        await updatePersona(projectId, persona.id, toBody(f));
        await onSaved();
      },
    },
  );
  const form = auto.value;
  const patch = (p: Partial<PersonaInput>) => auto.set(p);
  const flush = () => void auto.flush();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await createPersona(projectId, toBody(form));
      onClose();
      await onSaved();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open
      title={persona ? "Edit persona" : "New persona"}
      description="Just enough to design for them: what they do, what they need, what gets in the way."
      onClose={persona ? () => void closeAfterSave(auto, onClose) : onClose}
      onSubmit={persona ? (e) => e.preventDefault() : create}
      width={520}
      footer={
        persona ? (
          <AutosaveFooter auto={auto} onClose={onClose} />
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : "Create persona"}
            </button>
          </>
        )
      }
    >
      {/* Blurring out of the section saves whatever was typed in it. */}
      <div style={{ display: "contents" }} onBlur={flush}>
        <Field label="Name" error={auto.fieldErrors.name}>
          <input
            className="input"
            required
            placeholder="e.g. Priya, the operations lead"
            aria-invalid={!!auto.fieldErrors.name}
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>
        <Field label="Role / occupation">
          <input className="input" placeholder="e.g. Operations manager at a mid-size logistics firm" value={form.role ?? ""} onChange={(e) => patch({ role: e.target.value })} />
        </Field>
        <Field label="Primary interface" hint="Where they mostly meet the product.">
          <ComboBox value={form.primary_interface ?? ""} onChange={(v) => patch({ primary_interface: v })} options={INTERFACE_SUGGESTIONS} placeholder="e.g. Desktop" />
        </Field>
        <Field label="Traits">
          <ListEditor value={form.traits} onChange={(v) => patch({ traits: v })} placeholder="e.g. Time-poor, detail-oriented" addLabel="Add trait" />
        </Field>
        <Field label="Jobs to be done">
          <ListEditor value={form.jobs_to_be_done} onChange={(v) => patch({ jobs_to_be_done: v })} placeholder="e.g. Approve supplier invoices each week" addLabel="Add job" />
        </Field>
        <Field label="Current pain points">
          <ListEditor value={form.pain_points} onChange={(v) => patch({ pain_points: v })} placeholder="e.g. Re-keys data between two systems" addLabel="Add pain point" />
        </Field>
        <Field label="Feelings">
          <ListEditor value={form.feelings} onChange={(v) => patch({ feelings: v })} placeholder="e.g. Anxious about missing a deadline" addLabel="Add feeling" />
        </Field>
        <Field label="Notes">
          <textarea className="input textarea" rows={3} value={form.notes ?? ""} onChange={(e) => patch({ notes: e.target.value })} />
        </Field>
      </div>
      {formError && <div className="status-banner warn">{formError}</div>}
    </Drawer>
  );
}

/** The first couple of items of a persona's list, and how many more there are. */
function Preview({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="muted">—</span>;
  const shown = items.slice(0, 2);
  const more = items.length - shown.length;
  return (
    <span className="preview">
      {shown.map((item, i) => (
        <span key={i}>{item}</span>
      ))}
      {more > 0 && <span className="preview-more">+{more} more</span>}
    </span>
  );
}
