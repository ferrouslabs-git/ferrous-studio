// Pure tree operations for the component builder, ported from
// legacy/js/builder.global.js. Operate on an immer draft of a CustomDef.
import { CustomDef, Slot } from "../model/actions";
import { uid } from "../model/regions";

export type GroupSlot = Extract<Slot, { type: "group" }>;
export type LeafType = "heading" | "text" | "label" | "badge" | "button" | "button-row" | "input" | "image" | "divider";

export const LEAF_TYPES: LeafType[] = ["heading", "text", "label", "badge", "button", "button-row", "input", "image", "divider"];

export const PALETTE: { type: LeafType; label: string; icon: string }[] = [
  { type: "heading", label: "Heading", icon: "H" },
  { type: "text", label: "Text", icon: "T" },
  { type: "label", label: "Label", icon: "L" },
  { type: "badge", label: "Badge", icon: "B" },
  { type: "button", label: "Button", icon: "◉" },
  { type: "button-row", label: "Button row", icon: "◉◉" },
  { type: "input", label: "Input", icon: "▭" },
  { type: "image", label: "Image", icon: "🖼" },
  { type: "divider", label: "Divider", icon: "—" },
];

export const ICON_COLORS = ["#6aa0ff", "#58c08d", "#e0b341", "#e06060", "#a080ff", "#60c0e0", "#e0a060"];

export const isGroup = (s: Slot): s is GroupSlot => s.type === "group";

export function newDraft(): CustomDef {
  return {
    id: uid("cdef"),
    name: "",
    desc: "",
    icon: "CMP",
    color: ICON_COLORS[0],
    rootLayout: "col",
    rootAlign: "start",
    rootGridCols: 2,
    rootGap: 8,
    rootPadding: 8,
    slots: [],
  };
}

/** Fill in defaults and ids on a definition loaded from storage. */
export function migrateDraft(d: CustomDef): CustomDef {
  const out: CustomDef = {
    ...d,
    slots: Array.isArray(d.slots) ? d.slots : [],
    rootLayout: d.rootLayout ?? "col",
    rootAlign: d.rootAlign ?? "start",
    rootGridCols: d.rootGridCols ?? 2,
    rootGap: d.rootGap ?? 8,
    rootPadding: d.rootPadding ?? 8,
  };
  walk(out.slots, (s) => {
    if (!s.id) s.id = uid("sl");
  });
  return out;
}

export function walk(arr: Slot[], fn: (s: Slot, arr: Slot[], i: number, parent: GroupSlot | null) => void, parent: GroupSlot | null = null): void {
  arr.forEach((s, i) => {
    fn(s, arr, i, parent);
    if (isGroup(s)) walk(s.children, fn, s);
  });
}

export interface Located {
  slot: Slot;
  parentArr: Slot[];
  parent: GroupSlot | null;
  index: number;
}

export function locate(id: string, arr: Slot[], parent: GroupSlot | null = null): Located | null {
  for (let i = 0; i < arr.length; i++) {
    const s = arr[i];
    if (s.id === id) return { slot: s, parentArr: arr, parent, index: i };
    if (isGroup(s)) {
      const hit = locate(id, s.children, s);
      if (hit) return hit;
    }
  }
  return null;
}

export function makeLeaf(type: LeafType): Slot {
  const defaults: Record<string, string> = {
    heading: "Heading",
    text: "",
    label: "Label",
    badge: "Badge",
    button: "Action",
    "button-row": "Cancel, Save",
    input: "",
    image: "",
    divider: "",
  };
  return { id: uid("sl"), type, label: defaults[type] ?? "" };
}

export function selectedNodes(draft: CustomDef, selection: string[]): Located[] {
  return selection.map((id) => locate(id, draft.slots)).filter((x): x is Located => !!x);
}

export function commonParent(draft: CustomDef, selection: string[]): Slot[] | null {
  const nodes = selectedNodes(draft, selection);
  if (!nodes.length) return null;
  const first = nodes[0].parentArr;
  return nodes.every((n) => n.parentArr === first) ? first : null;
}

export function isContiguousSelection(draft: CustomDef, selection: string[]): boolean {
  const nodes = selectedNodes(draft, selection);
  if (nodes.length <= 1) return nodes.length === 1;
  if (!commonParent(draft, selection)) return false;
  const idx = nodes.map((n) => n.index).sort((a, b) => a - b);
  for (let i = 1; i < idx.length; i++) if (idx[i] !== idx[i - 1] + 1) return false;
  return true;
}

