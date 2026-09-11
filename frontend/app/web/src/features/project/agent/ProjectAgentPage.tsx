// The Project Agent tab: a live chat with Claude, scoped to this one
// project, that can create wireframes and diagrams via tool use (see
// backend/app/studio/project_agent.py). Replies render as markdown --
// the same renderer the board docs feature already uses -- since a
// wireframe/diagram summary reads as headings and lists.
import { FormEvent, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../../core/api";
import { formatTime } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { MarkdownWithMermaid } from "../epics/MarkdownWithMermaid";
import { useProject } from "../ProjectLayout";
import { getAgentStatus, listAgentMessages, ProjectAgentMessage, sendAgentMessage } from "./projectAgentApi";

const STARTER_PROMPTS = [
  "What can you help me with?",
  "Build me wireframes from the connected repo",
  "Summarise this project so far",
];

export function ProjectAgentPage() {
  const { project, canWrite } = useProject();
  const status = useLoad(() => getAgentStatus(project.id), [project.id]);
  const history = useLoad(() => listAgentMessages(project.id), [project.id]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ProjectAgentMessage | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [history.data, pending, sending]);

  const submit = async (e: FormEvent, override?: string) => {
    e.preventDefault();
    const content = (override ?? draft).trim();
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
  const empty = messages.length === 0 && !pending;

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
            {empty && (
              <div className="agent-empty">
                <p className="muted">Say hello to get started, or try:</p>
                <div className="agent-starters">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="btn ghost small"
                      disabled={!canWrite}
                      onClick={(e) => void submit(e, prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) => (
              <AgentBubble key={m.id} message={m} />
            ))}
            {pending && <AgentBubble message={pending} />}
            {sending && (
              <div className="agent-bubble agent-bubble-assistant agent-bubble-thinking">
                <span className="agent-bubble-role">Project Agent</span>
                <span className="agent-typing" aria-label="Thinking">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {error && <div className="status-banner warn">{error}</div>}

          <form className="agent-compose" onSubmit={submit}>
            <textarea
              ref={textareaRef}
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
  const isUser = message.role === "user";
  return (
    <div className={`agent-bubble agent-bubble-${message.role}`}>
      <div className="agent-bubble-meta">
        <span className="agent-bubble-role">{isUser ? "You" : "Project Agent"}</span>
        {message.id !== "pending" && <span className="agent-bubble-time">{formatTime(message.created_at)}</span>}
      </div>
      {isUser ? <p className="agent-bubble-text">{message.content}</p> : <MarkdownWithMermaid body={message.content} />}
    </div>
  );
}
