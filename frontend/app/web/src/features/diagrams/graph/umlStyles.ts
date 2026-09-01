// Visual style for each UML type. Registered on the graph's stylesheet under
// the name `uml:<type>`; cells refer to it through `baseStyleNames`, so the
// XML only stores the name and a restyle here restyles every saved diagram.
//
// Look: notation drawn as "ink" on "paper", with the brand orange reserved for
// selection and handles. On the dark canvas that inverts to chalk on a board
// — light ink on dark paper; on the light canvas it is the conventional
// dark-on-white. Only these two colours flip, so every style below follows.
//
// The colours are live module bindings rather than constants: applyUmlTheme()
// reassigns them and the style factories read them when the stylesheet is
// (re)registered, so one call restyles every open and saved diagram.
import type { CellStyle, Stylesheet } from "@maxgraph/core";
import { EDGE_TYPES, PALETTE, UmlEdgeType, UmlNodeType } from "./umlTypes";

export type UmlTheme = "dark" | "light";

interface UmlPalette {
  ink: string;
  paper: string;
  paperMuted: string;
  edge: string;
  edgeText: string;
  canvasBg: string;
}

const PALETTES: Record<UmlTheme, UmlPalette> = {
  dark: {
    ink: "#F4F4F7",
    paper: "#1A1A23",
    paperMuted: "#2A2A36",
    edge: "#C9CBD6",
    edgeText: "#E6E8EE",
    canvasBg: "#0B0B11",
  },
  light: {
    ink: "#16161C",
    paper: "#FFFFFF",
    paperMuted: "#ECEAE6",
    edge: "#55555F",
    edgeText: "#16161C",
    canvasBg: "#F4F3F1",
  },
};

export let INK = PALETTES.dark.ink;
export let PAPER = PALETTES.dark.paper;
export let PAPER_MUTED = PALETTES.dark.paperMuted;
export let EDGE = PALETTES.dark.edge;
export let EDGE_TEXT = PALETTES.dark.edgeText;
export let CANVAS_BG = PALETTES.dark.canvasBg;

/* A note is a pale sticky in either theme, so its ink never flips. */
export const NOTE_INK = "#1A1A23";
export const NOTE = "#FFF3C4";
export const ACCENT = "#FF5B1A";
export const FONT = "Space Grotesk, Inter, system-ui, sans-serif";

/** The theme the document is currently in, as maxGraph cannot read CSS variables. */
export function currentUmlTheme(): UmlTheme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light"
    ? "light"
    : "dark";
}

/** Point the colours at a theme. Callers must re-register styles afterwards. */
export function applyUmlTheme(theme: UmlTheme): void {
  const p = PALETTES[theme];
  INK = p.ink;
  PAPER = p.paper;
  PAPER_MUTED = p.paperMuted;
  EDGE = p.edge;
  EDGE_TEXT = p.edgeText;
  CANVAS_BG = p.canvasBg;
}

const base = (): CellStyle => ({
  fillColor: PAPER,
  strokeColor: INK,
  strokeWidth: 1.5,
  fontColor: INK,
  fontFamily: FONT,
  fontSize: 13,
  whiteSpace: "wrap",
  rounded: false,
});

const solidInk = (): CellStyle => ({ fillColor: INK, strokeColor: INK, noLabel: true, resizable: false });

