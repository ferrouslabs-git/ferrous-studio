// The Observation capture sub-section of a study: one capture per participant.
// Pick a participant, then run their session from one screen -- the script to
// read, and for each task the stopwatch, error count, outcome and notes.
//
// The participant's own rating and answer arrive from their page, so this
// re-reads them every few seconds and merges in ONLY those fields: whatever
// the moderator is typing is never overwritten.
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../../core/api";
import { formatDateTime } from "../../../core/format";
import { Card } from "./StudyEditor";
import {
  Capture,
  CaptureInput,
  captureTask,
  getCapture,
  Study,
  StudyTask,
  Success,
  TaskResult,
  updateParticipant,
} from "./usabilityApi";
import { clock, parseClock, participantLink, progressLabel } from "./usabilityModel";

const POLL_MS = 5000;
const OUTCOMES: { value: Success; label: string }[] = [
  { value: "complete", label: "Complete" },
  { value: "help", label: "With help" },
  { value: "fail", label: "Fail" },
];

export function StudyCapture({
  projectId,
  study,
  participantId,
  onPick,
}: {
  projectId: string;
  study: Study;
  participantId: string | undefined;
  onPick: (participantId: string) => void;
}) {
  const people = study.participant_list;
  if (people.length === 0) {
    return (
      <div className="empty">
        <b>No participants yet.</b> Add participants to the study, then capture each session here.
      </div>
    );
  }
  const current = people.find((p) => p.id === participantId);

  return (
    <div className="stack">
      <div className="usab-people" role="tablist" aria-label="Participant">
        {people.map((p) => {
          const progress = progressLabel(p);
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === current?.id}
              className={`usab-person${p.id === current?.id ? " active" : ""}`}
              onClick={() => onPick(p.id)}
            >
              <b>{p.code}</b>
              <span className="muted">{progress.text}</span>
            </button>
          );
        })}
      </div>
      {current ? (
        <ParticipantCapture key={current.id} projectId={projectId} study={study} participantId={current.id} />
      ) : (
        <div className="empty">Choose a participant to capture their session.</div>
      )}
    </div>
  );
}

