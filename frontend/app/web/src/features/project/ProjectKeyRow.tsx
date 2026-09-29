// The project key row on the details page: the short code every board id
// starts with (IA-REQ-5), unique within the organisation. Renaming it renames
// every id in the project at once -- the server stores none of them.
//
// Like an environment address it belongs to the lineage, not the version, so
// it reads the organisation role rather than useProject().canWrite and stays
// editable on a locked version (set_board_key is lock-exempt on the server).
import { FormEvent, useState } from "react";
import { useSession } from "../../app/session";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { useLoad } from "../../core/useLoad";
import { getBoardKey, setBoardKey } from "./board/boardKeyApi";
import { useProject } from "./ProjectLayout";

export function ProjectKeyRow() {
  const { project } = useProject();
  const { canWrite } = useSession();
  const current = useLoad(() => getBoardKey(project.id), [project.id]);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = current.data?.key ?? null;

  const open = () => {
    setValue(key ?? "");
    setError(null);
    setEditing(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await setBoardKey(project.id, value.trim().toUpperCase());
      setEditing(false);
      await current.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

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
          <button type="button" className="btn small ghost" onClick={open}>
            Change
          </button>
        )}
      </div>

      <Drawer
        open={editing}
        title="Project key"
        onClose={() => setEditing(false)}
        onSubmit={save}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !value.trim() || value.trim().toUpperCase() === key}>
              {saving ? "Saving…" : "Save key"}
            </button>
          </>
        }
      >
        <Field label="Key">
          <input
            className="input"
            maxLength={6}
            autoCapitalize="characters"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          />
        </Field>
        {value.trim() && value.trim() !== key && (
          <div className="status-banner">
            Every id in this project will change: {key}-REQ-1 becomes {value.trim()}-REQ-1.
          </div>
        )}
        {error && <div className="status-banner warn">{error}</div>}
      </Drawer>
    </>
  );
}
