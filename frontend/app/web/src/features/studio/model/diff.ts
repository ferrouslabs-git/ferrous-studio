// Derive id-addressed ops from a before/after pair of page states.
//
// This is how every editor action -- and undo/redo -- reaches the server: the
// action mutates a draft (ported nearly verbatim from the legacy builder),
// and the diff turns the change into set / insert / remove / move ops keyed
// by entity id. It is deliberately not immer's patch output, whose paths are
// array indices and would break under concurrent inserts.
import { PageLike } from "./applyOps";
import { ComponentNode, Frame, Op, REGION_ORDER, RegionName } from "./types";

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
  region: RegionName | null;
}

function placements(frame: Frame): Map<string, Placed> {
  const out = new Map<string, Placed>();
  if (frame.layoutMode === "regions") {
    for (const r of REGION_ORDER) for (const cmp of frame.layout.regions[r]) out.set(cmp.id, { cmp, region: r });
  } else {
    for (const cmp of frame.layout.components) out.set(cmp.id, { cmp, region: null });
  }
  return out;
}

const CMP_KEYS = ["type", "label", "props", "customId"] as const;

export function diffPage(prev: PageLike, next: PageLike): Op[] {
  const ops: Op[] = [];

  for (const key of ["name", "route", "pos"] as const) {
    if (prev[key] !== next[key]) ops.push({ op: "set", path: key, value: next[key] });
  }

  const prevFrames = new Map(prev.document.frames.map((f) => [f.id, f]));
  const nextFrames = new Map(next.document.frames.map((f) => [f.id, f]));

  for (const [id] of prevFrames) {
    if (!nextFrames.has(id)) ops.push({ op: "remove", target: { frame: id } });
  }
  for (const [id, frame] of nextFrames) {
    const before = prevFrames.get(id);
    if (!before) {
      ops.push({ op: "insert", into: { list: "frames" }, value: frame as unknown as Record<string, unknown> & { id: string } });
      continue;
    }
    if (before === frame) continue; // structural sharing: untouched
    diffFrame(before, frame, ops);
  }
  return ops;
}

function diffFrame(before: Frame, after: Frame, ops: Op[]): void {
  const t = { frame: after.id };
  if (before.label !== after.label) ops.push({ op: "set", target: t, path: "label", value: after.label });
  if (before.pos !== after.pos) ops.push({ op: "set", target: t, path: "pos", value: after.pos });

  if (before.layoutMode !== after.layoutMode) {
    // The whole layout shape changes; replace it in one go.
    ops.push({ op: "set", target: t, path: "layoutMode", value: after.layoutMode });
    ops.push({ op: "set", target: t, path: "layout", value: after.layout });
    return;
  }
  if (after.layoutMode === "regions" && before.layoutMode === "regions") {
    if (!deepEqual(before.layout.options, after.layout.options)) {
      ops.push({ op: "set", target: t, path: "layout.options", value: after.layout.options });
    }
  }

  const prevPlaced = placements(before);
  const nextPlaced = placements(after);
  for (const [id] of prevPlaced) {
    if (!nextPlaced.has(id)) ops.push({ op: "remove", target: { frame: after.id, cmp: id } });
  }
  for (const [id, { cmp, region }] of nextPlaced) {
    const was = prevPlaced.get(id);
    if (!was) {
      ops.push({
        op: "insert",
        target: t,
        into: region ? { region } : { list: "components" },
        value: cmp as unknown as Record<string, unknown> & { id: string },
      });
      continue;
    }
    if (was.cmp === cmp && was.region === region) continue;
    if (was.region !== region || was.cmp.pos !== cmp.pos) {
      ops.push({
        op: "move",
        target: { frame: after.id, cmp: id },
        to: region && was.region !== region ? { region, pos: cmp.pos } : { pos: cmp.pos },
      });
    }
    for (const key of CMP_KEYS) {
      if (!deepEqual(was.cmp[key], cmp[key])) {
        ops.push({ op: "set", target: { frame: after.id, cmp: id }, path: key, value: cmp[key] ?? null });
      }
    }
  }
}
