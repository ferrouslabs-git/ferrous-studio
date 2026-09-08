// Client for comments on any board entity (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPost } from "../../../core/api";

export type BoardEntityType = "release" | "epic" | "feature" | "requirement" | "sprint" | "doc";

export interface BoardComment {
  id: string;
  entity_type: BoardEntityType;
  entity_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/comments`;

export const listBoardComments = (projectId: string, entityType: BoardEntityType, entityId: string) =>
  apiGet<BoardComment[]>(`${base(projectId)}?entity_type=${entityType}&entity_id=${entityId}`);

export const createBoardComment = (
  projectId: string,
  entityType: BoardEntityType,
  entityId: string,
  body: string,
) => apiPost<BoardComment>(base(projectId), { entity_type: entityType, entity_id: entityId, body });

export const deleteBoardComment = (projectId: string, commentId: string) =>
  apiDelete(`${base(projectId)}/${commentId}`);
