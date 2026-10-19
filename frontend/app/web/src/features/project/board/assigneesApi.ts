// Who board work (requirements, epics, features, feedback) can be assigned
// to: the organisation's active members, then the active super admins, who
// need not be members. The server accepts exactly this set.
import { apiGet } from "../../../core/api";

export interface Assignee {
  user_id: string;
  email: string;
  name: string | null;
  /** The organisation role, or "super_admin" for a super admin who is not a member. */
  role: string;
  super_admin: boolean;
}

export const listAssignees = (projectId: string) => apiGet<Assignee[]>(`/studio/projects/${projectId}/board/assignees`);
