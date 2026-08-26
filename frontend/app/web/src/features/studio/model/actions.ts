// Editor actions, ported from legacy/js/mutations.global.js. Each one mutates
// an immer draft of the page in place -- the legacy style survives, which is
// where port bugs would otherwise breed -- and returns UI hints (what to
// select, what to toast). The caller runs it through the history hook, which
// diffs before/after into ops and hands them to the outbox.
//
// Positions are fractional indices; a list's array order always equals its
// pos order, so "insert at index i" means "give it a pos between i-1 and i".
import { COMPONENT_TYPES, DEFAULT_LABELS, PATTERNS } from "../catalog";
import { PageLike } from "./applyOps";
import { posAfterLast, posAtIndex, posBetween, reposition } from "./positions";
import { classifyRegion, emptyRegions, getDefaultProps, STRUCTURAL_TYPES, uid } from "./regions";
import { ComponentNode, Frame, MainFlow, REGION_ORDER, RegionName } from "./types";

export interface CustomDef {
  id: string;
  name: string;
  desc?: string;
  icon?: string;
  color?: string;
  rootLayout?: "col" | "row" | "grid";
  rootAlign?: "start" | "center" | "end";
  rootGridCols?: number;
  rootGap?: number;
  rootPadding?: number;
  slots: Slot[];
}

export type Slot =
  | { id: string; type: "group"; layout?: "col" | "row" | "grid"; align?: "start" | "center" | "end"; gridCols?: number; label?: string; children: Slot[] }
  | { id: string; type: string; label?: string };

export interface ActionResult {
  selectCmpId?: string | null;
  selectFrameId?: string;
  toast?: string;
  /** A definition created as a side effect (editable components); persist it at project level. */
  newDef?: CustomDef;
}

export interface ActionContext {
  frameId: string;
  customComponents: readonly CustomDef[];
}

type Draft = PageLike;

// ── Lookups ─────────────────────────────────────────────────────────────────

export function frameOf(page: PageLike, frameId: string | null | undefined): Frame | undefined {
  return page.document.frames.find((f) => f.id === frameId);
}

interface Loc {
  region: RegionName | null;
  list: ComponentNode[];
  index: number;
}

export function locateCmp(frame: Frame, id: string | null | undefined): Loc | null {
  if (!id) return null;
  if (frame.layoutMode === "regions") {
    for (const r of REGION_ORDER) {
      const index = frame.layout.regions[r].findIndex((c) => c.id === id);
      if (index >= 0) return { region: r, list: frame.layout.regions[r], index };
    }
    return null;
  }
  const index = frame.layout.components.findIndex((c) => c.id === id);
  return index >= 0 ? { region: null, list: frame.layout.components, index } : null;
}

export function listFor(frame: Frame, region: RegionName | null): ComponentNode[] {
  if (frame.layoutMode === "regions") return frame.layout.regions[region ?? "main"];
  return frame.layout.components;
}

const isSmartDock = (frame: Frame) => frame.layoutMode === "regions" && frame.layout.options.smartDock;

function insertAt(list: ComponentNode[], index: number | null, cmp: ComponentNode): void {
  const i = index == null ? list.length : Math.max(0, Math.min(index, list.length));
  cmp.pos = posAtIndex(list, i);
  list.splice(i, 0, cmp);
}

function flatToRegions(components: ComponentNode[]) {
  const regions = emptyRegions();
  for (const c of components) regions[classifyRegion(c.type)].push(c);
  for (const r of REGION_ORDER) reposition(regions[r]);
  return regions;
}

function regionsToFlat(regions: Record<RegionName, ComponentNode[]>): ComponentNode[] {
  const flat = REGION_ORDER.flatMap((r) => regions[r]);
  reposition(flat);
  return flat;
}

function newComponent(type: string, label?: string): ComponentNode {
  const cmp: ComponentNode = { id: uid("c"), type, label: label ?? DEFAULT_LABELS[type] ?? type, pos: "" };
  const defaults = getDefaultProps(type);
  if (Object.keys(defaults).length) cmp.props = JSON.parse(JSON.stringify(defaults));
  return cmp;
}

