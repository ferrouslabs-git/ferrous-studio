// Pure helpers over the loaded board: ordering, derived dates, the release
// backlog, sprint arithmetic. Ported from the reference app's roadmap.js,
// releases.js, sprints.js and effort.js. Nothing here touches React or the
// network, so it is unit-tested directly.
import type { Epic } from "./epicsApi";
import { rollup } from "./effort";
import type { Feature } from "./featuresApi";
import type { Release } from "./releasesApi";
import type { Requirement } from "./requirementsApi";
import type { Sprint, SprintState } from "./sprintsApi";

// The trailing number of a human id ("E12" -> 12, "REQ-7" -> 7), which is the
// creation order every list here sorts by.
export const numSuffix = (humanId: string): number => parseInt(String(humanId).match(/(\d+)$/)?.[1] ?? "0", 10);

const bySeq = <T extends { human_id: string }>(a: T, b: T) => numSuffix(a.human_id) - numSuffix(b.human_id);

export const sortEpics = (epics: Epic[]): Epic[] => [...epics].sort(bySeq);
export const sortFeatures = (features: Feature[]): Feature[] => [...features].sort(bySeq);
export const sortRequirements = (rs: Requirement[]): Requirement[] => [...rs].sort(bySeq);

// ── the two OR-inheritance rules ────────────────────────────────────────────
// A requirement's effective EPIC is its own epic if set, else its feature's;
// its effective RELEASE is its own release if set, else its effective epic's.
// The server annotates both on every requirement it returns; these recompute
// from the loaded board so a local change (an epic moved to another release)
// is reflected without a refetch.
export function effectiveEpicId(r: Requirement, featureById: Map<string, Feature>): string | null {
  if (r.epic_id) return r.epic_id;
  if (r.feature_id) return featureById.get(r.feature_id)?.epic_id ?? null;
  return null;
}

export function effectiveReleaseId(
  r: Requirement,
  epicById: Map<string, Epic>,
  featureById: Map<string, Feature>,
): string | null {
  if (r.release_id) return r.release_id;
  const eid = effectiveEpicId(r, featureById);
  return (eid ? epicById.get(eid)?.release_id : null) ?? null;
}

// ── releases ────────────────────────────────────────────────────────────────
// A release has no date of its own: its date is the end of the latest sprint
// filed under it. The server derives the same value (Release.date); this
// copy recomputes from the loaded sprints after a sprint edit.
export interface ReleaseSchedule {
  date: string | null;
  last: Sprint | null;
  sprints: number;
}

export function releaseSchedule(releaseId: string, sprints: Sprint[]): ReleaseSchedule {
  const mine = sprints.filter((s) => s.release_id === releaseId);
  const dated = mine.filter((s) => s.end_date);
  if (!dated.length) return { date: null, last: null, sprints: mine.length };
  const last = dated.reduce((a, b) => ((b.end_date ?? "") > (a.end_date ?? "") ? b : a));
  return { date: last.end_date, last, sprints: mine.length };
}

export const releaseDate = (release: Release, sprints: Sprint[]): string | null =>
  releaseSchedule(release.id, sprints).date;

// Shipped releases sink to the bottom, most recent first; the rest sort by
// derived date with unscheduled ones last -- the order every consumer wants.
export function sortReleases(releases: Release[], sprints: Sprint[]): Release[] {
  return [...releases].sort((a, b) => {
    if (!!a.shipped_at !== !!b.shipped_at) return a.shipped_at ? 1 : -1;
    if (a.shipped_at && b.shipped_at) return a.shipped_at < b.shipped_at ? 1 : -1;
    const da = releaseDate(a, sprints) ?? "9999";
    const db = releaseDate(b, sprints) ?? "9999";
    if (da !== db) return da < db ? -1 : 1;
    return bySeq(a, b);
  });
}

export type DueClass = "due-ok" | "due-soon" | "due-over" | "due-none" | "due-shipped";

export interface DueStatus {
  cls: DueClass;
  label: string;
}

export function releaseDue(release: Release, sprints: Sprint[], now: Date = new Date()): DueStatus {
  if (release.shipped_at) return { cls: "due-shipped", label: `shipped ${release.shipped_at.slice(0, 10)}` };
  const date = releaseDate(release, sprints);
  if (!date) return { cls: "due-none", label: "unscheduled" };
  const days = Math.ceil((new Date(date + "T23:59:59").getTime() - now.getTime()) / 86400000);
  if (days < 0) return { cls: "due-over", label: `${-days}d overdue` };
  if (days === 0) return { cls: "due-soon", label: "due today" };
  if (days <= 14) return { cls: "due-soon", label: `${days}d left` };
  return { cls: "due-ok", label: `${days}d left` };
}

// What is still open on a release when someone ships it. Shipping is a human
// call and never blocked; this is what the confirmation lists.
export function shipGaps(release: Release, backlog: Requirement[], sprints: Sprint[]): string[] {
  const open = backlog.filter((r) => r.status !== "Done");
  const live = sprints.filter((s) => s.release_id === release.id && s.state !== "done");
  const gaps: string[] = [];
  if (open.length) gaps.push(`${open.length} requirement${open.length === 1 ? " is" : "s are"} not Done`);
  if (live.length) {
    gaps.push(`${live.length} sprint${live.length === 1 ? "" : "s"} still open (${live.map((s) => s.human_id).join(", ")})`);
  }
  return gaps;
}

