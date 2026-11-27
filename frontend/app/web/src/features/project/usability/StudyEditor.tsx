// The Study sub-section: everything a study tests with. Details, research
// questions, the protocol and consent form a participant reads, the tasks,
// the files tasks hand out, the moderator's script and the word list.
// Saved as you go, like the other project forms; files save when chosen.
import { ReactNode, useRef, useState } from "react";
import { AutosaveStatus } from "../../../components/AutosaveStatus";
import { ComboBox } from "../../../components/ComboBox";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { errorMessage } from "../../../core/api";
import { useAutosave } from "../../../core/useAutosave";
import { useLoad } from "../../../core/useLoad";
import { listPersonas } from "../personas/personasApi";
import {
  deleteStudyFile,
  exportStudy,
  Study,
  StudyContent,
  StudyDetails,
  StudyFile,
  StudyScript,
  StudyTask,
  updateStudy,
  uploadStudyFile,
} from "./usabilityApi";
import {
  downloadText,
  fileToBase64,
  formatSize,
  linesToList,
  moveItem,
  newTask,
  slug,
  WEB_ADDRESS_ERROR,
  webAddress,
} from "./usabilityModel";

interface Form extends StudyDetails {
  content: StudyContent;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;

const SCRIPT_PARTS: { key: keyof StudyScript; label: string }[] = [
  { key: "before", label: "Before you start" },
  { key: "welcome", label: "Welcome, read aloud" },
  { key: "per_task", label: "During each task" },
  { key: "wrap_up", label: "Wrap-up, read aloud" },
  { key: "after", label: "After the session" },
];

export function StudyEditor({
  projectId,
  study,
  onSaved,
}: {
  projectId: string;
  study: Study;
  onSaved: () => Promise<unknown>;
}) {
  const personas = useLoad(() => listPersonas(projectId), [projectId]);
  const auto = useAutosave<Form>(
    {
      name: study.name,
      persona: study.persona,
      duration: study.duration,
      app_url: study.app_url,
      account_email: study.account_email,
      account_password: study.account_password,
      account_notes: study.account_notes,
      content: study.content,
    },
    {
      validate: (f) => {
        if (!f.name.trim()) return { name: "A study needs a name." };
        if (f.app_url.trim() && !webAddress(f.app_url)) return { app_url: WEB_ADDRESS_ERROR };
        return null;
      },
      save: async (f) => {
        await updateStudy(projectId, study.id, f);
        await onSaved();
      },
    },
  );
  const form = auto.value;
  const content = form.content;
  const setContent = (patch: Partial<StudyContent>) => auto.set((f) => ({ ...f, content: { ...f.content, ...patch } }));
  const setTask = (id: string, patch: Partial<StudyTask>) =>
    setContent({ tasks: content.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [removing, setRemoving] = useState<StudyTask | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const addTask = () => {
    const task = newTask();
    setContent({ tasks: [...content.tasks, task] });
    setOpenTask(task.id);
  };

  const download = async () => {
    setExportError(null);
    try {
      await auto.flush();
      const doc = await exportStudy(projectId, study.id);
      downloadText(`${slug(study.name)}.study.json`, JSON.stringify(doc, null, 2), "application/json");
    } catch (err) {
      setExportError(errorMessage(err));
    }
  };

  return (
    <div className="stack" onBlur={() => void auto.flush()}>
      <div className="row">
        <AutosaveStatus auto={auto} />
        <span className="shell-spacer" />
        <button type="button" className="btn ghost small" onClick={() => void download()}>
          Export study
        </button>
      </div>
      {exportError && (
        <div className="usab-warning" role="alert">
          {exportError}
        </div>
      )}

      <Card title="Details">
        <div className="usab-grid">
          <Labelled label="Name" error={auto.fieldErrors.name}>
            <input className="input" value={form.name} onChange={(e) => auto.set({ name: e.target.value })} />
          </Labelled>
          <Labelled label="Persona">
            <ComboBox
              value={form.persona}
              onChange={(persona) => auto.set({ persona })}
              options={(personas.data ?? []).map((p) => p.name)}
            />
          </Labelled>
          <Labelled label="How long it takes">
            <input
              className="input"
              value={form.duration}
              placeholder="about 60 minutes"
              onChange={(e) => auto.set({ duration: e.target.value })}
            />
          </Labelled>
          <Labelled label="Application address" error={auto.fieldErrors.app_url}>
            <input
              className="input"
              value={form.app_url}
              placeholder="https://"
              onChange={(e) => auto.set({ app_url: e.target.value })}
            />
          </Labelled>
        </div>
      </Card>

      <Card title="Research questions">
        <Paragraphs
          label="Research question"
          value={content.research_questions}
          onChange={(research_questions) => setContent({ research_questions })}
          addLabel="Add question"
        />
      </Card>

      <Card title="Protocol">
        <Paragraphs label="Protocol paragraph" value={content.protocol} onChange={(protocol) => setContent({ protocol })} addLabel="Add paragraph" />
      </Card>

      <Card title="Consent form" note={`Version ${study.consent_version}`}>
        <Labelled label="Title">
          <input className="input" value={content.consent_title} onChange={(e) => setContent({ consent_title: e.target.value })} />
        </Labelled>
        <Paragraphs
          label="Consent paragraph"
          value={content.consent_text}
          onChange={(consent_text) => setContent({ consent_text })}
          addLabel="Add paragraph"
        />
      </Card>

      {/* Whether participants are given an account to sign in with, or sign up themselves as part of the testing. */}
      <Card title="Signing in">
        <label className="row">
          <input type="checkbox" checked={content.sign_up} onChange={(e) => setContent({ sign_up: e.target.checked })} />
          Testing includes signing up
        </label>
        {/* The study's test account: every participant gets it unless their own details say otherwise. */}
        <div className="usab-grid">
          <Labelled label={content.sign_up ? "Email to sign up with" : "Test account email"}>
            <input
              className="input"
              autoComplete="off"
              value={form.account_email}
              onChange={(e) => auto.set({ account_email: e.target.value })}
            />
          </Labelled>
          {!content.sign_up && (
            <Labelled label="Test account password">
              <input
                className="input"
                autoComplete="off"
                value={form.account_password}
                onChange={(e) => auto.set({ account_password: e.target.value })}
              />
            </Labelled>
          )}
        </div>
        <Labelled label="Anything else they need to sign in">
          <textarea
            className="input textarea"
            rows={2}
            value={form.account_notes}
            onChange={(e) => auto.set({ account_notes: e.target.value })}
          />
        </Labelled>
        {content.sign_up && (
          <Paragraphs
            label="Instruction"
            value={content.sign_up_text}
            onChange={(sign_up_text) => setContent({ sign_up_text })}
            addLabel="Add instruction"
          />
        )}
      </Card>

      <Card
        title="Tasks"
        note={`${content.tasks.length} ${content.tasks.length === 1 ? "task" : "tasks"}`}
        action={
          <button type="button" className="btn small primary" onClick={addTask}>
            Add task
          </button>
        }
      >
        {content.tasks.length === 0 && <div className="empty">No tasks yet.</div>}
        {content.tasks.map((task, i) => (
          <TaskCard
            key={task.id}
            index={i}
            total={content.tasks.length}
            task={task}
            files={study.files}
            open={openTask === task.id}
            onToggle={() => setOpenTask(openTask === task.id ? null : task.id)}
            onChange={(patch) => setTask(task.id, patch)}
            onMove={(to) => setContent({ tasks: moveItem(content.tasks, i, to) })}
            onRemove={() => setRemoving(task)}
          />
        ))}
      </Card>

      <FilesCard projectId={projectId} study={study} onChanged={onSaved} />

      <Card title="Moderator's script">
        {SCRIPT_PARTS.map((part) => (
          <div key={part.key} className="usab-block">
            <h3>{part.label}</h3>
            <Paragraphs
              label={part.label}
              value={content.script[part.key]}
              onChange={(lines) => setContent({ script: { ...content.script, [part.key]: lines } })}
              addLabel="Add line"
            />
          </div>
        ))}
      </Card>

      <Card title="Word choice" note={`${content.words.length} words, one per line`}>
        <div className="usab-grid">
          <Labelled label="Words to choose from">
            <textarea
              className="input textarea usab-words-edit"
              defaultValue={content.words.join("\n")}
              onBlur={(e) => setContent({ words: linesToList(e.target.value) })}
            />
          </Labelled>
          <Labelled label="How many to pick as most descriptive">
            <input
              className="input"
              type="number"
              min={1}
              max={10}
              value={content.top_words}
              onChange={(e) => setContent({ top_words: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </Labelled>
        </div>
      </Card>

      <ConfirmDrawer
        open={removing !== null}
        title="Remove task"
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          setContent({ tasks: content.tasks.filter((t) => t.id !== removing.id) });
          await auto.flush();
        }}
      >
        <p>
          Remove <b>{removing?.title || "this task"}</b>? Anything already captured for it stops showing in the capture
          and the insights.
        </p>
      </ConfirmDrawer>
    </div>
  );
}

// ── small building blocks ───────────────────────────────────────────────────

export function Card({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {note && <span className="muted">{note}</span>}
        <span className="shell-spacer" />
        {action}
      </div>
      <div className="section-body">{children}</div>
    </section>
  );
}

function Labelled({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="drawer-field">
      <span className="drawer-field-label">{label}</span>
      {children}
      {error && <span className="drawer-field-error">{error}</span>}
    </label>
  );
}

/** A list of paragraphs: one growing text box each, with remove and add. */
function Paragraphs({
  label,
  value,
  onChange,
  addLabel,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
}) {
  return (
    <div className="usab-paragraphs">
      {value.map((text, i) => (
        <div className="usab-paragraph" key={i}>
          <textarea
            className="input textarea"
            aria-label={`${label} ${i + 1}`}
            rows={Math.min(6, Math.max(1, Math.ceil(text.length / 110)))}
            value={text}
            onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)))}
          />
          <button
            type="button"
            className="btn icon"
            aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
            title="Remove"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn small ghost" onClick={() => onChange([...value, ""])}>
        + {addLabel}
      </button>
    </div>
  );
}

function TaskCard({
  index,
  total,
  task,
  files,
  open,
  onToggle,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  task: StudyTask;
  files: StudyFile[];
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<StudyTask>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const toggleFile = (name: string) =>
    onChange({ files: task.files.includes(name) ? task.files.filter((f) => f !== name) : [...task.files, name] });
  // A file a task names but the study no longer holds is not offered to a participant.
  const missing = task.files.filter((name) => !files.some((f) => f.name === name));

  return (
    <div className={`usab-task${open ? " open" : ""}`}>
      <div className="usab-task-head">
        <button type="button" className="usab-task-toggle" aria-expanded={open} onClick={onToggle}>
          <span className="usab-task-no">Task {index + 1}</span>
          <span className="usab-task-title">{task.title || <span className="muted">Untitled</span>}</span>
        </button>
        <button type="button" className="btn icon" aria-label={`Move task ${index + 1} up`} title="Move up" disabled={index === 0} onClick={() => onMove(index - 1)}>
          ↑
        </button>
        <button type="button" className="btn icon" aria-label={`Move task ${index + 1} down`} title="Move down" disabled={index === total - 1} onClick={() => onMove(index + 1)}>
          ↓
        </button>
        <button type="button" className="btn icon" aria-label={`Remove task ${index + 1}`} title="Remove" onClick={onRemove}>
          ×
        </button>
      </div>
      {open && (
        <div className="usab-task-body">
          <div className="usab-two">
            <div>
              <h3>What the participant sees</h3>
              <Labelled label="Title">
                <input className="input" value={task.title} onChange={(e) => onChange({ title: e.target.value })} />
              </Labelled>
              <Labelled label="Scenario">
                <textarea className="input textarea" rows={4} value={task.scenario} onChange={(e) => onChange({ scenario: e.target.value })} />
              </Labelled>
              <div className="drawer-field">
                <span className="drawer-field-label">Notes</span>
                <Paragraphs label="Note" value={task.notes} onChange={(notes) => onChange({ notes })} addLabel="Add note" />
              </div>
              <div className="drawer-field">
                <span className="drawer-field-label">Files they are given</span>
                {files.length === 0 && <span className="muted">This study has no files yet.</span>}
                <div className="usab-checks">
                  {files.map((f) => (
                    <label key={f.id} className="usab-check">
                      <input type="checkbox" checked={task.files.includes(f.name)} onChange={() => toggleFile(f.name)} />
                      {f.name}
                    </label>
                  ))}
                </div>
                {missing.length > 0 && (
                  <span className="drawer-field-error">
                    Not in this study any more: {missing.join(", ")}.{" "}
                    <button type="button" className="usab-link" onClick={() => onChange({ files: task.files.filter((n) => !missing.includes(n)) })}>
                      Remove
                    </button>
                  </span>
                )}
              </div>
              <Labelled label="Question to answer afterwards">
                <input
                  className="input"
                  value={task.answer_prompt ?? ""}
                  onChange={(e) => onChange({ answer_prompt: e.target.value || null })}
                />
              </Labelled>
            </div>
            <div>
              <h3>For the moderator only</h3>
              <Labelled label="Success when">
                <textarea className="input textarea" rows={2} value={task.success} onChange={(e) => onChange({ success: e.target.value })} />
              </Labelled>
              <Labelled label="Expected path">
                <textarea className="input textarea" rows={2} value={task.path} onChange={(e) => onChange({ path: e.target.value })} />
              </Labelled>
              <Labelled label="Watch for">
                <textarea className="input textarea" rows={3} value={task.watch} onChange={(e) => onChange({ watch: e.target.value })} />
              </Labelled>
              <div className="drawer-field">
                <span className="drawer-field-label">Ask afterwards</span>
                <Paragraphs label="Question" value={task.probes} onChange={(probes) => onChange({ probes })} addLabel="Add question" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilesCard({ projectId, study, onChanged }: { projectId: string; study: Study; onChanged: () => Promise<unknown> }) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const used = (name: string) => study.content.tasks.filter((t) => t.files.includes(name)).length;

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(list)) {
        if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 2 MB.`);
        await uploadStudyFile(projectId, study.id, {
          name: file.name,
          content_type: file.type || "application/octet-stream",
          data_base64: await fileToBase64(file),
        });
      }
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  };
  const remove = async (file: StudyFile) => {
    setError(null);
    try {
      await deleteStudyFile(projectId, study.id, file.id);
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card
      title="Files"
      action={
        <>
          <input ref={picker} type="file" multiple hidden aria-label="Files to add to the study" onChange={(e) => void upload(e.target.files)} />
          <button type="button" className="btn small primary" disabled={busy} onClick={() => picker.current?.click()}>
            {busy ? "Uploading…" : "Add files"}
          </button>
        </>
      }
    >
      {error && (
        <div className="usab-warning" role="alert">
          {error}
        </div>
      )}
      {study.files.length === 0 ? (
        <div className="empty">No files yet.</div>
      ) : (
        <table className="usab-table">
          <thead>
            <tr>
              <th>File</th>
              <th className="num">Size</th>
              <th className="num">Used by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {study.files.map((f) => (
              <tr key={f.id}>
                <td className="mono">{f.name}</td>
                <td className="num">{formatSize(f.size)}</td>
                <td className="num">
                  {used(f.name)} {used(f.name) === 1 ? "task" : "tasks"}
                </td>
                <td className="num">
                  <button type="button" className="btn small ghost danger" onClick={() => void remove(f)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