function ensureProps(cmp: ComponentNode): Record<string, unknown> {
  if (cmp.props && typeof cmp.props === "object") return cmp.props;
  const defaults = getDefaultProps(cmp.type);
  const props: Record<string, unknown> = Object.keys(defaults).length ? JSON.parse(JSON.stringify(defaults)) : {};
  cmp.props = props;
  return props;
}

export function createEditableDefinition(seedLabel: string, existing: readonly CustomDef[]): CustomDef {
  const base = (seedLabel || "Editable component").trim() || "Editable component";
  const taken = new Set(existing.map((d) => (d.name || "").toLowerCase()));
  let name = base;
  let n = 2;
  while (taken.has(name.toLowerCase())) name = `${base} ${n++}`;
  return {
    id: uid("cdef"),
    name,
    desc: "Editable custom block",
    icon: "EDT",
    color: "#6aa0ff",
    rootLayout: "col",
    rootAlign: "start",
    rootGridCols: 2,
    rootGap: 8,
    rootPadding: 8,
    slots: [
      { id: uid("sl"), type: "heading", label: "Section title" },
      { id: uid("sl"), type: "text", label: "Helper text" },
      { id: uid("sl"), type: "input", label: "" },
      { id: uid("sl"), type: "button-row", label: "Cancel, Save" },
    ],
  };
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function setLayoutMode(draft: Draft, ctx: ActionContext, mode: "flat" | "regions"): ActionResult | void {
  const frame = frameOf(draft, ctx.frameId);
  if (!frame || frame.layoutMode === mode) return;
  const f = frame as unknown as Record<string, unknown>;
  if (mode === "regions" && frame.layoutMode === "flat") {
    f.layout = { regions: flatToRegions(frame.layout.components), options: { smartDock: true, mainFlow: "stack" } };
  } else if (mode === "flat" && frame.layoutMode === "regions") {
    f.layout = { components: regionsToFlat(frame.layout.regions) };
  }
  f.layoutMode = mode;
}

export function setFrameOptions(draft: Draft, ctx: ActionContext, patch: { smartDock?: boolean; mainFlow?: MainFlow }): void {
  const frame = frameOf(draft, ctx.frameId);
  if (!frame || frame.layoutMode !== "regions") return;
  Object.assign(frame.layout.options, patch);
}

export function applyPattern(
  draft: Draft,
  ctx: ActionContext,
  patternId: string,
  region: RegionName | null = null,
  atIndex: number | null = null,
): ActionResult | void {
  const pattern = PATTERNS.find((p) => p.id === patternId);
  const frame = frameOf(draft, ctx.frameId);
  if (!pattern || !frame) return;
  const newCmps = pattern.components.map((type) => newComponent(type));

  // Full preset apply is region-first: map each component into its slot.
  if (region == null && atIndex == null) {
    const regions = emptyRegions();
    for (const c of newCmps) regions[classifyRegion(c.type)].push(c);
    for (const r of REGION_ORDER) reposition(regions[r]);
    const options =
      frame.layoutMode === "regions" ? { ...frame.layout.options } : { smartDock: true, mainFlow: "stack" as MainFlow };
    const f = frame as unknown as Record<string, unknown>;
    f.layoutMode = "regions";
    f.layout = { regions, options };
    return { selectCmpId: null, toast: `Applied pattern: ${pattern.name}` };
  }

  if (frame.layoutMode === "regions") {
    const target = region ?? "main";
    const fits = newCmps.filter((c) => classifyRegion(c.type) === target);
    const overflow = newCmps.filter((c) => classifyRegion(c.type) !== target);
    let i = atIndex ?? frame.layout.regions[target].length;
    for (const c of fits) insertAt(frame.layout.regions[target], i++, c);
    for (const c of overflow) insertAt(frame.layout.regions[classifyRegion(c.type)], null, c);
  } else {
    let i = atIndex ?? frame.layout.components.length;
    for (const c of newCmps) insertAt(frame.layout.components, i++, c);
  }
  return { selectCmpId: null, toast: `Inserted pattern: ${pattern.name}` };
}

// ── Components ──────────────────────────────────────────────────────────────

export function appendComponent(
  draft: Draft,
  ctx: ActionContext,
  type: string,
  region: RegionName | null = null,
  atIndex: number | null = null,
  customId: string | null = null,
): ActionResult | void {
  const frame = frameOf(draft, ctx.frameId);
  if (!frame) return;
  const def = type === "custom" && customId ? ctx.customComponents.find((d) => d.id === customId) : null;
  const component = newComponent(type, def ? def.name : undefined);
  if (type === "custom" && customId) component.customId = customId;
  const result: ActionResult = { selectCmpId: component.id };
  if (type === "editable-component") {
    const created = createEditableDefinition(component.label, ctx.customComponents);
    component.customId = created.id;
    component.label = created.name;
    result.newDef = created;
  }

  const wantsRegions = frame.layoutMode === "regions" || region != null;
  if (wantsRegions && frame.layoutMode !== "regions") {
    setLayoutMode(draft, ctx, "regions");
    result.toast = "Auto layout: switched to Regions";
  }
  const f = frameOf(draft, ctx.frameId)!;

  if (f.layoutMode === "regions") {
    const targetRegion =
      isSmartDock(f) && STRUCTURAL_TYPES.has(type) ? classifyRegion(type) : (region ?? classifyRegion(type));
    const list = f.layout.regions[targetRegion];
    // A shell type dropped where one already owns the region swaps it rather than stacking.
    const isExplicitDrop = region != null && atIndex != null;
    if (STRUCTURAL_TYPES.has(type) && !isExplicitDrop) {
      const existingIdx = list.findIndex((c) => STRUCTURAL_TYPES.has(c.type) && classifyRegion(c.type) === targetRegion);
      if (existingIdx !== -1) {
        const defaultLabel = DEFAULT_LABELS[type] ?? type;
        list[existingIdx] = { ...component, label: defaultLabel, pos: list[existingIdx].pos };
        return { ...result, toast: `Swapped to ${defaultLabel}` };
      }
    }
    insertAt(list, atIndex, component);
  } else {
    insertAt(f.layout.components, atIndex, component);
  }
  return result;
}

export function moveComponent(draft: Draft, ctx: ActionContext, id: string, delta: -1 | 1): void {
  const frame = frameOf(draft, ctx.frameId);
  const loc = frame && locateCmp(frame, id);
  if (!loc) return;
  const j = loc.index + delta;
  if (j < 0 || j >= loc.list.length) return;
  const [item] = loc.list.splice(loc.index, 1);
  // After removal the neighbours at j-1 / j bracket the destination.
  item.pos = posAtIndex(loc.list, j);
  loc.list.splice(j, 0, item);
}

export function removeComponent(draft: Draft, ctx: ActionContext, id: string): ActionResult | void {
  const frame = frameOf(draft, ctx.frameId);
  const loc = frame && locateCmp(frame, id);
  if (!loc) return;
  loc.list.splice(loc.index, 1);
  return { selectCmpId: null };
}

/** Drop `srcId` before/after `targetId` (same frame). */
export function reorderById(draft: Draft, ctx: ActionContext, srcId: string, targetId: string, before: boolean): void {
  const frame = frameOf(draft, ctx.frameId);
  const src = frame && locateCmp(frame, srcId);
  if (!frame || !src) return;
  const [item] = src.list.splice(src.index, 1);
  if (frame.layoutMode === "regions" && isSmartDock(frame) && STRUCTURAL_TYPES.has(item.type)) {
    const list = frame.layout.regions[classifyRegion(item.type)];
    item.pos = posAfterLast(list);
    list.push(item);
    return;
  }
  const target = locateCmp(frame, targetId);
  if (!target) {
    item.pos = posAfterLast(src.list);
    src.list.push(item);
    return;
  }
  insertAt(target.list, before ? target.index : target.index + 1, item);
}

export function moveToRegion(draft: Draft, ctx: ActionContext, srcId: string, region: RegionName): void {
  const frame = frameOf(draft, ctx.frameId);
  if (!frame || frame.layoutMode !== "regions") return;
  const src = locateCmp(frame, srcId);
  if (!src) return;
  const [item] = src.list.splice(src.index, 1);
  const target = isSmartDock(frame) && STRUCTURAL_TYPES.has(item.type) ? classifyRegion(item.type) : region;
  const list = frame.layout.regions[target];
  item.pos = posAfterLast(list);
  list.push(item);
}

export function setComponentType(draft: Draft, ctx: ActionContext, id: string, type: string): ActionResult | void {
  const frame = frameOf(draft, ctx.frameId);
  const loc = frame && locateCmp(frame, id);
  if (!loc) return;
  const cmp = loc.list[loc.index];
  cmp.type = type;
  const result: ActionResult = { selectCmpId: id };
  if (type === "editable-component" && !cmp.customId) {
    const created = createEditableDefinition(cmp.label, ctx.customComponents);
    cmp.customId = created.id;
    result.newDef = created;
  }
  if (type !== "editable-component" && type !== "custom") delete cmp.customId;
  const defaults = getDefaultProps(type);
  if (Object.keys(defaults).length) cmp.props = JSON.parse(JSON.stringify(defaults));
  else delete cmp.props;
  return result;
}

export function setComponentLabel(draft: Draft, ctx: ActionContext, id: string, label: string): void {
  const frame = frameOf(draft, ctx.frameId);
  const loc = frame && locateCmp(frame, id);
  if (loc) loc.list[loc.index].label = label;
}

// ── Frames ──────────────────────────────────────────────────────────────────

export function addFrame(draft: Draft, ctx: ActionContext, label: string, cloneCurrent: boolean): ActionResult {
  const src = frameOf(draft, ctx.frameId);
  const pos = posAfterLast(draft.document.frames);
  let frame: Frame;
  const dup = (arr: ComponentNode[]) =>
    arr.map((c) => ({ ...c, id: uid("c"), props: c.props ? JSON.parse(JSON.stringify(c.props)) : c.props }));
  if (cloneCurrent && src) {
    if (src.layoutMode === "regions") {
      const regions = emptyRegions();
      for (const r of REGION_ORDER) regions[r] = dup(src.layout.regions[r]);
      frame = { id: uid("frame"), label, pos, layoutMode: "regions", layout: { regions, options: { ...src.layout.options } } };
    } else {
      frame = { id: uid("frame"), label, pos, layoutMode: "flat", layout: { components: dup(src.layout.components) } };
    }
  } else if ((src?.layoutMode ?? "flat") === "regions") {
    frame = { id: uid("frame"), label, pos, layoutMode: "regions", layout: { regions: emptyRegions(), options: { smartDock: true, mainFlow: "stack" } } };
  } else {
    frame = { id: uid("frame"), label, pos, layoutMode: "flat", layout: { components: [] } };
  }
  draft.document.frames.push(frame);
  return { selectFrameId: frame.id, selectCmpId: null };
}

export function deleteFrame(draft: Draft, ctx: ActionContext, id: string): ActionResult | void {
  const frames = draft.document.frames;
  if (frames.length <= 1) return;
  const idx = frames.findIndex((f) => f.id === id);
  if (idx < 0) return;
  frames.splice(idx, 1);
  if (ctx.frameId === id) return { selectFrameId: frames[Math.max(0, idx - 1)].id, selectCmpId: null };
}

export function setFrameLabel(draft: Draft, ctx: ActionContext, id: string, label: string): void {
  const frame = frameOf(draft, id);
  if (frame) frame.label = label;
}

// ── Props editing (inline tokens) ───────────────────────────────────────────

function cmpById(draft: Draft, ctx: ActionContext, id: string): ComponentNode | null {
  const frame = frameOf(draft, ctx.frameId);
  const loc = frame && locateCmp(frame, id);
  return loc ? loc.list[loc.index] : null;
}

export function addPropItem(draft: Draft, ctx: ActionContext, id: string, key = "items"): ActionResult | void {
  const cmp = cmpById(draft, ctx, id);
  if (!cmp) return;
  const props = ensureProps(cmp);
  if (!Array.isArray(props[key])) {
    const defaults = getDefaultProps(cmp.type);
    props[key] = Array.isArray(defaults[key]) ? [...(defaults[key] as unknown[])] : [];
  }
  (props[key] as unknown[]).push(`Item ${(props[key] as unknown[]).length + 1}`);
  return { selectCmpId: id };
}

export function renamePropItem(draft: Draft, ctx: ActionContext, id: string, key: string, index: number, text: string): ActionResult | void {
  const cmp = cmpById(draft, ctx, id);
  if (!cmp) return;
  const props = ensureProps(cmp);
  const items = props[key];
  const value = (text || "").trim();
  if (!Array.isArray(items) || index < 0 || index >= items.length || !value) return;
  items[index] = value;
  return { selectCmpId: id };
}

export function setPropValue(draft: Draft, ctx: ActionContext, id: string, key: string, text: string): ActionResult | void {
  const cmp = cmpById(draft, ctx, id);
  if (!cmp) return;
  ensureProps(cmp)[key] = (text || "").trim();
  return { selectCmpId: id };
}

export function setPropPath(draft: Draft, ctx: ActionContext, id: string, path: string, text: string): ActionResult | void {
  const cmp = cmpById(draft, ctx, id);
  if (!cmp) return;
  const props = ensureProps(cmp);
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return;
  let node: unknown = props;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    node = (node as Record<string | number, unknown>)?.[key];
    if (node == null) return;
  }
  const last = parts[parts.length - 1];
  (node as Record<string | number, unknown>)[/^\d+$/.test(last) ? Number(last) : last] = (text || "").trim();
  return { selectCmpId: id };
}

