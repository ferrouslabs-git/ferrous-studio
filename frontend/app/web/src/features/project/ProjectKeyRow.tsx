// The project key row on the details page: the short code every board id
// starts with (IA-REQ-5), unique within the organisation. Renaming it renames
// every id in the project at once -- the server stores none of them.
//
// Like an environment address it belongs to the lineage, not the version, so
// it reads the organisation role rather than useProject().canWrite and stays
// editable on a locked version (set_board_key is lock-exempt on the server).
//
// The key saves itself like every other edit, but only on leaving the field
// (or Enter), never mid-word: each save renames every id in the project.
import { useState } from "react";
import { useSession } from "../../app/session";
import { AutosaveFooter, closeAfterSave } from "../../components/AutosaveStatus";
import { Drawer, Field } from "../../components/Drawer";
import { useAutosave } from "../../core/useAutosave";
import { useLoad } from "../../core/useLoad";
import { getBoardKey, setBoardKey } from "./board/boardKeyApi";
import { useProject } from "./ProjectLayout";

/** The server's rule (BoardKeyWrite): a letter, then one to five letters or digits. */
const KEY_RE = /^[A-Z][A-Z0-9]{1,5}$/;

export function ProjectKeyRow() {
  const { project } = useProject();
  const { canWrite } = useSession();
  const current = useLoad(() => getBoardKey(project.id), [project.id]);
  const [editing, setEditing] = useState(false);
  const key = current.data?.key ?? null;

  return (
    <>
      <div className="details-label">Key</div>
      <div className="details-value env-row">
        {current.error ? (
          <span className="muted">{current.error}</span>
        ) : key ? (
          <b>{key}</b>
        ) : (
          <span className="muted">Loading…</span>
        )}
        <span className="shell-spacer" />
        {canWrite && key && (
          <button type="button" className="btn small ghost" onClick={() => setEditing(true)}>
            Change
          </button>
        )}
      </div>

      {editing && key && (
        <KeyDrawer
          projectId={project.id}
          initial={key}
          onSaved={current.reload}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

function KeyDrawer({
  projectId,
  initial,
  onSaved,
  onClose,
}: {
  projectId: string;
  initial: string;
  onSaved: () => Promise<unknown>;
  onClose: () => void;
}) {
  // The key the server last confirmed, for the "every id will change" warning.
  const [savedKey, setSavedKey] = useState(initial);
  const form = useAutosave(
    { key: initial },
    {
      delay: null,
      validate: (v) =>
        KEY_RE.test(v.key) ? null : { key: "2 to 6 letters or digits, starting with a letter." },
      save: async (v) => {
        const res = await setBoardKey(projectId, v.key);
        setSavedKey(res.key);
        await onSaved();
      },
    },
  );
  const value = form.value.key;

  return (
    <Drawer
      open
      title="Project key"
      onClose={() => void closeAfterSave(form, onClose)}
      onSubmit={(e) => {
        e.preventDefault();
        void form.flush();
      }}
      footer={<AutosaveFooter auto={form} onClose={onClose} />}
    >
      <Field label="Key" error={form.fieldErrors.key}>
        <input
          className="input"
          maxLength={6}
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={!!form.fieldErrors.key}
          value={value}
          onChange={(e) => form.set({ key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
          onBlur={() => void form.flush()}
        />
      </Field>
      {value && value !== savedKey && KEY_RE.test(value) && (
        <div className="status-banner">
          Every id in this project will change: {savedKey}-REQ-1 becomes {value}-REQ-1.
        </div>
      )}
    </Drawer>
  );
}
