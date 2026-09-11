// Client for the board's audit events (backend app/studio/board/routes.py).
// The History tab of the comments panel reads one entity's events; the
// sprint board's feed gets its events bundled in GET sprints/{id}/activity.
import { apiGet } from "../../../core/api";

// `detail` is written by the server per action: create/delete carry
// {title|name}, updates carry {field: {from, to}} for each changed field,
// comment.created carries {excerpt}, release.shipped carries {shipped_at}.
export type EventDetail = Record<string, unknown>;

export interface BoardEvent {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  detail: EventDetail;
  created_at: string;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board/events`;

export const listEvents = (
  projectId: string,
  filters: { entity_type?: string; entity_id?: string; limit?: number } = {},
) => {
  const params = new URLSearchParams();
  if (filters.entity_type) params.set("entity_type", filters.entity_type);
  if (filters.entity_id) params.set("entity_id", filters.entity_id);
  if (filters.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return apiGet<BoardEvent[]>(qs ? `${base(projectId)}?${qs}` : base(projectId));
};
