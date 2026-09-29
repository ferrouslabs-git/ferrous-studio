// Client for a board's project key (backend app/studio/board/routes.py): the
// prefix of every id the board renders, unique within the organisation.
import { apiGet, apiPut } from "../../../core/api";

const path = (projectId: string) => `/studio/projects/${projectId}/board/key`;

export const getBoardKey = (projectId: string) => apiGet<{ key: string }>(path(projectId));

/** 409 when another project in the organisation already uses it. */
export const setBoardKey = (projectId: string, key: string) => apiPut<{ key: string }>(path(projectId), { key });
