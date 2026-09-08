// Client for a project's board docs (backend app/studio/board/routes.py) --
// notes filed under an epic, or unfiled. Body is markdown, with ```mermaid
// fences rendered as diagrams (see MarkdownWithMermaid.tsx).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

export interface BoardDoc {
  id: string;
  human_id: string;
  title: string;
  body: string;
  tags: string[];
  epic_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoardDocInput {
  title: string;
  body: string;
  tags: string[];
  epic_id: string | null;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/docs`;

export const listBoardDocs = (projectId: string, epicId?: string) =>
  apiGet<BoardDoc[]>(epicId ? `${base(projectId)}?epic_id=${epicId}` : base(projectId));
export const createBoardDoc = (projectId: string, input: BoardDocInput) => apiPost<BoardDoc>(base(projectId), input);
export const updateBoardDoc = (
  projectId: string,
  docId: string,
  patch: Partial<BoardDocInput> & { clear_epic?: boolean },
) => apiPatch<BoardDoc>(`${base(projectId)}/${docId}`, patch);
export const deleteBoardDoc = (projectId: string, docId: string) => apiDelete(`${base(projectId)}/${docId}`);
