// Client for comments on any board entity (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";
import type { BoardAttachment } from "../attachmentsApi";

export type BoardEntityType = "release" | "epic" | "feature" | "requirement" | "sprint" | "doc";

export interface BoardComment {
  id: string;
  entity_type: BoardEntityType;
  entity_id: string;
  author_id: string;
  // Set when the comment came from an agent acting through its board token
  // (author_id is then the human who minted that token).
  agent_id: string | null;
  /** "" for a comment that is only its attachments. */
  body: string;
  created_at: string;
  /** When its author last changed the text; null if never edited. */
  edited_at?: string | null;
  /** Its uploaded files, oldest first; always [] on a comment just posted. */
  attachments: BoardAttachment[];
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/comments`;

// Every live comment on the board, for the comment counts on cards and rows
// -- one request rather than one per entity.
export const listAllBoardComments = (projectId: string) => apiGet<BoardComment[]>(base(projectId));

export const createBoardComment = (
  projectId: string,
  entityType: BoardEntityType,
  entityId: string,
  body: string,
) => apiPost<BoardComment>(base(projectId), { entity_type: entityType, entity_id: entityId, body });

/** Only the comment's author may (403 otherwise). */
export const updateBoardComment = (projectId: string, commentId: string, body: string) =>
  apiPatch<BoardComment>(`${base(projectId)}/${commentId}`, { body });

export const deleteBoardComment =(projectId: string, commentId: string) =>
  apiDelete(`${base(projectId)}/${commentId}`);
