// Editor actions. Each one mutates an immer draft of the page in place and
// returns UI hints (what to select, what to toast). The caller runs it
// through the history hook, which diffs before/after into ops and hands them
// to the outbox.
//
// Positions are fractional indices; a list's array order always equals its
// pos order, so "insert at index i" means "give it a pos between i-1 and i".
//
// Addressing: an "element" is one addressable piece of a component. A typed
// child node (ElementNode) is addressed by the key `el:<id>` with a null
// index; a scalar prop token (the brand text, a heading) by its prop key.
// Selection, Inspector editing and link targets all use this addressing.
import { ComponentSeed, COMPONENTS, ElementSeed, elementMeta, navAlign, PATTERNS, PatternTemplate } from "../catalog";
import { PageLike } from "./applyOps";
import { byPos, posAfterLast, posAtIndex, posBetween, reposition } from "./positions";
import { defaultElementsFor, getDefaultProps, makeElement, uid } from "./regions";
import {
  firstRegionId,
  newRegion,
  removeRegion,
  setNodeSize,
  setRegionBg,
  setRegionLabel,
  splitRegion,
  SplitSide,
} from "./tree";
import { ComponentNode, ElementNode, LayoutNode, LinkTarget, PageDocument, Size } from "./types";

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
  selectRegionId?: string | null;
  /** Select one element: `{ cmpId, key: "el:<id>", index: null }`. */
  selectElement?: { cmpId: string; key: string; index: number | null };
  toast?: string;
  /** A definition created as a side effect (editable components); persist it at project level. */
  newDef?: CustomDef;
}

export interface ActionContext {
  customComponents: readonly CustomDef[];
}

type Draft = PageLike;

/** Links a component's elements carry, keyed by element address: `el:<id>`
 *  for element nodes, a scalar prop key for tokens. Legacy documents may
 *  still hold index-aligned arrays under array keys; migration rewrites
 *  those to `el:` keys on read. */
export type LinksProp = Record<string, (LinkTarget | null)[] | LinkTarget>;

export const EL_PREFIX = "el:";
export const elKey = (id: string): string => `${EL_PREFIX}${id}`;
export const isElKey = (key: string): boolean => key.startsWith(EL_PREFIX);

// ── Lookups ─────────────────────────────────────────────────────────────────

interface Loc {
  region: string;
  list: ComponentNode[];
  index: number;
}

export function locateCmp(doc: PageDocument, id: string | null | undefined): Loc | null {
  if (!id) return null;
  for (const [region, list] of Object.entries(doc.regions)) {
    const index = list.findIndex((c) => c.id === id);
    if (index >= 0) return { region, list, index };
  }
  return null;
}

function regionList(doc: PageDocument, regionId: string | null): ComponentNode[] {
  const id = regionId && regionId in doc.regions ? regionId : firstRegionId(doc.root);
  return (doc.regions[id] ??= []);
}

function insertAt(list: ComponentNode[], index: number | null, cmp: ComponentNode): void {
  const i = index == null ? list.length : Math.max(0, Math.min(index, list.length));
  cmp.pos = posAtIndex(list, i);
  list.splice(i, 0, cmp);
}

const asSeed = (seed: ComponentSeed | string): ComponentSeed => (typeof seed === "string" ? { type: seed } : seed);

function newComponent(seedIn: ComponentSeed | string, label?: string): ComponentNode {
  const seed = asSeed(seedIn);
  const meta = COMPONENTS[seed.type];
  const cmp: ComponentNode = {
    id: uid("c"),
    type: seed.type,
    label: label ?? seed.label ?? meta?.label ?? seed.type,
    pos: "",
  };
  if (meta) {
    cmp.shape = seed.shape ?? meta.defaultShape;
    if (seed.layout ?? meta.defaultLayout) cmp.layout = seed.layout ?? meta.defaultLayout;
    cmp.elements = defaultElementsFor(seed.type, seed.elements ?? []);
    // A default-seeded header titles the component, so it starts as the
    // label ("Filters", "Activity") rather than the generic "Header".
    if (!seed.elements?.some((s) => s.type === "header")) {
      const header = cmp.elements.find((e) => e.type === "header");
      if (header) header.label = cmp.label;
    }
  }
  const defaults = getDefaultProps(seed.type);
  if (Object.keys(defaults).length) cmp.props = JSON.parse(JSON.stringify(defaults));
  return cmp;
}

