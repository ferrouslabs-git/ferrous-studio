// The platform Kanban's pure parts: week arithmetic, the saved filter and
// what it lets through. Kept apart from the page so they can be tested.
import type { KanbanItem } from "./kanbanApi";

/** The assignee filter's value for work nobody has picked up. */
export const UNASSIGNED = "__unassigned__";

/** A date as YYYY-MM-DD in local time (never via toISOString, which is UTC). */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parses YYYY-MM-DD as a local date; null if it is not one. */
export function parseIsoDate(s: string | null | undefined): Date | null {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

/** The Monday of the week `d` falls in. */
export function mondayOf(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + days);
  return out;
}

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "23 – 29 Nov 2026", "30 Nov – 6 Dec 2026", "29 Dec 2025 – 4 Jan 2026". */
export function formatWeek(monday: Date): string {
  const sunday = addDays(monday, 6);
  if (monday.getFullYear() !== sunday.getFullYear()) {
    return `${DAY_MONTH_YEAR.format(monday)} – ${DAY_MONTH_YEAR.format(sunday)}`;
  }
  if (monday.getMonth() !== sunday.getMonth()) {
    return `${DAY_MONTH.format(monday)} – ${DAY_MONTH_YEAR.format(sunday)}`;
  }
  return `${monday.getDate()} – ${DAY_MONTH_YEAR.format(sunday)}`;
}

/**
 * The filter, as saved. Projects are kept by lineage, so a new version of a
 * project stays picked; assignees keep their names, so a pick still reads
 * right in a week where that person has no work.
 */
export interface KanbanFilter {
  lineages: { id: string; name: string }[];
  assignees: { id: string; name: string }[];
}

export const NO_FILTER: KanbanFilter = { lineages: [], assignees: [] };

const isPick = (v: unknown): v is { id: string; name: string } =>
  !!v && typeof v === "object" && typeof (v as { id: unknown }).id === "string" && typeof (v as { name: unknown }).name === "string";

/** A saved filter read back defensively: anything malformed is dropped. */
export function parseFilter(raw: string | null): KanbanFilter {
  if (!raw) return NO_FILTER;
  try {
    const v = JSON.parse(raw) as Partial<KanbanFilter>;
    return {
      lineages: Array.isArray(v.lineages) ? v.lineages.filter(isPick) : [],
      assignees: Array.isArray(v.assignees) ? v.assignees.filter(isPick) : [],
    };
  } catch {
    return NO_FILTER;
  }
}

/** An empty pick means everything, as with every MultiSelect. */
export function matchesFilter(item: KanbanItem, filter: KanbanFilter): boolean {
  if (filter.lineages.length > 0 && !filter.lineages.some((l) => l.id === item.lineage_id)) return false;
  if (filter.assignees.length > 0) {
    const who = item.assignee?.id ?? UNASSIGNED;
    if (!filter.assignees.some((a) => a.id === who)) return false;
  }
  return true;
}
