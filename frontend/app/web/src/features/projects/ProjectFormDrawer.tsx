// Create or edit a project: the same three fields either way, so the same
// drawer. Shared by an organisation's projects list (which creates and edits
// within itself), the platform-wide admin list (which edits any project and,
// given `orgs`, creates one for whichever organisation is picked) and the
// project's own details page.
//
// Creating keeps its Create button; editing saves as you go (useAutosave).
import { FormEvent, useState } from "react";
import { AutosaveFooter, closeAfterSave } from "../../components/AutosaveStatus";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage, RequestOptions } from "../../core/api";
import { useAutosave } from "../../core/useAutosave";
import { createProject, orgScope, Project, updateProject } from "./projectsApi";

/** An organisation the drawer can create a project in. */
export interface ProjectOrgOption {
  id: string;
  name: string;
}

interface ProjectDraft {
  name: string;
  description: string;
  rationale: string;
}

const toBody = (d: ProjectDraft) => ({
  name: d.name.trim(),
  description: d.description.trim() || null,
  rationale: d.rationale.trim() || null,
});

interface ProjectFormDrawerProps {
  open: boolean;
  /** null creates a project; anything else edits that one. */
  project: Project | null;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  /** Which organisation the save runs against, when not the active one. */
  opts?: RequestOptions;
  /**
   * Organisations to choose from when creating. Given, the drawer shows a
   * picker and the create runs under the chosen one's scope instead of
   * `opts`; omitted, the project lands in the active organisation.
   */
  orgs?: ProjectOrgOption[];
}

export function ProjectFormDrawer(props: ProjectFormDrawerProps) {
  // Mounted only while open, so the fields start from the project each time
  // and closing flushes any pending save.
  if (!props.open) return null;
  return <ProjectFormDrawerBody key={props.project?.id ?? "new"} {...props} />;
}

function ProjectFormDrawerBody({ project, onClose, onSaved, opts, orgs }: ProjectFormDrawerProps) {
  const [orgId, setOrgId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useAutosave<ProjectDraft>(
    {
      name: project?.name ?? "",
      description: project?.description ?? "",
      rationale: project?.rationale ?? "",
    },
    {
      enabled: project !== null,
      validate: (d) => (d.name.trim() ? null : { name: "A project needs a name." }),
      save: async (d) => {
        if (!project) return;
        await updateProject(project.id, toBody(d), opts);
        await onSaved();
      },
    },
  );
  const draft = form.value;

  const picksOrg = project === null && orgs !== undefined;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createProject(toBody(draft), picksOrg ? orgScope(orgId) : opts);
      onClose();
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const flush = () => void form.flush();

  return (
    <Drawer
      open
      title={project ? "Edit project" : "New project"}
      description={project ? "Pages and components are unaffected." : undefined}
      onClose={project ? () => void closeAfterSave(form, onClose) : onClose}
      onSubmit={project ? (e) => e.preventDefault() : create}
      footer={
        project ? (
          <AutosaveFooter auto={form} onClose={onClose} />
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !draft.name.trim() || (picksOrg && !orgId)}>
              {saving ? "Saving…" : "Create project"}
            </button>
          </>
        )
      }
    >
      {picksOrg && orgs && (
        <Field label="Organisation">
          <select className="select" required value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="" disabled>
              Choose an organisation
            </option>
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Name" error={form.fieldErrors.name}>
        <input
          className="input"
          required
          placeholder="e.g. Customer portal"
          aria-invalid={!!form.fieldErrors.name}
          value={draft.name}
          onChange={(e) => form.set({ name: e.target.value })}
          onBlur={flush}
        />
      </Field>
      <Field label="Description" hint="Optional. Shown on the project row.">
        <textarea
          className="input textarea"
          rows={3}
          placeholder="What this project covers"
          value={draft.description}
          onChange={(e) => form.set({ description: e.target.value })}
          onBlur={flush}
        />
      </Field>
      <Field
        label="Rationale"
        hint="Why the project exists: the problem, the outcome sought. Editable later in Project details."
      >
        <textarea
          className="input textarea"
          rows={4}
          placeholder="e.g. Supplier invoices take three systems and a week to approve; we want same-day approval in one place."
          value={draft.rationale}
          onChange={(e) => form.set({ rationale: e.target.value })}
          onBlur={flush}
        />
      </Field>
      {error && <div className="status-banner warn">{error}</div>}
    </Drawer>
  );
}
