// Client for a project's usability studies (backend app/studio/usability/).
//
// Two halves. The organisation's side goes through core/api like every other
// project resource. The participant's side (`session*`) is called from the
// public study page, where there is no session at all: it uses plain fetch so
// that it sends no bearer token and no scope headers, and so that a 401 can
// never bounce a participant to the sign-in page.
import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../../core/api";

export interface StudyTask {
  /** Stable for the life of the task: results are keyed on it. */
  id: string;
  title: string;
  scenario: string;
  notes: string[];
  files: string[];
  answer_prompt: string | null;
  // The moderator's half. Never sent to a participant.
  success: string;
  path: string;
  watch: string;
  probes: string[];
}

export interface StudyScript {
  before: string[];
  welcome: string[];
  per_task: string[];
  wrap_up: string[];
  after: string[];
}

export interface StudyEmail {
  subject: string;
  body: string[];
}

/** What email copy may use; anything else in braces is sent as written. */
export const EMAIL_PLACEHOLDERS = ["name", "study", "moderator", "organisation", "duration"] as const;

export interface StudyContent {
  research_questions: string[];
  protocol: string[];
  consent_title: string;
  consent_text: string[];
  /** The testing includes signing up: participants get an email to use and `sign_up_text`, not a test account. */
  sign_up: boolean;
  sign_up_text: string[];
  /** The words of the two booking emails. Studio adds the button, session details and rebooking link itself. */
  emails: { invite: StudyEmail; confirmation: StudyEmail };
  tasks: StudyTask[];
  script: StudyScript;
  words: string[];
  top_words: number;
}

export interface StudySummary {
  id: string;
  name: string;
  status: "open" | "closed";
  persona: string;
  duration: string;
  app_url: string;
  task_count: number;
  participants: number;
  completed: number;
  created_at: string;
  updated_at: string;
}

export interface StudyFile {
  id: string;
  name: string;
  content_type: string;
  size: number;
}

export interface Progress {
  consented: boolean;
  tasks_rated: number;
  tasks_total: number;
  completed: boolean;
}

export interface Participant {
  id: string;
  study_id: string;
  code: string;
  token: string;
  scheduled_at: string;
  role: string;
  company: string;
  characteristics: string;
  /** Always the study's address: every participant opens the same one. */
  app_url: string;
  account_email: string;
  account_password: string;
  account_notes: string;
  consent_name: string | null;
  consent_at: string | null;
  words: string[];
  top_words: string[];
  completed_at: string | null;
  session_notes: string;
  progress: Progress;
  // Booking: who to write to, their booking link, and how it went. Times are UTC instants.
  name: string;
  contact_email: string;
  booking_token: string;
  booked_start: string | null;
  meet_url: string;
  calendar_error: string | null;
  invite_sent_at: string | null;
  invite_error: string | null;
  confirmation_sent_at: string | null;
}

export type ParticipantInput = Partial<
  Pick<
    Participant,
    | "name"
    | "contact_email"
    | "scheduled_at"
    | "role"
    | "company"
    | "characteristics"
    | "account_email"
    | "account_password"
    | "account_notes"
    | "session_notes"
  >
>;

export interface Study
  extends StudySummary,
    Pick<
      StudyDetails,
      | "account_email"
      | "account_password"
      | "account_notes"
      | "moderator_user_id"
      | "session_minutes"
      | "slot_gap_minutes"
      | "timezone"
    > {
  content: StudyContent;
  consent_version: number;
  files: StudyFile[];
  participant_list: Participant[];
}

export type Success = "complete" | "help" | "fail";

/** One task for one participant: rating and answer are theirs, the rest is the moderator's. */
export interface TaskResult {
  task_id: string;
  rating: number | null;
  answer: string;
  time_seconds: number | null;
  errors: number | null;
  success: Success | null;
  observations: string;
}

export interface Capture extends Participant {
  tasks: TaskResult[];
}

export type CaptureInput = Partial<Pick<TaskResult, "time_seconds" | "errors" | "observations">> & {
  success?: Success | "";
};

export interface Observation {
  id: string;
  task_id: string | null;
  text: string;
  solution: string;
  notes: string;
  participant_ids: string[];
}

export interface Stat {
  count: number;
  mean: number | null;
  sd: number | null;
  ci95: number | null;
}

export interface Insights {
  research_questions: string[];
  tasks: { id: string; title: string }[];
  participants: { id: string; code: string; role: string; company: string; completed: boolean }[];
  observations: Observation[];
  metrics: {
    task_id: string;
    title: string;
    rows: (TaskResult & { participant_id: string })[];
    success: Stat;
    time_seconds: Stat;
    errors: Stat;
    rating: Stat;
  }[];
  words: { word: string; chosen: number; top: number }[];
}

