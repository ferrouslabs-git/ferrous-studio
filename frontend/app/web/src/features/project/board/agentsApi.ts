// Client for a project's persistent named agents (backend
// app/studio/board/agent_routes.py). Distinct from an "agent run" (one
// single attempt at a requirement) -- an agent is started/stopped
// repeatedly and works its assigned sprint's Todo requirements in queue
// order. Real ECS launch only happens if the environment configures it
// (AGENT_ECS_CLUSTER etc.); otherwise starting one fails with a clear
// "not configured" message rather than pretending to launch anything.
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

export type AgentDesiredState = "running" | "stopped";
export type AgentStatus = "running" | "stopped" | "error";

export interface Agent {
  id: string;
  name: string;
  sprint_id: string | null;
  desired_state: AgentDesiredState;
  status: AgentStatus;
  last_error: string | null;
  current_requirement_id: string | null;
  last_heartbeat: string | null;
  created_at: string;
  updated_at: string;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/agents`;

export const listAgents = (projectId: string) => apiGet<Agent[]>(base(projectId));
export const createAgent = (projectId: string, name: string, sprintId: string | null) =>
  apiPost<Agent>(base(projectId), { name, sprint_id: sprintId });
export const updateAgent = (
  projectId: string,
  agentId: string,
  patch: { name?: string; sprint_id?: string | null; clear_sprint?: boolean; desired_state?: AgentDesiredState },
) => apiPatch<Agent>(`${base(projectId)}/${agentId}`, patch);
export const deleteAgent = (projectId: string, agentId: string) => apiDelete(`${base(projectId)}/${agentId}`);
