import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../core/apiError";
import { OpBatch, OpBatchResult } from "../model/types";
import { Outbox, OutboxCallbacks, OutboxOptions } from "./outbox";
import { IndexedDbOutboxStore, MemoryOutboxStore, OutboxStore } from "./store";

const PROJECT = "proj-1";

function batch(id: string, pageId = "page-a", baseVersion = 0): OpBatch {
  return {
    clientBatchId: id,
    pageId,
    baseVersion,
    ops: [{ op: "set", target: { cmp: "c1" }, path: "label", value: id }],
  };
}

/** A transport whose next results are scripted; unscripted calls succeed. */
function scriptedTransport() {
  const calls: OpBatch[] = [];
  const script: Array<() => Promise<OpBatchResult>> = [];
  let version = 0;
  const transport = vi.fn(async (b: OpBatch) => {
    calls.push({ ...b, ops: [...b.ops] });
    const next = script.shift();
    if (next) return next();
    version += 1;
    return { page_id: b.pageId, version };
  });
  return {
    transport,
    calls,
    fail: (err: unknown) => script.push(() => Promise.reject(err)),
    succeedWith: (v: number) => script.push(async () => ({ page_id: "page-a", version: v })),
    /** Hold the next call open until the returned resolver is invoked. */
    hold: () => {
      let release!: (r: OpBatchResult) => void;
      script.push(() => new Promise<OpBatchResult>((res) => (release = res)));
      return (r: OpBatchResult) => release(r);
    },
  };
}

function callbacks() {
  const c = {
    applied: [] as OpBatch[],
    conflicts: [] as OpBatch[][],
    rejected: [] as { batch: OpBatch; message: string }[],
    onApplied: (b: OpBatch) => void c.applied.push(b),
    onConflict: (_b: OpBatch, _body: unknown, dropped: OpBatch[]) => void c.conflicts.push(dropped),
    onRejected: (b: OpBatch, e: ApiError) => void c.rejected.push({ batch: b, message: e.message }),
  } satisfies OutboxCallbacks & Record<string, unknown>;
  return c;
}