/** A study as one document: what Export gives and Import takes. */
export interface StudyExport {
  name: string;
  persona?: string | null;
  duration?: string | null;
  app_url?: string | null;
  content: StudyContent;
  files: { name: string; content_type: string; data_base64: string }[];
}

export interface StudyDetails {
  name: string;
  persona: string;
  duration: string;
  app_url: string;
  /** The test account every participant uses unless their own details say otherwise. */
  account_email: string;
  account_password: string;
  account_notes: string;
  /** A Studio super admin: sessions and holds go on their Google calendar. */
  moderator_user_id: string | null;
  /** How long a bookable slot is. */
  session_minutes: number | null;
  /** The break between one slot and the next; 0 is back to back. */
  slot_gap_minutes: number;
  /** What emails and Studio show times in, e.g. Europe/London. */
  timezone: string;
}

export interface Moderator {
  id: string;
  name: string;
  email: string;
}

/** A study's bookable times, for the Slots tab. Times are UTC instants. */
export interface Availability {
  calendar_connected: boolean;
  calendar_error: string | null;
  /** What stops participants booking, e.g. "choose a moderator". */
  problems: string[];
  /** `booked`: someone has a session in it, so it cannot be changed. */
  windows: { id: string; starts_at: string; ends_at: string; held: boolean; hold_error: string | null; booked: boolean }[];
  slots: {
    start: string;
    /** past: already started, so no longer offered. */
    state: "free" | "booked" | "busy" | "past";
    participant: { id: string; code: string; name: string } | null;
  }[];
}

const base = (projectId: string) => `/studio/projects/${projectId}/usability/studies`;
const one = (projectId: string, studyId: string) => `${base(projectId)}/${studyId}`;

export const listStudies = (projectId: string) => apiGet<StudySummary[]>(base(projectId));
export const getStudy = (projectId: string, studyId: string) => apiGet<Study>(one(projectId, studyId));
export const createStudy = (projectId: string, input: Partial<StudyExport> & { name: string }) =>
  apiPost<Study>(base(projectId), input);
export const updateStudy = (
  projectId: string,
  studyId: string,
  patch: Partial<StudyDetails> & { status?: "open" | "closed"; content?: StudyContent },
) => apiPatch<Study>(one(projectId, studyId), patch);
export const deleteStudy = (projectId: string, studyId: string) => apiDelete(one(projectId, studyId));
export const cloneStudy = (projectId: string, studyId: string, name?: string) =>
  apiPost<Study>(`${one(projectId, studyId)}/clone`, name ? { name } : {});
export const exportStudy = (projectId: string, studyId: string) =>
  apiGet<StudyExport>(`${one(projectId, studyId)}/export`);

export const uploadStudyFile = (
  projectId: string,
  studyId: string,
  file: { name: string; content_type: string; data_base64: string },
) => apiPost<StudyFile>(`${one(projectId, studyId)}/files`, file);
export const deleteStudyFile = (projectId: string, studyId: string, fileId: string) =>
  apiDelete(`${one(projectId, studyId)}/files/${fileId}`);

export const addParticipant = (projectId: string, studyId: string, input: ParticipantInput) =>
  apiPost<Participant>(`${one(projectId, studyId)}/participants`, input);
export const getCapture = (projectId: string, studyId: string, participantId: string) =>
  apiGet<Capture>(`${one(projectId, studyId)}/participants/${participantId}`);
export const updateParticipant = (projectId: string, studyId: string, participantId: string, patch: ParticipantInput) =>
  apiPatch<Participant>(`${one(projectId, studyId)}/participants/${participantId}`, patch);
export const removeParticipant = (projectId: string, studyId: string, participantId: string) =>
  apiDelete(`${one(projectId, studyId)}/participants/${participantId}`);
export const captureTask = (
  projectId: string,
  studyId: string,
  participantId: string,
  taskId: string,
  input: CaptureInput,
) => apiPut<TaskResult>(`${one(projectId, studyId)}/participants/${participantId}/tasks/${taskId}`, input);

export const sendBookingEmail = (projectId: string, studyId: string, participantId: string) =>
  apiPost<Participant>(`${one(projectId, studyId)}/participants/${participantId}/send-booking-email`, {});

export const listModerators = (projectId: string) =>
  apiGet<Moderator[]>(`/studio/projects/${projectId}/usability/moderators`);
export const getAvailability = (projectId: string, studyId: string) =>
  apiGet<Availability>(`${one(projectId, studyId)}/availability`);
export const addAvailability = (projectId: string, studyId: string, window: { starts_at: string; ends_at: string }) =>
  apiPost<Availability>(`${one(projectId, studyId)}/availability`, window);
