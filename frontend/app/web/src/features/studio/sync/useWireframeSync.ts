// React binding for the outbox: one Outbox per open wireframe, wired to the
// API, IndexedDB and the page state held by the studio.
//
// commit(ops) is the single entry point for a committed action: it applies
// the ops to local state immediately (optimistic), then enqueues them. On a
// conflict the page is refetched and the dropped batches are rebased and
// requeued; ops that still target changed entities will conflict again and
// be reported, everything else lands.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../../core/api";
import { getWireframePage, sendWireframeOpBatch } from "../../project/wireframes/wireframesApi";
import { applyOps } from "../model/applyOps";
import { normalizePage } from "../model/positions";
import { Op, OpBatch, PageRecord } from "../model/types";
import { Outbox, OutboxSnapshot } from "./outbox";
import { IndexedDbOutboxStore } from "./store";

const IDLE: OutboxSnapshot = {
  pending: 0,
  phase: "idle",
  attempt: 0,
  lastError: null,
  offline: false,
  locked: false,
};

let sharedStore: IndexedDbOutboxStore | null = null;
function store(): IndexedDbOutboxStore {
  if (!sharedStore) sharedStore = new IndexedDbOutboxStore();
  return sharedStore;
}

export function useWireframeSync(
  projectId: string,
  wireframeId: string,
  page: PageRecord | null,
  /** Route a page update to whoever holds that page's live state — the open
   *  page or an ancestor shell record. Unknown ids are ignored. */
  applyPage: (pageId: string, update: (prev: PageRecord) => PageRecord) => void,
) {
  const [snapshot, setSnapshot] = useState<OutboxSnapshot>(IDLE);
  /** Send held-back edits after the version has been unlocked. */
  const resume = useCallback(() => outboxRef.current?.resume(), []);
  const [conflict, setConflict] = useState<string | null>(null);
  /** Bumped whenever a page is reloaded from the server over a conflict;
   *  undo history for that page must be dropped. */
  const [reset, setReset] = useState<{ token: number; pageId: string | null }>({ token: 0, pageId: null });
  const outboxRef = useRef<Outbox | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    if (!projectId || !wireframeId) return;
    // The outbox persists its queue under this key; a wireframe is the unit
    // of editing, so each gets its own queue.
    const key = `${projectId}:${wireframeId}`;
    const outbox = new Outbox(key, (batch) => sendWireframeOpBatch(projectId, wireframeId, batch), store(), {
      onApplied: (batch, result) => {
        applyPage(batch.pageId, (prev) => ({ ...prev, version: result.version }));
      },
      onConflict: (batch, body, dropped) => {
        setConflict(
          `Changed elsewhere: your edit to ${body.conflicts.map((c) => c.entity_id).join(", ")} was not applied. Reloading.`,
        );
        void getWireframePage(projectId, wireframeId, batch.pageId)
          .then((raw) => {
            const fresh = normalizePage(raw);
            outbox.notePageVersion(fresh.id, fresh.version);
            // Rebase the dropped batches onto the fresh page for local state;
            // the server re-checks each on requeue.
            let rebased: PageRecord = fresh;
            const replayable: OpBatch[] = [];
            for (const b of dropped) {
              try {
                rebased = applyOps(rebased, b.ops);
                replayable.push(b);
              } catch {
                // Targets no longer exist; drop silently -- the server would 422 it anyway.
              }
            }
            applyPage(fresh.id, () => rebased);
            // Even when the conflicted page is not on screen (its batches
            // were still draining after a switch), its history is stale.
            setReset((r) => ({ token: r.token + 1, pageId: fresh.id }));
            outbox.requeue(replayable);
          })
          .catch((err) => setConflict(errorMessage(err)));
      },
      onRejected: (_batch, error) => setConflict(`The server rejected an edit: ${error.message}`),
      // The queue is paused, not emptied: these edits flush once the version
      // is unlocked, so say so rather than implying the work is gone.
      onLocked: () => setConflict("This version is locked. Unlock it to save your changes."),
    });
    outboxRef.current = outbox;
    const unsubscribe = outbox.subscribe(setSnapshot);
    outbox.start();
    void outbox.init();
    return () => {
      unsubscribe();
      void outbox.flush();
      outbox.dispose();
      outboxRef.current = null;
    };
  }, [projectId, wireframeId, applyPage]);

  useEffect(() => {
    if (page) outboxRef.current?.notePageVersion(page.id, page.version);
  }, [page]);

  const commit = useCallback(
    (ops: Op[]) => {
      const outbox = outboxRef.current;
      const current = pageRef.current;
      if (!outbox || !current || ops.length === 0) return;
      setConflict(null);
      applyPage(current.id, () => applyOps(current, ops));
      outbox.enqueue({
        clientBatchId: outbox.newBatchId(),
        pageId: current.id,
        baseVersion: current.version,
        ops,
      });
    },
    [applyPage],
  );

  /** Adopt an already-computed next state — for the open page or an
   *  ancestor shell — and send the ops that produced it. */
  const commitWith = useCallback(
    (next: PageRecord, ops: Op[]) => {
      const outbox = outboxRef.current;
      if (!outbox || ops.length === 0) return;
      setConflict(null);
      applyPage(next.id, () => next);
      outbox.enqueue({
        clientBatchId: outbox.newBatchId(),
        pageId: next.id,
        baseVersion: next.version,
        ops,
      });
    },
    [applyPage],
  );

  const retryNow = useCallback(() => outboxRef.current?.retryNow(), []);

  return useMemo(
    () => ({ snapshot, conflict, reset, commit, commitWith, retryNow, resume }),
    [snapshot, conflict, reset, commit, commitWith, retryNow, resume],
  );
}
