// Create or edit a project: the same three fields either way, so the same
// drawer. Shared by an organisation's projects list (which creates and edits
// within itself) and the platform-wide admin list (which edits any project
// and, given `orgs`, creates one for whichever organisation is picked).
import { FormEvent, useEffect, useState } from "react";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage, RequestOptions } from "../../core/api";
import { createProject, orgScope, Project, updateProject } from "./projectsApi";

/** An organisation the drawer can create a project in. */
export interface ProjectOrgOption {
  id: string;
  name: string;
}

export function ProjectFormDrawer({
  open,
  project,
  onClose,
  onSaved,
  opts,
  orgs,
}: {
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
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rationale, setRationale] = useState("");
  const [orgId, setOrgId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the fields when the drawer opens rather than on every render, so
  // typing is never overwritten by the project prop it started from.
  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setRationale(project?.rationale ?? "");
    setOrgId("");
    setError(null);
  }, [open, project]);

  const picksOrg = project === null && orgs !== undefined;

  const unchanged =
    project !== null &&
    name.trim() === project.name &&
    description.trim() === (project.description ?? "") &&
    rationale.trim() === (project.rationale ?? "");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      rationale: rationale.trim() || null,
    };
    try {
      if (project) await updateProject(project.id, body, opts);
      else await createProject(body, picksOrg ? orgScope(orgId) : opts);
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
      open={open}
      title={project ? "Edit project" : "New project"}
      description={project ? "Pages and components are unaffected." : undefined}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving || !name.trim() || unchanged || (picksOrg && !orgId)}>
            {saving ? "Saving…" : project ? "Save changes" : "Create project"}
          </button>
        </>
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
      <Field label="Name">
        <input
          className="input"
          required
          placeholder="e.g. Customer portal"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Description" hint="Optional. Shown on the project row.">
        <textarea
          className="input textarea"
          rows={3}
          placeholder="What this project covers"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
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
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      </Field>
      {error && <div className="status-banner warn">{error}</div>}
    </Drawer>
  );
}
