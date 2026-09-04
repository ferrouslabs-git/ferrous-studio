// Client for a wireframe's audit log (backend app/studio/audit.py): an
// append-only record of annotation events and wireframe changes, with canvas
// edits coalesced into one row per user per page per editing session.
import { apiGet } from "../../../core/api";

export interface AuditEvent {
  id: string;
  event: string;
  user_id: string | null;
  /** Actor snapshot taken at write time; survives user deletion. */
  user_name: string | null;
  user_email: string | null;
  page_id: string | null;
  detail: Record<string, unknown>;
  /** Session start; the paging cursor. */
  created_at: string;
  /** Last activity in a coalesced session; equals created_at otherwise. */
  updated_at: string;
}

export interface AuditPageResult {
  events: AuditEvent[];
  has_more: boolean;
  next_before: string | null;
}

/** Event code -> British English label template. `detail` fills the rest at
 *  render time (page names, N-/T- references, old -> new names). */
export const AUDIT_EVENT_LABELS: Record<string, string> = {
  page_edited: "Edited page",
  page_added: "Added page",
  page_renamed: "Renamed page",
  page_deleted: "Deleted page",
  snapshot_saved: "Saved snapshot",
  snapshot_restored: "Restored snapshot",
  snapshot_copied: "Copied snapshot to a new wireframe",
  wireframe_renamed: "Renamed wireframe",
  wireframe_archived: "Archived wireframe",
  wireframe_restored: "Restored wireframe",
  note_created: "Added note",
  note_edited: "Edited note",
  note_deleted: "Deleted note",
  task_created: "Added task",
  task_edited: "Edited task",
  task_deleted: "Deleted task",
  task_resolved: "Resolved task",
  task_reopened: "Reopened task",
};

/** Filter groups for the audit page's event select. */
export const AUDIT_EVENT_GROUPS: { value: string; label: string; events: string[] }[] = [
  { value: "edits", label: "Page edits", events: ["page_edited"] },
  { value: "structure", label: "Structure", events: ["page_added", "page_renamed", "page_deleted"] },
  {
    value: "notes",
    label: "Notes",
    events: ["note_created", "note_edited", "note_deleted"],
  },
  {
    value: "tasks",
    label: "Tasks",
    events: ["task_created", "task_edited", "task_deleted", "task_resolved", "task_reopened"],
  },
  { value: "snapshots", label: "Snapshots", events: ["snapshot_saved", "snapshot_restored", "snapshot_copied"] },
  {
    value: "wireframe",
    label: "Wireframe",
    events: ["wireframe_renamed", "wireframe_archived", "wireframe_restored"],
  },
];

export const listWireframeAudit = (
  projectId: string,
  wireframeId: string,
  opts?: { limit?: number; before?: string },
) => {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.before) params.set("before", opts.before);
  const query = params.toString();
  return apiGet<AuditPageResult>(
    `/studio/projects/${projectId}/wireframes/${wireframeId}/audit${query ? `?${query}` : ""}`,
  );
};
