// Small pencil icon that opens the "Edit organisation" drawer. Rendered next
// to the organisation name in the sidebar, and only for organisation admins
// (the server enforces this too; hiding it just avoids a failing click).
import { FormEvent, useState } from "react";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { UmTenant, updateTenant } from "../../core/umApi";

export function EditOrgButton({ org, onSaved }: { org: UmTenant; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(org.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDrawer = () => {
    setName(org.name);
    setError(null);
    setOpen(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateTenant(org.id, { name: name.trim() });
      setOpen(false);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const unchanged = name.trim() === org.name;

  return (
    <>
      <button
        type="button"
        className="btn icon"
        onClick={openDrawer}
        aria-label="Edit organisation"
        title="Edit organisation"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M11.5 2.5l2 2L5 13l-2.8.8.8-2.8z" strokeLinejoin="round" />
          <path d="M10 4l2 2" />
        </svg>
      </button>
      <Drawer
        open={open}
        title="Edit organisation"
        description="Changes apply immediately for every member."
        onClose={() => setOpen(false)}
        onSubmit={save}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !name.trim() || unchanged}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {error && <div className="status-banner warn">{error}</div>}
      </Drawer>
    </>
  );
}
