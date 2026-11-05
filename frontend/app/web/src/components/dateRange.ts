// A "created between these two days" filter for any ListToolbar (FS-REQ-75).
// Days are read in the viewer's own time zone: a report raised at 00:30 on
// 1 April BST was raised on 1 April for someone in London, even though it was
// still 31 March in UTC. Both ends are inclusive and either may be left empty.
import { parseUtcDate } from "../core/format";

/** "YYYY-MM-DD" in local time -- the value a date input holds; null when the
 *  timestamp does not parse. */
export function localDayOf(timestamp: string): string | null {
  const d = parseUtcDate(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** True when the timestamp's local day falls within [from, to]; an empty end
 *  is open. An unparseable timestamp only passes an unset range. */
export function inDateRange(timestamp: string, from: string, to: string): boolean {
  if (from === "" && to === "") return true;
  const day = localDayOf(timestamp);
  if (day === null) return false;
  // ISO days compare correctly as strings.
  return (from === "" || day >= from) && (to === "" || day <= to);
}
