// Questions from the agent: the pick-and-code skill's own convention -- a
// "Question: …" comment plus status=Blocked. Answering posts a comment and
// flips the requirement back to Todo, which is exactly what wakes the agent.
// No new table, no new protocol. The answer boxes are uncontrolled and their
// drafts kept in a ref, keyed by requirement, so a poll redrawing the card
// never loses what has been typed.
import { useRef, useState } from "react";
import { useBoard } from "../../board/boardData";
import { useBoardMutations } from "../../board/boardMutations";
import { relTime } from "../../board/events";
import type { Requirement } from "../../board/requirementsApi";
import type { SprintActivity, SprintQuestion } from "../../board/sprintsApi";
import { useToast } from "../../board/toast";

interface QuestionsCardProps {
  live: SprintActivity | null;
  refresh: (force?: boolean) => Promise<void>;
  onOpen: (r: Requirement) => void;
}

export function QuestionsCard({ live, refresh, onOpen }: QuestionsCardProps) {
  const { index, canWrite } = useBoard();
  const mutations = useBoardMutations();
  const toast = useToast();
  const drafts = useRef(new Map<string, string>());
  const boxes = useRef(new Map<string, HTMLTextAreaElement>());
  const [sending, setSending] = useState<string | null>(null);

  const answer = async (q: SprintQuestion) => {
    const r = q.requirement;
    const text = (drafts.current.get(r.id) ?? "").trim();
    if (!text) {
      boxes.current.get(r.id)?.focus();
      return;
    }
    setSending(r.id);
    try {
      await mutations.postComment("requirement", r.id, text);
      await mutations.patchRequirement(r.id, { status: "Todo" });
    } catch {
      setSending(null);
      return; // already toasted
    }
    drafts.current.delete(r.id);
    const box = boxes.current.get(r.id);
    if (box) box.value = "";
    setSending(null);
    toast(`${r.human_id} answered — back in Todo for the agent`);
    await refresh(true);
  };

  const open = (q: SprintQuestion) => {
    const full = index.requirementById.get(q.requirement.id);
    if (full) onOpen(full);
  };

  const author = (q: SprintQuestion) =>
    q.comment.agent_id ? index.agentById.get(q.comment.agent_id)?.name ?? "agent" : index.memberName(q.comment.author_id);

  return (
    <div className="hcard">
      <h3>Questions from the agent</h3>
      <div className="body">
        {live === null ? (
          <div className="sb-card-empty">loading…</div>
        ) : live.questions.length === 0 ? (
          <div className="sb-card-empty">No open questions. When the agent needs a decision it blocks the requirement and asks here.</div>
        ) : (
          live.questions.map((q) => {
            const r = q.requirement;
            return (
              <div key={q.comment.id} className="sb-q">
                <div className="sb-q-head" onClick={() => open(q)}>
                  <span className="lnk">{r.human_id}</span>
                  <span className="t">{r.title}</span>
                </div>
                <div className="sb-q-text">{q.comment.body.replace(/^\s*question:\s*/i, "")}</div>
                <div className="sb-q-meta">
                  {author(q)} · {relTime(q.comment.created_at)}
                </div>
                {canWrite && (
                  <>
                    <textarea
                      key={r.id}
                      ref={(el) => {
                        if (el) boxes.current.set(r.id, el);
                        else boxes.current.delete(r.id);
                      }}
                      className="sb-answer"
                      placeholder="your answer…"
                      defaultValue={drafts.current.get(r.id) ?? ""}
                      onChange={(e) => drafts.current.set(r.id, e.target.value)}
                    />
                    <div className="sb-q-actions">
                      <button type="button" className="btn mini-x primary" disabled={sending === r.id} onClick={() => void answer(q)}>
                        Answer & unblock
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
