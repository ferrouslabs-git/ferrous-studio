// Client for a project's deployed environments and the feedback raised against
// them (backend app/studio/board/routes.py).
//
// Both hang off the board, so they are keyed on the project *lineage*: every
// version of a project sees the same UAT link and the same reports.
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, errorMessage } from "../../../core/api";
import { uploadAttachment } from "../attachmentsApi";

export type EnvironmentSlug = "uat" | "staging" | "production";
export type FeedbackKind = "feedback" | "bug" | "requirement";
export type FeedbackSeverity = "low" | "medium" | "high" | "critical";
export type FeedbackStatus = "New" | "Triaged" | "Accepted" | "Declined" | "Done";

export const FEEDBACK_KINDS: FeedbackKind[] = ["feedback", "bug", "requirement"];
export const FEEDBACK_SEVERITIES: FeedbackSeverity[] = ["low", "medium", "high", "critical"];
export const FEEDBACK_STATUSES: FeedbackStatus[] = ["New", "Triaged", "Accepted", "Declined", "Done"];

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
  /** "UAT", "Staging", "Production" -- named by the server, not the client. */
  label: string;
  /** null when nobody has published an address for it yet. */
  url: string | null;
  updated_at: string | null;
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
  created_at: string;
  updated_at: string;
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

/** Publish an address, or clear it with "". Returns all three, so the caller
 *  never has to merge one row back into a list it already holds. */
export const setEnvironment = (projectId: string, slug: EnvironmentSlug, url: string) =>
  apiPut<Environment[]>(`${base(projectId)}/environments/${slug}`, { url });

export const listFeedback = (projectId: string) => apiGet<Feedback[]>(`${base(projectId)}/feedback`);

export const createFeedback = (projectId: string, input: FeedbackInput) =>
  apiPost<Feedback>(`${base(projectId)}/feedback`, input);

export const updateFeedback = (projectId: string, feedbackId: string, patch: Partial<FeedbackInput & { status: FeedbackStatus }>) =>
  apiPatch<Feedback>(`${base(projectId)}/feedback/${feedbackId}`, patch);

export const deleteFeedback = (projectId: string, feedbackId: string) =>
  apiDelete(`${base(projectId)}/feedback/${feedbackId}`);

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
