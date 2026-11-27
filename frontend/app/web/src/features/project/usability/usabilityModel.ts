// Pure helpers for usability studies: times, labels, the CSV exports and the
// small conversions the editor needs. No React and no network, so each is
// tested directly (usabilityModel.test.ts).
import type { Insights, Participant, Stat, StudyContent, StudyExport, StudyTask } from "./usabilityApi";

/** Seconds as minutes:seconds, e.g. 95 → "1:35". */
export function clock(seconds: number | null): string {
  if (seconds == null) return "–";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "1:35" or "95" → seconds; anything else → null. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(\d+):([0-5]?\d)$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function progressLabel(p: Pick<Participant, "progress">): { text: string; tone: "" | "accent" | "good" } {
  if (p.progress.completed) return { text: "Finished", tone: "good" };
  if (!p.progress.consented) return { text: "Not started", tone: "" };
  if (p.progress.tasks_rated === 0) return { text: "Consent given", tone: "accent" };
  return { text: `${p.progress.tasks_rated} of ${p.progress.tasks_total} tasks rated`, tone: "accent" };
}

/** "Thu 3 Dec, 14:00" for an instant, in a time zone. */
export function shortWhen(iso: string, timeZone: string, withTime = true): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
  }).format(new Date(iso));
}

/** Where a participant's booking stands, for the participants list. `detail` is the full error, if any. */
export function bookingStatus(
  p: Pick<Participant, "contact_email" | "booked_start" | "invite_sent_at" | "invite_error">,
  timeZone: string,
): { text: string; tone: "" | "accent" | "good" | "warn"; detail?: string } {
  if (p.booked_start) {
    const when = shortWhen(p.booked_start, timeZone);
    if (p.invite_error) return { text: `Booked ${when}, email failed`, tone: "warn", detail: p.invite_error };
    return { text: `Booked ${when}`, tone: "good" };
  }
  if (p.invite_error) return { text: "Email not sent", tone: "warn", detail: p.invite_error };
  if (p.invite_sent_at) return { text: `Invited ${shortWhen(p.invite_sent_at, timeZone, false)}`, tone: "accent" };
  if (!p.contact_email) return { text: "No contact email", tone: "" };
  return { text: "Not invited", tone: "" };
}

/** The link an admin copies and sends to a participant themselves. */
export function participantLink(token: string, origin = window.location.origin): string {
  return `${origin}/study/${token}`;
}

/** The address if it is a web address, else null. The participant is given it
 *  as a link, and a `javascript:` address would run on their page. */
export function webAddress(url: string | null | undefined): string | null {
  const value = (url ?? "").trim();
  return /^https?:\/\/\S+$/i.test(value) ? value : null;
}

export const WEB_ADDRESS_ERROR = "The application address must start with http:// or https://";

/** A new task with an id of its own: results hang off the id, never the position. */
export function newTask(): StudyTask {
  const id = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");
  return { id, title: "", scenario: "", notes: [], files: [], answer_prompt: null, success: "", path: "", watch: "", probes: [] };
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** One word per line → the list a study stores, without blanks or repeats. */
export function linesToList(text: string): string[] {
  return Array.from(new Set(text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)));
}

const SUCCESS_MARK: Record<string, string> = { complete: "✓", help: "help", fail: "✗" };
export const successMark = (success: string | null | undefined) => (success ? SUCCESS_MARK[success] ?? success : "–");

