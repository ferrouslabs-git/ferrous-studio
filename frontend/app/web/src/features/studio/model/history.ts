// Undo/redo over page snapshots, plus the bridge from an action to the
// outbox. Snapshots are immer-produced states, so keeping one costs a
// reference: untouched frames and regions are shared, and 200 steps is cheap.
//
// One committed action = one history entry = one op batch. Text fields
// commit on blur/Enter (see InlineEdit), so a typed label is one step, not
// one per keystroke; drags commit on drop.
//
// The timeline is wireframe-wide, not per page: every entry remembers which
// page it was made on. Undoing (or redoing) a step applies in place when
// that page is on screen — the open page, or an ancestor shell edited
// around a child page — and otherwise navigates there first, applying the
// reversal once the page has loaded. Only a server-side conflict
// invalidates history, and only for the page that conflicted — its
// snapshots no longer describe the server state.
import { produce } from "immer";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageLike } from "./applyOps";
import { diffPage } from "./diff";
import { Op, PageRecord } from "./types";

export const HISTORY_LIMIT = 200;
const COALESCE_MS = 400;

export interface CommitOptions {
  /** Consecutive commits with the same key inside COALESCE_MS collapse into one undo step. */
  coalesceKey?: string;
}

export interface HistoryEntry {
  pageId: string;
  /** The page as it was before the action: the undo target. */
  before: PageRecord;
  /** The page as the action left it: the redo target. */
  after: PageRecord;
}

/** One step handed back by the timeline: apply `target` to page `pageId`. */
export interface HistoryStep {
  pageId: string;
  target: PageRecord;
}

/** The wireframe-wide undo timeline: entries [0, index) are applied, the
 *  rest are undone. Pure bookkeeping — applying a step to the document (and
 *  navigating to its page) is the hook's job. */
export class HistoryTimeline {
  private entries: HistoryEntry[] = [];
  private index = 0;

  canUndo(): boolean {
    return this.index > 0;
  }

  canRedo(): boolean {
    return this.index < this.entries.length;
  }

  /** Record a step: any redo branch is discarded, and the oldest entry
   *  falls off once the limit is reached. */
  push(entry: HistoryEntry): void {
    this.entries.length = this.index;
    this.entries.push(entry);
    if (this.entries.length > HISTORY_LIMIT) this.entries.shift();
    this.index = this.entries.length;
  }

  /** Fold a follow-up commit into the newest entry (label typing, colour
   *  drags). Only possible while that entry is the tip and on the same page;
   *  returns false so the caller pushes a fresh entry instead. */
  coalesce(after: PageRecord): boolean {
    if (this.index === 0 || this.index !== this.entries.length) return false;
    const top = this.entries[this.index - 1];
    if (top.pageId !== after.id) return false;
    this.entries[this.index - 1] = { ...top, after };
    return true;
  }

  /** Move the cursor one step and hand back what to apply: dir -1 undoes
   *  (target = before), +1 redoes (target = after). Entries whose page has
   *  been deleted are discarded on the way past. */
  step(dir: -1 | 1, pageExists: (id: string) => boolean): HistoryStep | null {
    for (;;) {
      const at = dir === -1 ? this.index - 1 : this.index;
      const entry = this.entries[at];
      if (!entry) return null;
      if (pageExists(entry.pageId)) {
        this.index += dir;
        return { pageId: entry.pageId, target: dir === -1 ? entry.before : entry.after };
      }
      this.entries.splice(at, 1);
      if (dir === -1) this.index -= 1;
    }
  }

  /** Put the cursor back after a step whose application was abandoned. */
  rollback(dir: -1 | 1): void {
    this.index -= dir;
  }

  /** Forget every entry for one page: after a conflict reload its snapshots
   *  no longer describe what the server holds. Other pages' entries stay. */
  dropPage(pageId: string): void {
    let removedBelow = 0;
    for (let i = 0; i < this.index; i++) if (this.entries[i].pageId === pageId) removedBelow++;
    this.entries = this.entries.filter((e) => e.pageId !== pageId);
    this.index -= removedBelow;
  }
}

export interface PageHistory {
  /** Mutate a draft of the OPEN page; if anything changed, record a step and send the ops. */
  commit<R>(mutator: (draft: PageLike) => R, opts?: CommitOptions): R | undefined;
  /** Same, but against any live record — the open page or an ancestor shell
   *  being edited in place. The step remembers which page it belongs to. */
  commitOn<R>(record: PageRecord, mutator: (draft: PageLike) => R, opts?: CommitOptions): R | undefined;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
}

interface Sink {
  commitWith(next: PageRecord, ops: Op[]): void;
}

