// The outbox: an ordered queue of op batches for one project, sent one at a
// time, retried with backoff, and mirrored to durable storage.
//
// Guarantees:
//  - Strict order. Exactly one batch is in flight; a failure retries *that*
//    batch and never advances past it, so batches cannot land out of sequence.
//  - Idempotent retries. A batch is frozen (id and base version) after its
//    first send, so a retry after a timeout is byte-identical and the server
//    dedupes it by client_batch_id.
//  - Editing never blocks. Failures surface through the snapshot; the
//    caller keeps accepting edits.
//  - Crash safety. The queue is flushed to the store every few seconds and
//    on visibilitychange/pagehide (the last reliable moments), by
//    wipe-and-rewrite.
//
// Conflicts (409) drop the failed batch and every later batch for the same
// page, then hand them to `onConflict`. The caller refetches the page and may
// `requeue` those batches against the new version.
import { ApiError, errorMessage } from "../../../core/apiError";
import { isConflictBody, OpBatch, OpBatchResult, OpConflictBody } from "../model/types";
import { OutboxStore } from "./store";

export type OutboxPhase = "idle" | "syncing" | "retrying" | "paused";

/**
 * 423 Locked: the project is a frozen version. Unlike every other refusal this
 * one is neither a conflict nor transient -- it needs a person to unlock the
 * version -- so the queue stops rather than dropping or retrying the batch.
 */
export const LOCKED_STATUS = 423;

export interface OutboxSnapshot {
  pending: number;
  phase: OutboxPhase;
  attempt: number;
  lastError: string | null;
  /** Best guess: the last failure looked like a network problem, not a server answer. */
  offline: boolean;
  /** The queue is holding unsent work because the version is locked. */
  locked: boolean;
}

export interface OutboxCallbacks {
  onApplied(batch: OpBatch, result: OpBatchResult): void;
  onConflict(batch: OpBatch, body: OpConflictBody, dropped: OpBatch[]): void;
  onRejected(batch: OpBatch, error: ApiError): void;
  /** The version was locked mid-edit. The queue is intact and paused. */
  onLocked(error: ApiError): void;
}

export interface OutboxOptions {
  flushIntervalMs?: number;
  backoffMs?: number[];
  maxBackoffMs?: number;
  newBatchId?: () => string;
}

export type Transport = (batch: OpBatch) => Promise<OpBatchResult>;

const DEFAULT_BACKOFF = [1000, 2000, 4000, 8000];

/** Also the id minter for one-off batches sent outside the outbox (e.g. a
 *  rename of a linked page, which is not the open page). */
