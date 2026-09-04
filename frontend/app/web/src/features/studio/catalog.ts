// The library's shared vocabulary: components, their shapes and layouts, the
// element types each component hosts, and screen patterns. This is the
// contract between design and engineering, so names are deliberate.
//
// Two classes of library item:
//   - a COMPONENT stands alone in a region and has a `shape` (which variant
//     it is) and a `layout` (how it flows);
//   - an ELEMENT only ever lives inside a component, and carries
//     representative data (a column's data kind, a field's placeholder)
//     declared here as `dataFields`.
import { Size } from "./model/types";

// ── Representative data ─────────────────────────────────────────────────────

/** What kind of data an element stands for; drives how samples render.
 *  Mirrored by the backend's DataKind literal (schemas.py) — keep in step. */
export const DATA_KINDS = [
  "text", "number", "date", "time", "email", "phone", "currency",
  "percentage", "status", "person", "tags", "image", "boolean", "url", "actions",
] as const;
export type DataKind = (typeof DATA_KINDS)[number];

/** One editable slot of an element's representative data. `logo` is a
 *  built-in icon picker + image upload (stored as an icon name, a data URL,
 *  or "none"); `image` is a plain image upload (stored as a data URL);
 *  `dataset` binds the element to a reusable value list (stored as the
 *  dataset's id) — the Inspector renders all three specially. */
export interface DataFieldMeta {
  key: string;
  label: string;
  kind: "text" | "select" | "logo" | "image" | "dataset";
  options?: readonly string[];
  /** dataset fields only: the manual text field this binding replaces
   *  (hidden in the Inspector while a dataset is chosen). */
  supersedes?: string;
}

/** The built-in logo marks a brand element can use (drawn in Schematic). */
export const LOGO_ICONS = ["bolt", "spark", "leaf", "cube", "ring", "wave", "peak", "heart"] as const;

/** The icon marks a nav item can carry (as `data.icon`) when its nav bar's
 *  shape is Icons; `data.icon` may instead hold an uploaded image (a data
 *  URL), and unset keeps the placeholder square. Drawn in
 *  components/icons.tsx, whose record must cover exactly these names. */
export const NAV_ICONS = [
  "home", "dashboard", "folder", "document", "calendar", "inbox",
  "user", "users", "chat", "mail", "phone", "bell",
  "search", "chart", "database", "layers", "globe", "pin",
  "star", "heart", "flag", "tag", "clock", "camera",
  "image", "cart", "card", "briefcase", "building", "book",
  "clipboard", "bookmark", "cloud", "download", "lock", "key",
  "shield", "settings", "help",
] as const;
export type NavIcon = (typeof NAV_ICONS)[number];

/** Web-safe font choices for the style controls (regions/components/elements
 *  store the id; renderers resolve it to a stack via fontStack). */
