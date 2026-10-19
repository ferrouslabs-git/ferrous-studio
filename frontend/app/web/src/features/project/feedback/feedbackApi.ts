// Client for a project's deployed environments and the feedback raised against
// them (backend app/studio/board/routes.py).
//
// Both hang off the board, so they are keyed on the project *lineage*: every
// version of a project sees the same UAT link and the same reports.
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, errorMessage } from "../../../core/api";
import { uploadAttachment } from "../attachmentsApi";

/** An environment's stable key. A board starts with "uat", "staging" and
 *  "production"; ones added later get a slug minted from their first name. */
export type EnvironmentSlug = string;
export type FeedbackKind = "feedback" | "bug" | "requirement";
export type FeedbackSeverity = "low" | "medium" | "high" | "critical";
/** Wire values; statuses.FEEDBACK_STATUSES on the server. */
export type FeedbackStatus =
  | "New"
  | "EstimatedToConfirm"
  | "OnHold"
  | "NotABug"
  | "Confirmed"
  | "InProgress"
  | "Resolved";

export const FEEDBACK_KINDS: FeedbackKind[] = ["feedback", "bug", "requirement"];
export const FEEDBACK_SEVERITIES: FeedbackSeverity[] = ["low", "medium", "high", "critical"];
export const FEEDBACK_STATUSES: FeedbackStatus[] = [
  "New",
  "EstimatedToConfirm",
  "OnHold",
  "NotABug",
  "Confirmed",
  "InProgress",
  "Resolved",
];

/** What each status is called on screen (statuses.FEEDBACK_STATUS_LABEL). */
export const STATUS_LABELS: Record<FeedbackStatus, string> = {
  New: "New",
  EstimatedToConfirm: "Estimated – to confirm",
  OnHold: "On hold – fix later",
  NotABug: "Not a bug, added to backlog",
  Confirmed: "Confirmed, not started",
  InProgress: "Fix in progress",
  Resolved: "Resolved",
};

/** A report in one of these has had its outcome; the default queue hides them. */
export const CLOSED_STATUSES: ReadonlySet<FeedbackStatus> = new Set<FeedbackStatus>(["NotABug", "Resolved"]);

/** What each kind is called on screen. The wire value stays lower case. */
export const KIND_LABELS: Record<FeedbackKind, string> = {
  feedback: "Feedback",
  bug: "Bug",
  requirement: "New requirement",
};

export const SEVERITY_LABELS: Record<FeedbackSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export interface Environment {
  slug: EnvironmentSlug;
  /** What it is called on screen; renaming it never changes the slug. */
  label: string;
  /** null when nobody has published an address for it yet. */
  url: string | null;
  updated_at: string | null;
  /** Reports raised against it; one with any cannot be removed. */
  feedback_count: number;
}

export interface Feedback {
  id: string;
  human_id: string;
  environment: EnvironmentSlug;
  kind: FeedbackKind;
  severity: FeedbackSeverity;
  title: string;
  detail: string;
  /** The exact page, the environment address being only the base. "" if unset. */
  page_url: string;
  status: FeedbackStatus;
  /** Server-side count, so the list can show which reports carry evidence
   *  without a listAttachments call per row. */
  screenshot_count: number;
  raised_by: string | null;
  raised_by_name: string | null;
  raised_by_email: string | null;
  assignee_id: string | null;
  /** Hours; null is "not estimated", never zero. */
  estimate_hours: number | null;
  /** When it last became Resolved; null while it is not. */
  resolved_at: string | null;
  /** The requirement raised from it, if any -- it may since have been deleted. */
  requirement_id: string | null;
  created_at: string;
  updated_at: string;
}

/** What triage changes beyond the reporter's own fields. */
export interface FeedbackTriage {
  status?: FeedbackStatus;
  assignee_id?: string | null;
  clear_assignee?: boolean;
  estimate_hours?: number | null;
}