/** What the studio provides so history can reach across pages. */
export interface HistoryHost {
  /** The loaded page has settled: load-time migration/reset already sent. */
  ready: boolean;
  /** Bumped by the sync layer when a page was reloaded over a conflict. */
  reset: { token: number; pageId: string | null };
  pageExists(id: string): boolean;
  /** The live record when the page is on screen — the open page or an
   *  ancestor shell — so a step can apply in place without navigating. */
  getRecord(id: string): PageRecord | null;
  /** Open a page (recorded as a navigation step, like a page-picker click). */
  navigateTo(id: string): void;
}

export function usePageHistory(page: PageRecord | null, sink: Sink, host: HistoryHost): PageHistory {
  const timeline = useRef(new HistoryTimeline());
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  /** A cross-page step waiting for its page to load before it can apply. */
  const pending = useRef<{ dir: -1 | 1; step: HistoryStep } | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const hostRef = useRef(host);
  hostRef.current = host;
  const [rev, bump] = useState(0);

  const send = useCallback(
    (from: PageRecord, to: PageRecord) => {
      const ops = diffPage(from, to);
      if (ops.length === 0) return false;
      sink.commitWith(to, ops);
      return true;
    },
    [sink],
  );

  const commitOn = useCallback(
    <R,>(record: PageRecord, mutator: (draft: PageLike) => R, opts: CommitOptions = {}): R | undefined => {
      // The record only NAMES the page — the commit rebases onto its live
      // copy. A caller resuming after an await (the link-back that follows
      // a linked page's POST) holds a render-old record; producing `next`
      // from that would adopt a state missing every commit made since and
      // send the regression to the server as ops.
      const base = hostRef.current.getRecord(record.id) ?? record;
      let result: R | undefined;
      const next = produce(base, (draft) => {
        result = mutator(draft as PageLike);
      });
      if (next === base) return result;
      if (!send(base, next)) return result;

      const now = Date.now();
      const coalesced =
        !!opts.coalesceKey &&
        lastKey.current?.key === opts.coalesceKey &&
        now - lastKey.current.at < COALESCE_MS &&
        timeline.current.coalesce(next);
      if (!coalesced) timeline.current.push({ pageId: base.id, before: base, after: next });
      lastKey.current = opts.coalesceKey ? { key: opts.coalesceKey, at: now } : null;
      bump((n) => n + 1);
      return result;
    },
    [send],
  );

  const commit = useCallback(
    <R,>(mutator: (draft: PageLike) => R, opts: CommitOptions = {}): R | undefined => {
      const current = pageRef.current;
      if (!current) return undefined;
      return commitOn(current, mutator, opts);
    },
    [commitOn],
  );

  const restore = useCallback(
    (snapshot: PageRecord) => {
      const current = hostRef.current.getRecord(snapshot.id);
      if (!current) return;
      // Versions belong to the live row, not the snapshot.
      const target: PageRecord = { ...snapshot, version: current.version, entity_versions: current.entity_versions };
      send(current, target);
    },
    [send],
  );

  const stepBy = useCallback(
    (dir: -1 | 1) => {
      // A step already waiting for its page counts as abandoned: put it
      // back, then take a fresh step (usually the same one — this doubles
      // as the retry when a page load failed underneath it).
      if (pending.current) {
        timeline.current.rollback(pending.current.dir);
        pending.current = null;
      }
      lastKey.current = null;
      const step = timeline.current.step(dir, hostRef.current.pageExists);
      bump((n) => n + 1);
      if (!step) return;
      // Apply in place when the step's page is on screen — the open page or
      // an ancestor shell edited around it.
      if (hostRef.current.getRecord(step.pageId)) {
        restore(step.target);
      } else {
        // The step was made on another page: open it, apply on arrival.
        pending.current = { dir, step };
        hostRef.current.navigateTo(step.pageId);
      }
    },
    [restore],
  );

  const undo = useCallback(() => stepBy(-1), [stepBy]);
  const redo = useCallback(() => stepBy(1), [stepBy]);

  // Apply a pending cross-page step once its page has loaded and settled. A
  // different page arriving means the user went elsewhere mid-flight: the
  // step is rolled back rather than applied to the wrong page.
  useEffect(() => {
    const p = pending.current;
    if (!p || !page) return;
    if (page.id !== p.step.pageId) {
      timeline.current.rollback(p.dir);
      pending.current = null;
      bump((n) => n + 1);
      return;
    }
    if (!host.ready) return;
    pending.current = null;
    restore(p.step.target);
    bump((n) => n + 1);
  }, [page, host.ready, restore]);

  // A conflict reload invalidates one page's snapshots only.
  useEffect(() => {
    if (host.reset.token === 0 || !host.reset.pageId) return;
    if (pending.current?.step.pageId === host.reset.pageId) pending.current = null;
    timeline.current.dropPage(host.reset.pageId);
    lastKey.current = null;
    bump((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.reset.token]);

  return useMemo(
    () => ({ commit, commitOn, undo, redo, canUndo: timeline.current.canUndo(), canRedo: timeline.current.canRedo() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, commitOn, undo, redo, rev],
  );
}
