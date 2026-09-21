// The one place progress and estimates are computed, ported from the
// reference app's static/js/effort.js. Every progress bar, percentage,
// count and effort figure on the board comes from rollup() here; the server
// mirrors the same weights in app/studio/board/service.py's progress_rollup
// so figures it returns (release progress, the board summary) agree with
// the ones computed here from loaded requirements.

// One working day, for turning stored hours into something readable.
// Estimates are always STORED in hours; this only affects display.
export const WORK_DAY_HOURS = 8;

const trimNum = (n: number) => String(Math.round(n * 10) / 10);

// 12 -> "1.5d", 6 -> "6h", 40 -> "5d", null -> "—". One decimal at most, and
// "not estimated" (null) never renders as "0h" -- the difference between
// unknown and nothing is the whole point of the nullable column.
export function fmtEffort(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return "—";
  if (h < WORK_DAY_HOURS) return trimNum(h) + "h";
  return trimNum(h / WORK_DAY_HOURS) + "d";
}

// How much of a requirement counts as delivered. Done is finished; ToTest is
// credited three quarters (implemented, awaiting a human's approval);
// InProgress half. NotStarted and Blocked count as zero.
export function statusWeight(status: string): number {
  if (status === "Done") return 1;
  if (status === "ToTest") return 0.75;
  if (status === "InProgress") return 0.5;
  return 0;
}

export interface Rollup {
  total: number;
  done: number;
  in_progress: number;
  to_test: number;
  // Weighted by statusWeight(); the three counts above are plain, because a
  // bar's label should say what is true ("3/8 done") rather than the weighting.
  pct: number;
  // Sum of the estimates that EXIST, and how much of the set they cover. A
  // total over a half-estimated epic is not the epic's size, so anything
  // showing `hours` must consult the coverage -- see effortSummary().
  hours: number;
  hours_done: number;
  estimated: number;
  unestimated: number;
  // 1 when there is nothing to estimate, so an empty epic is not "0% estimated".
  coverage: number;
}

export interface Estimable {
  status: string;
  estimate_hours?: number | null;
}

export function rollup(rs: Estimable[]): Rollup {
  let score = 0;
  let done = 0;
  let inProgress = 0;
  let toTest = 0;
  let hours = 0;
  let hoursDone = 0;
  let estimated = 0;
  for (const r of rs) {
    const w = statusWeight(r.status);
    score += w;
    if (r.status === "Done") done++;
    else if (r.status === "InProgress") inProgress++;
    else if (r.status === "ToTest") toTest++;
    const h = r.estimate_hours;
    if (h != null) {
      estimated++;
      hours += h;
      hoursDone += h * w;
    }
  }
  const total = rs.length;
  return {
    total,
    done,
    in_progress: inProgress,
    to_test: toTest,
    pct: total ? Math.round((100 * score) / total) : 0,
    hours,
    hours_done: hoursDone,
    estimated,
    unestimated: total - estimated,
    coverage: total ? estimated / total : 1,
  };
}

// How a rolled-up effort total is worded. Partial coverage states the partial
// sum and admits the gap -- "3d · 6/10 estimated" -- rather than inventing a
// floor or a projection. `partial` lets callers style the figure as provisional.
export function effortSummary(p: Rollup): { text: string; partial: boolean } {
  if (!p.total) return { text: "", partial: false };
  if (!p.estimated) return { text: "not estimated", partial: true };
  return p.estimated === p.total
    ? { text: fmtEffort(p.hours), partial: false }
    : { text: `${fmtEffort(p.hours)} · ${p.estimated}/${p.total} estimated`, partial: true };
}

// The estimate control's preset ladder. Chips are the primary control; the
// number box is the escape hatch for a genuinely odd value.
export const EST_PRESETS = [1, 2, 4, 8, 16, 24, 40];
// Past a week the honest answer is usually "this is more than one
// requirement" -- surfaced as a hint, never enforced.
export const EST_SPLIT_HINT_HOURS = 40;
