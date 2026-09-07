// The UML / business-analysis vocabulary the editor speaks. No maxGraph
// imports here, so the palette definitions and the derived-model types can
// be shared with tests and with the diagrams list page.

export type UmlNodeType =
  | "actor"
  | "usecase"
  | "boundary"
  | "class"
  | "entity"
  | "start"
  | "end"
  | "action"
  | "decision"
  | "fork"
  | "forkV"
  | "swimlane"
  | "swimlaneV"
  | "lifeline"
  | "activation"
  | "note"
  | "text"
  | "rect"
  | "roundRect"
  | "ellipse"
  | "circle"
  | "triangle"
  | "diamond"
  | "pentagon"
  | "hexagon"
  | "star"
  | "cross"
  | "cylinder"
  | "cloud"
  | "parallelogram"
  | "trapezium"
  | "arrow"
  | "callout";

export type UmlEdgeType =
  | "association"
  | "directed"
  | "generalisation"
  | "aggregation"
  | "composition"
  | "dependency"
  | "flow"
  | "include"
  | "extend"
  | "message"
  | "messageAsync";

/** Attribute on the cell's user object that names its UML type. */
export const UML_ATTR = "umlType";

export type Family = "Use case" | "Class / entity" | "Activity" | "Sequence" | "Basic shapes" | "General";

export interface PaletteEntry {
  type: UmlNodeType;
  family: Family;
  label: string;
  w: number;
  h: number;
  defaultLabel: string;
  /** Other cells can be dropped inside it. */
  container?: boolean;
  /** Has no text of its own (start/end/fork). */
  noLabel?: boolean;
  /** Short glyph for the palette tile. */
  glyph: string;
}

export const PALETTE: PaletteEntry[] = [
  { type: "actor", family: "Use case", label: "Actor", w: 40, h: 70, defaultLabel: "Actor", glyph: "웃" },
  { type: "usecase", family: "Use case", label: "Use case", w: 150, h: 60, defaultLabel: "Use case", glyph: "◯" },
  { type: "boundary", family: "Use case", label: "System boundary", w: 320, h: 260, defaultLabel: "System", container: true, glyph: "▭" },
  { type: "class", family: "Class / entity", label: "Class", w: 180, h: 110, defaultLabel: "ClassName", glyph: "▤" },
  { type: "entity", family: "Class / entity", label: "Entity", w: 170, h: 90, defaultLabel: "Entity", glyph: "▥" },
  { type: "start", family: "Activity", label: "Start", w: 28, h: 28, defaultLabel: "", noLabel: true, glyph: "●" },
  { type: "end", family: "Activity", label: "End", w: 32, h: 32, defaultLabel: "", noLabel: true, glyph: "◉" },
  { type: "action", family: "Activity", label: "Action", w: 140, h: 50, defaultLabel: "Action", glyph: "▢" },
  { type: "decision", family: "Activity", label: "Decision / merge", w: 60, h: 60, defaultLabel: "Decision?", glyph: "◇" },
  { type: "fork", family: "Activity", label: "Fork / join", w: 140, h: 8, defaultLabel: "", noLabel: true, glyph: "▬" },
  { type: "forkV", family: "Activity", label: "Fork / join (vertical)", w: 8, h: 140, defaultLabel: "", noLabel: true, glyph: "▮" },
  { type: "swimlane", family: "Activity", label: "Swimlane", w: 560, h: 160, defaultLabel: "Lane", container: true, glyph: "⊟" },
  { type: "swimlaneV", family: "Activity", label: "Swimlane (vertical)", w: 180, h: 480, defaultLabel: "Lane", container: true, glyph: "⊞" },
  { type: "lifeline", family: "Sequence", label: "Lifeline", w: 120, h: 320, defaultLabel: "Object", container: true, glyph: "╽" },
  { type: "activation", family: "Sequence", label: "Activation", w: 12, h: 80, defaultLabel: "", noLabel: true, glyph: "▮" },
  { type: "rect", family: "Basic shapes", label: "Rectangle", w: 140, h: 80, defaultLabel: "", glyph: "▭" },
  { type: "roundRect", family: "Basic shapes", label: "Rounded", w: 140, h: 80, defaultLabel: "", glyph: "▢" },
  { type: "ellipse", family: "Basic shapes", label: "Ellipse", w: 150, h: 90, defaultLabel: "", glyph: "◯" },
  { type: "circle", family: "Basic shapes", label: "Circle", w: 100, h: 100, defaultLabel: "", glyph: "○" },
  { type: "triangle", family: "Basic shapes", label: "Triangle", w: 110, h: 95, defaultLabel: "", glyph: "△" },
  { type: "diamond", family: "Basic shapes", label: "Diamond", w: 120, h: 90, defaultLabel: "", glyph: "◇" },
  { type: "pentagon", family: "Basic shapes", label: "Pentagon", w: 110, h: 105, defaultLabel: "", glyph: "⬠" },
  { type: "hexagon", family: "Basic shapes", label: "Hexagon", w: 130, h: 90, defaultLabel: "", glyph: "⬡" },
  { type: "star", family: "Basic shapes", label: "Star", w: 110, h: 105, defaultLabel: "", glyph: "☆" },
  { type: "cross", family: "Basic shapes", label: "Cross", w: 110, h: 110, defaultLabel: "", glyph: "✚" },
  { type: "cylinder", family: "Basic shapes", label: "Cylinder", w: 110, h: 120, defaultLabel: "", glyph: "⛁" },
  { type: "cloud", family: "Basic shapes", label: "Cloud", w: 170, h: 105, defaultLabel: "", glyph: "☁" },
  { type: "parallelogram", family: "Basic shapes", label: "Parallelogram", w: 160, h: 80, defaultLabel: "", glyph: "▱" },
  { type: "trapezium", family: "Basic shapes", label: "Trapezium", w: 160, h: 80, defaultLabel: "", glyph: "⏢" },
  { type: "arrow", family: "Basic shapes", label: "Arrow", w: 150, h: 80, defaultLabel: "", glyph: "➡" },
  { type: "callout", family: "Basic shapes", label: "Callout", w: 160, h: 100, defaultLabel: "", glyph: "🗪" },
  { type: "note", family: "General", label: "Note", w: 160, h: 100, defaultLabel: "", glyph: "🗎" },
  { type: "text", family: "General", label: "Text", w: 140, h: 30, defaultLabel: "Text", glyph: "T" },
];

