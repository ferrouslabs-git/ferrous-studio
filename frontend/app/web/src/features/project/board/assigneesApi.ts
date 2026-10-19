// Who board work (requirements, epics, features, feedback) can be assigned
// to: the organisation's active members, then the active super admins, who
// need not be members. The server accepts exactly this set.
import { apiGet } from "../../../core/api";

/** Only what assigning needs: no emails or roles (any board reader gets this). */
export interface Assignee {
  user_id: string;
  /** Display name; a member without one is shown by email, a super admin never is. */
  name: string;
  super_admin: boolean;
}

export const listAssignees = (projectId: string) => apiGet<Assignee[]>(`/studio/projects/${projectId}/board/assignees`);