export function defaultBatchId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class Outbox {
  private queue: OpBatch[] = [];
  private inFlight = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;
  private disposed = false;
  /** Nothing is sent until init() has loaded persisted work, so it goes first. */
  private ready = false;
  private lastError: string | null = null;
  private offline = false;
  /** Paused on a locked version: the queue is kept, not drained. */
  private locked = false;
  private readonly knownVersion = new Map<string, number>();
  private readonly listeners = new Set<(s: OutboxSnapshot) => void>();
  private beforeUnloadBound = false;
  private readonly opts: Required<OutboxOptions>;

  constructor(
    private readonly projectId: string,
    private readonly transport: Transport,
    private readonly store: OutboxStore,
    private readonly callbacks: OutboxCallbacks,
    opts: OutboxOptions = {},
  ) {
    this.opts = {
      flushIntervalMs: opts.flushIntervalMs ?? 2000,
      backoffMs: opts.backoffMs ?? DEFAULT_BACKOFF,
      maxBackoffMs: opts.maxBackoffMs ?? 30000,
      newBatchId: opts.newBatchId ?? defaultBatchId,
    };
  }

  /** Load anything a previous session left behind, then start sending. */
  async init(): Promise<void> {
    const persisted = await this.store.load(this.projectId);
    this.queue = [...persisted, ...this.queue];
    this.ready = true;
    this.notify();
    void this.drain();
  }

  /** Tell the outbox the version of a page the client has fully incorporated. */
  notePageVersion(pageId: string, version: number): void {
    const known = this.knownVersion.get(pageId) ?? -1;
    if (version > known) this.knownVersion.set(pageId, version);
  }

  newBatchId(): string {
    return this.opts.newBatchId();
  }

  enqueue(batch: OpBatch): void {
    if (this.disposed) return;
    this.queue.push(batch);
    this.dirty = true;
    this.notify();
    void this.drain();
  }

  /** Re-submit batches dropped by a conflict, against the page's new version. */
  requeue(batches: OpBatch[]): void {
    for (const b of batches) {
      this.enqueue({
        ...b,
        clientBatchId: this.opts.newBatchId(),
        baseVersion: this.knownVersion.get(b.pageId) ?? b.baseVersion,
      });
    }
  }

  /**
   * Start sending again after the version has been unlocked.
   *
   * The queue was never touched while paused, so the work the user did against
   * the locked version flushes intact.
   */
  resume(): void {
    if (!this.locked) return;
    this.locked = false;
    this.lastError = null;
    this.notify();
    void this.drain();
  }

  retryNow(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    void this.drain();
  }

  /** Wipe-and-rewrite the remaining queue to the store. */
  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await this.store.replaceAll(this.projectId, [...this.queue]);
  }

  snapshot(): OutboxSnapshot {
    return {
      pending: this.queue.length,
      phase: this.locked ? "paused" : this.inFlight ? "syncing" : this.retryTimer ? "retrying" : "idle",
      attempt: this.attempt,
      lastError: this.lastError,
      offline: this.offline,
      locked: this.locked,
    };
  }

  subscribe(listener: (s: OutboxSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  /** Attach timers and page-lifecycle listeners (browser only). */
  start(): void {
    this.flushTimer = setInterval(() => void this.flush(), this.opts.flushIntervalMs);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onHide);
      window.addEventListener("pagehide", this.onHide);
      window.addEventListener("online", this.onOnline);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onHide);
      window.removeEventListener("pagehide", this.onHide);
      window.removeEventListener("online", this.onOnline);
      this.setBeforeUnload(false);
    }
    this.listeners.clear();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private readonly onHide = () => {
    if (typeof document === "undefined" || document.visibilityState === "hidden") void this.flush();
  };

  private readonly onOnline = () => this.retryNow();

  private readonly onBeforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    // Chrome requires returnValue to be set for the dialog to show.
    e.returnValue = "";
  };

  /** Registered only while there is unsaved work; a standing listener disables bfcache. */
  private setBeforeUnload(on: boolean): void {
    if (typeof window === "undefined" || on === this.beforeUnloadBound) return;
    if (on) window.addEventListener("beforeunload", this.onBeforeUnload);
    else window.removeEventListener("beforeunload", this.onBeforeUnload);
    this.beforeUnloadBound = on;
  }

  private notify(): void {
    this.setBeforeUnload(this.queue.length > 0);
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  private async drain(): Promise<void> {
    if (!this.ready || this.disposed || this.locked) return;
    if (this.inFlight || this.retryTimer || this.queue.length === 0) return;
    this.inFlight = true;
    const batch = this.queue[0];

    // The client has incorporated its own earlier batches, so the base is
    // the latest version it knows -- but only on the first attempt: a retry
    // must resend the identical payload for idempotency to hold.
    if (this.attempt === 0) {
      const known = this.knownVersion.get(batch.pageId);
      if (known !== undefined && known > batch.baseVersion) batch.baseVersion = known;
    }
    this.notify();

    try {
      const result = await this.transport(batch);
      this.queue.shift();
      this.dirty = true;
      this.attempt = 0;
      this.lastError = null;
      this.offline = false;
      this.notePageVersion(batch.pageId, result.version);
      this.callbacks.onApplied(batch, result);
    } catch (err) {
      this.handleFailure(batch, err);
    } finally {
      this.inFlight = false;
      this.notify();
      if (!this.retryTimer) void this.drain();
    }
  }

  private handleFailure(batch: OpBatch, err: unknown): void {
    if (err instanceof ApiError && err.status === 409 && isConflictBody(err.body)) {
      this.queue.shift();
      const dropped = this.queue.filter((b) => b.pageId === batch.pageId);
      this.queue = this.queue.filter((b) => b.pageId !== batch.pageId);
      this.dirty = true;
      this.attempt = 0;
      this.lastError = null;
      this.notePageVersion(batch.pageId, err.body.version);
      this.callbacks.onConflict(batch, err.body, dropped);
      return;
    }
    // A locked version is neither a conflict nor a transient failure: someone
    // froze this project, and only a person can unfreeze it. So the queue stops
    // where it is. Falling through to the branch below would treat 423 as "not
    // retryable" and shift the batch away, destroying edits made in a tab that
    // was open when the project was versioned from somewhere else; backing off
    // instead would retry against a lock that no timer can clear.
    //
    // Nothing is dropped and no timer is set, so `resume()` -- called once the
    // version is unlocked -- flushes this batch and everything behind it
    // intact. `onLocked` fires once per lock, because `drain()` refuses to run
    // again while `locked` is set.
    if (err instanceof ApiError && err.status === LOCKED_STATUS) {
      this.locked = true;
      this.attempt = 0;
      this.offline = false;
      this.lastError = err.message;
      this.callbacks.onLocked(err);
      return;
    }

    const retryable =
      !(err instanceof ApiError) || err.status >= 500 || err.status === 408 || err.status === 429;
    if (!retryable) {
      const apiErr = err as ApiError;
      this.queue.shift();
      this.dirty = true;
      this.attempt = 0;
      this.lastError = apiErr.message;
      this.callbacks.onRejected(batch, apiErr);
      return;
    }
    this.attempt += 1;
    this.lastError = errorMessage(err);
    this.offline =
      !(err instanceof ApiError) || (typeof navigator !== "undefined" && navigator.onLine === false);
    const steps = this.opts.backoffMs;
    const delay = Math.min(steps[Math.min(this.attempt - 1, steps.length - 1)], this.opts.maxBackoffMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.drain();
    }, delay);
  }
}