async function settle() {
  // Let chained microtasks (transport promises, finally blocks) resolve.
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

async function make(
  t: ReturnType<typeof scriptedTransport>,
  cb: OutboxCallbacks,
  opts: OutboxOptions = {},
  store: OutboxStore = new MemoryOutboxStore(),
) {
  const ob = new Outbox(PROJECT, t.transport, store, cb, opts);
  await ob.init();
  return ob;
}

describe("Outbox", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends batches strictly in order with one in flight", async () => {
    const t = scriptedTransport();
    const release = t.hold();
    const cb = callbacks();
    const ob = await make(t, cb);
    ob.enqueue(batch("b1"));
    ob.enqueue(batch("b2"));
    ob.enqueue(batch("b3"));
    await settle();
    expect(t.calls.map((c) => c.clientBatchId)).toEqual(["b1"]);
    expect(ob.snapshot()).toMatchObject({ pending: 3, phase: "syncing" });

    release({ page_id: "page-a", version: 1 });
    await settle();
    expect(t.calls.map((c) => c.clientBatchId)).toEqual(["b1", "b2", "b3"]);
    expect(cb.applied.map((b) => b.clientBatchId)).toEqual(["b1", "b2", "b3"]);
    expect(ob.snapshot()).toMatchObject({ pending: 0, phase: "idle" });
  });

  it("bumps baseVersion to the latest applied version, but never on a retry", async () => {
    const t = scriptedTransport();
    t.succeedWith(5);
    t.fail(new TypeError("network down"));
    const ob = await make(t, callbacks(), { backoffMs: [100] });
    ob.enqueue(batch("b1", "page-a", 4));
    ob.enqueue(batch("b2", "page-a", 4));
    await settle();
    // b1 applied at v5; b2 was enqueued with base 4 but is sent with 5.
    expect(t.calls[1]).toMatchObject({ clientBatchId: "b2", baseVersion: 5 });

    // b2 failed with a network error; the retry is byte-identical.
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(t.calls[2]).toMatchObject({ clientBatchId: "b2", baseVersion: 5 });
    expect(t.calls.length).toBe(3);
  });

  it("retries network errors with backoff and does not advance past the failed batch", async () => {
    const t = scriptedTransport();
    t.fail(new TypeError("fetch failed"));
    t.fail(new TypeError("fetch failed"));
    const cb = callbacks();
    const ob = await make(t, cb, { backoffMs: [1000, 2000] });
    ob.enqueue(batch("b1"));
    ob.enqueue(batch("b2"));
    await settle();
    expect(t.calls.map((c) => c.clientBatchId)).toEqual(["b1"]);
    expect(ob.snapshot()).toMatchObject({ phase: "retrying", attempt: 1, offline: true, pending: 2 });

    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(t.calls.map((c) => c.clientBatchId)).toEqual(["b1", "b1"]);
    expect(ob.snapshot().attempt).toBe(2);

    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(t.calls.map((c) => c.clientBatchId)).toEqual(["b1", "b1", "b1", "b2"]);
    expect(cb.applied.map((b) => b.clientBatchId)).toEqual(["b1", "b2"]);
    expect(ob.snapshot()).toMatchObject({ pending: 0, offline: false, attempt: 0 });
  });

  it("drops a batch the server rejects (4xx), reports it, and carries on", async () => {
    const t = scriptedTransport();
    t.fail(new ApiError(422, { detail: "bad op" }, "bad op"));
    const cb = callbacks();
    const ob = await make(t, cb);
    ob.enqueue(batch("b1"));
    ob.enqueue(batch("b2"));
    await settle();
    expect(cb.rejected).toEqual([{ batch: expect.objectContaining({ clientBatchId: "b1" }), message: "bad op" }]);
    expect(cb.applied.map((b) => b.clientBatchId)).toEqual(["b2"]);
    expect(ob.snapshot()).toMatchObject({ pending: 0, phase: "idle" });
  });

  it("on 409 drops the same page's later batches, keeps other pages, and can requeue", async () => {
    const t = scriptedTransport();
    const body = { detail: "conflict", page_id: "page-a", version: 9, conflicts: [{ entity_id: "c1", current_version: 9 }] };
    t.fail(new ApiError(409, body, "conflict"));
    const cb = callbacks();
    let n = 0;
    const ob = await make(t, cb, { newBatchId: () => `re-${++n}` });
    ob.enqueue(batch("a1", "page-a", 3));
    ob.enqueue(batch("a2", "page-a", 3));
    ob.enqueue(batch("b1", "page-b", 0));
    await settle();

    expect(cb.conflicts).toHaveLength(1);
    expect(cb.conflicts[0].map((b) => b.clientBatchId)).toEqual(["a2"]);
    expect(cb.applied.map((b) => b.clientBatchId)).toEqual(["b1"]);

    ob.requeue(cb.conflicts[0]);
    await settle();
    const last = t.calls[t.calls.length - 1];
    expect(last).toMatchObject({ clientBatchId: "re-1", pageId: "page-a", baseVersion: 9 });
  });

  it("flushes the remaining queue by wipe-and-rewrite, only when dirty", async () => {
    const t = scriptedTransport();
    const release = t.hold();
    const store = new MemoryOutboxStore();
    const spy = vi.spyOn(store, "replaceAll");
    const ob = await make(t, callbacks(), { flushIntervalMs: 500 }, store);
    ob.start();
    ob.enqueue(batch("b1"));
    ob.enqueue(batch("b2"));
    await settle();

    await vi.advanceTimersByTimeAsync(500);
    expect(spy).toHaveBeenLastCalledWith(PROJECT, [
      expect.objectContaining({ clientBatchId: "b1" }),
      expect.objectContaining({ clientBatchId: "b2" }),
    ]);

    release({ page_id: "page-a", version: 1 });
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    expect(spy).toHaveBeenLastCalledWith(PROJECT, []);
    const writes = spy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(spy).toHaveBeenCalledTimes(writes); // nothing dirty, nothing written
    ob.dispose();
  });

  it("holds new work until init has restored the persisted queue, which goes first", async () => {
    const store = new MemoryOutboxStore();
    await store.replaceAll(PROJECT, [batch("old-1"), batch("old-2")]);
    const t = scriptedTransport();
    const ob = new Outbox(PROJECT, t.transport, store, callbacks());
    ob.enqueue(batch("new-1"));
    await settle();
    expect(t.calls).toEqual([]);
    await ob.init();
    await settle();
    expect(t.calls.map((c) => c.clientBatchId)).toEqual(["old-1", "old-2", "new-1"]);
  });
});

describe("IndexedDbOutboxStore", () => {
  it("round-trips in order and replaceAll wipes previous rows", async () => {
    const store = new IndexedDbOutboxStore(`test-${Math.random()}`);
    await store.replaceAll(PROJECT, [batch("b1"), batch("b2"), batch("b3")]);
    await store.replaceAll("other", [batch("o1")]);
    expect((await store.load(PROJECT)).map((b) => b.clientBatchId)).toEqual(["b1", "b2", "b3"]);

    await store.replaceAll(PROJECT, [batch("b3")]);
    expect((await store.load(PROJECT)).map((b) => b.clientBatchId)).toEqual(["b3"]);
    expect((await store.load("other")).map((b) => b.clientBatchId)).toEqual(["o1"]);

    await store.replaceAll(PROJECT, []);
    expect(await store.load(PROJECT)).toEqual([]);
  });
});