function ensureProps(cmp: ComponentNode): Record<string, unknown> {
  if (cmp.props && typeof cmp.props === "object") return cmp.props;
  const props: Record<string, unknown> = {};
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

// ── Layout tree ─────────────────────────────────────────────────────────────

export function splitRegionAction(draft: Draft, _ctx: ActionContext, regionId: string, side: SplitSide): ActionResult | void {
  const newId = splitRegion(draft.document, regionId, side);
  if (!newId) return;
  return { selectRegionId: newId, selectCmpId: null };
}

export function removeRegionAction(draft: Draft, _ctx: ActionContext, regionId: string): ActionResult | void {
  if (!removeRegion(draft.document, regionId)) return;
  return { selectRegionId: null, selectCmpId: null };
}

export function setRegionLabelAction(draft: Draft, _ctx: ActionContext, regionId: string, label: string): void {
  setRegionLabel(draft.document, regionId, label);
}

export function setRegionBgAction(draft: Draft, _ctx: ActionContext, regionId: string, bg: string): void {
  setRegionBg(draft.document, regionId, bg);
}

/** Apply divider-drag or inspector size changes; one commit per gesture. */
export function resizeNodes(draft: Draft, _ctx: ActionContext, changes: { id: string; size: Size }[]): void {
  for (const change of changes) setNodeSize(draft.document, change.id, change.size);
}

/** Build a pattern template into fresh nodes + region lists + components. */
function instantiateTemplate(template: PatternTemplate, regions: Record<string, ComponentNode[]>): LayoutNode {
  if (template.children) {
    return {
      kind: "split",
      id: uid("s"),
      dir: template.dir ?? "col",
      size: template.size ?? { fr: 1 },
      children: template.children.map((c) => instantiateTemplate(c, regions)),
    };
  }
  const region = newRegion(template.size ?? { fr: 1 });
  if (template.label) region.label = template.label;
  const list = (template.components ?? []).map((seed) => newComponent(seed));
  reposition(list);
  regions[region.id] = list;
  return region;
}

export function applyPattern(draft: Draft, _ctx: ActionContext, patternId: string, regionId: string | null = null): ActionResult | void {
  const pattern = PATTERNS.find((p) => p.id === patternId);
  if (!pattern) return;
  const doc = draft.document;
  const built: Record<string, ComponentNode[]> = {};
  const node = instantiateTemplate(pattern.template, built);

  if (regionId == null || !(regionId in doc.regions)) {
    // Full apply: the pattern becomes the whole page.
    doc.root = node;
    doc.regions = built;
    return { selectCmpId: null, selectRegionId: null, toast: `Applied pattern: ${pattern.name}` };
  }

  // Drop onto a region: the pattern replaces that region, and the region's
  // existing components move into the pattern's first region.
  const existing = doc.regions[regionId] ?? [];
  const target = draft.document;
  const found = findAndReplace(target, regionId, node);
  if (!found) return;
  Object.assign(doc.regions, built);
  const destId = firstRegionId(node);
  const dest = (doc.regions[destId] ??= []);
  for (const cmp of existing) {
    cmp.pos = posAfterLast(dest);
    dest.push(cmp);
  }
  delete doc.regions[regionId];
  return { selectCmpId: null, selectRegionId: null, toast: `Inserted pattern: ${pattern.name}` };
}

function findAndReplace(doc: PageDocument, id: string, next: LayoutNode): boolean {
  if (doc.root.id === id) {
    doc.root = next;
    return true;
  }
  let done = false;
  const visit = (node: LayoutNode) => {
    if (node.kind !== "split" || done) return;
    const index = node.children.findIndex((c) => c.id === id);
    if (index >= 0) {
      next.size = node.children[index].size;
      node.children[index] = next;
      done = true;
      return;
    }
    node.children.forEach(visit);
  };
  visit(doc.root);
  return done;
}

// ── Components ──────────────────────────────────────────────────────────────

export function appendComponent(
  draft: Draft,
  ctx: ActionContext,
  seedIn: ComponentSeed | string,
  regionId: string | null = null,
  atIndex: number | null = null,
  customId: string | null = null,
): ActionResult | void {
  const seed = asSeed(seedIn);
  const def = seed.type === "custom" && customId ? ctx.customComponents.find((d) => d.id === customId) : null;
  const component = newComponent(seed, def ? def.name : undefined);
  if (seed.type === "custom" && customId) component.customId = customId;
  const result: ActionResult = { selectCmpId: component.id };
  if (seed.type === "editable-component") {
    const created = createEditableDefinition(component.label, ctx.customComponents);
    component.customId = created.id;
    component.label = created.name;
    result.newDef = created;
  }
  insertAt(regionList(draft.document, regionId), atIndex, component);
  return result;
}

export function moveComponent(draft: Draft, _ctx: ActionContext, id: string, delta: -1 | 1): void {
  const loc = locateCmp(draft.document, id);
  if (!loc) return;
  const j = loc.index + delta;
  if (j < 0 || j >= loc.list.length) return;
  const [item] = loc.list.splice(loc.index, 1);
  // After removal the neighbours at j-1 / j bracket the destination.
  item.pos = posAtIndex(loc.list, j);
  loc.list.splice(j, 0, item);
}

export function removeComponent(draft: Draft, _ctx: ActionContext, id: string): ActionResult | void {
  const loc = locateCmp(draft.document, id);
  if (!loc) return;
  loc.list.splice(loc.index, 1);
  return { selectCmpId: null };
}

/** Drop `srcId` before/after `targetId` (possibly in another region). */
export function reorderById(draft: Draft, _ctx: ActionContext, srcId: string, targetId: string, before: boolean): void {
  const src = locateCmp(draft.document, srcId);
  if (!src) return;
  const [item] = src.list.splice(src.index, 1);
  const target = locateCmp(draft.document, targetId);
  if (!target) {
    item.pos = posAfterLast(src.list);
    src.list.push(item);
    return;
  }
  insertAt(target.list, before ? target.index : target.index + 1, item);
}

export function moveToRegion(draft: Draft, _ctx: ActionContext, srcId: string, regionId: string): void {
  const doc = draft.document;
  if (!(regionId in doc.regions)) return;
  const src = locateCmp(doc, srcId);
  if (!src || src.region === regionId) return;
  const [item] = src.list.splice(src.index, 1);
  const list = doc.regions[regionId];
  item.pos = posAfterLast(list);
  list.push(item);
}

/** Change a component's type. This is a reset: the new type's default shape,
 *  layout, elements and props replace the old content (only the label and
 *  position survive). Changing SHAPE, by contrast, keeps everything. */
export function setComponentType(draft: Draft, ctx: ActionContext, id: string, type: string): ActionResult | void {
  const loc = locateCmp(draft.document, id);
  if (!loc) return;
  const cmp = loc.list[loc.index];
  const fresh = newComponent(type, cmp.label);
  cmp.type = type;
  cmp.shape = fresh.shape;
  cmp.layout = fresh.layout;
  cmp.elements = fresh.elements;
  if (fresh.shape === undefined) delete cmp.shape;
  if (fresh.layout === undefined) delete cmp.layout;
  if (fresh.elements === undefined) delete cmp.elements;
  const result: ActionResult = { selectCmpId: id };
  if (type === "editable-component" && !cmp.customId) {
    const created = createEditableDefinition(cmp.label, ctx.customComponents);
    cmp.customId = created.id;
    result.newDef = created;
  }
  if (type !== "editable-component" && type !== "custom") delete cmp.customId;
  if (fresh.props) cmp.props = fresh.props;
  else delete cmp.props;
  return result;
}

export function setComponentLabel(draft: Draft, _ctx: ActionContext, id: string, label: string): void {
  const loc = locateCmp(draft.document, id);
  if (loc) loc.list[loc.index].label = label;
}

/** Pick another variant of the same component. Elements and edited props are
 *  deliberately kept — trying shapes must never lose content. */
export function setComponentShape(draft: Draft, _ctx: ActionContext, id: string, shape: string): ActionResult | void {
  const cmp = cmpById(draft, id);
  if (!cmp || !COMPONENTS[cmp.type]?.shapes.some((s) => s.id === shape)) return;
  cmp.shape = shape;
  return { selectCmpId: id };
}

export function setComponentLayout(draft: Draft, _ctx: ActionContext, id: string, layout: string): ActionResult | void {
  const cmp = cmpById(draft, id);
  if (!cmp || !COMPONENTS[cmp.type]?.layouts.some((l) => l.id === layout)) return;
  cmp.layout = layout;
  return { selectCmpId: id };
}

// ── Elements ────────────────────────────────────────────────────────────────

function cmpById(draft: Draft, id: string): ComponentNode | null {
  const loc = locateCmp(draft.document, id);
  return loc ? loc.list[loc.index] : null;
}

const elementsOf = (cmp: ComponentNode): ElementNode[] => (cmp.elements ??= []);

export function findElement(cmp: ComponentNode, elementId: string): ElementNode | null {
  return cmp.elements?.find((e) => e.id === elementId) ?? null;
}

/** Add one element to a component, honouring the vocabulary and `max`.
 *  Canvas children get a cascading default position they can be moved from. */
export function addElement(
  draft: Draft,
  _ctx: ActionContext,
  cmpId: string,
  seedIn: ElementSeed | string,
  atIndex: number | null = null,
): ActionResult | void {
  const cmp = cmpById(draft, cmpId);
  if (!cmp) return;
  const seed = typeof seedIn === "string" ? { type: seedIn } : seedIn;
  const meta = elementMeta(cmp.type, seed.type);
  if (!meta) return;
  const list = elementsOf(cmp);
  if (meta.max != null && list.filter((e) => e.type === seed.type).length >= meta.max) {
    return { selectCmpId: cmpId, toast: `This component already has its ${meta.label.toLowerCase()}` };
  }
  const node = makeElement(cmp.type, seed)!;
  // A header re-added from the library titles the component again.
  if (node.type === "header" && !seed.label) node.label = cmp.label;
  if (cmp.type === "canvas") {
    const n = list.length;
    node.data = { x: String(16 + (n % 8) * 24), y: String(16 + (n % 8) * 24), ...node.data };
  }
  const sorted = byPos(list);
  const i = atIndex == null ? sorted.length : Math.max(0, Math.min(atIndex, sorted.length));
  node.pos = posAtIndex(sorted, i);
  list.push(node);
  return { selectElement: { cmpId, key: elKey(node.id), index: null } };
}

export function removeElement(draft: Draft, _ctx: ActionContext, cmpId: string, elementId: string): ActionResult | void {
  const cmp = cmpById(draft, cmpId);
  if (!cmp?.elements) return;
  const index = cmp.elements.findIndex((e) => e.id === elementId);
  if (index < 0) return;
  const [gone] = cmp.elements.splice(index, 1);
  dropLink(cmp, elKey(elementId));
  // A removed header leaves props.title = "" as a persisted tombstone, or
  // read-time migration would resurrect it from the label (migrateHeader).
  if (gone.type === "header") ensureProps(cmp).title = "";
  // A removed column takes its cells with it.
  if (gone.type === "column" && Array.isArray(cmp.props?.rows)) {
    for (const row of cmp.props.rows as Record<string, unknown>[]) {
      if (row && typeof row === "object") delete row[elementId];
    }
  }
  return { selectCmpId: cmpId };
}

/** Drop one element before/after a sibling (drag-and-drop reorder). */
export function reorderElement(
  draft: Draft,
  _ctx: ActionContext,
  cmpId: string,
  srcId: string,
  targetId: string,
  before: boolean,
): ActionResult | void {
  const cmp = cmpById(draft, cmpId);
  if (!cmp?.elements || srcId === targetId) return;
  const src = cmp.elements.find((e) => e.id === srcId);
  const rest = byPos(cmp.elements).filter((e) => e.id !== srcId);
  const ti = rest.findIndex((e) => e.id === targetId);
  if (!src || ti < 0) return;
  src.pos = posAtIndex(rest, before ? ti : ti + 1);
  // A horizontal nav bar renders in left/centre/right zones (pos order within
  // each), so landing beside a sibling also adopts its zone — one drag both
  // reorders and re-aligns.
  if (cmp.type === "navbar" && (cmp.layout ?? COMPONENTS.navbar.defaultLayout) === "horizontal") {
    const zone = navAlign(rest[ti]);
    if (navAlign(src) !== zone) (src.data ??= {}).align = zone;
  }
  return { selectElement: { cmpId, key: elKey(srcId), index: null } };
}

export function moveElement(draft: Draft, _ctx: ActionContext, cmpId: string, elementId: string, delta: -1 | 1): void {
  const cmp = cmpById(draft, cmpId);
  if (!cmp?.elements) return;
  const sorted = byPos(cmp.elements);
  const index = sorted.findIndex((e) => e.id === elementId);
  const j = index + delta;
  if (index < 0 || j < 0 || j >= sorted.length) return;
  const el = cmp.elements.find((e) => e.id === elementId)!;
  const rest = sorted.filter((e) => e.id !== elementId);
  el.pos = posAtIndex(rest, j);
}

export function setElementData(draft: Draft, _ctx: ActionContext, cmpId: string, elementId: string, key: string, value: string): ActionResult | void {
  const cmp = cmpById(draft, cmpId);
  const element = cmp ? findElement(cmp, elementId) : null;
  if (!cmp || !element) return;
  const trimmed = (value || "").trim();
  const data = (element.data ??= {});
  if (trimmed) data[key] = trimmed;
  else delete data[key];
  if (!Object.keys(data).length) delete element.data;
  return { selectElement: { cmpId, key: elKey(elementId), index: null } };
}

/** Free placement inside a canvas; one call per completed drag. */
export function setElementPosition(draft: Draft, _ctx: ActionContext, cmpId: string, elementId: string, x: number, y: number): void {
  const cmp = cmpById(draft, cmpId);
  const element = cmp ? findElement(cmp, elementId) : null;
  if (!element) return;
  const data = (element.data ??= {});
  data.x = String(Math.max(0, Math.round(x)));
  data.y = String(Math.max(0, Math.round(y)));
}

/** Free sizing inside a canvas (corner drag); one call per completed drag. */
export function setElementSize(draft: Draft, _ctx: ActionContext, cmpId: string, elementId: string, w: number, h: number): void {
  const cmp = cmpById(draft, cmpId);
  const element = cmp ? findElement(cmp, elementId) : null;
  if (!element) return;
  const data = (element.data ??= {});
  data.w = String(Math.max(40, Math.round(w)));
  data.h = String(Math.max(24, Math.round(h)));
}

// ── List rows ───────────────────────────────────────────────────────────────
// Sample records are component-level representative data: an array of sparse
// objects keyed by column element id. Absent cells render kind-derived
// samples (see Schematic).

type RowRecord = Record<string, string>;

function rowsOf(cmp: ComponentNode): RowRecord[] {
  const props = ensureProps(cmp);
  if (!Array.isArray(props.rows)) props.rows = [];
  return props.rows as RowRecord[];
}

export function addListRow(draft: Draft, _ctx: ActionContext, id: string): ActionResult | void {
  const cmp = cmpById(draft, id);
  if (!cmp) return;
  rowsOf(cmp).push({});
  return { selectCmpId: id };
}

export function setListCell(draft: Draft, _ctx: ActionContext, id: string, rowIndex: number, columnId: string, text: string): ActionResult | void {
  const cmp = cmpById(draft, id);
  if (!cmp || rowIndex < 0) return;
  const rows = rowsOf(cmp);
  while (rows.length <= rowIndex) rows.push({});
  const value = (text || "").trim();
  if (value) rows[rowIndex][columnId] = value;
  else delete rows[rowIndex][columnId];
  return { selectCmpId: id };
}

// ── Element text and links ──────────────────────────────────────────────────

function walkPath(src: unknown, parts: string[]): unknown {
  let node: unknown = src;
  for (const p of parts) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string | number, unknown>)[/^\d+$/.test(p) ? Number(p) : p];
  }
  return node;
}

