// Derive id-addressed ops from a before/after pair of page states.
//
// This is how every editor action -- and undo/redo -- reaches the server: the
// action mutates a draft, and the diff turns the change into set / insert /
// remove / move ops keyed by entity id. It is deliberately not immer's patch
// output, whose paths are array indices and would break under concurrent
// inserts.
//
// Op order matters: the layout tree `set` is emitted before component
// inserts/moves so that a region created by a split exists in the tree before
// anything lands in it. A replaced tree never deletes component lists, so
// moves out of a removed region (emitted by the action that merged its
// content) still resolve.
import { PageLike } from "./applyOps";
import { ComponentNode, Op } from "./types";

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

interface Placed {
  cmp: ComponentNode;
  region: string;
}

function placements(page: PageLike): Map<string, Placed> {
  const out = new Map<string, Placed>();
  for (const [region, list] of Object.entries(page.document.regions)) {
    for (const cmp of list) out.set(cmp.id, { cmp, region });
  }
  return out;
}

const CMP_KEYS = ["type", "label", "shape", "layout", "elements", "props", "customId"] as const;

export function diffPage(prev: PageLike, next: PageLike): Op[] {
  const ops: Op[] = [];

  for (const key of ["name", "route", "pos"] as const) {
    if (prev[key] !== next[key]) ops.push({ op: "set", path: key, value: next[key] });
  }

  if (prev.document.root !== next.document.root && !deepEqual(prev.document.root, next.document.root)) {
    ops.push({ op: "set", path: "root", value: next.document.root });
  }

  const prevPlaced = placements(prev);
  const nextPlaced = placements(next);
  for (const [id] of prevPlaced) {
    if (!nextPlaced.has(id)) ops.push({ op: "remove", target: { cmp: id } });
  }
  for (const [id, { cmp, region }] of nextPlaced) {
    const was = prevPlaced.get(id);
    if (!was) {
      ops.push({ op: "insert", into: { region }, value: cmp as unknown as Record<string, unknown> & { id: string } });
      continue;
    }
    if (was.cmp === cmp && was.region === region) continue;
    if (was.region !== region || was.cmp.pos !== cmp.pos) {
      ops.push({
        op: "move",
        target: { cmp: id },
        to: was.region !== region ? { region, pos: cmp.pos } : { pos: cmp.pos },
      });
    }
    for (const key of CMP_KEYS) {
      if (!deepEqual(was.cmp[key], cmp[key])) {
        ops.push({ op: "set", target: { cmp: id }, path: key, value: cmp[key] ?? null });
      }
    }
  }
  return ops;
}
