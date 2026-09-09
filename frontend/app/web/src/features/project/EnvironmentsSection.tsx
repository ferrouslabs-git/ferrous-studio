// The Environments section of the project details page: where a build of this
// product can be reached, in the order it is promoted through them.
//
// It sits beside Repository rather than on the Feedback tab because it is the
// same kind of thing -- filing, set once by an admin, read constantly by
// everyone else. Feedback then links to whatever is published here.
//
// Addresses belong to the project *lineage*, not to a version: every version
// of a project shares one UAT link, and a locked version can still have a
// wrong one corrected (the backend uses get_project, not
// get_writable_project). That is why this section stays available on a frozen
// version while the Edit button above it does not.
import { FormEvent, useState } from "react";
import { useSession } from "../../app/session";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { formatDateTime } from "../../core/format";
import { useLoad } from "../../core/useLoad";
import { Environment, listEnvironments, setEnvironment } from "./feedback/feedbackApi";
import { useProject } from "./ProjectLayout";

export function EnvironmentsSection() {
  const { project } = useProject();
  // The organisation role, NOT useProject().canWrite -- that one is narrowed by
  // the version lock, and an address is not part of what a version froze. This
  // is the one section on this page that stays editable while the project is
  // locked, matching the backend (set_environment is on the EXEMPT list in
  // test_lock_coverage.py); the Repository section below takes the lock
  // because a repository link is read through the frozen version's own row.
  // The server decides either way -- this only hides what would 403.
  const { canWrite: roleCanWrite } = useSession();

  const environments = useLoad(() => listEnvironments(project.id), [project.id]);
  const [editing, setEditing] = useState<Environment | null>(null);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const rows = environments.data ?? [];

  const openDrawer = (env: Environment) => {
    setEditing(env);
    setUrl(env.url ?? "");
    setFormError(null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    try {
      // The server answers with all three, so nothing has to be merged back in.
      await setEnvironment(project.id, editing.slug, url.trim());
      setEditing(null);
      await environments.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2>Environments</h2>
      </div>

      <div className="section-body stack">
        {environments.error ? (
          <div className="status-banner warn">{environments.error}</div>
        ) : environments.loading && rows.length === 0 ? (
          <span className="muted">Loading…</span>
        ) : (
          <div className="details-grid">
            {rows.map((env) => (
              <EnvironmentRow key={env.slug} env={env} canWrite={roleCanWrite} onEdit={() => openDrawer(env)} />
            ))}
          </div>
        )}
      </div>

      <Drawer
        open={editing !== null}
        title={editing ? `${editing.label} address` : ""}
        onClose={() => setEditing(null)}
        onSubmit={save}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving}>
              {saving ? "Saving…" : url.trim() ? "Save address" : "Clear address"}
            </button>
          </>
        }
      >
        <Field label="Address">
          <input
            className="input"
            type="url"
            placeholder="https://uat.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>
    </section>
  );
}

function EnvironmentRow({
  env,
  canWrite,
  onEdit,
}: {
  env: Environment;
  canWrite: boolean;
  onEdit: () => void;
}) {
  return (
    <>
      <div className="details-label">{env.label}</div>
      <div className="details-value env-row">
        {env.url ? (
          <a className="repo-link" href={env.url} target="_blank" rel="noreferrer noopener">
            {env.url}
          </a>
        ) : (
          <span className="muted">Not set</span>
        )}
        {env.updated_at && <span className="muted">Updated {formatDateTime(env.updated_at)}</span>}
        <span className="shell-spacer" />
        {canWrite && (
          <button type="button" className="btn small ghost" onClick={onEdit}>
            {env.url ? "Change" : "Set"}
          </button>
        )}
      </div>
    </>
  );
}
