// The Answers sub-section of a study: what participants typed in answer to
// each task's question, task by task, so they can be read side by side. The
// answers come from Study insights (the server leaves out blank ones).
import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../../../core/api";
import { Card } from "./StudyEditor";
import { getInsights, Insights, Study } from "./usabilityApi";
import { answersCsv, downloadText, slug } from "./usabilityModel";

export function StudyAnswers({ projectId, study }: { projectId: string; study: Study }) {
  const [ins, setIns] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getInsights(projectId, study.id)
      .then((data) => {
        setIns(data);
        setError(null);
      })
      .catch((err) => setError(errorMessage(err)));
  }, [projectId, study.id]);
  useEffect(load, [load]);

  if (!ins) {
    return error ? (
      <div className="usab-warning" role="alert">
        {error}
      </div>
    ) : (
      <div className="muted">Loading…</div>
    );
  }
  if (ins.answers.length === 0) {
    return (
      <div className="empty">
        <b>No task asks for an answer.</b> Give a task a question in the Study tab, and what participants type shows here.
      </div>
    );
  }
  // Number tasks as the study does, even when only some ask a question.
  const taskNo = new Map(ins.tasks.map((t, i) => [t.id, i + 1]));
  const total = ins.answers.reduce((n, t) => n + t.answers.length, 0);

  return (
    <div className="stack" data-testid="answers">
      <div className="row">
        <span className="muted">
          {total} answer{total === 1 ? "" : "s"} from {ins.participants.length} participant{ins.participants.length === 1 ? "" : "s"}
        </span>
        <span className="shell-spacer" />
        <button
          type="button"
          className="btn small ghost"
          disabled={total === 0}
          onClick={() => downloadText(`${slug(study.name)}-answers.csv`, answersCsv(ins), "text/csv;charset=utf-8")}
        >
          Export CSV
        </button>
      </div>
      {ins.answers.map((t) => (
        <Card key={t.task_id} title={`Task ${taskNo.get(t.task_id) ?? "?"}${t.title ? ` · ${t.title}` : ""}`}>
          {t.prompt && (
            <p className="usab-fact">
              <b>Asked</b> {t.prompt}
            </p>
          )}
          {t.answers.length === 0 ? (
            <span className="muted">No answers yet.</span>
          ) : (
            <ul className="usab-answers">
              {t.answers.map((a) => (
                <li key={a.participant_id}>
                  <b>{a.code}</b>
                  <span>{a.answer}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}
