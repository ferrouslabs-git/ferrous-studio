// Client for a project's board epics (backend app/studio/board/routes.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

export type EpicPhase = "Now" | "Next" | "Later";
export const EPIC_PHASES: EpicPhase[] = ["Now", "Next", "Later"];

export interface Epic {
  id: string;
  human_id: string;
  title: string;
  summary: string;
  phase: EpicPhase;
  release_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EpicInput {
  title: string;
  summary: string;
  phase: EpicPhase;
  release_id: string | null;
}

export interface EpicProgress {
  done: number;
  doing: number;
  total: number;
  pct: number;
}

export interface BoardSummary {
  epics: { epic: Epic; progress: EpicProgress }[];
  status_counts: Record<string, number>;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/epics`;

export const listEpics = (projectId: string) => apiGet<Epic[]>(base(projectId));
export const createEpic = (projectId: string, input: EpicInput) => apiPost<Epic>(base(projectId), input);
export const updateEpic = (
  projectId: string,
  epicId: string,
  patch: Partial<EpicInput> & { clear_release?: boolean },
) => apiPatch<Epic>(`${base(projectId)}/${epicId}`, patch);
export const deleteEpic = (projectId: string, epicId: string) => apiDelete(`${base(projectId)}/${epicId}`);

export const getBoardSummary = (projectId: string) =>
  apiGet<BoardSummary>(`/studio/projects/${projectId}/board/summary`);
