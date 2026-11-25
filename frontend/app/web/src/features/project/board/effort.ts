// The one place progress is computed, ported from the
// reference app's static/js/effort.js. Every progress bar, percentage,
// and count on the board comes from rollup() here; the server
// mirrors the same weights in app/studio/board/service.py's progress_rollup
// so figures it returns (release progress, the board summary) agree with
// the ones computed here from loaded requirements.

// One working day, for turning stored hours into something readable.
// Requirements carry no estimate on the board (FS-REQ-106); hours remain for
// feedback reports and their maintenance charges, always STORED in hours.
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
}

export function rollup(rs: { status: string }[]): Rollup {
  let score = 0;
  let done = 0;
  let inProgress = 0;
  let toTest = 0;
  for (const r of rs) {
    const w = statusWeight(r.status);
    score += w;
    if (r.status === "Done") done++;
    else if (r.status === "InProgress") inProgress++;
    else if (r.status === "ToTest") toTest++;
  }
  const total = rs.length;
  return {
    total,
    done,
    in_progress: inProgress,
    to_test: toTest,
    pct: total ? Math.round((100 * score) / total) : 0,
  };
}

// The estimate control's preset ladder. Chips are the primary control; the
// number box is the escape hatch for a genuinely odd value.
export const EST_PRESETS = [1, 2, 4, 8, 16, 24, 40];
// Past a week the honest answer is usually "this is more than one
// requirement" -- surfaced as a hint, never enforced.
export const EST_SPLIT_HINT_HOURS = 40;
