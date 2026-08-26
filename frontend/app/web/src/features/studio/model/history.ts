// Undo/redo over page snapshots, plus the bridge from an action to the
// outbox. Snapshots are immer-produced states, so pushing one costs a
// reference: untouched frames and regions are shared, and 200 steps is cheap.
//
// One committed action = one history entry = one op batch. Text fields
// commit on blur/Enter (see InlineEdit), so a typed label is one step, not
// one per keystroke; drags commit on drop.
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

export interface PageHistory {
  /** Mutate a draft; if anything changed, record a step and send the ops. */
  commit<R>(mutator: (draft: PageLike) => R, opts?: CommitOptions): R | undefined;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
}

interface Sink {
  commitWith(next: PageRecord, ops: Op[]): void;
}

export function usePageHistory(page: PageRecord | null, sink: Sink, resetToken: number): PageHistory {
  const past = useRef<PageRecord[]>([]);
  const future = useRef<PageRecord[]>([]);
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const [, bump] = useState(0);

  // A page switch or a server-side conflict reload invalidates the stacks.
  useEffect(() => {
    past.current = [];
    future.current = [];
    lastKey.current = null;
    bump((n) => n + 1);
  }, [page?.id, resetToken]);

  const send = useCallback(
    (from: PageRecord, to: PageRecord) => {
      const ops = diffPage(from, to);
      if (ops.length === 0) return false;
      sink.commitWith(to, ops);
      return true;
    },
    [sink],
  );

  const commit = useCallback(
    <R,>(mutator: (draft: PageLike) => R, opts: CommitOptions = {}): R | undefined => {
      const current = pageRef.current;
      if (!current) return undefined;
      let result: R | undefined;
      const next = produce(current, (draft) => {
        result = mutator(draft as PageLike);
      });
      if (next === current) return result;
      if (!send(current, next)) return result;

      const now = Date.now();
      const coalesce =
        opts.coalesceKey && lastKey.current?.key === opts.coalesceKey && now - lastKey.current.at < COALESCE_MS;
      if (!coalesce) {
        past.current.push(current);
        if (past.current.length > HISTORY_LIMIT) past.current.shift();
      }
      lastKey.current = opts.coalesceKey ? { key: opts.coalesceKey, at: now } : null;
      future.current = [];
      bump((n) => n + 1);
      return result;
    },
    [send],
  );

  const restore = useCallback(
    (snapshot: PageRecord) => {
      const current = pageRef.current;
      if (!current) return;
      // Versions belong to the live row, not the snapshot.
      const target: PageRecord = { ...snapshot, version: current.version, entity_versions: current.entity_versions };
      send(current, target);
    },
    [send],
  );

  const undo = useCallback(() => {
    const current = pageRef.current;
    const prev = past.current.pop();
    if (!current || !prev) return;
    future.current.push(current);
    lastKey.current = null;
    restore(prev);
    bump((n) => n + 1);
  }, [restore]);

  const redo = useCallback(() => {
    const current = pageRef.current;
    const next = future.current.pop();
    if (!current || !next) return;
    past.current.push(current);
    lastKey.current = null;
    restore(next);
    bump((n) => n + 1);
  }, [restore]);

  return useMemo(
    () => ({ commit, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, undo, redo, past.current.length, future.current.length],
  );
}