export const FONTS = [
  { id: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { id: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { id: "trebuchet", label: "Trebuchet MS", stack: "'Trebuchet MS', Tahoma, sans-serif" },
  { id: "georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { id: "times", label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { id: "courier", label: "Courier New", stack: "'Courier New', Courier, monospace" },
] as const;
export const fontStack = (id: string | undefined): string | undefined => FONTS.find((f) => f.id === id)?.stack;

/** Where an element sits in a horizontal nav bar (stored as `data.align`).
 *  Unset falls back by type: content leads, chrome trails. */
export const NAV_ALIGN_OPTIONS = ["left", "centre", "right"] as const;
export type NavAlign = (typeof NAV_ALIGN_OPTIONS)[number];
const NAV_TRAILING_TYPES = new Set(["search", "button", "avatar"]);
export function navAlign(el: { type: string; data?: Record<string, string> }): NavAlign {
  const a = el.data?.align;
  if (a === "left" || a === "centre" || a === "right") return a;
  return NAV_TRAILING_TYPES.has(el.type) ? "right" : "left";
}

/** Corner treatments a shapeable element offers (stored as `data.shape`;
 *  unset keeps the widget's own default). Rendered as `el-shape-*` classes. */
export const EL_SHAPE_OPTIONS = ["square", "rounded", "pill"] as const;

/** Fill treatments a fillable element offers (stored as `data.fill`; unset
 *  keeps the widget's own default). Rendered as `el-fill-*` classes. */
export const EL_FILL_OPTIONS = ["filled", "outline", "ghost"] as const;

export interface ElementTypeMeta {
  type: string;
  label: string;
  desc: string;
  icon: string;
  dataFields: DataFieldMeta[];
  defaultLabel: string;
  defaultData?: Record<string, string>;
  /** At most this many per component (a nav has one brand, one avatar). */
  max?: number;
  /** Committing an empty label removes the element. Only for pure-text
   *  elements (a nav item, a button — the label IS the element); widgets
   *  with their own body (inputs, columns…) keep the element and just show
   *  a blank label. Delete / "Remove element" removes either kind. */
  blankRemoves?: boolean;
  /** Offers the corner-shape control (EL_SHAPE_OPTIONS via `data.shape`). */
  shapeable?: boolean;
  /** Offers the fill control (EL_FILL_OPTIONS via `data.fill`). */
  fillable?: boolean;
  /** Fill rendered when `data.fill` is unset — this widget's own default.
   *  Absent means the base CSS look; an explicit `data.fill` always wins. */
  defaultFill?: (typeof EL_FILL_OPTIONS)[number];
}

// ── Element vocabularies ────────────────────────────────────────────────────
// Shared metas exist once; a type id means the same thing in every host.

const el = (meta: ElementTypeMeta): ElementTypeMeta => meta;

const BRAND = el({
  type: "brand", label: "Brand / logo", desc: "Product name or logo mark", icon: "BR",
  dataFields: [{ key: "logo", label: "Logo", kind: "logo" }],
  defaultLabel: "Acme", max: 1,
});
const NAV_ITEM = el({ type: "nav-item", label: "Nav item", desc: "A destination; link it to a page", icon: "NV", dataFields: [], defaultLabel: "Item", blankRemoves: true });
const GROUP_HEADING = el({ type: "group-heading", label: "Group heading", desc: "Section title above nav items", icon: "GH", dataFields: [], defaultLabel: "Section", blankRemoves: true });
const SEARCH = el({ type: "search", label: "Search box", desc: "Search input; the text is its placeholder", icon: "SR", dataFields: [], defaultLabel: "Search…", max: 1, shapeable: true, fillable: true, defaultFill: "outline" });
const BUTTON = el({
  type: "button", label: "Button", desc: "Action button", icon: "BT",
  dataFields: [{ key: "style", label: "Style", kind: "select", options: ["primary", "secondary", "danger"] }],
  defaultLabel: "Action", defaultData: { style: "primary" }, blankRemoves: true,
  shapeable: true, fillable: true,
});
const AVATAR = el({
  type: "avatar", label: "Avatar / user", desc: "Signed-in user; the text is the initials", icon: "AV",
  dataFields: [{ key: "name", label: "Name", kind: "text" }, { key: "role", label: "Role", kind: "text" }],
  defaultLabel: "AL", defaultData: { name: "Ada Lovelace", role: "Administrator" }, max: 1, shapeable: true,
});
const WORKSPACE = el({ type: "workspace-switcher", label: "Workspace switcher", desc: "Workspace selector", icon: "WS", dataFields: [], defaultLabel: "Acme Workspace", max: 1 });
const DIVIDER = el({ type: "divider", label: "Divider", desc: "Separator line or spacer", icon: "—", dataFields: [], defaultLabel: "" });

/** The component's title, as a real element so it styles and places like any
 *  other. `placement` chooses between the chrome row (beside filters, search,
 *  legends) and its own line above the component. */
const HEADER = el({
  type: "header", label: "Header", desc: "The component's title; inline with its controls, or on its own line above", icon: "HD",
  dataFields: [{ key: "placement", label: "Placement", kind: "select", options: ["inline", "above"] }],
  defaultLabel: "Header", defaultData: { placement: "inline" }, max: 1, blankRemoves: true,
});

const COLUMN = el({
  type: "column", label: "Column", desc: "One column / field of each record", icon: "CO",
  dataFields: [
    { key: "kind", label: "Data kind", kind: "select", options: DATA_KINDS },
    { key: "dataset", label: "Dataset", kind: "dataset", supersedes: "samples" },
    { key: "samples", label: "Sample values", kind: "text" },
  ],
  defaultLabel: "Column", defaultData: { kind: "text" },
});
const COLUMN_HEADER = el({ type: "column-header", label: "Column header", desc: "The header row; remove it for a headerless table", icon: "CH", dataFields: [], defaultLabel: "", max: 1 });
const ROW_ACTION = el({ type: "row-action", label: "Row action", desc: "Per-row action (Edit, Delete…)", icon: "RA", dataFields: [], defaultLabel: "Edit", blankRemoves: true, shapeable: true, fillable: true });
const SELECT_COLUMN = el({ type: "select-column", label: "Select column", desc: "Bulk-select checkboxes", icon: "☑", dataFields: [], defaultLabel: "", max: 1 });
/** The field a list filters by. Bind it to a dataset (or type options) and the
 *  chip becomes a real dropdown showing the chosen value; left unbound it stays
 *  the plain label chip it has always been. */
const FILTER = el({
  type: "filter", label: "Filter chip", desc: "The field this list filters by", icon: "FL",
  dataFields: [
    { key: "dataset", label: "Dataset", kind: "dataset", supersedes: "options" },
    { key: "options", label: "Options", kind: "text" },
    // Set by picking from the expanded menu on the canvas; blank = unselected.
    { key: "selected", label: "Selected", kind: "text" },
  ],
  defaultLabel: "Filter", blankRemoves: true, shapeable: true, fillable: true,
});
const PAGINATION = el({
  type: "pagination", label: "Pagination", desc: "Page controls", icon: "PG",
  dataFields: [{ key: "pageSize", label: "Page size", kind: "text" }],
  defaultLabel: "", defaultData: { pageSize: "10" }, max: 1,
});

const TEXT_INPUT = el({
  type: "text-input", label: "Text input", desc: "Single-line input", icon: "TI",
  dataFields: [
    { key: "kind", label: "Data kind", kind: "select", options: ["text", "email", "number", "password", "phone", "url"] },
    { key: "placeholder", label: "Placeholder", kind: "text" },
  ],
  defaultLabel: "Field", defaultData: { kind: "text" }, shapeable: true, fillable: true, defaultFill: "outline",
});
const TEXT_AREA = el({
  type: "text-area", label: "Text area", desc: "Multi-line input", icon: "TA",
  dataFields: [{ key: "placeholder", label: "Placeholder", kind: "text" }], defaultLabel: "Notes",
  shapeable: true, fillable: true, defaultFill: "outline",
});
const SELECT = el({
  type: "select", label: "Dropdown", desc: "Choice from a list", icon: "DD",
  dataFields: [
    { key: "dataset", label: "Dataset", kind: "dataset", supersedes: "options" },
    { key: "options", label: "Options", kind: "text" },
    // Set by picking from the expanded menu on the canvas; blank = unselected.
    { key: "selected", label: "Selected", kind: "text" },
  ],
  defaultLabel: "Choice", defaultData: { options: "Option A, Option B" }, shapeable: true, fillable: true, defaultFill: "outline",
});
const RADIO_GROUP = el({
  type: "radio-group", label: "Radio group", desc: "One-of-many choice", icon: "RG",
  dataFields: [{ key: "options", label: "Options", kind: "text" }],
  defaultLabel: "Choice", defaultData: { options: "Yes, No" },
});
const CHECKBOX = el({ type: "checkbox", label: "Checkbox", desc: "On/off tick", icon: "CB", dataFields: [], defaultLabel: "Option" });
const TOGGLE = el({ type: "toggle", label: "Toggle", desc: "On/off switch", icon: "TG", dataFields: [], defaultLabel: "Enabled" });
const DATE_PICKER = el({ type: "date-picker", label: "Date picker", desc: "Date input", icon: "DP", dataFields: [], defaultLabel: "Date", shapeable: true, fillable: true, defaultFill: "outline" });
const FILE_UPLOAD = el({ type: "file-upload", label: "File upload", desc: "Drop zone / browse", icon: "FU", dataFields: [], defaultLabel: "Attachment", shapeable: true, fillable: true, defaultFill: "outline" });
const SECTION_HEADING = el({ type: "section-heading", label: "Section heading", desc: "Groups the fields after it", icon: "SH", dataFields: [], defaultLabel: "Section", blankRemoves: true });
const STEP = el({ type: "step", label: "Step", desc: "One step of a wizard", icon: "ST", dataFields: [], defaultLabel: "Step", blankRemoves: true, shapeable: true, fillable: true });
const HELP_TEXT = el({ type: "help-text", label: "Help text", desc: "Guidance under a field", icon: "HT", dataFields: [], defaultLabel: "Explain what to enter here.", blankRemoves: true });

const SERIES = el({
  type: "series", label: "Series", desc: "A data series; values drive the plot", icon: "SE",
  dataFields: [{ key: "values", label: "Sample values", kind: "text" }],
  defaultLabel: "Series", defaultData: { values: "42, 58, 35, 71" },
});
const CATEGORY_AXIS = el({
  type: "category-axis", label: "Category axis", desc: "What the x-axis counts along", icon: "CX",
  dataFields: [{ key: "categories", label: "Categories", kind: "text" }],
  defaultLabel: "", defaultData: { categories: "Jan, Feb, Mar, Apr" }, max: 1,
});
const VALUE_AXIS = el({
  type: "value-axis", label: "Value axis", desc: "What the y-axis measures", icon: "VY",
  dataFields: [{ key: "unit", label: "Unit", kind: "text" }], defaultLabel: "Value", max: 1,
});
const LEGEND = el({ type: "legend", label: "Legend", desc: "Names the series", icon: "LG", dataFields: [], defaultLabel: "", max: 1 });
const RANGE_SELECTOR = el({ type: "range-selector", label: "Range selector", desc: "The period shown", icon: "RS", dataFields: [], defaultLabel: "Last 12 months", max: 1 });
const STAT = el({
  type: "stat", label: "Stat tile", desc: "One metric at a glance", icon: "KP",
  dataFields: [{ key: "value", label: "Value", kind: "text" }, { key: "delta", label: "Change", kind: "text" }],
  defaultLabel: "Metric", defaultData: { value: "12,408", delta: "+4.2%" }, shapeable: true, fillable: true,
});

const HEADING = el({ type: "heading", label: "Heading", desc: "Large title text", icon: "H", dataFields: [], defaultLabel: "Heading", blankRemoves: true });
const TEXT = el({ type: "text", label: "Text", desc: "Body copy", icon: "T", dataFields: [], defaultLabel: "Body text.", blankRemoves: true });
const LABEL = el({ type: "label", label: "Label", desc: "Small caption text", icon: "L", dataFields: [], defaultLabel: "Label", blankRemoves: true });
const BADGE = el({ type: "badge", label: "Badge", desc: "Status pill", icon: "B", dataFields: [], defaultLabel: "Badge", blankRemoves: true, shapeable: true, fillable: true });
const LINK = el({ type: "link", label: "Link", desc: "Text link; link it to a page", icon: "LK", dataFields: [], defaultLabel: "Link", blankRemoves: true });
const IMAGE = el({
  type: "image", label: "Image", desc: "Picture: upload one, or a placeholder describing what appears", icon: "IM",
  dataFields: [{ key: "src", label: "Image", kind: "image" }],
  defaultLabel: "Describe the image", shapeable: true,
});
const BOX = el({ type: "box", label: "Box", desc: "Container rectangle standing in for anything", icon: "BX", dataFields: [], defaultLabel: "Area", shapeable: true, fillable: true });

const EVENT = el({
  type: "event", label: "Event", desc: "A calendar entry", icon: "EV",
  dataFields: [
    { key: "when", label: "When", kind: "text" },
    { key: "kind", label: "Kind", kind: "select", options: ["meeting", "task", "reminder", "all-day"] },
  ],
  defaultLabel: "Event", defaultData: { when: "Tue 10:00", kind: "meeting" },
});
const VIEW_SWITCHER = el({
  type: "view-switcher", label: "View switcher", desc: "Month / week / day toggle", icon: "VW",
  dataFields: [{ key: "views", label: "Views", kind: "text" }],
  defaultLabel: "", defaultData: { views: "Month, Week, Day" }, max: 1,
});
const CAL_NAV = el({ type: "calendar-nav", label: "Navigation", desc: "Previous / today / next", icon: "◂▸", dataFields: [], defaultLabel: "", max: 1 });
const RESOURCE_ROW = el({ type: "resource-row", label: "Resource row", desc: "One lane of the schedule", icon: "RR", dataFields: [], defaultLabel: "Resource" });
const CAL_LEGEND = el({
  type: "calendar-legend", label: "Legend", desc: "Names the event kinds", icon: "LG",
  dataFields: [{ key: "kinds", label: "Kinds", kind: "text" }],
  defaultLabel: "", defaultData: { kinds: "Meeting, Task, Reminder" }, max: 1,
});

/** Element lists shared between hosts (the canvas hosts everything). */
export const FORM_ELEMENTS: ElementTypeMeta[] = [
  TEXT_INPUT, TEXT_AREA, SELECT, RADIO_GROUP, CHECKBOX, TOGGLE, DATE_PICKER,
  FILE_UPLOAD, SECTION_HEADING, STEP, HELP_TEXT, BUTTON,
];
export const LIST_ELEMENTS: ElementTypeMeta[] = [
  COLUMN, COLUMN_HEADER, ROW_ACTION, SELECT_COLUMN, SEARCH, FILTER, PAGINATION,
];

const dedupe = (lists: ElementTypeMeta[][]): ElementTypeMeta[] => {
  const seen = new Set<string>();
  const out: ElementTypeMeta[] = [];
  for (const list of lists) {
    for (const meta of list) {
      if (seen.has(meta.type)) continue;
      seen.add(meta.type);
      out.push(meta);
    }
  }
  return out;
};

// ── Components ──────────────────────────────────────────────────────────────

export interface ShapeMeta {
  id: string;
  label: string;
  desc?: string;
}

export interface LayoutMeta {
  id: string;
  label: string;
}

export interface ElementSeed {
  type: string;
  label?: string;
  data?: Record<string, string>;
}

export interface ComponentMeta {
  type: string;
  label: string;
  desc: string;
  icon: string;
  shapes: ShapeMeta[];
  defaultShape: string;
  layouts: LayoutMeta[];
  defaultLayout?: string;
  elements: ElementTypeMeta[];
  defaultElements: ElementSeed[];
}

export const COMPONENTS: Record<string, ComponentMeta> = {
  navbar: {
    type: "navbar", label: "Nav bar", desc: "Navigation items as a top bar or side rail", icon: "NAV",
    // Shapes are orientation-neutral: each applies in both layouts.
    shapes: [
      { id: "plain", label: "Plain", desc: "Just the item labels" },
      { id: "tabs", label: "Tabs", desc: "Tab bar for sub-sections" },
      { id: "icons", label: "Icons", desc: "Icon + label items" },
      { id: "breadcrumb", label: "Breadcrumb", desc: "Location trail" },
      { id: "grouped", label: "Grouped", desc: "Items under section headings" },
    ],
    defaultShape: "plain",
    layouts: [{ id: "horizontal", label: "Horizontal" }, { id: "vertical", label: "Vertical" }],
    defaultLayout: "horizontal",
    // SELECT is the bar's dropdown: an environment/team/filter picker showing
    // its first option as the chosen value (see Schematic's ui-nav-select).
    elements: [BRAND, NAV_ITEM, GROUP_HEADING, SEARCH, SELECT, BUTTON, AVATAR, WORKSPACE, DIVIDER],
    defaultElements: [
      { type: "brand" },
      { type: "nav-item", label: "Overview" },
      { type: "nav-item", label: "Users" },
      { type: "nav-item", label: "Reports" },
      { type: "avatar" },
    ],
  },
  list: {
    type: "list", label: "List", desc: "Records as a table, cards, rows or a feed", icon: "LST",
    shapes: [
      { id: "table", label: "Table", desc: "Columns and rows" },
      { id: "cards", label: "Cards", desc: "One card per record" },
      { id: "rows", label: "Rows", desc: "Simple stacked rows" },
      { id: "feed", label: "Feed", desc: "Timeline of events" },
    ],
    defaultShape: "table",
    layouts: [
      { id: "vertical", label: "Vertical" },
      { id: "grid", label: "Grid" },
      { id: "horizontal", label: "Horizontal" },
    ],
    defaultLayout: "vertical",
    elements: [HEADER, ...LIST_ELEMENTS],
    defaultElements: [
      { type: "header" },
      { type: "column-header" },
      { type: "column", label: "Name", data: { kind: "text", samples: "Ada Lovelace, Linus Torvalds, Grace Hopper" } },
      { type: "column", label: "Email", data: { kind: "email" } },
      { type: "column", label: "Status", data: { kind: "status", samples: "Active, Active, Inactive" } },
      { type: "column", label: "Joined", data: { kind: "date" } },
      { type: "search" },
    ],
  },
  form: {
    type: "form", label: "Form", desc: "Inputs for create / edit", icon: "FRM",
    shapes: [
      { id: "simple", label: "Simple", desc: "Flat list of fields" },
      { id: "sections", label: "Sections", desc: "Fields grouped under headings" },
      { id: "wizard", label: "Wizard", desc: "Multi-step with progress" },
      { id: "inline", label: "Inline", desc: "One row of inputs" },
    ],
    defaultShape: "simple",
    layouts: [
      { id: "one-column", label: "One column" },
      { id: "two-column", label: "Two columns" },
      { id: "horizontal", label: "Labels beside" },
    ],
    defaultLayout: "one-column",
    elements: [HEADER, ...FORM_ELEMENTS],
    defaultElements: [
      { type: "header" },
      { type: "text-input", label: "Name" },
      { type: "text-input", label: "Email", data: { kind: "email" } },
      { type: "select", label: "Role", data: { options: "Administrator, Member, Viewer" } },
      { type: "select", label: "Team", data: { options: "Design, Engineering, Sales" } },
      { type: "button", label: "Cancel", data: { style: "secondary" } },
      { type: "button", label: "Save", data: { style: "primary" } },
    ],
  },
  graph: {
    type: "graph", label: "Graph", desc: "Data visualisation, or stat tiles", icon: "GRA",
    shapes: [
      { id: "bar", label: "Bar" },
      { id: "line", label: "Line" },
      { id: "area", label: "Area" },
      { id: "pie", label: "Pie" },
      { id: "donut", label: "Donut" },
      { id: "scatter", label: "Scatter" },
      { id: "stats", label: "Stat tiles", desc: "Metric tiles: numbers at a glance" },
    ],
    defaultShape: "bar",
    layouts: [{ id: "vertical", label: "Vertical" }, { id: "horizontal", label: "Horizontal" }],
    defaultLayout: "vertical",
    elements: [HEADER, SERIES, CATEGORY_AXIS, VALUE_AXIS, LEGEND, RANGE_SELECTOR, STAT],
    defaultElements: [
      { type: "header" },
      { type: "series", label: "This year" },
      { type: "category-axis" },
      { type: "range-selector" },
    ],
  },
  canvas: {
    type: "canvas", label: "Canvas", desc: "Freeform area: place any element anywhere", icon: "CNV",
    shapes: [
      { id: "plain", label: "Plain" },
      { id: "card", label: "Card", desc: "Framed" },
      { id: "grid", label: "Grid", desc: "Dotted design surface" },
      { id: "transparent", label: "Transparent", desc: "No frame or background — only the elements show" },
    ],
    defaultShape: "plain",
    layouts: [
      { id: "fixed", label: "Fixed height" },
      { id: "fill", label: "Fill region" },
      { id: "float", label: "Float over region" },
    ],
    defaultLayout: "fixed",
    elements: dedupe([
      [HEADING, TEXT, LABEL, BADGE, BUTTON, TEXT_INPUT, LINK, IMAGE, BOX, DIVIDER],
      FORM_ELEMENTS,
      LIST_ELEMENTS,
    ]),
    defaultElements: [
      { type: "heading", label: "Heading", data: { x: "16", y: "16" } },
      { type: "text", label: "Explain what this part of the UI does.", data: { x: "16", y: "56" } },
      { type: "button", label: "Action", data: { x: "16", y: "96" } },
    ],
  },
  calendar: {
    type: "calendar", label: "Calendar", desc: "Month, week, agenda or schedule", icon: "CAL",
    shapes: [
      { id: "month", label: "Month" },
      { id: "week", label: "Week" },
      { id: "day", label: "Day", desc: "Agenda list" },
      { id: "schedule", label: "Schedule", desc: "Resource timeline" },
      { id: "mini", label: "Mini", desc: "Date picker" },
    ],
    defaultShape: "month",
    layouts: [{ id: "full", label: "Full" }, { id: "compact", label: "Compact" }],
    defaultLayout: "full",
    elements: [HEADER, EVENT, VIEW_SWITCHER, CAL_NAV, RESOURCE_ROW, CAL_LEGEND],
    defaultElements: [
      { type: "header" },
      { type: "calendar-nav" },
      { type: "view-switcher" },
      { type: "event", label: "Design review", data: { when: "Tue 10:00", kind: "meeting" } },
      { type: "event", label: "Sprint planning", data: { when: "Wed 09:30", kind: "meeting" } },
      { type: "event", label: "Ship v2", data: { when: "Fri", kind: "all-day" } },
    ],
  },
};

/** Which component types host `elementType` (drop gating; several hosts is fine). */
export function elementHosts(elementType: string): string[] {
  return Object.values(COMPONENTS)
    .filter((c) => c.elements.some((e) => e.type === elementType))
    .map((c) => c.type);
}

export function elementMeta(componentType: string, elementType: string): ElementTypeMeta | null {
  return COMPONENTS[componentType]?.elements.find((e) => e.type === elementType) ?? null;
}

export const componentMeta = (type: string): ComponentMeta | null => COMPONENTS[type] ?? null;

/** Component types withdrawn from the vocabulary (2026-09-03). They have no
 *  meta, no renderer and no migration: normalizePage drops any instance a
 *  stored document still carries, and the `e1c4a7f2b930` migration cleared
 *  them out of the database. Listed so the strip is one named thing rather
 *  than a literal buried in positions.ts. */
export const RETIRED_TYPES = new Set<string>([
  "hero", "detail", "empty", "main", "modal", "footer",
  // Legacy ids that folded into the above before they were withdrawn:
  "rightpanel-detail",
]);

// ── Legacy vocabulary ───────────────────────────────────────────────────────
// Pre-restructure types. Kept so stored documents normalise (see
// model/migrate.ts) and unmapped strays still render a placeholder.

export const DEFAULT_LABELS: Record<string, string> = {
  navbar: "App",
  list: "List",
  form: "Form",
  graph: "Chart",
  canvas: "Canvas",
  calendar: "Calendar",
  "editable-component": "Editable component",
  // Legacy type ids, migrated on read:
  sidebar: "Side Nav",
  tabs: "Tabs",
  breadcrumb: "Breadcrumb",
  kpi: "Metrics",
  chart: "Chart",
  filters: "Search bar",
  stepper: "Steps",
  actions: "Actions",
  "nav-basic": "Nav",
  "nav-search": "Nav",
  "nav-cta": "Nav",
  "sidenav-simple": "Side Nav",
  "sidenav-grouped": "Side Nav",
  "sidenav-workspace": "Side Nav",
  "rightpanel-filters": "Filter Panel",
  "rightpanel-activity": "Activity Feed",
};

// ── Screen patterns ─────────────────────────────────────────────────────────

/** What a pattern region starts with: a component type plus optional shape,
 *  layout, label and extra elements appended after the type's defaults. */
export interface ComponentSeed {
  type: string;
  shape?: string;
  layout?: string;
  label?: string;
  elements?: ElementSeed[];
}

/** A pattern is a ready-made layout tree: splits with sizes, and the
 *  component seeds each region starts with. `children` present = a split;
 *  otherwise a region leaf. `size` defaults to fill ({ fr: 1 }). */
export interface PatternTemplate {
  dir?: "row" | "col";
  size?: Size;
  label?: string;
  children?: PatternTemplate[];
  components?: ComponentSeed[];
}

export interface Pattern {
  id: string;
  icon: string;
  name: string;
  group: string;
  desc: string;
  template: PatternTemplate;
}

const topNav = (extra?: ElementSeed[]): ComponentSeed => ({ type: "navbar", elements: extra });
const sideNav = (seed: Partial<ComponentSeed> = {}): ComponentSeed => ({ type: "navbar", layout: "vertical", shape: "icons", label: "Side Nav", ...seed });
const filterPanel: ComponentSeed = {
  type: "form", label: "Filters",
  elements: [
    { type: "select", label: "Status", data: { options: "Any, Active, Inactive" } },
    { type: "select", label: "Date range", data: { options: "Any time, Last week, Last month" } },
    { type: "select", label: "Assigned to", data: { options: "Anyone" } },
    { type: "button", label: "Clear", data: { style: "secondary" } },
    { type: "button", label: "Apply", data: { style: "primary" } },
  ],
};
const activityFeed: ComponentSeed = {
  type: "list", shape: "feed", label: "Activity",
  elements: [
    { type: "column", label: "Event", data: { kind: "text", samples: "Created record, Updated status, Added note" } },
    { type: "column", label: "When", data: { kind: "time", samples: "2 min ago, 1 hr ago, 3 hr ago" } },
  ],
};

const header = (nav: ComponentSeed): PatternTemplate => ({ size: "auto", label: "Header", components: [nav] });
const sidebar = (side: ComponentSeed): PatternTemplate => ({ size: 260, label: "Sidebar", components: [side] });
const panel = (right: ComponentSeed): PatternTemplate => ({ size: 300, label: "Panel", components: [right] });
const content = (...seeds: ComponentSeed[]): PatternTemplate => ({ label: "Content", components: seeds });

const navOnly = (nav: ComponentSeed): PatternTemplate => ({ dir: "col", children: [header(nav), content()] });
const leftPanel = (side: ComponentSeed): PatternTemplate => ({ dir: "row", children: [sidebar(side), content()] });
const rightPanel = (right: ComponentSeed): PatternTemplate => ({ dir: "row", children: [content(), panel(right)] });
const fullShell = (nav: ComponentSeed, side: ComponentSeed, right: ComponentSeed): PatternTemplate => ({
  dir: "col",
  children: [header(nav), { dir: "row", children: [sidebar(side), content(), panel(right)] }],
});

const groupedSideNav = sideNav({
  shape: "grouped",
  elements: [{ type: "group-heading", label: "Admin" }, { type: "nav-item", label: "Billing" }],
});
const workspaceSideNav = sideNav({ elements: [{ type: "workspace-switcher" }] });

export const PATTERNS: Pattern[] = [
  { id: "empty-screen", icon: "EMP", name: "Empty screen", group: "Starter", desc: "One blank region", template: { components: [] } },
  { id: "nav-basic-only", icon: "N-B", name: "Nav only - Basic", group: "Top Nav", desc: "Header band with basic top navigation", template: navOnly(topNav()) },
  { id: "nav-search-only", icon: "N-S", name: "Nav only - Search", group: "Top Nav", desc: "Header band with search-enabled top navigation", template: navOnly(topNav([{ type: "search" }])) },
  { id: "nav-cta-only", icon: "N-C", name: "Nav only - CTA", group: "Top Nav", desc: "Header band with CTA-style top navigation", template: navOnly(topNav([{ type: "button", label: "Get started" }])) },
  { id: "left-panel-simple", icon: "L-S", name: "Left panel - Simple", group: "Left Panel", desc: "Content beside a simple side navigation", template: leftPanel(sideNav()) },
  { id: "left-panel-grouped", icon: "L-G", name: "Left panel - Grouped", group: "Left Panel", desc: "Content beside grouped side navigation", template: leftPanel(groupedSideNav) },
  { id: "left-panel-workspace", icon: "L-W", name: "Left panel - Workspace", group: "Left Panel", desc: "Content beside a workspace-switcher side navigation", template: leftPanel(workspaceSideNav) },
  { id: "right-panel-filters", icon: "R-F", name: "Right panel - Filters", group: "Right Panel", desc: "Content with a right-side filter panel", template: rightPanel(filterPanel) },
  { id: "right-panel-activity", icon: "R-A", name: "Right panel - Activity", group: "Right Panel", desc: "Content with a right-side activity feed", template: rightPanel(activityFeed) },
  { id: "full-shell-basic", icon: "F-B", name: "Full shell - Basic nav", group: "Full Shell", desc: "Basic nav + simple left panel + activity right panel", template: fullShell(topNav(), sideNav(), activityFeed) },
  { id: "full-shell-search", icon: "F-S", name: "Full shell - Search nav", group: "Full Shell", desc: "Search nav + grouped left panel + filters right panel", template: fullShell(topNav([{ type: "search" }]), groupedSideNav, filterPanel) },
  { id: "full-shell-cta", icon: "F-C", name: "Full shell - CTA nav", group: "Full Shell", desc: "CTA nav + workspace left panel + activity right panel", template: fullShell(topNav([{ type: "button", label: "Get started" }]), workspaceSideNav, activityFeed) },
];

/** Display labels of the components a pattern instantiates (library subtitles). */
export function patternComponents(template: PatternTemplate): string[] {
  if (template.children) return template.children.flatMap(patternComponents);
  return (template.components ?? []).map((seed) => seed.label ?? COMPONENTS[seed.type]?.label ?? seed.type);
}
