// The maintenance log's arithmetic (FS-REQ-54), kept pure so it can be tested
// without a page around it.
//
// The rules, in one place:
//   * A month is a calendar month, keyed "YYYY-MM". Report timestamps are UTC
//     from the server, so a report resolved at 23:30 on the last day of a
//     month counts in that month by UTC, the same everywhere.
//   * A contract covers every month from its start date's month to its end
//     date's month inclusive (or for ever, with no end). A month it covers
//     gets its full hours -- no proration for a contract starting mid-month.
//     Overlapping contracts add up: two running at once is two lots of hours.
//   * Hours used in a month are what the reports resolved in it are charged
//     at (chargedWork). A report is charged its own estimate -- the figure the
//     client confirmed at "Estimated – to confirm" -- until requirements are
//     raised from it; from then on the sum of those requirements' estimates
//     supersedes it, since the work is planned and estimated there. A resolved
//     report with nothing to charge uses nothing, and is counted so the page
//     can say so rather than quietly under-reporting.
//   * Unused hours roll over into the next month, without limit. An overspend
//     rolls over too, as a negative balance, so a heavy month is paid back by
//     the next rather than forgotten.
//   * The ledger runs from the month the earliest contract starts to the
//     current month. Reports resolved before any contract existed are not
//     drawn against one.

/** "YYYY-MM". */
export type MonthKey = string;

export interface ContractTerms {
  /** "YYYY-MM-DD". */
  start_date: string;
  end_date: string | null;
  hours_per_month: number;
}

export interface ResolvedWork {
  /** UTC timestamp, or null while the report is not resolved. */
  resolved_at: string | null;
  estimate_hours: number | null;
}

export interface MonthRow {
  month: MonthKey;
  /** Hours the contracts covering this month provide. */
  contracted: number;
  /** The balance carried in from the month before (0 for the first month). */
  rolledOver: number;
  /** Estimates of the reports resolved this month. */
  used: number;
  /** rolledOver + contracted - used: what carries into the next month. */
  balance: number;
  /** Reports resolved this month. */
  resolved: number;
  /** Of those, how many had no estimate and so used nothing. */
  unestimated: number;
}

/** What chargedWork needs of a report and of a requirement raised from it. */
export interface ChargeableReport {
  id: string;
  resolved_at: string | null;
  estimate_hours: number | null;
}
export interface RaisedRequirement {
  feedback_id: string | null;
  estimate_hours: number | null;
}

/**
 * Each report with the hours it is charged at: the summed estimates of the
 * requirements raised from it once it has any, else its own estimate. Null
 * when there is nothing to charge -- no requirement carries an estimate, or
 * (with none raised) the report has none.
 */
export function chargedWork(reports: ChargeableReport[], requirements: RaisedRequirement[]): ResolvedWork[] {
  const raised = new Map<string, (number | null)[]>();
  for (const r of requirements) {
    if (!r.feedback_id) continue;
    const list = raised.get(r.feedback_id) ?? [];
    list.push(r.estimate_hours);
    raised.set(r.feedback_id, list);
  }
  return reports.map((report) => {
    const estimates = raised.get(report.id);
    if (!estimates) return { resolved_at: report.resolved_at, estimate_hours: report.estimate_hours };
    const known = estimates.filter((e): e is number => e != null);
    return { resolved_at: report.resolved_at, estimate_hours: known.length ? round2(known.reduce((a, b) => a + b, 0)) : null };
  });
}

/** The month a date or timestamp falls in: "2026-03-14T09:00:00" -> "2026-03". */
export function monthOf(isoDateOrTimestamp: string): MonthKey {
  return isoDateOrTimestamp.slice(0, 7);
}

export function nextMonth(month: MonthKey): MonthKey {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The month a Date is in, by UTC, to match the server's timestamps. */
export function currentMonth(now: Date = new Date()): MonthKey {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Hours the contracts provide in one month. */
export function contractedIn(contracts: ContractTerms[], month: MonthKey): number {
  let total = 0;
  for (const c of contracts) {
    if (monthOf(c.start_date) > month) continue;
    if (c.end_date !== null && monthOf(c.end_date) < month) continue;
    total += c.hours_per_month;
  }
  return total;
}

/** Floating-point sums of halves and tenths drift (0.1 + 0.2); hours are
 *  shown to two places at most, so they are kept to two places too. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Every month from the earliest contract's start to `upTo` inclusive, oldest
 * first, with the hours contracted, used, rolled over and left. Empty when
 * there are no contracts or the first one has not started yet.
 */
export function maintenanceLedger(contracts: ContractTerms[], work: ResolvedWork[], upTo: MonthKey): MonthRow[] {
  if (contracts.length === 0) return [];
  const first = contracts.map((c) => monthOf(c.start_date)).reduce((a, b) => (b < a ? b : a));
  if (first > upTo) return [];

  const usedBy = new Map<MonthKey, { used: number; resolved: number; unestimated: number }>();
  for (const w of work) {
    if (!w.resolved_at) continue;
    const m = monthOf(w.resolved_at);
    const tally = usedBy.get(m) ?? { used: 0, resolved: 0, unestimated: 0 };
    tally.resolved += 1;
    if (w.estimate_hours == null) tally.unestimated += 1;
    else tally.used += w.estimate_hours;
    usedBy.set(m, tally);
  }

  const rows: MonthRow[] = [];
  let carried = 0;
  for (let m = first; m <= upTo; m = nextMonth(m)) {
    const contracted = contractedIn(contracts, m);
    const tally = usedBy.get(m) ?? { used: 0, resolved: 0, unestimated: 0 };
    const used = round2(tally.used);
    const balance = round2(carried + contracted - used);
    rows.push({
      month: m,
      contracted: round2(contracted),
      rolledOver: carried,
      used,
      balance,
      resolved: tally.resolved,
      unestimated: tally.unestimated,
    });
    carried = balance;
  }
  return rows;
}

/** "12h", "7.5h", "-3h" -- hours, never converted to days: a contract is
 *  sold in hours, and the log has to read in the same unit. */
export function fmtHours(h: number): string {
  if (!Number.isFinite(h)) return "—";
  const rounded = round2(h);
  return `${Object.is(rounded, -0) ? 0 : rounded}h`;
}

/** "March 2026". */
export function fmtMonth(month: MonthKey): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "14 Mar 2026" from "2026-03-14", without a timezone shifting the day. */
export function fmtDay(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * How long a report took to resolve, from when it was raised: "40m", "5h",
 * "3d 4h". Whole minutes under an hour, whole hours under a day, days and
 * hours above. Calendar time, not working time -- the client waited through
 * the weekend too.
 */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}
