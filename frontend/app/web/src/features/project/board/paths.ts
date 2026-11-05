// The board's routes, in one place. Everything hangs under the project:
// /orgs/:orgId/projects/:projectId/{roadmap, roadmap/:releaseId,
// roadmap/sprints/:sprintId, epics, epics/:epicId}. Selection on a page
// travels in the query string so it survives a reload and can be linked to.
export interface EpicPageQuery {
  req?: string | null;
  doc?: string | null;
}

export interface BoardPaths {
  roadmap: string;
  release: (releaseId: string) => string;
  sprint: (sprintId: string, query?: { req?: string | null }) => string;
  epics: string;
  epic: (epicId: string, query?: EpicPageQuery) => string;
}

function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    q.set(k, v);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export function boardPaths(orgId: string, projectId: string): BoardPaths {
  const base = `/orgs/${orgId}/projects/${projectId}`;
  return {
    roadmap: `${base}/roadmap`,
    release: (releaseId) => `${base}/roadmap/${releaseId}`,
    sprint: (sprintId, query = {}) => withQuery(`${base}/roadmap/sprints/${sprintId}`, { req: query.req }),
    epics: `${base}/epics`,
    epic: (epicId, query = {}) => withQuery(`${base}/epics/${epicId}`, { req: query.req, doc: query.doc }),
  };
}
