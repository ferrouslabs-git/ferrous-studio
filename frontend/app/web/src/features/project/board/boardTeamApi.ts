// Client for a board's team (backend app/studio/board/routes.py): the super
// admins feedback is routed to on Slack -- the product manager and the
// support developer. Lineage state, like the project key.
import { apiGet, apiPut } from "../../../core/api";

export interface BoardTeam {
  product_manager_id: string | null;
  support_dev_id: string | null;
}

const path = (projectId: string) => `/studio/projects/${projectId}/board/team`;

export const getBoardTeam = (projectId: string) => apiGet<BoardTeam>(path(projectId));

/** Replaces both roles; 422 when an id is not a super admin. */
export const setBoardTeam = (projectId: string, team: BoardTeam) => apiPut<BoardTeam>(path(projectId), team);