function ParticipantCapture({ projectId, study, participantId }: { projectId: string; study: Study; participantId: string }) {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    getCapture(projectId, study.id, participantId)
      .then((c) => {
        setCapture(c);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [projectId, study.id, participantId]);
  useEffect(load, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      getCapture(projectId, study.id, participantId)
        .then((fresh) =>
          setCapture(
            (old) =>
              old && {
                ...old,
                consent_name: fresh.consent_name,
                consent_at: fresh.consent_at,
                words: fresh.words,
                top_words: fresh.top_words,
                completed_at: fresh.completed_at,
                progress: fresh.progress,
                tasks: old.tasks.map((t) => {
                  const theirs = fresh.tasks.find((x) => x.task_id === t.task_id);
                  return theirs ? { ...t, rating: theirs.rating, answer: theirs.answer } : t;
                }),
              },
          ),
        )
        .catch(() => {
          // A missed poll is retried in a few seconds.
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [projectId, study.id, participantId]);

  const save = async (taskId: string, input: CaptureInput) => {
    setError(null);
    setCapture(
      (c) =>
        c && {
          ...c,
          tasks: c.tasks.map((t) =>
            t.task_id === taskId
              ? { ...t, ...input, success: input.success === undefined ? t.success : input.success || null }
              : t,
          ),
        },
    );
    try {
      await captureTask(projectId, study.id, participantId, taskId, input);
    } catch (err) {
      setError(`Not saved: ${errorMessage(err)}`);
    }
  };
  const saveNotes = async (session_notes: string) => {
    setError(null);
    try {
      await updateParticipant(projectId, study.id, participantId, { session_notes });
    } catch (err) {
      setError(`Not saved: ${errorMessage(err)}`);
    }
  };

  if (!capture) {
    return error ? (
      <div className="usab-warning" role="alert">
        {error}
      </div>
    ) : (
      <div className="muted">Loading…</div>
    );
  }
  const script = study.content.script;
  const who = [capture.role, capture.company, capture.characteristics].filter(Boolean).join(" · ");

  return (
    <div className="stack">
      {error && (
        <div className="usab-warning" role="alert">
          {error}
        </div>
      )}
      <div className="row">
        <b>{capture.code}</b>
        {who && <span className="muted">{who}</span>}
        <span className="shell-spacer" />
        <button
          type="button"
          className="btn small ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(participantLink(capture.token));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy participant link"}
        </button>
      </div>

      <Card title="Before you start">
        <Lines items={script.before} />
        <p className="usab-fact">
          <b>Test account</b> {capture.account_email || study.account_email || "not set"} at {capture.app_url || "no address set"}
        </p>
      </Card>

      <Card title="Welcome" note="Read aloud">
        <Lines items={script.welcome} read />
        <p className="usab-fact">
          <b>Consent</b>{" "}
          {capture.consent_name
            ? `given by ${capture.consent_name}${capture.consent_at ? ` on ${formatDateTime(capture.consent_at)}` : ""}`
            : "not given yet"}
        </p>
      </Card>

      <Card title="During each task">
        <Lines items={script.per_task} />
      </Card>

      {study.content.tasks.map((task, i) => {
        const result = capture.tasks.find((t) => t.task_id === task.id);
        return result && <TaskCapture key={task.id} index={i} task={task} result={result} onSave={(input) => void save(task.id, input)} />;
      })}

      <Card title="Wrap-up" note="Read aloud">
        <Lines items={script.wrap_up} read />
        {capture.top_words.length > 0 && (
          <p className="usab-fact">
            <b>Their words</b> {capture.top_words.join(", ")}
            {capture.words.length > capture.top_words.length && ` (from ${capture.words.length} ticked)`}
          </p>
        )}
      </Card>

      <Card title="Session notes">
        <textarea
          className="input textarea usab-wide"
          rows={4}
          aria-label="Session notes"
          defaultValue={capture.session_notes}
          onBlur={(e) => void saveNotes(e.target.value)}
        />
      </Card>

      <Card title="After the session">
        <Lines items={script.after} />
      </Card>
    </div>
  );
}

function Lines({ items, read }: { items: string[]; read?: boolean }) {
  if (items.length === 0) return <span className="muted">Nothing here.</span>;
  return (
    <ul className={`usab-lines${read ? " read" : ""}`}>
      {items.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}

function TaskCapture({
  index,
  task,
  result,
  onSave,
}: {
  index: number;
  task: StudyTask;
  result: TaskResult;
  onSave: (input: CaptureInput) => void;
}) {
  // The stopwatch counts on top of whatever time is already saved, so a task
  // that was paused (or a page that was reloaded) carries on rather than restarting.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const base = useRef(0);
  const running = startedAt != null;
  const no = index + 1;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [running]);

  const start = () => {
    base.current = result.time_seconds ?? 0;
    setStartedAt(Date.now());
  };
  const stop = () => {
    if (startedAt == null) return;
    onSave({ time_seconds: base.current + Math.floor((Date.now() - startedAt) / 1000) });
    setStartedAt(null);
  };
  const errors = result.errors ?? 0;

  return (
    <section className="section" data-testid={`capture-task-${no}`}>
      <div className="section-head">
        <h2>Task {no}</h2>
        <span className="muted">{task.title}</span>
      </div>
      <div className="section-body usab-two">
        <div>
          <p className="usab-read">{task.scenario}</p>
          {task.files.length > 0 && (
            <p className="usab-fact">
              <b>They are given</b> <span className="mono">{task.files.join(", ")}</span>
            </p>
          )}
          {task.success && (
            <p className="usab-fact">
              <b>Success when</b> {task.success}
            </p>
          )}
          {task.path && (
            <p className="usab-fact">
              <b>Expected path</b> {task.path}
            </p>
          )}
          {task.watch && (
            <p className="usab-fact">
              <b>Watch for</b> {task.watch}
            </p>
          )}
          {task.probes.length > 0 && (
            <p className="usab-fact">
              <b>Ask afterwards</b> {task.probes.join(" ")}
            </p>
          )}
        </div>
        <div>
          <div className="usab-measures">
            <div className="usab-measure">
              <span className="drawer-field-label">Time on task</span>
              <div className="row">
                {running ? (
                  <span className="usab-figure" data-testid={`capture-clock-${no}`}>
                    {clock(base.current + Math.floor((Date.now() - (startedAt ?? 0)) / 1000))}
                  </span>
                ) : (
                  <input
                    className="input usab-figure-input"
                    aria-label={`Task ${no} time on task`}
                    key={result.time_seconds ?? "none"}
                    defaultValue={result.time_seconds == null ? "" : clock(result.time_seconds)}
                    placeholder="m:ss"
                    onBlur={(e) => {
                      const text = e.target.value.trim();
                      const next = text === "" ? null : parseClock(text);
                      if (text !== "" && next == null) {
                        e.target.value = result.time_seconds == null ? "" : clock(result.time_seconds);
                        return;
                      }
                      if (next !== result.time_seconds) onSave({ time_seconds: next });
                    }}
                  />
                )}
                {running ? (
                  <button type="button" className="btn small primary" onClick={stop}>
                    Stop
                  </button>
                ) : (
                  <button type="button" className="btn small" onClick={start}>
                    {result.time_seconds ? "Resume" : "Start"}
                  </button>
                )}
              </div>
            </div>
            <div className="usab-measure">
              <span className="drawer-field-label">No. of errors</span>
              <div className="row">
                <button type="button" className="btn small" aria-label={`Task ${no} one fewer error`} disabled={errors === 0} onClick={() => onSave({ errors: errors - 1 })}>
                  −
                </button>
                <span className="usab-figure" data-testid={`capture-errors-${no}`}>
                  {result.errors == null ? "–" : result.errors}
                </span>
                <button type="button" className="btn small" aria-label={`Task ${no} one more error`} onClick={() => onSave({ errors: errors + 1 })}>
                  +
                </button>
              </div>
            </div>
            <div className="usab-measure">
              <span className="drawer-field-label">Satisfaction</span>
              <div className="row">
                <span className="usab-figure" data-testid={`capture-rating-${no}`}>
                  {result.rating == null ? "–" : `${result.rating}/10`}
                </span>
              </div>
            </div>
          </div>
          <div className="usab-measure">
            <span className="drawer-field-label">Task success</span>
            <div className="row" role="radiogroup" aria-label={`Task ${no} success`}>
              {OUTCOMES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={result.success === o.value}
                  className={`btn small${result.success === o.value ? " primary" : ""}`}
                  onClick={() => onSave({ success: result.success === o.value ? "" : o.value })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <label className="drawer-field">
            <span className="drawer-field-label">Observations</span>
            <textarea
              className="input textarea usab-wide"
              rows={5}
              aria-label={`Task ${no} observations`}
              defaultValue={result.observations}
              onBlur={(e) => {
                if (e.target.value !== result.observations) onSave({ observations: e.target.value });
              }}
            />
          </label>
          {task.answer_prompt && (
            <p className="usab-fact">
              <b>{task.answer_prompt}</b> {result.answer || <span className="muted">No answer yet</span>}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
