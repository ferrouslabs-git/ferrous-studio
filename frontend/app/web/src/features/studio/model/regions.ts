// Per-type default props, element minting and id minting. Pure functions: no
// state, no DOM. This is the domain knowledge the server deliberately does
// not have.
import { COMPONENTS, ElementSeed, elementMeta } from "../catalog";
import { ElementNode } from "./types";
import { reposition } from "./positions";

/** Shell chrome: types that fill a region edge-to-edge (nav bars, footers)
 *  rather than stacking as padded content. Drives canvas spacing only —
 *  placement is entirely the user's. */
export const STRUCTURAL_TYPES = new Set<string>(["navbar", "footer"]);

/** Short random ids. More entropy than the legacy counter-based uid, since
 *  ids now live in a shared database rather than one browser session. */
export function uid(prefix: string): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Scalar placeholder content for a freshly added component. Everything list-
 *  shaped lives in `elements` now (see defaultElementsFor); these are the
 *  remaining strings a renderer shows outside any element. */
export function getDefaultProps(type: string): Record<string, unknown> {
  switch (type) {
    case "list":
      // Three sample records; cells are keyed by column element id and fall
      // back to kind-derived samples until edited.
      return { rows: [{}, {}, {}] };
    case "calendar":
      return { period: "March 2026" };
    case "detail":
      return { heading: "Ada Lovelace", status: "Active" };
    case "footer":
      return { copyright: "© 2026 Acme" };
    default:
      return {};
  }
}

/** Build one element instance from its catalogue meta plus an optional seed. */
export function makeElement(componentType: string, seed: ElementSeed): ElementNode | null {
  const meta = elementMeta(componentType, seed.type);
  if (!meta) return null;
  const node: ElementNode = {
    id: uid("e"),
    type: meta.type,
    label: seed.label ?? meta.defaultLabel,
    pos: "",
  };
  const data = { ...meta.defaultData, ...seed.data };
  if (Object.keys(data).length) node.data = data;
  return node;
}

/** The elements a fresh component of `type` starts with, in pos order.
 *  Explicit seeds win over defaults for max-capped types (one header, one
 *  search…): a default seed that would breach the cap is dropped. */
export function defaultElementsFor(type: string, extra: ElementSeed[] = []): ElementNode[] {
  const meta = COMPONENTS[type];
  if (!meta) return [];
  const counts = new Map<string, number>();
  for (const seed of extra) counts.set(seed.type, (counts.get(seed.type) ?? 0) + 1);
  const defaults = meta.defaultElements.filter((seed) => {
    const max = elementMeta(type, seed.type)?.max;
    if (max == null) return true;
    const reserved = counts.get(seed.type) ?? 0;
    if (reserved >= max) return false;
    counts.set(seed.type, reserved + 1);
    return true;
  });
  const out: ElementNode[] = [];
  for (const seed of [...defaults, ...extra]) {
    const node = makeElement(type, seed);
    if (node) out.push(node);
  }
  reposition(out);
  return out;
}
