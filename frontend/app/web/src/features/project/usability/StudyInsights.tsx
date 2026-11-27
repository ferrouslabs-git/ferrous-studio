// The Study insights sub-section: the study aggregated across its
// participants, as the rainbow spreadsheet lays it out. Observations against
// participants (with a possible solution and notes), the measures for every
// participant and task with their averages, and the word choices. The
// averages come from the server; this file only lays them out.
import { Fragment, useCallback, useEffect, useState } from "react";
import { ConfirmDrawer } from "../../../components/ConfirmDrawer";
import { errorMessage } from "../../../core/api";
import { Card } from "./StudyEditor";
import {
  addObservation,
  deleteObservation,
  getInsights,
  Insights,
  markObservation,
  Observation,
  Stat,
  Study,
  updateObservation,
} from "./usabilityApi";
import { clock, downloadText, metricsCsv, num, observationsCsv, slug, successMark } from "./usabilityModel";

type Kind = "success" | "time" | "errors" | "rating";

const FOOT: { label: string; show: (s: Stat, kind: Kind) => string }[] = [
  {
    label: "Mean",
    show: (s, kind) =>
      kind === "time"
        ? clock(s.mean == null ? null : Math.round(s.mean))
        : kind === "success"
          ? s.mean == null
            ? "–"
            : `${Math.round(s.mean * 100)}%`
          : num(s.mean),
  },
  { label: "Count", show: (s) => String(s.count) },
  {
    label: "Standard deviation",
    show: (s, kind) => (kind === "time" ? clock(s.sd == null ? null : Math.round(s.sd)) : num(s.sd, 2)),
  },
  {
    label: "95% confidence",
    show: (s, kind) => (s.ci95 == null ? "–" : kind === "time" ? `±${clock(Math.round(s.ci95))}` : `±${num(s.ci95, 2)}`),
  },
];