/** The element's current text: an element node's label, or a scalar prop
 *  falling back to the type's defaults. */
export function elementValue(cmp: ComponentNode, key: string, index: number | null): string {
  if (isElKey(key)) return findElement(cmp, key.slice(EL_PREFIX.length))?.label ?? "";
  const parts = key.split(".").filter(Boolean);
  let v = walkPath(cmp.props, parts);
  if (v === undefined) v = walkPath(getDefaultProps(cmp.type), parts);
  if (index != null) v = Array.isArray(v) ? v[index] : undefined;
  return v == null ? "" : String(v);
}

export function elementLink(cmp: ComponentNode, key: string, index: number | null): LinkTarget | null {
  const links = cmp.props?.links as LinksProp | undefined;
  const entry = links?.[key];
  if (entry == null) return null;
  if (index == null) return Array.isArray(entry) ? null : entry;
  return Array.isArray(entry) ? (entry[index] ?? null) : null;
}

function dropLink(cmp: ComponentNode, key: string): void {
  const links = cmp.props?.links as LinksProp | undefined;
  if (!links || !(key in links)) return;
  delete links[key];
  if (!Object.keys(links).length) delete cmp.props!.links;
}

/** Set an element's text. An empty commit removes PURE-TEXT elements (nav
 *  items, buttons — see blankRemoves in the catalogue); widget elements
 *  (inputs, columns…) keep the element and just blank the label. Scalars
 *  take the value as-is. */
