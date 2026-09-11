// The Agent card in the sprint board's side column: the agent(s) delivering
// this sprint, each with an editable name, a status chip, start/stop,
// delete, its last error, and what it is working on. Starting an agent on a
// sprint that is not active offers to start the sprint first -- an agent
// only works an active sprint. Creation files the agent under the sprint
// BEFORE asking for a start, so a failed start (locally, ECS is not
// configured and the server says so in the toast) still leaves a stopped
// agent here, visible and ready to retry, rather than an orphan on no sprint.
import { useRef, useState } from "react";
import type { Agent } from "../../board/agentsApi";
import { useBoard } from "../../board/boardData";
import { useBoardMutations } from "../../board/boardMutations";
import { AgentChip } from "../../board/chips";
import { useDialogs } from "../../board/dialogs";
import { relTime } from "../../board/events";
import { InlineText } from "../../board/InlineText";
import type { Requirement } from "../../board/requirementsApi";
import type { Sprint, SprintActivity } from "../../board/sprintsApi";
import { useToast } from "../../board/toast";

interface AgentCardProps {
  sprint: Sprint;
  live: SprintActivity | null;
  refresh: (force?: boolean) => Promise<void>;
  onOpen: (r: Requirement) => void;
}

export function AgentCard({ sprint, live, refresh, onOpen }: AgentCardProps) {
  const { index, canManageAgents } = useBoard();
  const mutations = useBoardMutations();
  const dialogs = useDialogs();
  const toast = useToast();
  // One start sequence at a time: the dialogs it raises would otherwise
  // dismiss each other.
  const startBusy = useRef(false);
  const [stopping, setStopping] = useState<string | null>(null);

  const startAgent = async (existing: Agent | null) => {
    if (startBusy.current) return;
    startBusy.current = true;
    try {
      let s = sprint;
      if (s.state !== "active") {
        const ok = await dialogs.confirm({
          title: "Start the sprint first",
          ok: "Start sprint",
          danger: false,
          message: `${s.human_id} · ${s.name} is ${s.state}. An agent only works an active sprint — start the sprint now?`,
        });
        if (!ok) return;
        s = (await mutations.setSprintState(s, "active")).sprint;
      }
      let a = existing;
      if (!a) {
        const v = await dialogs.form({
          title: `New agent for ${s.human_id}`,
          ok: "Create & start",
          fields: [{ key: "name", label: "Agent name", required: true, value: `${s.name} agent`, placeholder: "e.g. worker-1" }],
        });
        if (!v) return;
        a = await mutations.createAgent(v.name, s.id);
      } else if (a.sprint_id !== s.id) {
        a = await mutations.patchAgent(a.id, { sprint_id: s.id });
      }
      await mutations.patchAgent(a.id, { desired_state: "running" });
      toast(`${a.name} starting on ${s.human_id}…`);
    } catch {
      // The mutation layer has toasted the server's reason (e.g. "not configured").
    } finally {
      startBusy.current = false;
      void refresh(true);
    }
  };

  const stop = async (a: Agent) => {
    setStopping(a.id);
    try {
      await mutations.patchAgent(a.id, { desired_state: "stopped" });
      toast(`${a.name} stopping…`);
    } catch {
      // Already toasted.
    } finally {
      setStopping(null);
      void refresh(true);
    }
  };

  const rename = async (a: Agent, name: string) => {
    try {
      await mutations.patchAgent(a.id, { name });
      await refresh(true);
    } catch {
      // Already toasted.
    }
  };

  const remove = async (a: Agent) => {
    const ok = await dialogs.confirm({
      title: "Delete agent",
      ok: "Delete agent",
      message: `Delete agent "${a.name}"?\nStops it first if it's running.`,
    });
    if (!ok) return;
    try {
      await mutations.deleteAgent(a);
    } catch {
      // Already toasted.
    }
    void refresh(true);
  };

  // The poll's list, read through the board for the freshest copy of each:
  // a rename or a stop lands there before the next poll does.
  const agents = live ? live.agents.map((a) => index.agentById.get(a.id) ?? a) : [];

  return (
    <div className="hcard">
      <h3>Agent</h3>
      <div className="body">
        {live === null ? (
          <div className="sb-card-empty">loading…</div>
        ) : agents.length === 0 ? (
          <>
            <div className="sb-card-empty">No agent delivers {sprint.human_id} yet.</div>
            {canManageAgents && (
              <button type="button" className="btn mini-x primary" style={{ marginTop: 8 }} onClick={() => void startAgent(null)}>
                ▶ Start an agent
              </button>
            )}
          </>
        ) : (
          <>
            {agents.map((a) => (
              <AgentRow
                key={a.id}
                agent={a}
                canManage={canManageAgents}
                stopping={stopping === a.id}
                onStart={(ag) => void startAgent(ag)}
                onStop={(ag) => void stop(ag)}
                onRename={rename}
                onDelete={(ag) => void remove(ag)}
                onOpen={onOpen}
              />
            ))}
            {canManageAgents && (
              <button type="button" className="btn mini-x" style={{ marginTop: 6 }} onClick={() => void startAgent(null)}>
                ＋ another agent
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface AgentRowProps {
  agent: Agent;
  canManage: boolean;
  stopping: boolean;
  onStart: (a: Agent) => void;
  onStop: (a: Agent) => void;
  onRename: (a: Agent, name: string) => Promise<void>;
  onDelete: (a: Agent) => void;
  onOpen: (r: Requirement) => void;
}

function AgentRow({ agent: a, canManage, stopping, onStart, onStop, onRename, onDelete, onOpen }: AgentRowProps) {
  const { index } = useBoard();
  const working = a.current_requirement_id ? index.requirementById.get(a.current_requirement_id) ?? null : null;
  const running = a.status === "running";
  const meta = a.current_requirement_id
    ? `working on ${working ? `${working.human_id} · ${working.title}` : "a requirement"}`
    : running
      ? "running — picking up work"
      : a.last_heartbeat
        ? `last seen ${relTime(a.last_heartbeat)}`
        : "never run";

  return (
    <div className="sb-agent">
      <div className="sb-agent-row">
        <InlineText
          className="ms-ttl"
          value={a.name}
          onSave={(v) => onRename(a, v)}
          disabled={!canManage}
          title={canManage ? "double-click to rename" : undefined}
        />
        <AgentChip agent={a} />
        <span style={{ marginLeft: "auto" }} />
        {canManage &&
          (running ? (
            <button type="button" className="btn mini-x" disabled={stopping} onClick={() => onStop(a)}>
              ■ Stop
            </button>
          ) : (
            <button type="button" className="btn mini-x primary" onClick={() => onStart(a)}>
              ▶ Start
            </button>
          ))}
        {canManage && (
          <button type="button" className="btn mini-x danger-ink" title="delete agent" onClick={() => onDelete(a)}>
            ✕
          </button>
        )}
      </div>
      {a.status === "error" && a.last_error && <div className="ag-err">{a.last_error}</div>}
      {working ? (
        <div className="ag-meta" style={{ cursor: "pointer" }} onClick={() => onOpen(working)}>
          {meta}
        </div>
      ) : (
        <div className="ag-meta">{meta}</div>
      )}
    </div>
  );
}
