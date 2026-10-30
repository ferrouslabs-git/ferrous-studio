// A "which month was it created in" filter for any ListToolbar (FS-REQ-75).
// Months are bucketed in the viewer's own time zone: a report raised at 00:30
// on 1 March BST belongs to March for someone in London, even though it is
// still February in UTC. "" means all time.
import { parseUtcDate } from "../core/format";
import type { ListFilter } from "./ListToolbar";

/** "YYYY-MM" in local time; null when the timestamp does not parse. */
export function localMonthOf(timestamp: string): string | null {
  const d = parseUtcDate(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** True when the month filter is unset, or the timestamp falls in that month. */
export function inMonth(timestamp: string, month: string): boolean {
  return month === "" || localMonthOf(timestamp) === month;
}

/** The distinct months the timestamps fall in, newest first. */
export function monthsOf(timestamps: string[]): string[] {
  const set = new Set<string>();
  for (const t of timestamps) {
    const m = localMonthOf(t);
    if (m) set.add(m);
  }
  return [...set].sort().reverse();
}

/** "March 2026" from "2026-03". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/**
 * A toolbar filter listing every month the rows were created in, newest first,
 * after "All time". A selected month no row falls in any more stays listed so
 * the select never shows a value it has no option for.
 */
export function monthFilter(opts: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  timestamps: string[];
}): ListFilter {
  let months = monthsOf(opts.timestamps);
  if (opts.value && !months.includes(opts.value)) months = [...months, opts.value].sort().reverse();
  return {
    label: opts.label,
    value: opts.value,
    onChange: opts.onChange,
    options: [{ value: "", label: "All time" }, ...months.map((m) => ({ value: m, label: monthLabel(m) }))],
  };
}
