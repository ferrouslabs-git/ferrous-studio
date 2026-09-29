// The Environments section of the project details page: where a build of this
// product can be reached, in the order it is promoted through them.
//
// It sits beside Repository rather than on the Feedback tab because it is the
// same kind of thing -- filing, set once by an admin, read constantly by
// everyone else. Feedback then links to whatever is published here.
//
// The list is the project's own: it starts as UAT, Staging and Production and
// can be added to, renamed, reordered and pruned. A long list folds down to
// its first few rows. An environment reports were raised against cannot be
// removed (the server refuses it), so its delete stays disabled.
//
// Addresses belong to the project *lineage*, not to a version: every version
// of a project shares one UAT link, and a locked version can still have a
// wrong one corrected (the backend uses get_project, not
// get_writable_project). That is why this section stays available on a frozen
// version while the Edit button above it does not.
import { FormEvent, useState } from "react";
import { useSession } from "../../app/session";
import { Confirmation, ConfirmationDrawer } from "../../components/ConfirmDrawer";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { formatDateTime } from "../../core/format";
import { useLoad } from "../../core/useLoad";
import {
  createEnvironment,
  deleteEnvironment,
  Environment,
  listEnvironments,
  reorderEnvironments,
  setEnvironment,
} from "./feedback/feedbackApi";
import { useProject } from "./ProjectLayout";

/** More rows than this and the list folds down to its first FOLDED_ROWS. */
const FOLD_OVER = 4;
const FOLDED_ROWS = 3;

/** The drawer's subject: an environment being edited, or a new one. */
type Editing = { env: Environment | null };

export function EnvironmentsSection() {
  const { project } = useProject();
  // The organisation role, NOT useProject().canWrite -- that one is narrowed by
  // the version lock, and an address is not part of what a version froze. This
  // is the one section on this page that stays editable while the project is
  // locked, matching the backend (the environment routes are on the EXEMPT
  // list in test_lock_coverage.py); the Repository section below takes the
  // lock because a repository link is read through the frozen version's own
  // row. The server decides either way -- this only hides what would 403.
  const { canWrite: roleCanWrite } = useSession();

  const environments = useLoad(() => listEnvironments(project.id), [project.id]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const rows = environments.data ?? [];
  const folds = rows.length > FOLD_OVER;
  const shown = folds && !expanded ? rows.slice(0, FOLDED_ROWS) : rows;

  const openDrawer = (env: Environment | null) => {
    setEditing({ env });
    setLabel(env?.label ?? "");
    setUrl(env?.url ?? "");
    setFormError(null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    try {
      if (editing.env) {
        await setEnvironment(project.id, editing.env.slug, { label: label.trim(), url: url.trim() });
      } else {
        await createEnvironment(project.id, { label: label.trim(), url: url.trim() });
        // A new one lands at the end, which a folded list would hide.
        setExpanded(true);
      }
      setEditing(null);
      await environments.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const move = async (from: number, to: number) => {
    const slugs = rows.map((r) => r.slug);
    [slugs[from], slugs[to]] = [slugs[to], slugs[from]];
    setMoveError(null);
    try {
      await reorderEnvironments(project.id, slugs);
    } catch (err) {
      setMoveError(errorMessage(err));
    }
    await environments.reload();
  };

  const remove = (env: Environment) =>
    setConfirming({
      title: `Remove ${env.label}`,
      body: (
        <p>
          Remove <b>{env.label}</b>
          {env.url ? (
            <>
              {" "}
              and its address <code>{env.url}</code>
            </>
          ) : null}
          ?
        </p>
      ),
      confirmLabel: "Remove",
      run: async () => {
        await deleteEnvironment(project.id, env.slug);
        await environments.reload();
      },
    });

  return (
    <section className="section">
      <div className="section-head">
        <h2>Environments</h2>
        {rows.length > 0 && <span className="muted">{rows.length}</span>}
        <span className="shell-spacer" />
        {roleCanWrite && (
          <button type="button" className="btn small" onClick={() => openDrawer(null)}>
            + Add environment
          </button>
        )}
      </div>

      <div className="section-body stack">
        {environments.error ? (
          <div className="status-banner warn">{environments.error}</div>
        ) : environments.loading && rows.length === 0 ? (
          <span className="muted">Loading…</span>
        ) : rows.length === 0 ? (
          <span className="muted">No environments.</span>
        ) : (
          <div className="details-grid">
            {shown.map((env, i) => (
              <EnvironmentRow
                key={env.slug}
                env={env}
                canWrite={roleCanWrite}
                onEdit={() => openDrawer(env)}
                onRemove={() => remove(env)}
                onUp={i > 0 ? () => void move(i, i - 1) : undefined}
                onDown={i < rows.length - 1 ? () => void move(i, i + 1) : undefined}
              />
            ))}
          </div>
        )}
        {moveError && <div className="status-banner warn">{moveError}</div>}
        {folds && (
          <div>
            <button type="button" className="btn small ghost" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show fewer" : `Show all ${rows.length}`}
            </button>
          </div>
        )}
      </div>

      <Drawer
        open={editing !== null}
        title={editing?.env ? editing.env.label : "New environment"}
        onClose={() => setEditing(null)}
        onSubmit={save}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !label.trim()}>
              {saving ? "Saving…" : editing?.env ? "Save" : "Add environment"}
            </button>
          </>
        }
      >
        <Field label="Name">
          <input className="input" placeholder="e.g. Demo" maxLength={64} value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
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
      <ConfirmationDrawer pending={confirming} onClose={() => setConfirming(null)} />
    </section>
  );
}

function EnvironmentRow({
  env,
  canWrite,
  onEdit,
  onRemove,
  onUp,
  onDown,
}: {
  env: Environment;
  canWrite: boolean;
  onEdit: () => void;
  onRemove: () => void;
  /** Absent at the top (or bottom) of the list. */
  onUp?: () => void;
  onDown?: () => void;
}) {
  const reports = env.feedback_count;
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
          <>
            <button type="button" className="btn small ghost" title="move up" aria-label={`Move ${env.label} up`} disabled={!onUp} onClick={onUp}>
              ↑
            </button>
            <button type="button" className="btn small ghost" title="move down" aria-label={`Move ${env.label} down`} disabled={!onDown} onClick={onDown}>
              ↓
            </button>
            <button type="button" className="btn small ghost" onClick={onEdit}>
              Edit
            </button>
            <button
              type="button"
              className="btn small ghost danger"
              disabled={reports > 0}
              title={reports > 0 ? `${reports} feedback report${reports === 1 ? "" : "s"} raised against ${env.label}` : undefined}
              onClick={onRemove}
            >
              Remove
            </button>
          </>
        )}
      </div>
    </>
  );
}
