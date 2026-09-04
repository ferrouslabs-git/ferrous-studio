// Client-side mirror of backend/app/studio/ops.py: apply an op list to a page
// document. Used to rebase queued ops onto a freshly fetched page after a
// conflict, and by the reducer to keep local state and emitted ops in step.
// Same rules as the server: id-addressed, generic, no domain knowledge.
import { produce } from "immer";
import { regionIds } from "./tree";
import { ComponentNode, LayoutNode, Op, PageDocument } from "./types";

export class OpApplyError extends Error {}

function findComponent(doc: PageDocument): (cmpId: string) => { list: ComponentNode[]; index: number } {
  return (cmpId) => {
    for (const list of Object.values(doc.regions)) {
      const index = list.findIndex((c) => c.id === cmpId);
      if (index >= 0) return { list, index };
    }
    throw new OpApplyError(`component not found: ${cmpId}`);
  };
}

function targetList(doc: PageDocument, region: string | undefined): ComponentNode[] {
  if (!region || !regionIds(doc.root).includes(region)) {
    throw new OpApplyError("region required and must exist in the layout tree");
  }
  return (doc.regions[region] ??= []);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) throw new OpApplyError("empty path");
  if (parts[0] === "id") throw new OpApplyError("id is immutable");
  let cur: Record<string, unknown> = obj;
  for (const p of parts.slice(0, -1)) {
    const next = cur[p];
    if (!next || typeof next !== "object") {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** Page-level fields that `set` with an empty target may change.
 *  `presentation` is optional so plain fixtures stay terse; a missing key
 *  and null both mean "an ordinary page". */
export interface PageFields {
  name: string;
  route: string | null;
  pos: string;
  presentation?: "modal" | "drawer" | "drawer-left" | null;
}

export interface PageLike extends PageFields {
  document: PageDocument;
}

/** Returns a new page (structurally shared with the input) with `ops` applied. */
export function applyOps<T extends PageLike>(page: T, ops: Op[]): T {
  return produce(page, (draft) => {
    for (const op of ops) applyOne(draft as PageLike, op);
  });
}

function applyOne(page: PageLike, op: Op): void {
  const doc = page.document;

  switch (op.op) {
    case "set": {
      if (op.target?.cmp) {
        const { list, index } = findComponent(doc)(op.target.cmp);
        setPath(list[index] as unknown as Record<string, unknown>, op.path, op.value);
        return;
      }
      if (op.path === "root") {
        // Replace the layout tree wholesale. Component lists are left alone:
        // lists for regions no longer in the tree are inert (ignored on
        // render/export, pruned on the next normalise).
        doc.root = op.value as LayoutNode;
        return;
      }
      if (op.path === "name" || op.path === "route" || op.path === "pos" || op.path === "presentation") {
        (page as unknown as Record<string, unknown>)[op.path] = op.value;
        return;
      }
      throw new OpApplyError(`page field not settable: ${op.path}`);
    }
    case "insert": {
      if (Object.values(doc.regions).some((l) => l.some((c) => c.id === op.value.id))) {
        throw new OpApplyError(`duplicate component id: ${op.value.id}`);
      }
      targetList(doc, op.into.region).push(op.value as unknown as ComponentNode);
      return;
    }
    case "remove": {
      if (!op.target.cmp) throw new OpApplyError("remove requires target.cmp");
      const { list, index } = findComponent(doc)(op.target.cmp);
      list.splice(index, 1);
      return;
    }
    case "move": {
      if (!op.target.cmp) throw new OpApplyError("move requires target.cmp");
      const { list, index } = findComponent(doc)(op.target.cmp);
      const [cmp] = list.splice(index, 1);
      cmp.pos = op.to.pos;
      // A same-region reorder carries no region; only re-home when one is given.
      const dest = op.to.region ? targetList(doc, op.to.region) : list;
      dest.push(cmp);
      return;
    }
  }
}

/** The entity an op is about, for conflict bookkeeping. Inserts return the new id. */
export function entityKeyOf(op: Op): string {
  if (op.op === "insert") return op.value.id;
  if (op.op === "set" && !op.target?.cmp && op.path === "root") return "layout";
  return op.target?.cmp ?? "page";
}

export { byPos } from "./positions";
