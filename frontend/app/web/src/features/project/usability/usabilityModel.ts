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

/** The link an admin copies and sends to a participant themselves. */
export function participantLink(token: string, origin = window.location.origin): string {
  return `${origin}/study/${token}`;
}

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