export function StudyInsights({ projectId, study }: { projectId: string; study: Study }) {
  const [ins, setIns] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Observation | null>(null);

  const load = useCallback(() => {
    return getInsights(projectId, study.id)
      .then((data) => {
        setIns(data);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [projectId, study.id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!ins) {
    return error ? (
      <div className="usab-warning" role="alert">
        {error}
      </div>
    ) : (
      <div className="muted">Loading…</div>
    );
  }

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const patch = (o: Observation, body: Partial<Omit<Observation, "id">>) =>
    act(() => updateObservation(projectId, study.id, o.id, body));
  const toggle = (o: Observation, participantId: string) => {
    const seen = !o.participant_ids.includes(participantId);
    const participant_ids = seen ? [...o.participant_ids, participantId] : o.participant_ids.filter((id) => id !== participantId);
    // Tick at once; the reload after the save puts back the truth if it failed.
    // One participant at a time, so a tick made in a capture meanwhile is kept.
    setIns((cur) => cur && { ...cur, observations: cur.observations.map((x) => (x.id === o.id ? { ...x, participant_ids } : x)) });
    return act(() => markObservation(projectId, study.id, o.id, participantId, seen));
  };

  const people = ins.participants;
  const known = new Set(ins.tasks.map((t) => t.id));
  const groups: { taskId: string | null; label: string }[] = [
    ...ins.tasks.map((t, i) => ({ taskId: t.id as string | null, label: `Task ${i + 1}${t.title ? ` · ${t.title}` : ""}` })),
    { taskId: null, label: "General" },
  ];
  // An observation made against a task since removed still shows, under General.
  const inGroup = (o: Observation, taskId: string | null) =>
    taskId === null ? o.task_id === null || !known.has(o.task_id) : o.task_id === taskId;
  const columns = people.length + 5;
  const file = slug(study.name);

  return (
    <div className="stack">
      {error && (
        <div className="usab-warning" role="alert">
          {error}
        </div>
      )}

      {ins.research_questions.length > 0 && (
        <Card title="Research questions">
          <ol className="usab-lines">
            {ins.research_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </Card>
      )}

      <Card
        title="Observations"
        action={
          <button type="button" className="btn small ghost" onClick={() => downloadText(`${file}-observations.csv`, observationsCsv(ins), "text/csv;charset=utf-8")}>
            Export CSV
          </button>
        }
      >
        <div className="usab-scroll">
          <table className="usab-table usab-observations" data-testid="observations">
            <thead>
              <tr>
                <th className="usab-col-wide">Observation</th>
                {people.map((p) => (
                  <th key={p.id} className="usab-mark">
                    {p.code}
                  </th>
                ))}
                <th className="num">Count</th>
                <th className="usab-col-mid">Possible solution</th>
                <th className="usab-col-mid">Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.taskId ?? "general"}>
                  <tr className="usab-group">
                    <td colSpan={columns}>{g.label}</td>
                  </tr>
                  {ins.observations
                    .filter((o) => inGroup(o, g.taskId))
                    .map((o) => (
                      <tr key={o.id}>
                        <td>
                          <input
                            className="input"
                            aria-label="Observation"
                            defaultValue={o.text}
                            onBlur={(e) => {
                              if (e.target.value.trim() && e.target.value !== o.text) void patch(o, { text: e.target.value });
                            }}
                          />
                        </td>
                        {people.map((p) => (
                          <td key={p.id} className="usab-mark">
                            <input
                              type="checkbox"
                              aria-label={`${p.code}: ${o.text}`}
                              checked={o.participant_ids.includes(p.id)}
                              onChange={() => void toggle(o, p.id)}
                            />
                          </td>
                        ))}
                        <td className="num">
                          {o.participant_ids.length}
                          {people.length > 0 && ` / ${people.length}`}
                        </td>
                        <td>
                          <input
                            className="input"
                            aria-label="Possible solution"
                            defaultValue={o.solution}
                            onBlur={(e) => {
                              if (e.target.value !== o.solution) void patch(o, { solution: e.target.value });
                            }}
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            aria-label="Notes"
                            defaultValue={o.notes}
                            onBlur={(e) => {
                              if (e.target.value !== o.notes) void patch(o, { notes: e.target.value });
                            }}
                          />
                        </td>
                        <td>
                          <button type="button" className="btn icon" aria-label="Delete observation" title="Delete" onClick={() => setDeleting(o)}>
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  <tr>
                    <td colSpan={columns}>
                      <AddObservation
                        label={g.label}
                        onAdd={(text) => act(() => addObservation(projectId, study.id, { task_id: g.taskId, text }))}
                      />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Measures"
        action={
          <button type="button" className="btn small ghost" onClick={() => downloadText(`${file}-measures.csv`, metricsCsv(ins), "text/csv;charset=utf-8")}>
            Export CSV
          </button>
        }
      >
        {ins.metrics.length === 0 ? (
          <div className="empty">This study has no tasks yet.</div>
        ) : (
          <div className="usab-scroll">
            <table className="usab-table usab-metrics" data-testid="measures">
              <thead>
                <tr>
                  <th />
                  {ins.metrics.map((m, i) => (
                    <th key={m.task_id} colSpan={4} className="usab-task-col" title={m.title}>
                      Task {i + 1}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th>Participant</th>
                  {ins.metrics.map((m) => (
                    <Fragment key={m.task_id}>
                      <th className="usab-first">Success</th>
                      <th>Time</th>
                      <th>Errors</th>
                      <th>Satisfaction</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id}>
                    <td>{p.code}</td>
                    {ins.metrics.map((m) => {
                      const r = m.rows.find((x) => x.participant_id === p.id);
                      return (
                        <Fragment key={m.task_id}>
                          <td className="usab-first">{successMark(r?.success)}</td>
                          <td>{clock(r?.time_seconds ?? null)}</td>
                          <td>{r?.errors ?? "–"}</td>
                          <td>{r?.rating ?? "–"}</td>
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {FOOT.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    {ins.metrics.map((m) => (
                      <Fragment key={m.task_id}>
                        <td className="usab-first">{row.show(m.success, "success")}</td>
                        <td>{row.show(m.time_seconds, "time")}</td>
                        <td>{row.show(m.errors, "errors")}</td>
                        <td>{row.show(m.rating, "rating")}</td>
                      </Fragment>
                    ))}
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card title="Word choice">
        {ins.words.length === 0 ? (
          <div className="empty">No participant has done the word choice exercise yet.</div>
        ) : (
          <div className="usab-wordcloud" data-testid="words">
            {ins.words.map((w) => (
              <span key={w.word} className={`badge ${w.top > 0 ? "accent" : ""}`}>
                {w.word} · {w.chosen}
                {w.top > 0 && ` · top ×${w.top}`}
              </span>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDrawer
        open={deleting !== null}
        title="Delete observation"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteObservation(projectId, study.id, deleting.id);
          await load();
        }}
      >
        <p>
          Delete <b>{deleting?.text}</b>?
        </p>
      </ConfirmDrawer>
    </div>
  );
}

function AddObservation({ label, onAdd }: { label: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText("");
  };
  return (
    <div className="row">
      <input
        className="input usab-grow"
        placeholder="Add an observation"
        aria-label={`New observation for ${label}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button type="button" className="btn small" disabled={!text.trim()} onClick={submit}>
        Add
      </button>
    </div>
  );
}
