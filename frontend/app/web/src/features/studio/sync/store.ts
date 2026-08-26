// Durable storage for the outbox. IndexedDB in the browser (asynchronous,
// off the main thread, no 5MB ceiling -- unlike localStorage); an in-memory
// implementation for tests.
//
// `replaceAll` is the only write: it clears the project's rows and rewrites
// the whole remaining queue in one transaction. Figma's autosave write-up
// describes the bug this avoids -- surgically deleting acknowledged entries
// left stale changes on disk when a no-op change short-circuited before the
// observers fired. Wipe-and-rewrite has no such edge.
import { IDBPDatabase, openDB } from "idb";
import { OpBatch } from "../model/types";

export interface OutboxStore {
  load(projectId: string): Promise<OpBatch[]>;
  replaceAll(projectId: string, batches: OpBatch[]): Promise<void>;
}

export class MemoryOutboxStore implements OutboxStore {
  private readonly rows = new Map<string, OpBatch[]>();

  async load(projectId: string): Promise<OpBatch[]> {
    return [...(this.rows.get(projectId) ?? [])];
  }

  async replaceAll(projectId: string, batches: OpBatch[]): Promise<void> {
    this.rows.set(projectId, [...batches]);
  }
}

interface Row {
  key: string;
  projectId: string;
  seq: number;
  batch: OpBatch;
}

const DB_NAME = "ferrous-studio";
const STORE = "pendingOps";

export class IndexedDbOutboxStore implements OutboxStore {
  private readonly db: Promise<IDBPDatabase>;

  constructor(dbName = DB_NAME) {
    this.db = openDB(dbName, 1, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("byProject", "projectId");
      },
    });
  }

  async load(projectId: string): Promise<OpBatch[]> {
    const db = await this.db;
    const rows = (await db.getAllFromIndex(STORE, "byProject", projectId)) as Row[];
    return rows.sort((a, b) => a.seq - b.seq).map((r) => r.batch);
  }

  async replaceAll(projectId: string, batches: OpBatch[]): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(STORE, "readwrite");
    let cursor = await tx.store.index("byProject").openCursor(projectId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    batches.forEach((batch, seq) => {
      const row: Row = { key: `${projectId}:${batch.clientBatchId}`, projectId, seq, batch };
      void tx.store.put(row);
    });
    await tx.done;
  }
}