export function setElementText(draft: Draft, ctx: ActionContext, id: string, key: string, index: number | null, text: string): ActionResult | void {
  const cmp = cmpById(draft, id);
  if (!cmp) return;
  const value = (text || "").trim();
  if (isElKey(key)) {
    const elementId = key.slice(EL_PREFIX.length);
    const element = findElement(cmp, elementId);
    if (!element) return;
    if (!value && elementMeta(cmp.type, element.type)?.blankRemoves) {
      return removeElement(draft, ctx, id, elementId);
    }
    element.label = value;
    // Keep the element selected — a rename (or blank) is not a deselection.
    return { selectElement: { cmpId: id, key, index: null } };
  }
  if (index != null) return; // array tokens are gone; legacy docs migrate on read
  ensureProps(cmp)[key] = value;
  return { selectCmpId: id };
}

export function setElementLink(draft: Draft, _ctx: ActionContext, id: string, key: string, index: number | null, target: LinkTarget | null): ActionResult | void {
  const cmp = cmpById(draft, id);
  if (!cmp) return;
  const props = ensureProps(cmp);
  const links = ((props.links as LinksProp | undefined) ?? (props.links = {})) as LinksProp;
  if (index == null) {
    if (target) links[key] = target;
    else delete links[key];
  } else {
    let entry = links[key];
    if (!Array.isArray(entry)) entry = links[key] = [];
    while (entry.length <= index) entry.push(null);
    entry[index] = target;
    if (!target) {
      while (entry.length && entry[entry.length - 1] == null) entry.pop();
      if (!entry.length) delete links[key];
    }
  }
  if (!Object.keys(links).length) delete props.links;
  return { selectCmpId: id };
}

export function setPropValue(draft: Draft, _ctx: ActionContext, id: string, key: string, text: string): ActionResult | void {
  const cmp = cmpById(draft, id);
  if (!cmp) return;
  ensureProps(cmp)[key] = (text || "").trim();
  return { selectCmpId: id };
}

export const TYPE_OPTIONS = [...Object.keys(COMPONENTS), "editable-component"];

export { posBetween };