export const updateAvailability = (
  projectId: string,
  studyId: string,
  windowId: string,
  window: { starts_at: string; ends_at: string },
) => apiPatch<Availability>(`${one(projectId, studyId)}/availability/${windowId}`, window);
export const removeAvailability = async (projectId: string, studyId: string, windowId: string) => {
  await apiDelete(`${one(projectId, studyId)}/availability/${windowId}`);
  return getAvailability(projectId, studyId);
};
export const syncHolds = (projectId: string, studyId: string) =>
  apiPost<Availability>(`${one(projectId, studyId)}/availability/sync-holds`, {});

export const getInsights = (projectId: string, studyId: string) =>
  apiGet<Insights>(`${one(projectId, studyId)}/insights`);
export const addObservation = (projectId: string, studyId: string, input: Partial<Omit<Observation, "id">>) =>
  apiPost<Observation>(`${one(projectId, studyId)}/observations`, input);
export const updateObservation = (
  projectId: string,
  studyId: string,
  observationId: string,
  patch: Partial<Omit<Observation, "id">>,
) => apiPatch<Observation>(`${one(projectId, studyId)}/observations/${observationId}`, patch);
export const deleteObservation = (projectId: string, studyId: string, observationId: string) =>
  apiDelete(`${one(projectId, studyId)}/observations/${observationId}`);

// ── the participant page ────────────────────────────────────────────────────

export type SessionTask = Pick<StudyTask, "id" | "title" | "scenario" | "notes" | "files" | "answer_prompt"> & {
  rating: number | null;
  answer: string;
};

/** What the participant page is given. Everything after `consent` is absent until consent is given. */
export interface Session {
  title: string;
  organisation: string;
  duration: string;
  code: string;
  protocol: string[];
  consent: { title: string; text: string[]; given: boolean; name: string | null; at: string | null };
  /** With `sign_up`, the participant makes the account: no password, and `instructions` to follow. */
  account?: {
    sign_up: boolean;
    instructions: string[];
    app_url: string;
    email: string;
    password: string;
    notes: string;
  };
  tasks?: SessionTask[];
  word_list?: string[];
  top_words_count?: number;
  words?: string[];
  top_words?: string[];
  completed?: boolean;
}

const sessionBase = (token: string) => `/api/studio/usability/session/${encodeURIComponent(token)}`;

const sessionRequest = <T,>(method: string, token: string, path = "", body?: unknown) =>
  publicRequest<T>(method, `${sessionBase(token)}${path}`, body);

/** A call from a public page: no bearer token, no scope headers, and a 401 never redirects. */
async function publicRequest<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // Non-JSON error body; leave parsed as null.
    }
    const detail =
      parsed && typeof parsed === "object" && typeof (parsed as { detail?: unknown }).detail === "string"
        ? ((parsed as { detail: string }).detail)
        : "Something went wrong. Please try again.";
    throw new ApiError(response.status, parsed, detail);
  }
  return (await response.json()) as T;
}

export const getSession = (token: string) => sessionRequest<Session>("GET", token);
export const giveConsent = (token: string, name: string) =>
  sessionRequest<Session>("POST", token, "/consent", { name, agree: true });
export const saveSessionTask = (token: string, taskId: string, input: { rating?: number; answer?: string }) =>
  sessionRequest<{ task_id: string; rating: number | null; answer: string }>("PUT", token, `/tasks/${taskId}`, input);
export const saveSessionWords = (token: string, words: string[], topWords: string[]) =>
  sessionRequest<{ words: string[]; top_words: string[] }>("PUT", token, "/words", { words, top_words: topWords });
export const completeSession = (token: string) => sessionRequest<{ completed: boolean }>("POST", token, "/complete");
export const sessionFileUrl = (token: string, name: string) => `${sessionBase(token)}/files/${encodeURIComponent(name)}`;

// ── the booking page ────────────────────────────────────────────────────────

/** What the public booking page is given. Times are UTC instants. */
export interface Booking {
  title: string;
  organisation: string;
  duration: string;
  session_minutes: number;
  timezone: string;
  moderator: string;
  name: string;
  /** Free slot starts, earliest first. */
  slots: string[];
  booked: { start: string; meet_url: string } | null;
}

const bookingUrl = (token: string) => `/api/studio/usability/booking/${encodeURIComponent(token)}`;

export const getBooking = (token: string) => publicRequest<Booking>("GET", bookingUrl(token));
export const bookSlot = (token: string, start: string) => publicRequest<Booking>("POST", bookingUrl(token), { start });

/** A task file's text, for one shown on the page rather than downloaded (markdown). */
export async function getSessionFileText(token: string, name: string): Promise<string> {
  const response = await fetch(sessionFileUrl(token, name));
  if (!response.ok) throw new ApiError(response.status, null, `${name} could not be loaded.`);
  return response.text();
}