/** One dated period of a maintenance agreement. Dates are "YYYY-MM-DD". */
export interface MaintenanceContract {
  id: string;
  start_date: string;
  end_date: string | null;
  hours_per_month: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceContractInput {
  start_date: string;
  end_date: string | null;
  hours_per_month: number;
}

export interface FeedbackInput {
  environment: EnvironmentSlug;
  kind: FeedbackKind;
  severity: FeedbackSeverity;
  title: string;
  detail: string;
  page_url: string;
}

const base = (projectId: string) => `/studio/projects/${projectId}/board`;

export const listEnvironments = (projectId: string) =>
  apiGet<Environment[]>(`${base(projectId)}/environments`);

// Every environment write answers with the whole list, in order, so the
// caller never has to merge one row back into a list it already holds.

/** Add one at the end of the list; the address may be left blank. */
export const createEnvironment = (projectId: string, input: { label: string; url: string }) =>
  apiPost<Environment[]>(`${base(projectId)}/environments`, input);

/** Rename it, publish or clear its address ("" clears), or both. */
export const setEnvironment = (projectId: string, slug: EnvironmentSlug, patch: { label?: string; url?: string }) =>
  apiPut<Environment[]>(`${base(projectId)}/environments/${encodeURIComponent(slug)}`, patch);

/** Every slug, in the new order. */
export const reorderEnvironments = (projectId: string, slugs: EnvironmentSlug[]) =>
  apiPut<Environment[]>(`${base(projectId)}/environments/order`, { slugs });

/** Refused (409) while any report names it. The caller reloads the list afterwards. */
export const deleteEnvironment = (projectId: string, slug: EnvironmentSlug) =>
  apiDelete(`${base(projectId)}/environments/${encodeURIComponent(slug)}`);

export const listFeedback = (projectId: string) => apiGet<Feedback[]>(`${base(projectId)}/feedback`);

export const createFeedback = (projectId: string, input: FeedbackInput) =>
  apiPost<Feedback>(`${base(projectId)}/feedback`, input);

export const updateFeedback = (projectId: string, feedbackId: string, patch: Partial<FeedbackInput> & FeedbackTriage) =>
  apiPatch<Feedback>(`${base(projectId)}/feedback/${feedbackId}`, patch);

export const deleteFeedback = (projectId: string, feedbackId: string) =>
  apiDelete(`${base(projectId)}/feedback/${feedbackId}`);

/** Raise a board requirement from the report; answers with the report, now
 *  carrying `requirement_id`. 409 while its requirement is still live. */
export const createRequirementFromFeedback = (projectId: string, feedbackId: string) =>
  apiPost<Feedback>(`${base(projectId)}/feedback/${feedbackId}/requirement`, {});

// ── Maintenance contracts ────────────────────────────────────────────────

export const listMaintenanceContracts = (projectId: string) =>
  apiGet<MaintenanceContract[]>(`${base(projectId)}/maintenance-contracts`);

export const createMaintenanceContract = (projectId: string, input: MaintenanceContractInput) =>
  apiPost<MaintenanceContract>(`${base(projectId)}/maintenance-contracts`, input);

export const updateMaintenanceContract = (projectId: string, id: string, patch: Partial<MaintenanceContractInput>) =>
  apiPatch<MaintenanceContract>(`${base(projectId)}/maintenance-contracts/${id}`, patch);

export const deleteMaintenanceContract = (projectId: string, id: string) =>
  apiDelete(`${base(projectId)}/maintenance-contracts/${id}`);

// ── Screenshots ──────────────────────────────────────────────────────────

/** One screenshot on its way up. `file` is already the finished image. */
export interface ScreenshotUpload {
  id: string;
  file: File;
  status: "queued" | "uploading" | "done" | "failed";
  error?: string;
}

/**
 * Upload a report's screenshots, one after another.
 *
 * Sequential rather than Promise.all on purpose: a tester on a slow connection
 * wants a truthful "2 of 3", and one failure must not take the others with it.
 * Reports every transition through `onChange` and never throws -- the caller
 * decides what a partial failure means, because by this point the report itself
 * has already been raised and must not be rolled back.
 */
export async function uploadFeedbackScreenshots(
  projectId: string,
  feedbackId: string,
  queue: ScreenshotUpload[],
  onChange: (next: ScreenshotUpload[]) => void,
): Promise<{ uploaded: number; failed: number }> {
  const items = queue.map((item) => ({ ...item }));
  let uploaded = 0;
  let failed = 0;

  for (const item of items) {
    if (item.status === "done") continue;
    item.status = "uploading";
    item.error = undefined;
    onChange([...items]);
    try {
      await uploadAttachment(projectId, "feedback", feedbackId, item.file);
      item.status = "done";
      uploaded += 1;
    } catch (err) {
      item.status = "failed";
      item.error = errorMessage(err);
      failed += 1;
    }
    onChange([...items]);
  }
  return { uploaded, failed };
}