export function vertexStyleFor(type: UmlNodeType): CellStyle {
  switch (type) {
    case "actor":
      return { ...base(), shape: "uml-actor", fillColor: PAPER, verticalLabelPosition: "bottom", verticalAlign: "top", aspect: "fixed" };
    case "usecase":
      return { ...base(), shape: "ellipse", perimeter: "ellipsePerimeter" };
    case "boundary":
      return {
        ...base(),
        shape: "rectangle",
        fillColor: "none",
        strokeColor: EDGE,
        fontColor: EDGE_TEXT,
        align: "left",
        verticalAlign: "top",
        spacingLeft: 8,
        spacingTop: 4,
        dashed: true,
        dashPattern: "6 4",
      };
    case "class":
    case "entity":
      return { ...base(), shape: "rectangle", overflow: "fill", verticalAlign: "top", align: "left", spacing: 0 };
    case "start":
      return { ...base(), ...solidInk(), shape: "ellipse", perimeter: "ellipsePerimeter" };
    case "end":
      return { ...base(), ...solidInk(), shape: "doubleEllipse", perimeter: "ellipsePerimeter" };
    case "action":
      return { ...base(), shape: "rectangle", rounded: true, arcSize: 40 };
    case "decision":
      return { ...base(), shape: "rhombus", perimeter: "rhombusPerimeter", verticalLabelPosition: "bottom", verticalAlign: "top" };
    case "fork":
    case "forkV":
      return { ...base(), ...solidInk(), shape: "rectangle" };
    case "swimlane":
    case "swimlaneV":
      return {
        ...base(),
        shape: "swimlane",
        startSize: 28,
        horizontal: type === "swimlane",
        swimlaneFillColor: "none",
        fillColor: INK,
        fontColor: PAPER,
        strokeColor: EDGE,
        swimlaneLine: true,
        foldable: false,
      };
    case "lifeline":
      return { ...base(), shape: "uml-lifeline", verticalAlign: "top", spacingTop: 12, fillColor: PAPER };
    case "activation":
      return { ...base(), shape: "rectangle", fillColor: PAPER_MUTED, noLabel: true };
    case "note":
      return { ...base(), shape: "uml-note", fillColor: NOTE, fontColor: NOTE_INK, strokeColor: NOTE_INK, align: "left", verticalAlign: "top", spacing: 8 };
    case "text":
      return { ...base(), shape: "rectangle", fillColor: "none", strokeColor: "none", fontColor: EDGE_TEXT, align: "left" };
    case "rect":
      return { ...base(), shape: "rectangle" };
  }
}

const edgeBase = (): CellStyle => ({
  strokeColor: EDGE,
  strokeWidth: 1.5,
  fontColor: EDGE_TEXT,
  fontFamily: FONT,
  fontSize: 12,
  labelBackgroundColor: CANVAS_BG,
  edgeStyle: "orthogonalEdgeStyle",
  rounded: true,
  startArrow: "none",
  endArrow: "none",
});

export function edgeStyleFor(type: UmlEdgeType): CellStyle {
  switch (type) {
    case "association":
      return { ...edgeBase() };
    case "directed":
      return { ...edgeBase(), endArrow: "open", endSize: 10 };
    case "generalisation":
      return { ...edgeBase(), endArrow: "block", endFill: false, endSize: 14 };
    case "aggregation":
      return { ...edgeBase(), startArrow: "diamond", startFill: false, startSize: 14 };
    case "composition":
      return { ...edgeBase(), startArrow: "diamond", startFill: true, startSize: 14 };
    case "dependency":
      return { ...edgeBase(), dashed: true, dashPattern: "6 4", endArrow: "open", endSize: 10 };
    case "flow":
      return { ...edgeBase(), endArrow: "classic", endFill: true, endSize: 10 };
    case "include":
    case "extend":
      return { ...edgeBase(), dashed: true, dashPattern: "6 4", endArrow: "open", endSize: 10 };
    case "message":
      return { ...edgeBase(), edgeStyle: undefined, rounded: false, endArrow: "block", endFill: true, endSize: 10 };
    case "messageAsync":
      return { ...edgeBase(), edgeStyle: undefined, rounded: false, endArrow: "open", endSize: 10 };
  }
}

export const styleName = (type: string) => `uml:${type}`;

export function registerUmlStyles(stylesheet: Stylesheet): void {
  for (const entry of PALETTE) stylesheet.putCellStyle(styleName(entry.type), vertexStyleFor(entry.type));
  for (const entry of EDGE_TYPES) stylesheet.putCellStyle(styleName(entry.type), edgeStyleFor(entry.type));
}