export function addPropRow(draft: Draft, ctx: ActionContext, id: string, key = "rows"): ActionResult | void {
  const cmp = cmpById(draft, ctx, id);
  if (!cmp) return;
  const props = ensureProps(cmp);
  const rows = Array.isArray(props[key]) ? (props[key] as unknown[][]) : [];
  props[key] = rows;
  const cols = Array.isArray(props.columns) ? (props.columns as unknown[]).length : 3;
  rows.push(Array.from({ length: Math.max(1, cols) }, (_, i) => `Value ${rows.length + 1}.${i + 1}`));
  return { selectCmpId: id };
}

export function addPropColumn(draft: Draft, ctx: ActionContext, id: string, columnsKey = "columns", rowsKey = "rows"): ActionResult | void {
  const cmp = cmpById(draft, ctx, id);
  if (!cmp) return;
  const props = ensureProps(cmp);
  const columns = Array.isArray(props[columnsKey]) ? (props[columnsKey] as unknown[]) : [];
  const rows = Array.isArray(props[rowsKey]) ? (props[rowsKey] as unknown[][]) : [];
  props[columnsKey] = columns;
  props[rowsKey] = rows;
  const n = columns.length + 1;
  columns.push(`Column ${n}`);
  rows.forEach((row, ri) => {
    if (!Array.isArray(row)) rows[ri] = [];
    rows[ri].push(`Value ${ri + 1}.${n}`);
  });
  return { selectCmpId: id };
}