export const FAMILIES: Family[] = ["Use case", "Class / entity", "Activity", "Sequence", "Basic shapes", "General"];

export const NODE_BY_TYPE: Record<UmlNodeType, PaletteEntry> = Object.fromEntries(
  PALETTE.map((p) => [p.type, p]),
) as Record<UmlNodeType, PaletteEntry>;

export interface EdgeEntry {
  type: UmlEdgeType;
  label: string;
  /** Guillemet stereotype shown as the label when the edge has none. */
  stereotype?: string;
}

export const EDGE_TYPES: EdgeEntry[] = [
  { type: "association", label: "Association" },
  { type: "directed", label: "Directed association" },
  { type: "generalisation", label: "Generalisation" },
  { type: "aggregation", label: "Aggregation" },
  { type: "composition", label: "Composition" },
  { type: "dependency", label: "Dependency" },
  { type: "flow", label: "Control flow" },
  { type: "include", label: "Include", stereotype: "include" },
  { type: "extend", label: "Extend", stereotype: "extend" },
  { type: "message", label: "Message" },
  { type: "messageAsync", label: "Async message" },
];

export const EDGE_BY_TYPE: Record<UmlEdgeType, EdgeEntry> = Object.fromEntries(
  EDGE_TYPES.map((e) => [e.type, e]),
) as Record<UmlEdgeType, EdgeEntry>;

export const isNodeType = (t: string): t is UmlNodeType => t in NODE_BY_TYPE;
export const isEdgeType = (t: string): t is UmlEdgeType => t in EDGE_BY_TYPE;

/** Which types render a class-style compartment box. */
export const hasCompartments = (t: string) => t === "class" || t === "entity";

/**
 * A note is one block of text and nothing else, so its body is the label --
 * the same attribute in-place editing writes, which is why the canvas needs no
 * special case. Notes written before that kept the body in a separate `text`
 * attribute, so read through to it until the note is next edited.
 */
export const noteBody = (attrs: { label?: string; text?: string }) => attrs.label || attrs.text || "";