// ── sprints ─────────────────────────────────────────────────────────────────
const SP_RANK: Record<SprintState, number> = { active: 0, planned: 1, done: 2 };

// Active first, then planned, then done; newest first within a state.
export const sortSprints = (sprints: Sprint[]): Sprint[] =>
  [...sprints].sort((a, b) => SP_RANK[a.state] - SP_RANK[b.state] || numSuffix(b.human_id) - numSuffix(a.human_id));

// A release's sprints in date order (undated last). null = no release.
export function sprintsOf(releaseId: string | null, sprints: Sprint[]): Sprint[] {
  return sprints
    .filter((s) => (s.release_id ?? null) === releaseId)
    .sort((a, b) => {
      const sa = a.start_date || "9999";
      const sb = b.start_date || "9999";
      if (sa !== sb) return sa < sb ? -1 : 1;
      return bySeq(a, b);
    });
}

export function sprintDaysLeft(sprint: Sprint, now: Date = new Date()): number | null {
  if (!sprint.end_date) return null;
  return Math.ceil((new Date(sprint.end_date + "T23:59:59").getTime() - now.getTime()) / 86400000);
}

// The days badge on a sprint (release page card and sprint board header):
// null when the sprint has no end date. "Soon" is three days, tighter than
// a release's fortnight, because a sprint is the unit that actually slips.
export function sprintDue(sprint: Sprint, now: Date = new Date()): DueStatus | null {
  const days = sprintDaysLeft(sprint, now);
  if (days === null) return null;
  return {
    cls: days < 0 ? "due-over" : days <= 3 ? "due-soon" : "due-ok",
    label: days < 0 ? `${-days}d over` : `${days}d left`,
  };
}

// The question asked before completing a sprint: unfinished work goes back
// to the release backlog, and the count is the thing worth knowing first.
export function completeSprintMessage(sprint: Sprint, requirements: Requirement[]): string {
  const open = requirements.filter((r) => r.status !== "Done").length;
  return `Complete ${sprint.name}?` + (open ? `\n${open} unfinished requirement(s) return to the backlog.` : "");
}

// Agent work order within one sprint: queued items first by position, then
// everything else. Nulls sort last rather than being excluded -- an
// unordered requirement in an active sprint is still eligible, just last.
export function spOrdered(rs: Requirement[]): Requirement[] {
  return [...rs].sort(
    (a, b) => (a.queue_position ?? Infinity) - (b.queue_position ?? Infinity) || bySeq(a, b),
  );
}

// The PATCHes that reflow one sprint's order around a requirement's new
// 1-based slot. Scoped to a single sprint and to Todo items -- the queue an
// agent actually walks.
export function reorderPatches(
  ordered: Requirement[],
  r: Requirement,
  newPos: number,
): { id: string; queue_position: number }[] {
  const current = ordered.filter((x) => x.status === "Todo");
  const without = current.filter((x) => x.id !== r.id);
  const clamped = Math.max(1, Math.min(newPos, without.length + 1));
  without.splice(clamped - 1, 0, r);
  const changes: { id: string; queue_position: number }[] = [];
  without.forEach((x, i) => {
    if (x.queue_position !== i + 1) changes.push({ id: x.id, queue_position: i + 1 });
  });
  return changes;
}

// Measured velocity: the mean effort completed over the last few finished
// sprints. Completing a sprint returns everything that is not Done to the
// backlog, so the requirements still tagged to a done sprint are exactly the
// ones it delivered. Sprints with no estimated work are skipped.
export const VELOCITY_SAMPLE = 3;

export function recentVelocity(sprints: Sprint[], requirements: Requirement[]): { hours: number; n: number } | null {
  const finished = sprints
    .filter((s) => s.state === "done")
    .sort((a, b) => numSuffix(b.human_id) - numSuffix(a.human_id))
    .slice(0, VELOCITY_SAMPLE)
    .map((s) => rollup(requirements.filter((r) => r.sprint_id === s.id)).hours_done)
    .filter((h) => h > 0);
  return finished.length
    ? { hours: finished.reduce((a, b) => a + b, 0) / finished.length, n: finished.length }
    : null;
}

// The sprint's one lifecycle control: ▶ Start / ✓ Complete / ↺ Reopen.
export interface SprintLifecycle {
  label: string;
  primary: boolean;
  next: SprintState;
}

export function sprintLifecycle(sprint: Sprint): SprintLifecycle {
  if (sprint.state === "planned") return { label: "▶ Start", primary: true, next: "active" };
  if (sprint.state === "active") return { label: "✓ Complete", primary: false, next: "done" };
  return { label: "↺ Reopen", primary: false, next: "planned" };
}

export const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// A new sprint starts the day after this release's latest sprint ends (else
// today) and runs two weeks.
export function nextSprintDefaults(releaseSprints: Sprint[], today: Date = new Date()): { start: string; end: string } {
  let start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const ends = releaseSprints.map((s) => s.end_date).filter((e): e is string => !!e).sort();
  if (ends.length) {
    const next = new Date(ends[ends.length - 1] + "T00:00:00");
    next.setDate(next.getDate() + 1);
    if (next > start) start = next;
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  return { start: isoLocal(start), end: isoLocal(end) };
}

// Reference equality that treats undefined and null as the same "no
// reference" -- the API sends null, the UI often holds undefined.
export const sameRef = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null);
