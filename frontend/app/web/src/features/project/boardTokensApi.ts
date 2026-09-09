// Client for a project's board tokens (backend app/studio/board/agent_routes.py).
//
// A board token lets a non-browser client -- the MCP server, or an agent --
// reach this project's board without a Cognito login. It resolves to a
// ScopeContext carrying board:read/board:write and nothing else, scoped to
// this one board, so a leaked token cannot touch personas, wireframes or
// diagrams, or any other project.
//
// Minting requires board:tokens, which only account_admin holds.
import { apiDelete, apiGet, apiPost } from "../../core/api";

export interface BoardToken {
  id: string;
  label: string;
  created_by: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** The create response, and the only time the raw token is ever available:
 *  it is stored as a SHA-256 hash and no other endpoint returns it. */
export interface BoardTokenIssued extends BoardToken {
  token: string;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/tokens`;

export const listBoardTokens = (projectId: string) => apiGet<BoardToken[]>(base(projectId));
export const createBoardToken = (projectId: string, label: string) =>
  apiPost<BoardTokenIssued>(base(projectId), { label });
export const revokeBoardToken = (projectId: string, tokenId: string) =>
  apiDelete(`${base(projectId)}/${tokenId}`);
