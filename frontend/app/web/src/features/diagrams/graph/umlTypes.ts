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
  | "rect";

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

export type Family = "Use case" | "Class / entity" | "Activity" | "Sequence" | "General";

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
  { type: "note", family: "General", label: "Note", w: 160, h: 80, defaultLabel: "Note", glyph: "🗎" },
  { type: "text", family: "General", label: "Text", w: 140, h: 30, defaultLabel: "Text", glyph: "T" },
  { type: "rect", family: "General", label: "Rectangle", w: 140, h: 80, defaultLabel: "", glyph: "▭" },
];

export const FAMILIES: Family[] = ["Use case", "Class / entity", "Activity", "Sequence", "General"];

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
