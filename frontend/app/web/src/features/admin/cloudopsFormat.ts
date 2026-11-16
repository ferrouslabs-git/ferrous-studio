// Small, pure helpers for the CloudOps costs page, kept out of the component so they can be tested alone.
import { AutoWake, DailyAmount, ServiceRow, ServiceState } from "./cloudopsApi";

/** 1234.5 -> "$1,234.50"; negatives read "-$33.29" so credits are unmistakable. */
export function usd(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "-" : ""}$${abs}`;
}

/** An amount's share of a total, as "42%"; "—" when there is no total to compare against. */
export function share(amount: number, total: number): string {
  if (!(total > 0)) return "—";
  const pct = (amount / total) * 100;
  return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

/** Bar heights (0 to 1) for a daily series, scaled to the biggest day across every series passed in. */
export function barHeights(series: DailyAmount[], max: number): number[] {
  if (!(max > 0)) return series.map(() => 0);
  return series.map((d) => Math.max(0, Math.min(1, d.amount / max)));
}

export function peak(...series: DailyAmount[][]): number {
  return Math.max(0, ...series.flat().map((d) => d.amount));
}

/** "2026-11-16" -> "16 Nov". */
export function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${names[m - 1]}`;
}

// ── Resources ───────────────────────────────────────────────────────────────


/** "$12.66/mo", the estimate shown beside each service. */
export const perMonth = (n: number): string => `${usd(n)}/mo`;

export const STATE_LABEL: Record<ServiceState, string> = {
  running: "Running",
  asleep: "Asleep",
  stopped: "Stopped",
  starting: "Starting",
  unhealthy: "Unhealthy",
};

/** "0.25 vCPU · 0.5 GB". */
export const sizeLabel = (vcpu: number, gb: number): string => `${vcpu} vCPU · ${gb} GB`;

/** What the auto-wake tags amount to, in words. */
export function autowakeText(a: AutoWake, now: Date = new Date()): string {
  if (a.follows) return `Follows ${a.follows}`;
  if (!a.enabled) return "Off";
  const parts = [`On · sleeps after ${a.idle_minutes ?? 60} min idle`];
  if (a.keep_awake_until && new Date(a.keep_awake_until) > now) parts.push(`awake until ${a.keep_awake_until.replace("T", " ").replace("Z", " UTC")}`);
  return parts.join(" · ");
}

/** How many services are in each state. */
export function countStates(rows: ServiceRow[]): Record<ServiceState, number> {
  const out: Record<ServiceState, number> = { running: 0, asleep: 0, stopped: 0, starting: 0, unhealthy: 0 };
  for (const r of rows) out[r.state] += 1;
  return out;
}

// ── Actions ─────────────────────────────────────────────────────────────────

export const canStop = (state: ServiceState): boolean => state === "running" || state === "starting" || state === "unhealthy";
export const canStart = (state: ServiceState): boolean => state === "asleep" || state === "stopped";

export const ACTION_LABEL: Record<string, string> = {
  start: "Started",
  stop: "Stopped",
  set_autowake: "Changed auto-wake",
  set_keep_awake: "Changed keep-awake",
};

/** A <input type="datetime-local"> value ("2026-11-21T18:00", the person's own time) as an ISO UTC string, or null when empty. */
export function toIsoUtc(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Idle minutes as typed: blank means the default (null); anything not a whole number from 5 to 1440 is an error message. */
export function parseIdle(text: string): { value: number | null; error?: string } {
  if (text.trim() === "") return { value: null };
  const n = Number(text);
  if (!Number.isInteger(n) || n < 5 || n > 1440) return { value: null, error: "Idle minutes must be a whole number from 5 to 1440." };
  return { value: n };
}
