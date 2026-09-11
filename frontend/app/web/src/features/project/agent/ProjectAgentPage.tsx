// The Project Agent tab: a live chat with Claude, scoped to this one
// project. Phase 1 only (see docs/project-agent-implementation-plan.md) --
// plain conversation, no tools yet. The agent cannot change the project;
// it can only discuss it.
import { FormEvent, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../../core/api";
import { useLoad } from "../../../core/useLoad";
import { useProject } from "../ProjectLayout";
import { getAgentStatus, listAgentMessages, ProjectAgentMessage, sendAgentMessage } from "./projectAgentApi";

export function ProjectAgentPage() {
  const { project, canWrite } = useProject();
  const status = useLoad(() => getAgentStatus(project.id), [project.id]);
  const history = useLoad(() => listAgentMessages(project.id), [project.id]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ProjectAgentMessage | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [history.data, pending]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    setPending({ id: "pending", role: "user", content, created_at: new Date().toISOString() });
    setDraft("");
    try {
      await sendAgentMessage(project.id, content);
      await history.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
      setSending(false);
    }
  };

  if (status.data && !status.data.configured) {
    return (
      <div className="page stack">
        <div className="page-head">
          <h1>Project Agent</h1>
        </div>
        <div className="status-banner warn">Project Agent is not configured on this deployment.</div>
      </div>
    );
  }

  const messages = history.data ?? [];

  return (
    <div className="page stack">
      <div className="page-head">
        <h1>Project Agent</h1>
        <span className="shell-spacer" />
        <span className="muted">Chats with this project only -- nothing crosses into another project.</span>
      </div>

      <section className="section">
        <div className="section-body agent-chat-section">
          <div className="agent-chat-log">
            {messages.length === 0 && !pending && <div className="empty">Say hello to get started.</div>}
            {messages.map((m) => (
              <AgentBubble key={m.id} message={m} />
            ))}
            {pending && <AgentBubble message={pending} />}
            {sending && (
              <div className="agent-bubble agent-bubble-assistant">
                <span className="muted">Thinking…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {error && <div className="status-banner warn">{error}</div>}

          <form className="agent-compose" onSubmit={submit}>
            <textarea
              className="input textarea"
              rows={2}
              placeholder={canWrite ? "Ask Project Agent…" : "You need edit access to this project to use Project Agent."}
              value={draft}
              disabled={!canWrite || sending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit(e);
                }
              }}
            />
            <button className="btn primary" type="submit" disabled={!canWrite || sending || !draft.trim()}>
              {sending ? "Sending…" : "Send"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function AgentBubble({ message }: { message: ProjectAgentMessage }) {
  return (
    <div className={`agent-bubble agent-bubble-${message.role}`}>
      <span className="agent-bubble-role">{message.role === "user" ? "You" : "Project Agent"}</span>
      <p>{message.content}</p>
    </div>
  );
}