export function isDescendantOf(slot: Slot, targetId: string): boolean {
  if (!isGroup(slot)) return false;
  return slot.children.some((c) => c.id === targetId || isDescendantOf(c, targetId));
}

// ── Mutations (call inside produce) ─────────────────────────────────────────

/** Insert into the single selected group, else the root. Returns the new id. */
export function addSlot(draft: CustomDef, selection: string[], type: LeafType): string {
  const slot = makeLeaf(type);
  let target = draft.slots;
  if (selection.length === 1) {
    const r = locate(selection[0], draft.slots);
    if (r && isGroup(r.slot)) target = r.slot.children;
  }
  target.push(slot);
  return slot.id;
}

export function groupSelected(draft: CustomDef, selection: string[], layout: "col" | "row" | "grid"): string | null {
  if (!isContiguousSelection(draft, selection)) return null;
  const parent = commonParent(draft, selection)!;
  const indices = selectedNodes(draft, selection).map((n) => n.index).sort((a, b) => a - b);
  const start = indices[0];
  const taken = parent.splice(start, indices.length);
  const group: GroupSlot = { id: uid("grp"), type: "group", layout, gridCols: 2, label: "", children: taken };
  parent.splice(start, 0, group);
  return group.id;
}

export function ungroupSelected(draft: CustomDef, selection: string[]): string[] | null {
  if (selection.length !== 1) return null;
  const r = locate(selection[0], draft.slots);
  if (!r || !isGroup(r.slot)) return null;
  const kids = r.slot.children;
  r.parentArr.splice(r.index, 1, ...kids);
  return kids.map((k) => k.id);
}

export function moveSelected(draft: CustomDef, selection: string[], dir: "up" | "down"): boolean {
  if (selection.length !== 1) return false;
  const r = locate(selection[0], draft.slots);
  if (!r) return false;
  const j = r.index + (dir === "up" ? -1 : 1);
  if (j < 0 || j >= r.parentArr.length) return false;
  const [item] = r.parentArr.splice(r.index, 1);
  r.parentArr.splice(j, 0, item);
  return true;
}

export function duplicateSelected(draft: CustomDef, selection: string[]): string | null {
  if (selection.length !== 1) return null;
  const r = locate(selection[0], draft.slots);
  if (!r) return null;
  const clone: Slot = JSON.parse(JSON.stringify(r.slot));
  walk([clone], (s) => {
    s.id = uid(isGroup(s) ? "grp" : "sl");
  });
  r.parentArr.splice(r.index + 1, 0, clone);
  return clone.id;
}

export function deleteSelected(draft: CustomDef, selection: string[]): void {
  const targets = selectedNodes(draft, selection).sort((a, b) => b.index - a.index);
  for (const n of targets) n.parentArr.splice(n.index, 1);
}

export type DragSource = { kind: "palette"; type: LeafType } | { kind: "node"; id: string };
export type DropSpec = { kind: "root-append" } | { kind: "into"; groupId: string } | { kind: "before" | "after"; id: string };

/** Resolve a drop into (array, index) and perform it. Returns the moved/new id. */
export function performDrop(draft: CustomDef, source: DragSource, drop: DropSpec): string | null {
  let targetArr: Slot[];
  let targetIndex: number;
  if (drop.kind === "root-append") {
    targetArr = draft.slots;
    targetIndex = draft.slots.length;
  } else if (drop.kind === "into") {
    const g = locate(drop.groupId, draft.slots);
    if (!g || !isGroup(g.slot)) return null;
    targetArr = g.slot.children;
    targetIndex = targetArr.length;
  } else {
    const here = locate(drop.id, draft.slots);
    if (!here) return null;
    targetArr = here.parentArr;
    targetIndex = drop.kind === "before" ? here.index : here.index + 1;
  }

  if (source.kind === "palette") {
    const slot = makeLeaf(source.type);
    targetArr.splice(targetIndex, 0, slot);
    return slot.id;
  }
  const r = locate(source.id, draft.slots);
  if (!r) return null;
  if (drop.kind !== "root-append" && drop.kind !== "into") {
    const dest = locate(drop.id, draft.slots)!.slot;
    if (dest.id === source.id || isDescendantOf(r.slot, dest.id)) return null;
  }
  if (drop.kind === "into" && (drop.groupId === source.id || isDescendantOf(r.slot, drop.groupId))) return null;
  const [moving] = r.parentArr.splice(r.index, 1);
  let idx = targetIndex;
  if (r.parentArr === targetArr && r.index < targetIndex) idx = targetIndex - 1;
  targetArr.splice(idx, 0, moving);
  return moving.id;
}
