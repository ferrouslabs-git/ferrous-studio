// What is selected on the canvas. One click selects; the Inspector edits.
// An "element" is one addressable piece of a component (a nav item, a
// button, a scalar like the CTA text): entry `index` of the array prop at
// `key`, or the scalar at `key` when `index` is null.

export interface ElementSel {
  cmpId: string;
  key: string;
  index: number | null;
}

export type Selection =
  | { kind: "cmp"; id: string }
  | { kind: "region"; id: string }
  | ({ kind: "element" } & ElementSel);

export const sameElement = (a: ElementSel | null | undefined, b: { key: string; index: number | null }): boolean =>
  !!a && a.key === b.key && a.index === b.index;
