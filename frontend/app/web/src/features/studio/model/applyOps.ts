// Client-side mirror of backend/app/studio/ops.py: apply an op list to a page
// document. Used to rebase queued ops onto a freshly fetched page after a
// conflict, and by the reducer to keep local state and emitted ops in step.
// Same rules as the server: id-addressed, generic, no domain knowledge.
import { produce } from "immer";
import { ComponentNode, Frame, Op, PageDocument, REGION_ORDER, RegionName } from "./types";

export class OpApplyError extends Error {}

function findFrame(doc: PageDocument, frameId: string): Frame {
  const frame = doc.frames.find((f) => f.id === frameId);
  if (!frame) throw new OpApplyError(`frame not found: ${frameId}`);
  return frame;
}

function componentLists(frame: Frame): ComponentNode[][] {
  if (frame.layoutMode === "regions") return REGION_ORDER.map((r) => frame.layout.regions[r]);
  return [frame.layout.components];
}

function findComponent(frame: Frame): (cmpId: string) => { list: ComponentNode[]; index: number } {
  return (cmpId) => {
    for (const list of componentLists(frame)) {
      const index = list.findIndex((c) => c.id === cmpId);
      if (index >= 0) return { list, index };
    }
    throw new OpApplyError(`component not found: ${cmpId}`);
  };
}

function targetList(frame: Frame, region: RegionName | undefined): ComponentNode[] {
  if (frame.layoutMode === "regions") {
    if (!region || !REGION_ORDER.includes(region)) throw new OpApplyError("region required");
    return frame.layout.regions[region];
  }
  return frame.layout.components;
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

/** Page-level fields that `set` with an empty target may change. */
export interface PageFields {
  name: string;
  route: string | null;
  pos: string;
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
  const target = op.target ?? {};

  switch (op.op) {
    case "set": {
      if (target.cmp) {
        if (!target.frame) throw new OpApplyError("set on a component requires target.frame");
        const { list, index } = findComponent(findFrame(doc, target.frame))(target.cmp);
        setPath(list[index] as unknown as Record<string, unknown>, op.path, op.value);
        return;
      }
      if (target.frame) {
        setPath(findFrame(doc, target.frame) as unknown as Record<string, unknown>, op.path, op.value);
        return;
      }
      if (op.path === "name" || op.path === "route" || op.path === "pos") {
        (page as unknown as Record<string, unknown>)[op.path] = op.value;
        return;
      }
      throw new OpApplyError(`page field not settable: ${op.path}`);
    }
    case "insert": {
      if (target.frame) {
        const frame = findFrame(doc, target.frame);
        if (componentLists(frame).some((l) => l.some((c) => c.id === op.value.id))) {
          throw new OpApplyError(`duplicate component id: ${op.value.id}`);
        }
        targetList(frame, op.into.region).push(op.value as unknown as ComponentNode);
        return;
      }
      if (op.into.list !== "frames") throw new OpApplyError("insert without target.frame must use into.list = 'frames'");
      if (doc.frames.some((f) => f.id === op.value.id)) throw new OpApplyError(`duplicate frame id: ${op.value.id}`);
      doc.frames.push(op.value as unknown as Frame);
      return;
    }
    case "remove": {
      if (target.cmp) {
        if (!target.frame) throw new OpApplyError("remove on a component requires target.frame");
        const { list, index } = findComponent(findFrame(doc, target.frame))(target.cmp);
        list.splice(index, 1);
        return;
      }
      if (target.frame) {
        const index = doc.frames.findIndex((f) => f.id === target.frame);
        if (index < 0) throw new OpApplyError(`frame not found: ${target.frame}`);
        doc.frames.splice(index, 1);
        return;
      }
      throw new OpApplyError("remove requires target.frame or target.cmp");
    }
    case "move": {
      if (!target.frame || !target.cmp) throw new OpApplyError("move requires target.frame and target.cmp");
      const frame = findFrame(doc, target.frame);
      const { list, index } = findComponent(frame)(target.cmp);
      const [cmp] = list.splice(index, 1);
      cmp.pos = op.to.pos;
      const dest = "region" in op.to && op.to.region !== undefined ? targetList(frame, op.to.region) : list;
      dest.push(cmp);
      return;
    }
  }
}

/** The entity an op is about, for conflict bookkeeping. Inserts return the new id. */
export function entityKeyOf(op: Op): string {
  if (op.op === "insert") return op.value.id;
  const t = op.target ?? {};
  return t.cmp ?? t.frame ?? "page";
}

/** Sort helper: lists are stored in insertion order and read in `pos` order. */
export function byPos<T extends { pos: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0));
}
