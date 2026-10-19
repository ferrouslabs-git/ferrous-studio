// Small pencil icon that opens the "Edit organisation" drawer. Rendered next
// to the organisation name in the sidebar, and only for organisation admins
// (the server enforces this too; hiding it just avoids a failing click).
//
// The drawer saves as you go; the platform admin's organisations list uses
// the same one.
import { useState } from "react";
import { AutosaveFooter, closeAfterSave } from "../../components/AutosaveStatus";
import { Drawer, Field } from "../../components/Drawer";
import { useAutosave } from "../../core/useAutosave";
import { UmTenant, updateTenant } from "../../core/umApi";

export function EditOrgButton({ org, onSaved }: { org: UmTenant; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn icon"
        onClick={() => setOpen(true)}
        aria-label="Edit organisation"
        title="Edit organisation"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M11.5 2.5l2 2L5 13l-2.8.8.8-2.8z" strokeLinejoin="round" />
          <path d="M10 4l2 2" />
        </svg>
      </button>
      {open && <EditOrgDrawer tenantId={org.id} name={org.name} onSaved={onSaved} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Rename an organisation, saved as you go. Mount it only while open. */
export function EditOrgDrawer({
  tenantId,
  name,
  onSaved,
  onClose,
}: {
  tenantId: string;
  name: string;
  onSaved: () => Promise<unknown>;
  onClose: () => void;
}) {
  const auto = useAutosave(
    { name },
    {
      validate: (v) => (v.name.trim() ? null : { name: "An organisation needs a name." }),
      save: async (v) => {
        await updateTenant(tenantId, { name: v.name.trim() });
        await onSaved();
      },
    },
  );

  return (
    <Drawer
      open
      title="Edit organisation"
      description="Changes apply immediately for every member."
      onClose={() => void closeAfterSave(auto, onClose)}
      onSubmit={(e) => {
        e.preventDefault();
        void auto.flush();
      }}
      footer={<AutosaveFooter auto={auto} onClose={onClose} />}
    >
      <Field label="Name" error={auto.fieldErrors.name}>
        <input
          className="input"
          required
          aria-invalid={!!auto.fieldErrors.name}
          value={auto.value.name}
          onChange={(e) => auto.set({ name: e.target.value })}
          onBlur={() => void auto.flush()}
        />
      </Field>
    </Drawer>
  );
}
