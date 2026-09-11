// Client for the Project Agent chatbot (backend app/studio/project_agent.py).
//
// Phase 1 only -- plain text back-and-forth, no tools. The agent cannot yet
// change anything in the project; sending a message just gets a reply.
import { apiGet, apiPost } from "../../../core/api";

export interface ProjectAgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ProjectAgentStatus {
  configured: boolean;
}

const base = (projectId: string) => `/studio/projects/${projectId}/agent`;

export const getAgentStatus = (projectId: string) => apiGet<ProjectAgentStatus>(`${base(projectId)}/status`);
export const listAgentMessages = (projectId: string) => apiGet<ProjectAgentMessage[]>(`${base(projectId)}/messages`);
export const sendAgentMessage = (projectId: string, content: string) =>
  apiPost<ProjectAgentMessage>(`${base(projectId)}/messages`, { content });
