// A project's personas: enough about each user archetype to design for them.
import { FormEvent, useState } from "react";
import { ComboBox } from "../../../components/ComboBox";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { Drawer, Field } from "../../../components/Drawer";
import { cleanList, ListEditor } from "../../../components/ListEditor";
import { errorMessage } from "../../../core/api";
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
  const [editing, setEditing] = useState<Persona | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleting, setDeleting] = useState<Persona | null>(null);
  const [form, setForm] = useState<PersonaInput>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const patch = (p: Partial<PersonaInput>) => setForm((f) => ({ ...f, ...p }));

  const openDrawer = (p: Persona | null) => {
    setEditing(p);
    setForm(
      p
        ? {
            name: p.name,
            role: p.role ?? "",
            primary_interface: p.primary_interface ?? "",
            traits: p.traits,
            jobs_to_be_done: p.jobs_to_be_done,
            pain_points: p.pain_points,
            feelings: p.feelings,
            notes: p.notes ?? "",
          }
        : EMPTY,
    );
    setFormError(null);
    setDrawerOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const body: PersonaInput = {
      name: form.name.trim(),
      role: form.role?.trim() || null,
      primary_interface: form.primary_interface?.trim() || null,
      traits: cleanList(form.traits),
      jobs_to_be_done: cleanList(form.jobs_to_be_done),
      pain_points: cleanList(form.pain_points),
      feelings: cleanList(form.feelings),
      notes: form.notes?.trim() || null,
    };
    try {
      if (editing) await updatePersona(project.id, editing.id, body);
      else await createPersona(project.id, body);
      setDrawerOpen(false);
      await personas.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const list = personas.data ?? [];

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Personas</h1>
        <span className="sub">{list.length} in this project</span>
        <span className="shell-spacer" />
        {canWrite && (
          <button className="btn primary" onClick={() => openDrawer(null)}>
            New persona
          </button>
        )}
      </div>

      {personas.loading ? (
        <div className="empty">Loading…</div>
      ) : personas.error ? (
        <div className="empty error">{personas.error}</div>
      ) : list.length === 0 ? (
        <div className="empty">
          <b>No personas yet.</b> {canWrite ? "Describe who you are designing for." : "Nothing here yet."}
        </div>
      ) : (
        <div className="card-grid personas">
          {list.map((p) => (
            <PersonaCard key={p.id} persona={p} canWrite={canWrite} onEdit={() => openDrawer(p)} onDelete={() => setDeleting(p)} />
          ))}
        </div>
      )}

      <Drawer
        open={drawerOpen}
        title={editing ? "Edit persona" : "New persona"}
        description="Just enough to design for them: what they do, what they need, what gets in the way."
        onClose={() => setDrawerOpen(false)}
        onSubmit={save}
        width={520}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setDrawerOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create persona"}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input className="input" required placeholder="e.g. Priya, the operations lead" value={form.name} onChange={(e) => patch({ name: e.target.value })} />
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
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

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

function PersonaCard({ persona, canWrite, onEdit, onDelete }: { persona: Persona; canWrite: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="card persona-card">
      <h3>{persona.name}</h3>
      <p>{persona.role || <span className="muted">No role set</span>}</p>
      <div className="meta">
        {persona.primary_interface && <span className="badge accent">{persona.primary_interface}</span>}
      </div>
      <PersonaList title="Jobs to be done" items={persona.jobs_to_be_done} />
      <PersonaList title="Pain points" items={persona.pain_points} />
      <PersonaList title="Traits" items={persona.traits} />
      <PersonaList title="Feelings" items={persona.feelings} />
      {canWrite && (
        <div className="meta">
          <span className="shell-spacer" />
          <button className="btn small ghost" onClick={onEdit}>
            Edit
          </button>
          <button className="btn small ghost" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function PersonaList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="persona-list">
      <div className="persona-list-title">{title}</div>
      <ul>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
