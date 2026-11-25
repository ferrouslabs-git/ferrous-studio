// Client for the platform admins' cross-project Kanban (backend
// app/studio/board/admin_kanban.py). Reading spans organisations, so it sends
// no scope; moving a card is the project's own requirement PATCH, sent under
// the card's organisation (see AdminKanbanPage).
import { apiGet } from "../../core/api";
import type { RequirementPriority, RequirementStatus } from "../project/board/requirementsApi";

export interface KanbanItem {
  id: string;
  human_id: string;
  title: string;
  status: RequirementStatus;
  priority: RequirementPriority;
  assignee: { id: string; name: string } | null;
  /** The project's newest version: the one the card names and opens. */
  project_id: string;
  project_name: string;
  /** Shared by every version of the project. */
  lineage_id: string;
  account_id: string;
  account_name: string;
  sprint: { id: string; human_id: string; name: string; start_date: string | null; end_date: string | null };
}

export interface KanbanWeek {
  week_start: string;
  week_end: string;
  items: KanbanItem[];
}

/** `week` is any day of the week, as YYYY-MM-DD. */
export const getKanbanWeek = (week: string) =>
  apiGet<KanbanWeek>(`/studio/admin/kanban?week=${encodeURIComponent(week)}`, { scope: null });
