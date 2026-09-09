// Arrowheads on a connector's two ends. A connector type (generalisation,
// aggregation, ...) brings its own notation, so each end is "default" until
// the user picks an arrowhead, at which point the choice is written on the
// edge's own style and overrides the type's. Both live on the same style
// object, so the XML, the clipboard and undo all carry it for free.
import type { CellStyle } from "@maxgraph/core";

export type ArrowEnd = "start" | "end";

export type ArrowKind = "default" | "none" | "open" | "filled" | "hollow" | "diamondFilled" | "diamondHollow" | "circle";

interface ArrowEntry {
  kind: ArrowKind;
  label: string;
  /** The maxGraph marker, or nothing for "follow the connector type". */
  marker?: string;
  fill?: boolean;
  size?: number;
}

export const ARROW_KINDS: ArrowEntry[] = [
  { kind: "default", label: "Connector default" },
  { kind: "none", label: "None", marker: "none" },
  { kind: "open", label: "Open arrow", marker: "open", size: 10 },
  { kind: "filled", label: "Filled arrow", marker: "block", fill: true, size: 10 },
  { kind: "hollow", label: "Hollow arrow", marker: "block", fill: false, size: 14 },
  { kind: "diamondFilled", label: "Filled diamond", marker: "diamond", fill: true, size: 14 },
  { kind: "diamondHollow", label: "Hollow diamond", marker: "diamond", fill: false, size: 14 },
  { kind: "circle", label: "Circle", marker: "oval", fill: true, size: 8 },
];

const KEYS = {
  start: { arrow: "startArrow", fill: "startFill", size: "startSize" },
  end: { arrow: "endArrow", fill: "endFill", size: "endSize" },
} as const;

/** The arrowhead a style asks for on one end; "default" when it does not say. */
export function arrowKindOf(style: CellStyle | null | undefined, end: ArrowEnd): ArrowKind {
  const keys = KEYS[end];
  const marker = style?.[keys.arrow];
  if (marker === undefined) return "default";
  const fill = style?.[keys.fill];
  const match = ARROW_KINDS.find((a) => a.marker === marker && (a.fill === undefined || a.fill === (fill ?? true)));
  return match?.kind ?? "default";
}

/** A copy of the style with one end's arrowhead set, or cleared for "default". */
export function withArrow(style: CellStyle, end: ArrowEnd, kind: ArrowKind): CellStyle {
  const keys = KEYS[end];
  const next: CellStyle = { ...style };
  delete next[keys.arrow];
  delete next[keys.fill];
  delete next[keys.size];
  const entry = ARROW_KINDS.find((a) => a.kind === kind);
  if (!entry || !entry.marker) return next;
  next[keys.arrow] = entry.marker;
  if (entry.fill !== undefined) next[keys.fill] = entry.fill;
  if (entry.size !== undefined) next[keys.size] = entry.size;
  return next;
}