export function renameShellGroupTitle(draft: Draft, ctx: ActionContext, id: string, groupIndex: number, text: string): ActionResult | void {
  const cmp = cmpById(draft, ctx, id);
  const groups = cmp?.props?.groups as { title?: string; items: string[] }[] | undefined;
  if (!cmp || !Array.isArray(groups) || groupIndex < 0 || groupIndex >= groups.length) return;
  groups[groupIndex].title = (text || "").trim();
  return { selectCmpId: id };
}

export function addShellItem(draft: Draft, ctx: ActionContext, id: string, groupIndex: number | null = null): ActionResult | void {
  const cmp = cmpById(draft, ctx, id);
  if (!cmp) return;
  ensureProps(cmp);
  if (cmp.type === "sidenav-grouped") {
    const groups = (cmp.props!.groups as { title?: string; items: string[] }[]) ?? [];
    const g = groups[groupIndex ?? 0];
    if (!g) return;
    g.items.push(`Item ${g.items.length + 1}`);
    return { selectCmpId: id };
  }
  return addPropItem(draft, ctx, id, "items");
}

export function renameShellItem(draft: Draft, ctx: ActionContext, id: string, index: number, text: string, groupIndex: number | null = null): ActionResult | void {
  const cmp = cmpById(draft, ctx, id);
  const value = (text || "").trim();
  if (!cmp || !value) return;
  if (cmp.type === "sidenav-grouped") {
    const groups = cmp.props?.groups as { items: string[] }[] | undefined;
    const g = groups?.[groupIndex ?? -1];
    if (!g || index < 0 || index >= g.items.length) return;
    g.items[index] = value;
    return { selectCmpId: id };
  }
  return renamePropItem(draft, ctx, id, "items", index, value);
}

export const TYPE_OPTIONS = [...new Set([...Object.keys(COMPONENT_TYPES), ...Object.keys(DEFAULT_LABELS)])];

export { posBetween };
