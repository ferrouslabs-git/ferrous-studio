/** Backend timestamps are naive UTC; without a zone suffix `new Date()`
 *  would read them as local time, shifting every display by the offset. */
export function parseUtcDate(iso: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

/** British date and time, independent of the browser locale:
 *  "3 Sept 2026, 14:05". */
export function formatDateTime(iso: string): string {
  const date = parseUtcDate(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Time only, for a running conversation where the date is implied by
 *  position on screen: "14:05". */
export function formatTime(iso: string): string {
  const date = parseUtcDate(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** 1536 -> "1.5 KB". Binary units, one decimal above KB, none for bytes. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]}`;
}

/** British date, independent of the browser locale: "27 Aug 2026". */
export function formatDate(iso: string): string {
  const date = parseUtcDate(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "1 project", "3 projects", or with `of` "3 of 12 projects". */
export function countOf(visible: number, total: number, noun: [string, string]): string {
  const word = total === 1 ? noun[0] : noun[1];
  return visible === total ? `${total} ${word}` : `${visible} of ${total} ${word}`;
}
