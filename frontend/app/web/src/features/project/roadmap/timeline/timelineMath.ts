// The roadmap's time axis and derived extents, ported from the reference
// app's static/js/timeline.js. Two rules keep it honest: every date comes
// from a sprint (epics carry none of their own, so an epic with nothing
// scheduled gets no bar), and hours never position anything.
import type { Requirement } from "../../board/requirementsApi";
import type { Sprint } from "../../board/sprintsApi";

export const TL_DAY = 86400000;
export const tlParse = (d: string | null | undefined): Date | null => (d ? new Date(d + "T00:00:00") : null);

export interface Extent {
  start: string;
  end: string;
  sprints: number;
}

// An epic's dates are the union of the dated sprints its requirements sit in.
export function epicExtent(epicRequirements: Requirement[], sprintById: Map<string, Sprint>): Extent | null {
  const sids = [...new Set(epicRequirements.map((r) => r.sprint_id).filter((x): x is string => !!x))];
  const dated = sids
    .map((id) => sprintById.get(id))
    .filter((s): s is Sprint => !!s && !!s.start_date && !!s.end_date);
  if (!dated.length) return null;
  const starts = dated.map((s) => s.start_date as string).sort();
  const ends = dated.map((s) => s.end_date as string).sort();
  return { start: starts[0], end: ends[ends.length - 1], sprints: dated.length };
}

// A release spans its epics' derived bars and its own dated sprints, so a
// release with sprints planned but nothing committed still has a bar. Its
// own date is drawn separately as a target marker, so an epic running past
// it reads as visible overrun.
export function releaseExtent(
  epicExtents: (Extent | null)[],
  ownSprints: Sprint[],
): { start: string; end: string } | null {
  const ex: { start: string; end: string }[] = epicExtents.filter((x): x is Extent => !!x);
  for (const s of ownSprints) if (s.start_date && s.end_date) ex.push({ start: s.start_date, end: s.end_date });
  if (!ex.length) return null;
  const starts = ex.map((x) => x.start).sort();
  const ends = ex.map((x) => x.end).sort();
  return { start: starts[0], end: ends[ends.length - 1] };
}

export interface TimeWindow {
  lo: number;
  hi: number;
  span: number;
}

// Spans everything that has a real date, padded either side. Null when
// nothing is dated at all -- the caller renders an empty state rather than
// inventing a window.
export function tlWindow(sprints: Sprint[], now: number = Date.now()): TimeWindow | null {
  const ds: string[] = [];
  for (const s of sprints) {
    if (s.start_date) ds.push(s.start_date);
    if (s.end_date) ds.push(s.end_date);
  }
  if (!ds.length) return null;
  ds.sort();
  const t0 = (tlParse(ds[0]) as Date).getTime();
  const t1 = (tlParse(ds[ds.length - 1]) as Date).getTime();
  const lo = Math.min(t0, now) - 3 * TL_DAY;
  const hi = Math.max(t1, now) + 7 * TL_DAY;
  return { lo, hi, span: Math.max(hi - lo, TL_DAY) };
}

export const tlPct = (w: TimeWindow, d: string | number): number => {
  const t = typeof d === "number" ? d : (tlParse(d) as Date).getTime();
  return Math.max(0, Math.min(100, (100 * (t - w.lo)) / w.span));
};

// left/width for a bar, clamped into the window so a stray date cannot push
// a bar off the row.
export function tlBarStyle(w: TimeWindow, start: string, end: string): { left: string; width: string } {
  const a = tlPct(w, start);
  const b = tlPct(w, end);
  return { left: `${a}%`, width: `${Math.max(b - a, 0.6)}%` };
}

export function tlTicks(w: TimeWindow): { pct: number; label: string }[] {
  const out: { pct: number; label: string }[] = [];
  const d = new Date(w.lo);
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  while (d.getTime() < w.hi) {
    out.push({ pct: tlPct(w, d.getTime()), label: d.toLocaleString("en-GB", { month: "short" }) });
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

// An extent that ends after the release's target date is overrun -- the one
// thing the roadmap exists to make loud.
export const isLate = (extent: Extent | null, releaseDate: string | null): boolean =>
  !!(extent && releaseDate && extent.end > releaseDate);