export function num(value: number | null, digits = 1): string {
  return value == null ? "–" : value.toFixed(digits);
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Quote a cell only when it needs it. */
function cell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

/** The measures as the rainbow spreadsheet's Metrics sheet lays them out. */
export function metricsCsv(ins: Insights): string {
  const head1: unknown[] = [""];
  const head2: unknown[] = ["Participant"];
  ins.metrics.forEach((m, i) => {
    head1.push(`Task ${i + 1}`, "", "", "");
    head2.push("Success", "Time (s)", "Errors", "Satisfaction");
  });
  const body = ins.participants.map((p) => [
    p.code,
    ...ins.metrics.flatMap((m) => {
      const r = m.rows.find((x) => x.participant_id === p.id);
      return [r?.success ?? "", r?.time_seconds ?? "", r?.errors ?? "", r?.rating ?? ""];
    }),
  ]);
  const foot = (label: string, pick: (s: Stat) => number | null) => [
    label,
    ...ins.metrics.flatMap((m) => [m.success, m.time_seconds, m.errors, m.rating].map((s) => pick(s) ?? "")),
  ];
  return toCsv([
    head1,
    head2,
    ...body,
    foot("Mean", (s) => s.mean),
    foot("Count", (s) => s.count),
    foot("Standard deviation", (s) => s.sd),
    foot("95% confidence", (s) => s.ci95),
  ]);
}

/** Observations with one column per participant, as the Observations sheet has them. */
export function observationsCsv(ins: Insights): string {
  const taskNo = new Map(ins.tasks.map((t, i) => [t.id, i + 1]));
  const head = ["Task", "Observation", ...ins.participants.map((p) => p.code), "Participants", "Possible solution", "Notes"];
  const rows = ins.observations.map((o) => [
    o.task_id && taskNo.has(o.task_id) ? `Task ${taskNo.get(o.task_id)}` : "General",
    o.text,
    ...ins.participants.map((p) => (o.participant_ids.includes(p.id) ? "x" : "")),
    o.participant_ids.length,
    o.solution,
    o.notes,
  ]);
  return toCsv([head, ...rows]);
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "study";
}

export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── files and import ────────────────────────────────────────────────────────

/** A picked file as the base64 the API takes. */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // In chunks: spreading a large array into fromCharCode overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Read an exported study file. Says what is wrong in words a person can act
 * on; the server validates the content properly when it is created.
 */
export function parseStudyFile(text: string): StudyExport | { error: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { error: "This is not a study file: it is not valid JSON." };
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { error: "This is not a study file." };
  const d = doc as Record<string, unknown>;
  if (!d.content || typeof d.content !== "object") return { error: "This file has no study content in it." };
  return {
    name: typeof d.name === "string" && d.name.trim() ? d.name.trim() : "Imported study",
    persona: typeof d.persona === "string" ? d.persona : null,
    duration: typeof d.duration === "string" ? d.duration : null,
    app_url: typeof d.app_url === "string" ? d.app_url : null,
    content: d.content as StudyContent,
    files: Array.isArray(d.files) ? (d.files as StudyExport["files"]) : [],
  };
}

// ── booking times ───────────────────────────────────────────────────────────

/** How far a time zone is ahead of UTC at one instant, in milliseconds. */
function zoneOffset(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - utcMs;
}

/**
 * A wall-clock date and time ("2026-12-03", "14:00") in a time zone, as a UTC
 * ISO instant. Checked twice so a time either side of a clock change lands right.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wall - zoneOffset(wall, timeZone);
  utc = wall - zoneOffset(utc, timeZone);
  return new Date(utc).toISOString();
}

/** "14:00" for an instant, in a time zone. */
export function timeIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
}

/** "Thursday 3 December" for an instant, in a time zone. */
export function dayIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(
    new Date(iso),
  );
}

/** The short name of a zone at an instant, e.g. "GMT" or "EST". */
export function zoneName(iso: string, timeZone: string): string {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" })
    .formatToParts(new Date(iso))
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

/** Slot instants grouped by the day they fall on in a time zone, in order. */
export function slotsByDay(slots: string[], timeZone: string): { day: string; slots: string[] }[] {
  const out: { day: string; slots: string[] }[] = [];
  for (const iso of [...slots].sort()) {
    const day = dayIn(iso, timeZone);
    const last = out[out.length - 1];
    if (last && last.day === day) last.slots.push(iso);
    else out.push({ day, slots: [iso] });
  }
  return out;
}

/** The viewer's own time zone, e.g. Europe/London. */
export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Every time zone the browser knows, for a picker; a short list if it cannot say. */
export function timeZones(): string[] {
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  return supported ? supported("timeZone") : ["Europe/London", "Europe/Dublin", "Europe/Paris", "America/New_York", "UTC"];
}
