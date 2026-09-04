// How a saved snapshot is named wherever it is shown (the snapshots drawer,
// snapshot preview, the copy form). Manual saves are numbered oldest-first so
// they match the "v3" readout in the studio's top bar; the server's automatic
// backups are named by the moment they guard instead.
import type { ProjectVersion } from "./wireframesApi";

/** The server saves these around restores/conflicts; only "manual" snapshots
 *  come from the user's own Save snapshot button. */
export const AUTO_SNAPSHOT_TITLES: Record<string, string> = {
  before_restore: "Backup before a restore",
  before_conflict: "Backup before a conflict",
  before_replay: "Backup before a replay",
  after_replay: "Backup after a replay",
};

/** Manual snapshot id -> its version number. The API returns snapshots newest
 *  first, so the numbering counts down through the list. */
export function snapshotNumbers(versions: readonly ProjectVersion[]): Map<string, number> {
  const numbers = new Map<string, number>();
  let n = versions.filter((v) => v.reason === "manual").length;
  for (const v of versions) if (v.reason === "manual") numbers.set(v.id, n--);
  return numbers;
}

/** A snapshot's display name. The number is only known where the whole list
 *  is (it is a position, not a stored field), so without one a manual
 *  snapshot falls back to its label. */
export function snapshotTitle(version: Pick<ProjectVersion, "label" | "reason">, number?: number): string {
  if (version.reason !== "manual") return AUTO_SNAPSHOT_TITLES[version.reason] ?? "Automatic backup";
  const label = version.label?.trim();
  return [number ? `v${number}` : null, label].filter(Boolean).join(" · ") || "Snapshot";
}
