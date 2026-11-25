// Where a usability study participant's link lands: /study/:token.
//
// Public: a participant has no account, and holding the link is the proof, as
// with an invitation. Until consent is given the server sends only the
// protocol and the consent form, so there is nothing here to hide client-side.
// After consent the page walks them through: sign-in details, each task (its
// files, an ease rating and sometimes an answer), the word choice exercise,
// and a thank-you. Everything is saved as it is entered, so a reload loses
// nothing.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { errorMessage } from "../../../core/api";
import { formatDate } from "../../../core/format";
import {
  completeSession,
  getSession,
  giveConsent,
  saveSessionTask,
  saveSessionWords,
  Session,
  sessionFileUrl,
  SessionTask,
} from "./usabilityApi";
import { webAddress } from "./usabilityModel";

interface Step {
  id: string;
  label: string;
}

const stepKey = (token: string) => `studio_study_step_${token}`;

// Which step they were on is a convenience only: the page works without it.
function readStep(token: string): string | null {
  try {
    return localStorage.getItem(stepKey(token));
  } catch {
    return null;
  }
}
function writeStep(token: string, id: string): void {
  try {
    localStorage.setItem(stepKey(token), id);
  } catch {
    // Storage is unavailable (a private window); carry on.
  }
}

export function ParticipantPage() {
  const { token = "" } = useParams();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStepState] = useState("consent");

  useEffect(() => {
    getSession(token)
      .then((s) => {
        setSession(s);
        if (!s.consent.given) setStepState("consent");
        else if (s.completed) setStepState("done");
        else setStepState(readStep(token) ?? "account");
      })
      .catch((err) => setError(errorMessage(err)));
  }, [token]);

  const setStep = useCallback(
    (id: string) => {
      setStepState(id);
      writeStep(token, id);
      window.scrollTo(0, 0);
    },
    [token],
  );

  const tasks = session?.tasks ?? [];
  const steps: Step[] = useMemo(
    () => [
      { id: "consent", label: "Welcome and consent" },
      { id: "account", label: "Signing in" },
      ...tasks.map((t, i) => ({ id: `task-${t.id}`, label: `Task ${i + 1}` })),
      { id: "words", label: "Word choice" },
      { id: "done", label: "Finished" },
    ],
    [tasks],
  );

  if (error) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>This link is not working</h1>
          <p>{error}</p>
          <p>If you were sent this link for a usability session, ask the person who sent it for a new one.</p>
        </div>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  const locked = !session.consent.given;
  const index = Math.max(0, steps.findIndex((s) => s.id === step));
  const go = (delta: number) => setStep(steps[Math.min(steps.length - 1, Math.max(0, index + delta))].id);
  const patchTask = (id: string, next: Partial<SessionTask>) =>
    setSession((s) => s && { ...s, tasks: (s.tasks ?? []).map((t) => (t.id === id ? { ...t, ...next } : t)) });
  const done = (id: string): boolean => {
    if (id === "consent") return session.consent.given;
    if (id === "account") return session.consent.given && index > 1;
    if (id.startsWith("task-")) return tasks.find((t) => `task-${t.id}` === id)?.rating != null;
    if (id === "words") return (session.top_words ?? []).length > 0;
    return !!session.completed;
  };
  const taskIndex = tasks.findIndex((t) => `task-${t.id}` === step);
  const task = taskIndex >= 0 ? tasks[taskIndex] : undefined;

  return (
    <div className="ustudy">
      <nav className="ustudy-rail" aria-label="Study steps">
        <div className="ustudy-name">{session.title}</div>
        <div className="ustudy-code">
          {session.organisation} · participant {session.code}
        </div>
        <ol className="ustudy-steps">
          {steps.map((s) => {
            const disabled = locked && s.id !== "consent";
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={disabled}
                  className={`ustudy-step${s.id === step ? " active" : ""}`}
                  aria-current={s.id === step ? "step" : undefined}
                  onClick={() => setStep(s.id)}
                >
                  <span className="ustudy-tick" aria-hidden>
                    {!disabled && done(s.id) ? "✓" : ""}
                  </span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="ustudy-main">
        {step === "consent" && (
          <ConsentStep
            token={token}
            session={session}
            onDone={(s) => {
              setSession(s);
              setStep("account");
            }}
          />
        )}
        {step === "account" && session.account && <AccountStep account={session.account} onNext={() => go(1)} />}
        {task && (
          <TaskStep
            key={task.id}
            token={token}
            task={task}
            number={taskIndex + 1}
            total={tasks.length}
            onChange={(next) => patchTask(task.id, next)}
            onBack={() => go(-1)}
            onNext={() => go(1)}
          />
        )}
        {step === "words" && session.word_list && (
          <WordsStep
            token={token}
            session={session}
            onChange={(words, top_words) => setSession((s) => s && { ...s, words, top_words })}
            onBack={() => go(-1)}
            onDone={() => {
              setSession((s) => s && { ...s, completed: true });
              setStep("done");
            }}
          />
        )}
        {step === "done" && (
          <section>
            <h1>Thank you</h1>
            <p className="ustudy-lead">
              That is everything. We appreciate your participation. Your moderator will finish the session with you.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

function ConsentStep({ token, session, onDone }: { token: string; session: Session; onDone: (s: Session) => void }) {
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await giveConsent(token, name.trim()));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <section>
      <h1>{session.title}</h1>
      <p className="muted">
        A usability study by {session.organisation}
        {session.duration && ` · ${session.duration}`}
      </p>
      <div className="ustudy-cols">
        <div className="section">
          <div className="section-head">
            <h2>About this study</h2>
          </div>
          <div className="section-body ustudy-prose">
            {session.protocol.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
        <div className="section">
          <div className="section-head">
            <h2>{session.consent.title}</h2>
          </div>
          <div className="section-body ustudy-prose">
            {session.consent.text.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {session.consent.given ? (
              <p className="ustudy-given" data-testid="consent-given">
                Consent given by {session.consent.name}
                {session.consent.at && ` on ${formatDate(session.consent.at)}`}.
              </p>
            ) : (
              <>
                <label className="drawer-field">
                  <span className="drawer-field-label">Your full name</span>
                  <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="ustudy-check">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  I have read this form and I agree to take part and to be recorded.
                </label>
                <p className="muted">Date: {formatDate(new Date().toISOString())}</p>
                {error && (
                  <div className="usab-warning" role="alert">
                    {error}
                  </div>
                )}
                <button type="button" className="btn primary" disabled={busy || !agree || name.trim().length < 2} onClick={() => void submit()}>
                  {busy ? "Saving…" : "I agree, continue"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Copyable({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!secret);
  return (
    <div className="ustudy-kv">
      <span className="ustudy-k">{label}</span>
      <span className="ustudy-v mono">{value ? (shown ? value : "•".repeat(Math.min(12, value.length))) : "—"}</span>
      {secret && value && (
        <button type="button" className="btn small ghost" onClick={() => setShown((v) => !v)}>
          {shown ? "Hide" : "Show"}
        </button>
      )}
      {value && (
        <button
          type="button"
          className="btn small ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

function AccountStep({ account, onNext }: { account: NonNullable<Session["account"]>; onNext: () => void }) {
  return (
    <section>
      <h1>Signing in</h1>
      <p className="ustudy-lead">
        You will use a test account, not your own. Open the application in a new tab, sign in with these details, and
        keep this page open beside it.
      </p>
      <div className="section">
        <div className="section-head">
          <h2>Your test account</h2>
        </div>
        <div className="section-body">
          <div className="ustudy-kv">
            <span className="ustudy-k">Address</span>
            {webAddress(account.app_url) ? (
              <a className="ustudy-v mono" href={webAddress(account.app_url) ?? undefined} target="_blank" rel="noopener noreferrer">
                {account.app_url}
              </a>
            ) : (
              <span className="ustudy-v mono">{account.app_url || "—"}</span>
            )}
          </div>
          <Copyable label="Email" value={account.email} />
          <Copyable label="Password" value={account.password} secret />
          {account.notes && (
            <div className="ustudy-kv">
              <span className="ustudy-k">Also</span>
              <span className="ustudy-v">{account.notes}</span>
            </div>
          )}
        </div>
      </div>
      <div className="ustudy-nav">
        <span />
        <button type="button" className="btn primary" onClick={onNext}>
          I am signed in, show the first task
        </button>
      </div>
    </section>
  );
}

function TaskStep({
  token,
  task,
  number,
  total,
  onChange,
  onBack,
  onNext,
}: {
  token: string;
  task: SessionTask;
  number: number;
  total: number;
  onChange: (next: Partial<SessionTask>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [answer, setAnswer] = useState(task.answer);
  const [error, setError] = useState<string | null>(null);

  const save = async (input: { rating?: number; answer?: string }) => {
    setError(null);
    try {
      onChange(await saveSessionTask(token, task.id, input));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section>
      <div className="ustudy-eyebrow">
        Task {number} of {total}
      </div>
      <h1>{task.title}</h1>
      <p className="ustudy-scenario" data-testid="task-scenario">
        {task.scenario}
      </p>

      <div className="ustudy-cols">
        <div className="stack">
          {task.notes.length > 0 && (
            <div className="section">
              <div className="section-head">
                <h2>Notes</h2>
              </div>
              <div className="section-body">
                <ul className="usab-lines">
                  {task.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {task.files.length > 0 && (
            <div className="section">
              <div className="section-head">
                <h2>Files for this task</h2>
              </div>
              <div className="section-body ustudy-files">
                {task.files.map((name) => (
                  <a key={name} className="btn" href={sessionFileUrl(token, name)} download={name}>
                    Download <span className="mono">{name}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-head">
            <h2>When you have finished</h2>
          </div>
          <div className="section-body">
            {task.answer_prompt && (
              <label className="drawer-field">
                <span className="drawer-field-label">{task.answer_prompt}</span>
                <textarea
                  className="input textarea"
                  rows={3}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onBlur={() => {
                    if (answer !== task.answer) void save({ answer });
                  }}
                />
              </label>
            )}
            <div className="drawer-field">
              <span className="drawer-field-label" id={`rating-${task.id}`}>
                How easy did you find this task? 10 is easiest
              </span>
              <div className="ustudy-scale" role="radiogroup" aria-labelledby={`rating-${task.id}`}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={task.rating === n}
                    className={`btn${task.rating === n ? " primary" : ""}`}
                    onClick={() => void save({ rating: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {error && (
              <div className="usab-warning" role="alert">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="ustudy-nav">
        <button type="button" className="btn ghost" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn primary" disabled={task.rating == null} onClick={onNext}>
          {number === total ? "Continue to the word choice" : "Next task"}
        </button>
      </div>
    </section>
  );
}

function WordsStep({
  token,
  session,
  onChange,
  onBack,
  onDone,
}: {
  token: string;
  session: Session;
  onChange: (words: string[], top: string[]) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const words = session.words ?? [];
  const top = session.top_words ?? [];
  const limit = session.top_words_count ?? 5;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (nextWords: string[], nextTop: string[]) => {
    onChange(nextWords, nextTop);
    setError(null);
    try {
      await saveSessionWords(token, nextWords, nextTop);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const toggleWord = (word: string) => {
    const next = words.includes(word) ? words.filter((w) => w !== word) : [...words, word];
    void save(next, top.filter((w) => next.includes(w)));
  };
  const toggleTop = (word: string) => {
    if (!top.includes(word) && top.length >= limit) return;
    void save(words, top.includes(word) ? top.filter((w) => w !== word) : [...top, word]);
  };
  const finish = async () => {
    setBusy(true);
    try {
      await completeSession(token);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <section>
      <h1>Word choice</h1>
      <div className="section">
        <div className="section-head">
          <h2>Step 1</h2>
          <span className="muted">
            Thinking about the application you have just used, tick the words that best describe your experience. Choose
            as many as you wish.
          </span>
        </div>
        <div className="section-body ustudy-words">
          {(session.word_list ?? []).map((word) => (
            <label key={word} className="ustudy-word">
              <input type="checkbox" checked={words.includes(word)} onChange={() => toggleWord(word)} /> {word}
            </label>
          ))}
        </div>
      </div>
      <div className="section">
        <div className="section-head">
          <h2>Step 2</h2>
          <span className="muted">
            Now pick the {limit} words, from those you ticked, that describe it best. {top.length} of {limit} chosen.
          </span>
        </div>
        <div className="section-body ustudy-files">
          {words.length === 0 && <span className="muted">Tick some words above first.</span>}
          {words.map((word) => (
            <button
              key={word}
              type="button"
              aria-pressed={top.includes(word)}
              className={`btn${top.includes(word) ? " primary" : ""}`}
              disabled={!top.includes(word) && top.length >= limit}
              onClick={() => toggleTop(word)}
            >
              {word}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <div className="usab-warning" role="alert">
          {error}
        </div>
      )}
      <div className="ustudy-nav">
        <button type="button" className="btn ghost" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn primary" disabled={busy || top.length === 0} onClick={() => void finish()}>
          {busy ? "Finishing…" : "Finish"}
        </button>
      </div>
    </section>
  );
}
