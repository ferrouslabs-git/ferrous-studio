// React binding for the outbox: one Outbox per open project, wired to the
// API, IndexedDB and the page state held by the studio.
//
// commit(ops) is the single entry point for a committed action: it applies
// the ops to local state immediately (optimistic), then enqueues them. On a
// conflict the page is refetched and the dropped batches are rebased and
// requeued; ops that still target changed entities will conflict again and
// be reported, everything else lands.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../../core/api";
import { getPage, sendOpBatch } from "../../projects/projectsApi";
import { applyOps } from "../model/applyOps";
import { normalizePage } from "../model/positions";
import { Op, OpBatch, PageRecord } from "../model/types";
import { Outbox, OutboxSnapshot } from "./outbox";
import { IndexedDbOutboxStore } from "./store";

const IDLE: OutboxSnapshot = { pending: 0, phase: "idle", attempt: 0, lastError: null, offline: false };

let sharedStore: IndexedDbOutboxStore | null = null;
function store(): IndexedDbOutboxStore {
  if (!sharedStore) sharedStore = new IndexedDbOutboxStore();
  return sharedStore;
}

export function useProjectSync(
  projectId: string,
  page: PageRecord | null,
  setPage: (p: PageRecord | null | ((prev: PageRecord | null) => PageRecord | null)) => void,
) {
  const [snapshot, setSnapshot] = useState<OutboxSnapshot>(IDLE);
  const [conflict, setConflict] = useState<string | null>(null);
  /** Increments whenever the page is replaced from the server; undo history must reset. */
  const [resetToken, setResetToken] = useState(0);
  const outboxRef = useRef<Outbox | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    if (!projectId) return;
    const outbox = new Outbox(projectId, (batch) => sendOpBatch(projectId, batch), store(), {
      onApplied: (batch, result) => {
        setPage((prev) => (prev && prev.id === batch.pageId ? { ...prev, version: result.version } : prev));
      },
      onConflict: (batch, body, dropped) => {
        setConflict(
          `Changed elsewhere: your edit to ${body.conflicts.map((c) => c.entity_id).join(", ")} was not applied. Reloading.`,
        );
        void getPage(projectId, batch.pageId)
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
            if (pageRef.current?.id === fresh.id) {
              setPage(rebased);
              setResetToken((n) => n + 1);
            }
            outbox.requeue(replayable);
          })
          .catch((err) => setConflict(errorMessage(err)));
      },
      onRejected: (_batch, error) => setConflict(`The server rejected an edit: ${error.message}`),
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
  }, [projectId, setPage]);

  useEffect(() => {
    if (page) outboxRef.current?.notePageVersion(page.id, page.version);
  }, [page]);

  const commit = useCallback(
    (ops: Op[]) => {
      const outbox = outboxRef.current;
      const current = pageRef.current;
      if (!outbox || !current || ops.length === 0) return;
      setConflict(null);
      setPage(applyOps(current, ops));
      outbox.enqueue({
        clientBatchId: outbox.newBatchId(),
        pageId: current.id,
        baseVersion: current.version,
        ops,
      });
    },
    [setPage],
  );

  /** Adopt an already-computed next state and send the ops that produced it. */
  const commitWith = useCallback(
    (next: PageRecord, ops: Op[]) => {
      const outbox = outboxRef.current;
      if (!outbox || ops.length === 0) return;
      setConflict(null);
      setPage(next);
      outbox.enqueue({
        clientBatchId: outbox.newBatchId(),
        pageId: next.id,
        baseVersion: next.version,
        ops,
      });
    },
    [setPage],
  );

  const retryNow = useCallback(() => outboxRef.current?.retryNow(), []);

  return useMemo(
    () => ({ snapshot, conflict, resetToken, commit, commitWith, retryNow }),
    [snapshot, conflict, resetToken, commit, commitWith, retryNow],
  );
}
