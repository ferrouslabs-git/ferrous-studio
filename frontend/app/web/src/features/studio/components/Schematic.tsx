// Per-component rendering for the canvas. A component is drawn as the UI it
// stands for — a real nav bar, table, form or calendar — so a frame reads as
// a screen rather than a labelled schematic.
//
// A component renders its `elements` (typed children, pos order) branched by
// its `shape` and `layout`. Every string on screen is an EditableToken backed
// by an element label, element data or a scalar prop, so nothing is baked
// into the renderer: double-click to edit; committing an empty label removes
// pure-text elements (blankRemoves in the catalogue) while widget elements
// keep a blank label. With no `edit` handlers everything is read-only.
import { CSSProperties, Fragment, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, useEffect, useRef, useState } from "react";
import type { Dataset } from "../../project/datasets/datasetsApi";
import { EL_FILL_OPTIONS, EL_SHAPE_OPTIONS, elementMeta, fontStack, NavAlign, navAlign } from "../catalog";
import { CustomDef, elKey } from "../model/actions";
import { byPos } from "../model/positions";
import { getDefaultProps } from "../model/regions";
import { ComponentNode, ElementNode, LinkTarget } from "../model/types";
import { CustomSchematic } from "./CustomSchematic";
import { navIconGlyph } from "./icons";
import { EditableToken } from "./InlineEdit";
import { ElementSel, sameElement } from "./selection";

export interface SchematicEdit {
  setPropValue(key: string, text: string): void;
  /** Rename an element; an empty commit removes it (and its link). */
  setElementLabel(id: string, text: string): void;
  setElementData(id: string, key: string, value: string): void;
  addElement(type: string): void;
  removeElement(id: string): void;
  addRow(): void;
  setListCell(row: number, columnId: string, text: string): void;
  /** Canvas free placement; one call per completed drag. A multi-selection
   *  drag moves several elements, so this takes them as one batch — one
   *  history step, one undo. */
  moveElementsTo(moves: readonly { id: string; x: number; y: number }[]): void;
  /** Canvas free sizing (corner drag); one call per completed drag. */
  resizeElementTo(id: string, w: number, h: number): void;
  /** Drag-and-drop reorder within this component. */
  reorderElement(srcId: string, targetId: string, before: boolean): void;
}

/** Canvas-supplied element behaviour: selection, link lookup and follow.
 *  Scoped to one component (the ElementSels never carry another cmpId). */
export interface SchematicChrome {
  selected: ElementSel | null;
  editing: ElementSel | null;
  linkOf(key: string, index: number | null): LinkTarget | null;
  /** The open page and its ancestor shells; a nav item linking to one of
   *  these renders as the current tab. */
  activePageIds?: readonly string[];
  /** Element ids carrying notes / open tasks: the tokens and boxes of these
   *  draw a small marker dot. Absent (the preview) draws none. */
  noteEls?: ReadonlySet<string>;
  taskEls?: ReadonlySet<string>;
  /** The annotation target hovered in the panel: that element's dot and box
   *  are emphasised so the row and its marker read as one thing. */
  hotEl?: { id: string; kind: "note" | "task" | "both" } | null;
  /** Hover reporting the other way: a marked element under the pointer. The
   *  marker dot is far too small to be a hover target of its own, so the
   *  WHOLE element is the hover surface. */
  onMarkHover?: (mark: { id: string; kind: "note" | "task" | "both" } | null) => void;
  /** Preview mode: linked elements follow on a single click, the way the
   *  real system would, instead of the editor's double click. */
  followOnClick?: boolean;
  onSelectElement?: (key: string, index: number | null) => void;
  onFollow(target: LinkTarget): void;
  onEditEnd?: () => void;
}

interface Props {
  cmp: ComponentNode;
  defs: readonly CustomDef[];
  /** Bindable datasets (platform defaults + the project's own): an element
   *  whose `data.dataset` names one renders that list instead of its manual
   *  samples/options. An unknown id falls back to the manual values. */
  datasets?: readonly Dataset[];
  edit?: SchematicEdit;
  chrome?: SchematicChrome;
}

/** Every inline-editable token carries `ui-edit`; the canvas uses this to keep
 *  drags and structural double-clicks away from editable text. */
export const EDIT_TOKEN_SELECTOR = ".ui-edit, .inline-edit-input";

/** null/undefined = "still the sample"; "" = the user blanked it. */
type Val = string | null | undefined;

const isStatus = (v: string) => /^(active|inactive|pending|invited|disabled|enabled|archived)$/i.test(v.trim());
const statusTone = (v: string) => {
  const s = v.trim().toLowerCase();
  return s === "active" || s === "enabled" ? " good" : s === "pending" || s === "invited" ? " warn" : "";
};

/** Per-kind sample pools for representative data the user hasn't filled in. */
const SAMPLES: Record<string, string[]> = {
  text: ["Sample value", "Another value", "Third value", "Fourth value"],
  person: ["Ada Lovelace", "Linus Torvalds", "Grace Hopper", "Margaret Hamilton"],
  email: ["ada@acme.io", "linus@acme.io", "grace@acme.io", "margaret@acme.io"],
  status: ["Active", "Active", "Inactive", "Pending"],
  date: ["4 Mar 2025", "12 Jan 2024", "22 Aug 2023", "9 Feb 2026"],
  time: ["2 min ago", "1 hr ago", "Yesterday", "Last week"],
  number: ["42", "318", "1,204", "87"],
  currency: ["£84.30", "£1,240", "£310", "£12.99"],
  percentage: ["4.2%", "61%", "12.8%", "97%"],
  phone: ["+44 20 7946 0000", "+44 161 496 0000", "+44 131 496 0000"],
  tags: ["Design · Beta", "Ops", "Sales · EU", "Research"],
  boolean: ["Yes", "No", "Yes", "No"],
  url: ["acme.io/overview", "acme.io/pricing", "acme.io/docs"],
  image: ["—", "—", "—"],
  actions: ["", "", ""],
};
const sampleFor = (kind: string | undefined, i: number): string => {
  const pool = SAMPLES[kind ?? "text"] ?? SAMPLES.text;
  return pool[i % pool.length];
};
const CHART_VALUES = [42, 58, 35, 71, 49, 66, 83, 57, 72, 90, 63, 78];
const INITIALS = ["AL", "GH", "LT", "MH", "KJ"];
// Chart series read as structure, not palette: a graphite ramp, matching the
// canvas's own monochrome document language (see the wireframe palette note in
// studio.css). Ordered light-to-dark-blind: adjacent steps stay distinguishable
// side by side in a pie, and the ramp still separates when printed greyscale.
const PIE_COLOURS = ["#3D4650", "#7A8593", "#5B6673", "#99A3AE", "#2C333B", "#B4BCC5", "#C9CFD6"];

const splitList = (v: string | undefined): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const numberOf = (v: string, fallback: number) => {
  const n = parseFloat(v.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

const Chevron = () => <span className="ui-chevron" aria-hidden />;
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" />
  </svg>
);
const ImageIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="3" width="12" height="10" rx="1" />
    <circle cx="5.5" cy="6.5" r="1" />
    <path d="M2 11l3.5-3 3 2.5L11 8l3 3" />
  </svg>
);
const CheckIcon = () => (
  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 8.5 6.5 12 13 4.5" />
  </svg>
);

/** The built-in brand marks (names exported as LOGO_ICONS in the catalogue). */
const logoSvg = (children: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
const BRAND_MARKS: Record<string, ReactNode> = {
  bolt: logoSvg(<path d="M9 1.5 3.5 9H8l-1 5.5L12.5 7H8l1-5.5Z" />),
  spark: logoSvg(<path d="M8 1.5v13M1.5 8h13M3.5 3.5l9 9M12.5 3.5l-9 9" />),
  leaf: logoSvg(<path d="M13 3C6 3 3 6.5 3 13c6.5 0 10-3 10-10ZM3 13C6 9.5 9 7.5 13 3" />),
  cube: logoSvg(<path d="M8 1.5 14 5v6l-6 3.5L2 11V5l6-3.5ZM2 5l6 3.5L14 5M8 8.5v6" />),
  ring: logoSvg(<circle cx="8" cy="8" r="5.5" />),
  wave: logoSvg(<path d="M1.5 10c2-4 4-4 6 0s4 4 6 0" />),
  peak: logoSvg(<path d="M1.5 13 6 4.5 9 10l2-3.5 3.5 6.5H1.5Z" />),
  heart: logoSvg(<path d="M8 13.5C4 10.5 2 8.5 2 6a3 3 0 0 1 6-.5A3 3 0 0 1 14 6c0 2.5-2 4.5-6 7.5Z" />),
};

export function Schematic({ cmp, defs, datasets = [], edit, chrome }: Props) {
  const d = getDefaultProps(cmp.type);
  const els = byPos(cmp.elements ?? []);
  const byType = (...types: string[]) => els.filter((e) => types.includes(e.type));
  const first = (type: string): ElementNode | undefined => els.find((e) => e.type === type);
  const shape = cmp.shape ?? "";
  const layout = cmp.layout ?? "";
  const title = cmp.label || cmp.type;
  // The header element titles the component (list/form/graph/calendar).
  // "inline" renders it inside the component's chrome row; "above" pulls it
  // onto its own line over the component (see the wrap around the switch).
  const headerEl = first("header");
  const headerInline = headerEl && headerEl.data?.placement !== "above" ? headerEl : null;
  /** Element hovered as the target of a same-component reorder drag. */
  const [dropEl, setDropEl] = useState<string | null>(null);
  /** Live x/y override while a canvas child drag is in flight. */
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }>>({});
  /** Canvas multi-selection (Ctrl/⌘+click): element ids that drag as one
   *  group. Empty for a plain single selection; when populated it always
   *  contains the element `chrome.selected` points at, so the sync effect
   *  below clears it the moment selection moves elsewhere. */
  const [multi, setMulti] = useState<readonly string[]>([]);
  /** Swallows the click a completed canvas drag ends with, so releasing a
   *  drag never reselects or toggles the group. */
  const suppressClick = useRef(false);
  /** Live w/h override while a canvas child corner-resize is in flight. */
  const [dragSize, setDragSize] = useState<Record<string, { w: number; h: number }>>({});
  /** Live height override while the canvas resize handle is being dragged. */
  const [liveHeight, setLiveHeight] = useState<number | null>(null);
  /** Dropdown whose option menu is expanded (chevron click), like a real
   *  select. One per component; closes on outside pointerdown. */
  const [openSelect, setOpenSelect] = useState<string | null>(null);
  /** Ephemeral picks made by viewers (no edit handlers): the menu still works
   *  and the face updates, it just isn't persisted. */
  const [chosen, setChosen] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!openSelect) return;
    const close = (e: Event) => {
      if (!(e.target as HTMLElement | null)?.closest?.("[data-select-ui]")) setOpenSelect(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [openSelect]);

  // The group follows the single selection: once that leaves the group (a
  // click elsewhere, another component, a deselect), the group is stale.
  const selectedElKey = chrome?.selected?.key ?? null;
  useEffect(() => {
    if (multi.length && (!selectedElKey || !multi.some((id) => elKey(id) === selectedElKey))) setMulti([]);
  }, [multi, selectedElKey]);

  const scalarOf = (key: string): string | undefined => {
    const v = cmp.props?.[key];
    return v == null ? undefined : String(v);
  };
  const str = (key: string, fallback: string) => String(d[key] ?? fallback);

  // ── Tokens ───────────────────────────────────────────────────────────────
  /** One editable token. A blanked value shows a hover-only "…" so it can be
   *  recovered; viewers see nothing at all. Tokens with an `el` identity are
   *  elements: selectable with one click and linkable to a page. */
  const tok = (
    className: string,
    value: Val,
    sample: string,
    commit?: (t: string) => void,
    children?: ReactNode,
    el?: { key: string; index: number | null },
    /** A secondary token of an element (a data slot): it selects and rings
     *  with the element, but only the primary (label) token answers an
     *  external edit request — otherwise Enter would open several editors. */
    secondary = false,
    style?: CSSProperties,
    drag?: Record<string, unknown>,
  ) => {
    const blank = value === "";
    if (blank && !edit) return null;
    const link = el && chrome ? chrome.linkOf(el.key, el.index) : null;
    const element =
      el && chrome
        ? {
            selected: sameElement(chrome.selected, el),
            linked: !!link,
            editing: !secondary && sameElement(chrome.editing, el),
            followOnClick: chrome.followOnClick,
            onSelect: chrome.onSelectElement ? () => chrome.onSelectElement!(el.key, el.index) : undefined,
            onFollow: link ? () => chrome.onFollow(link) : undefined,
            onEditEnd: chrome.onEditEnd,
          }
        : undefined;
    return (
      <EditableToken
        className={`ui-edit${blank ? " blank" : ""} ${className}`.trim()}
        style={style}
        value={value ?? sample}
        onCommit={edit && commit ? commit : undefined}
        element={element}
        drag={drag}
      >
        {blank ? "…" : children}
      </EditableToken>
    );
  };
  /** User-set styling (font size, background, font, capitalisation) as an
   *  inline style — inline so it beats the widget classes' own rules. */
  const fsStyle = (el: ElementNode): CSSProperties | undefined => {
    const base = styleData(el.data) as Record<string, unknown> | undefined;
    const v = parseFloat(el.data?.fontSize ?? "");
    const fs = Number.isFinite(v) && v > 0 ? { fontSize: v } : undefined;
    return base || fs ? ({ ...base, ...fs } as CSSProperties) : undefined;
  };
  /** Corner-shape / fill classes (data.shape, data.fill) for the token or
   *  el-box; values are checked against the catalog's option lists so stray
   *  document data cannot mint arbitrary class names. An unset fill falls
   *  back to the type's `defaultFill` (input-like widgets read outline). */
  const variantCls = (el: ElementNode): string => {
    const shape = el.data?.shape;
    const raw = el.data?.fill;
    const fill =
      raw && (EL_FILL_OPTIONS as readonly string[]).includes(raw)
        ? raw
        : elementMeta(cmp.type, el.type)?.defaultFill;
    return (
      (shape && (EL_SHAPE_OPTIONS as readonly string[]).includes(shape) ? ` el-shape-${shape}` : "") +
      (fill ? ` el-fill-${fill}` : "")
    );
  };
  /** Marker classes for an element carrying notes / open tasks; the dot
   *  itself is drawn in CSS so tokens keep their layout. A panel row being
   *  hovered adds the emphasis class for its target. */
  const markCls = (el: ElementNode): string =>
    (chrome?.noteEls?.has(el.id) ? " has-note" : "") +
    (chrome?.taskEls?.has(el.id) ? " has-task" : "") +
    (chrome?.hotEl && chrome.hotEl.id === el.id ? ` mark-hot-${chrome.hotEl.kind}` : "");
  /** Hover handlers for a marked element: the whole token/box reports as its
   *  marker (the dot itself is too small to hover). Spread alongside the
   *  drag handlers. */
  const markHoverProps = (el: ElementNode): Record<string, unknown> => {
    if (!chrome?.onMarkHover) return {};
    const hasNote = !!chrome.noteEls?.has(el.id);
    const hasTask = !!chrome.taskEls?.has(el.id);
    if (!hasNote && !hasTask) return {};
    const kind = hasNote && hasTask ? "both" : hasTask ? "task" : "note";
    return {
      onMouseEnter: () => chrome.onMarkHover!({ id: el.id, kind }),
      onMouseLeave: () => chrome.onMarkHover!(null),
    };
  };
  /** An element's label; an empty commit removes pure-text elements only
   *  (blankRemoves). Draggable to reorder within the component (elDrag). */
  const elTok = (el: ElementNode, className: string, children?: ReactNode) =>
    tok(`${className}${variantCls(el)}${markCls(el)}${dropCls(el)}`, el.label, "", (t) => edit?.setElementLabel(el.id, t), children, { key: elKey(el.id), index: null }, false, fsStyle(el), { ...elDrag(el), ...markHoverProps(el) });
  /** One slot of an element's representative data; blanking restores the
   *  sample. Carries the element's identity so a click selects it. */
  const dataTok = (el: ElementNode, key: string, sample: string, className = "") =>
    tok(className, el.data?.[key], sample, (t) => edit?.setElementData(el.id, key, t), undefined, { key: elKey(el.id), index: null }, true, fsStyle(el));
  /** A field's label row. A blanked label removes the row outright — no "…"
   *  recovery token, since the Inspector's Text field restores it. */
  const fieldLabel = (el: ElementNode): ReactNode =>
    el.label === "" ? null : <label className="ui-label">{elTok(el, "")}</label>;

  // ── Whole-widget selection ────────────────────────────────────────────────
  const isSelected = (el: ElementNode): boolean =>
    chrome ? sameElement(chrome.selected, { key: elKey(el.id), index: null }) : false;
  const selectClick = (el: ElementNode) =>
    chrome?.onSelectElement
      ? (e: { stopPropagation(): void }) => {
          e.stopPropagation();
          chrome.onSelectElement!(elKey(el.id), null);
        }
      : undefined;

  // ── Drag-and-drop reorder within this component ───────────────────────────
  // The MIME type NAME carries the component id (dragover can read types but
  // not data), so only this component's own widgets light up as targets.
  // Canvas children are excluded: they move freely by pointer instead.
  const reorderMime = `application/x-vsub-elmove--${cmp.id}`;
  const dropBefore = (e: { clientX: number; clientY: number }, r: DOMRect): boolean => {
    // Split on whichever axis the pointer is furthest from the centre, so the
    // gesture reads correctly in rows, stacks and grids alike.
    const dx = (e.clientX - (r.left + r.width / 2)) / Math.max(1, r.width);
    const dy = (e.clientY - (r.top + r.height / 2)) / Math.max(1, r.height);
    return Math.abs(dx) > Math.abs(dy) ? dx < 0 : dy < 0;
  };
  const elDrag = (el: ElementNode): Record<string, unknown> => {
    if (!edit || cmp.type === "canvas") return {};
    return {
      draggable: true,
      onDragStart: (e: DragEvent & { dataTransfer: DataTransfer; stopPropagation(): void }) => {
        e.stopPropagation();
        e.dataTransfer.setData(reorderMime, el.id);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (e: DragEvent & { dataTransfer: DataTransfer; currentTarget: HTMLElement }) => {
        if (!e.dataTransfer.types.includes(reorderMime)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setDropEl((d) => (d === el.id ? d : el.id));
      },
      onDragLeave: () => setDropEl((d) => (d === el.id ? null : d)),
      onDrop: (e: DragEvent & { dataTransfer: DataTransfer; currentTarget: HTMLElement }) => {
        const src = e.dataTransfer.getData(reorderMime);
        setDropEl(null);
        if (!src) return;
        e.preventDefault();
        e.stopPropagation();
        if (src !== el.id) edit.reorderElement(src, el.id, dropBefore(e, e.currentTarget.getBoundingClientRect()));
      },
      onDragEnd: () => setDropEl(null),
    };
  };
  const dropCls = (el: ElementNode): string => (dropEl === el.id ? " el-drop" : "");
  /** A scalar prop (heading, copyright, period…) — selectable like any
   *  element, addressed by its prop key. */
  const text = (key: string, fallback: string, className = "") =>
    tok(className, scalarOf(key), fallback, (t) => edit?.setPropValue(key, t), undefined, { key, index: null });

  /** Wrap a whole widget (label + input, a pager, a legend…) so clicking
   *  anywhere inside it selects its element — not just its text tokens. The
   *  selection ring sits on the box; the tokens' own rings are suppressed in
   *  CSS. Every visible part of a component goes through this (or a token),
   *  so nothing on screen is out of reach of the Inspector or Delete. */
  const elBox = (el: ElementNode, className: string, children: ReactNode) => {
    // Preview: a linked widget (a whole button box, a search field…) is a
    // navigation target in its own right, not just its text token.
    const followLink = chrome?.followOnClick ? chrome.linkOf(elKey(el.id), null) : null;
    return (
      <div
        key={el.id}
        className={`el-box ${className}${variantCls(el)}${markCls(el)}${isSelected(el) ? " el-sel" : ""}${followLink ? " el-follow" : ""}${dropCls(el)}`.trim()}
        style={fsStyle(el)}
        onClick={
          followLink
            ? (e) => {
                e.stopPropagation();
                chrome!.onFollow(followLink);
              }
            : selectClick(el)
        }
        {...elDrag(el)}
        {...markHoverProps(el)}
      >
        {children}
      </div>
    );
  };

  /** A "+" affordance: invisible until the component (or an element in it) is selected; absent for viewers. */
  const add = (onClick: (e: SchematicEdit) => void, label: string, glyph = "+", className = "") =>
    edit ? (
      <button
        type="button"
        className={`ui-add ${className}`.trim()}
        title={label}
        aria-label={label}
        onClick={(ev) => {
          ev.stopPropagation();
          onClick(edit);
        }}
      >
        {glyph}
      </button>
    ) : null;
  const addEl = (type: string, label: string, glyph = "+", className = "") =>
    add((e) => e.addElement(type), label, glyph, className);
  /** A component's add affordances as overlay chrome floating over its
   *  bottom-right corner — or, for short bar components (bar = true), hanging
   *  just below its left edge — never in the flow, so they cannot displace
   *  the component's own elements. */
  const addCluster = (adds: ReactNode, bar = false) =>
    edit ? <div className={`ui-add-cluster${bar ? " bar" : ""}`}>{adds}</div> : null;

  const btnClass = (el: ElementNode, size = "") => {
    const style = el.data?.style;
    return `ui-btn${size ? ` ${size}` : ""}${style === "primary" ? " primary" : style === "danger" ? " danger" : ""}`;
  };
  /** The brand's logo: a built-in mark, an uploaded image, the default
   *  gradient square, or — when the user chose "none" — nothing at all. */
  const brandMark = (el: ElementNode): ReactNode => {
    const logo = el.data?.logo ?? "";
    if (logo === "none") return null;
    if (logo.startsWith("data:")) return <img className="ui-brand-img" src={logo} alt="" />;
    if (BRAND_MARKS[logo]) return <span className="ui-brand-mark" aria-hidden>{BRAND_MARKS[logo]}</span>;
    return <span className="ui-brand-default" aria-hidden />;
  };
  const brandTok = (el: ElementNode) => elTok(el, "ui-brand", <>{brandMark(el)}{el.label}</>);

  /** A nav item's icon (Icons shape): a built-in mark, an uploaded image, or
   *  — until one is picked in the Inspector — the placeholder square. */
  const navIconMark = (el: ElementNode): ReactNode => {
    const icon = el.data?.icon ?? "";
    if (icon.startsWith("data:")) return <img className="ui-icon img" src={icon} alt="" />;
    const mark = navIconGlyph(icon);
    return mark ? <span className="ui-icon mark" aria-hidden>{mark}</span> : <span className="ui-icon" aria-hidden />;
  };

  const searchBox = (el: ElementNode, className = "") =>
    elBox(
      el,
      `ui-input search ${className}`.trim(),
      <>
        <SearchIcon />
        {elTok(el, "ui-placeholder")}
      </>,
    );

  // ── Datasets and dropdown behaviour ──────────────────────────────────────

  /** The dataset an element bound via `data.dataset`, if it still exists. */
  const datasetOf = (el: ElementNode): Dataset | null => {
    const id = el.data?.dataset;
    return id ? datasets.find((ds) => ds.id === id) ?? null : null;
  };
  /** What a dropdown's menu lists: the bound dataset's values, else its
   *  manual options. */
  const dropdownOptions = (el: ElementNode): string[] => {
    const ds = datasetOf(el);
    return ds?.values.length ? ds.values : splitList(el.data?.options);
  };
  /** A dropdown's current value: what was picked from its expanded menu —
   *  persisted as `data.selected` in the editor, ephemeral for viewers. It
   *  reads as unselected ("Select…") until then. */
  const selectedValue = (el: ElementNode): string | null => chosen[el.id] ?? el.data?.selected ?? null;
  const pickOption = (el: ElementNode, value: string) => {
    if (edit) edit.setElementData(el.id, "selected", value);
    else setChosen((c) => ({ ...c, [el.id]: value }));
    setOpenSelect(null);
  };
  /** The chevron as a real affordance: clicking it expands the menu, in the
   *  editor and for viewers alike. */
  const selectToggle = (el: ElementNode) => (
    <button
      type="button"
      className="ui-select-toggle"
      data-select-ui
      aria-label="Toggle options"
      aria-expanded={openSelect === el.id}
      onClick={(e: ReactMouseEvent) => {
        e.stopPropagation();
        setOpenSelect((cur) => (cur === el.id ? null : el.id));
      }}
    >
      <Chevron />
    </button>
  );
  const selectMenu = (el: ElementNode): ReactNode => {
    const options = dropdownOptions(el);
    const current = selectedValue(el);
    return (
      <div className="ui-select-menu" role="listbox" data-select-ui>
        {options.length === 0 ? (
          <span className="ui-select-option none">No options</span>
        ) : (
          options.map((opt, i) => (
            <button
              type="button"
              key={i}
              role="option"
              aria-selected={opt === current}
              className={`ui-select-option${opt === current ? " on" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                pickOption(el, opt);
              }}
            >
              {opt}
            </button>
          ))
        )}
      </div>
    );
  };

  /** A list's filter chip. Given values — a bound dataset, or options typed by
   *  hand — it behaves as a real dropdown, showing the chosen value beside its
   *  field name; with none it stays the plain label chip it has always been, so
   *  no existing wireframe changes appearance. `ui-filter` rather than
   *  `ui-chip` because the chip's static ::after chevron would collide with the
   *  interactive toggle (and with the annotation marker's own ::after). */
  const filterChip = (el: ElementNode): ReactNode => {
    const options = dropdownOptions(el);
    if (options.length === 0) return elTok(el, "ui-chip");
    return elBox(
      el,
      `ui-filter${openSelect === el.id ? " open" : ""}`,
      <>
        {elTok(el, "ui-filter-label")}
        <span className="ui-value">{selectedValue(el) ?? options[0]}</span>
        {selectToggle(el)}
        {openSelect === el.id && selectMenu(el)}
      </>,
    );
  };

  // ── Shared field/widget rendering (form, canvas, kept components) ─────────

  const inputPlaceholder = (el: ElementNode): string => {
    if (el.data?.placeholder) return el.data.placeholder;
    const n = el.label.trim().toLowerCase();
    switch (el.type === "text-input" ? el.data?.kind ?? "text" : el.type) {
      case "email": return "name@company.com";
      case "number": return "0";
      case "password": return "••••••••";
      case "phone": return "+44 20 7946 0000";
      case "url": return "https://";
      case "select": return `Select ${n}…`;
      case "text-area": return `Add ${n}…`;
      case "file-upload": return "Drop a file here or browse";
      case "date-picker": return "Select date…";
      default: return `Enter ${n}`;
    }
  };

  /** Label + input body for a form-ish element. */
  const fieldWidget = (el: ElementNode): ReactNode => {
    const body = (cls: string, content?: ReactNode) => (
      <div className={`ui-input ${cls}`.trim()}>{content ?? <span className="ui-placeholder">{inputPlaceholder(el)}</span>}</div>
    );
    switch (el.type) {
      case "text-input": return body(el.data?.kind ?? "text");
      case "text-area": return body("tall");
      case "date-picker": return body("date");
      case "file-upload": return body("file");
      case "select": {
        const value = selectedValue(el);
        return body(
          `select${openSelect === el.id ? " open" : ""}`,
          <>
            {value ? <span className="ui-value">{value}</span> : <span className="ui-placeholder">{inputPlaceholder(el)}</span>}
            {selectToggle(el)}
            {openSelect === el.id && selectMenu(el)}
          </>,
        );
      }
      case "radio-group": {
        const options = splitList(el.data?.options);
        return (
          <div className="ui-choice-list">
            {(options.length ? options : ["Option A", "Option B"]).map((opt, i) => (
              <span key={i} className={`ui-choice${i === 0 ? " on" : ""}`}><i className="ui-radio" aria-hidden />{opt}</span>
            ))}
          </div>
        );
      }
      case "checkbox": return <span className="ui-choice on"><i className="ui-checkbox" aria-hidden><CheckIcon /></i>{elTok(el, "")}</span>;
      case "toggle": return <span className="ui-choice"><i className="ui-toggle on" aria-hidden />{elTok(el, "")}</span>;
      default: return null;
    }
  };

  const wideField = (el: ElementNode) => el.type === "text-area" || el.type === "file-upload";

  /** One element as a standalone widget (canvas children, hero, modal…). */
  const widget = (el: ElementNode, context: "flow" | "canvas" = "flow"): ReactNode => {
    switch (el.type) {
      case "heading": return <div className="ui-h2">{elTok(el, "")}</div>;
      case "text": return <p className="ui-p">{elTok(el, "")}</p>;
      case "label": return elTok(el, "ui-label");
      case "badge": return elTok(el, `ui-badge${statusTone(el.label)}`);
      case "button": return elTok(el, btnClass(el));
      case "link": return elTok(el, "ui-link");
      case "help-text": return <p className="ui-p ui-help">{elTok(el, "")}</p>;
      case "section-heading": return <div className="ui-h3">{elTok(el, "")}</div>;
      case "step": return elTok(el, "ui-chip");
      case "search": return searchBox(el, context === "canvas" ? "" : "sm");
      case "filter": return filterChip(el);
      case "row-action": return elTok(el, "ui-btn sm");
      case "image":
        // With an uploaded picture the placeholder chrome (dashed outline,
        // icon, caption) disappears — just the image shows.
        return el.data?.src
          ? elBox(el, "ui-image", <img src={el.data.src} alt={el.label} draggable={false} />)
          : elBox(
              el,
              "ui-image-ph",
              <>
                <ImageIcon />
                {elTok(el, "ui-image-cap")}
              </>,
            );
      case "box": return elBox(el, "ui-box", elTok(el, "ui-box-cap"));
      case "divider": return elBox(el, "divider-box", <hr className="ui-divider" />);
      case "checkbox":
      case "toggle":
      case "radio-group":
        return elBox(
          el,
          "ui-field",
          <>
            {el.type === "radio-group" && fieldLabel(el)}
            {fieldWidget(el)}
          </>,
        );
      case "text-input":
      case "text-area":
      case "select":
      case "date-picker":
      case "file-upload":
        return elBox(
          el,
          "ui-field",
          <>
            {fieldLabel(el)}
            {fieldWidget(el)}
          </>,
        );
      case "column":
        return elBox(
          el,
          "ui-field",
          <>
            <label className="ui-label">{elTok(el, "")}</label>
            <span className="ui-chip sm">{el.data?.kind ?? "text"}</span>
          </>,
        );
      case "pagination": return pagination(el);
      case "column-header": return <div className="ui-box sm">{edit ? "Column header" : null}</div>;
      case "select-column": return <span className="ui-choice"><i className="ui-checkbox" aria-hidden /></span>;
      default: return elTok(el, "ui-chip");
    }
  };

  const pagination = (el: ElementNode) =>
    elBox(
      el,
      "ui-pager",
      <>
        <span className="ui-pager-btn" aria-hidden>‹</span>
        <span className="ui-pager-btn on">1</span>
        <span className="ui-pager-btn">2</span>
        <span className="ui-pager-btn">3</span>
        <span className="ui-pager-btn" aria-hidden>›</span>
        {dataTok(el, "pageSize", "10", "ui-pager-size")} <span className="ui-pager-label">/ page</span>
      </>,
    );

  // ── Nav bar ───────────────────────────────────────────────────────────────

  const renderNavbar = (): ReactNode => {
    const brandEl = first("brand");
    const searchEl = first("search");
    const avatarEl = first("avatar");
    const workspaceEl = first("workspace-switcher");
    const buttons = byType("button");
    const selects = byType("select");
    const flow = els.filter((e) => e.type === "nav-item" || e.type === "group-heading" || e.type === "divider");

    /** A dropdown in the bar. No label text: it reads "Select" until an
     *  option is picked from its expanded menu (chevron click). */
    const navSelect = (el: ElementNode, vert = false) => {
      const value = selectedValue(el);
      return elBox(
        el,
        `ui-nav-select${vert ? " vert" : ""}${openSelect === el.id ? " open" : ""}`,
        <>
          {value ? <span className="ui-nav-value">{value}</span> : <span className="ui-nav-placeholder">Select</span>}
          {selectToggle(el)}
          {openSelect === el.id && selectMenu(el)}
        </>,
      );
    };

    // The item drawn as current: the one whose link target is the open page
    // (or one of its ancestor shells). With no such link, the first item
    // stays active as representative styling, as before.
    const navItems = flow.filter((e) => e.type === "nav-item");
    const activeNav =
      navItems.find((e) => {
        const link = chrome?.linkOf(elKey(e.id), null);
        return !!link && !!chrome?.activePageIds?.includes(link.pageId);
      }) ?? navItems[0];

    if (layout === "vertical") {
      // Side rail: group headings start sections; chrome sits top and bottom.
      // The shape applies here just as it does horizontally: plain labels,
      // tabs (left indicator), icon items, or a stacked crumb trail.
      const railItem = (el: ElementNode): ReactNode => {
        const active = activeNav === el;
        if (shape === "tabs") return elTok(el, `ui-tab vert${active ? " active" : ""}`);
        if (shape === "breadcrumb") return elTok(el, `ui-crumb vert${navItems[navItems.length - 1] === el ? " current" : ""}`);
        return elTok(
          el,
          `ui-side-item${active ? " active" : ""}`,
          <>
            {shape === "icons" && navIconMark(el)}
            <span className="ui-side-label">{el.label}</span>
          </>,
        );
      };
      const sections: ReactNode[][] = [[]];
      for (const el of flow) {
        if (el.type === "group-heading" && sections[sections.length - 1].length) sections.push([]);
        if (el.type === "group-heading") {
          sections[sections.length - 1].push(<div key={el.id} className="ui-side-title">{elTok(el, "")}</div>);
        } else if (el.type === "divider") {
          sections[sections.length - 1].push(elBox(el, "divider-box", <hr className="ui-divider" />));
        } else {
          sections[sections.length - 1].push(<Fragment key={el.id}>{railItem(el)}</Fragment>);
        }
      }
      return (
        <aside className="ui-sidenav">
          {workspaceEl &&
            elBox(
              workspaceEl,
              "ui-workspace",
              <>
                <span className="ui-avatar sq sm" aria-hidden>{workspaceEl.label.slice(0, 1).toUpperCase()}</span>
                {elTok(workspaceEl, "ui-workspace-name")}
                <Chevron />
              </>,
            )}
          {brandEl && <div className="ui-side-section">{brandTok(brandEl)}</div>}
          {searchEl && <div className="ui-side-section">{searchBox(searchEl)}</div>}
          {selects.length > 0 && <div className="ui-side-section">{selects.map((s) => navSelect(s, true))}</div>}
          {sections.map((section, i) => (
            <div key={i} className="ui-side-section">
              {section}
            </div>
          ))}
          {buttons.length > 0 && <div className="ui-side-section"><div className="ui-row">{buttons.map((b) => <Fragment key={b.id}>{elTok(b, btnClass(b, "sm"))}</Fragment>)}</div></div>}
          {avatarEl && (
            <div className="ui-side-section foot">
              {elBox(
                avatarEl,
                "ui-side-user",
                <>
                  {elTok(avatarEl, "ui-avatar sm")}
                  <div className="ui-side-user-text">
                    <div className="ui-side-user-name">{dataTok(avatarEl, "name", "Ada Lovelace")}</div>
                    <div className="ui-side-user-role">{dataTok(avatarEl, "role", "Administrator")}</div>
                  </div>
                </>,
              )}
            </div>
          )}
          {addCluster(addEl("nav-item", "Add navigation item", "+ Item", "text"))}
        </aside>
      );
    }

    // ── Horizontal: three zones (left / centre / right), each in pos order ──
    // An element's zone is its data.align, defaulting by type (navAlign), so
    // dragging and the Inspector's Alignment control genuinely rearrange the
    // bar rather than fighting a fixed brand → items → chrome order.
    const flowTypes = new Set(["nav-item", "group-heading", "divider"]);
    const crumbCurrent = flow[flow.length - 1];

    const navItem = (el: ElementNode, sepBefore: boolean) => {
      if (el.type === "divider") return elBox(el, "divider-box", <span className="ui-nav-divider" aria-hidden />);
      if (el.type === "group-heading") return <Fragment key={el.id}>{elTok(el, "ui-side-title inline")}</Fragment>;
      const cls =
        shape === "tabs" ? `ui-tab${activeNav === el ? " active" : ""}` :
        shape === "breadcrumb" ? `ui-crumb${el === crumbCurrent ? " current" : ""}` :
        `ui-nav-link${activeNav === el ? " active" : ""}`;
      return (
        <Fragment key={el.id}>
          {shape === "breadcrumb" && sepBefore && <span className="ui-crumb-sep" aria-hidden>/</span>}
          {elTok(el, cls, shape === "icons" ? <>{navIconMark(el)}{el.label}</> : undefined)}
        </Fragment>
      );
    };

    /** A run of consecutive nav items keeps its shape container (link row,
     *  tab strip, crumb trail). */
    const itemRun = (run: ElementNode[], key: string) => {
      const items = run.map((el, i) => navItem(el, i > 0));
      if (shape === "breadcrumb") return <nav key={key} className="ui-crumbs" aria-label="Breadcrumb">{items}</nav>;
      if (shape === "tabs") return <div key={key} className="ui-tabs" role="tablist">{items}</div>;
      return <nav key={key} className="ui-nav-links" aria-label="Primary">{items}</nav>;
    };

    const piece = (el: ElementNode): ReactNode => {
      switch (el.type) {
        case "brand": return <Fragment key={el.id}>{brandTok(el)}</Fragment>;
        case "search": return <Fragment key={el.id}>{searchBox(el, "ui-nav-search")}</Fragment>;
        case "select": return <Fragment key={el.id}>{navSelect(el)}</Fragment>;
        case "avatar": return <Fragment key={el.id}>{elTok(el, "ui-avatar")}</Fragment>;
        case "workspace-switcher":
          return elBox(
            el,
            "ui-workspace bar",
            <>
              <span className="ui-avatar sq sm" aria-hidden>{el.label.slice(0, 1).toUpperCase()}</span>
              {elTok(el, "ui-workspace-name")}
              <Chevron />
            </>,
          );
        default: return <Fragment key={el.id}>{elTok(el, btnClass(el, "sm"))}</Fragment>;
      }
    };

    const zones: Record<NavAlign, ElementNode[]> = { left: [], centre: [], right: [] };
    for (const el of els) zones[navAlign(el)].push(el);

    const zoneBody = (list: ElementNode[]): ReactNode[] => {
      const out: ReactNode[] = [];
      let run: ElementNode[] = [];
      const flush = () => {
        if (!run.length) return;
        out.push(itemRun(run, `run-${run[0].id}`));
        run = [];
      };
      for (const el of list) {
        if (flowTypes.has(el.type)) run.push(el);
        else {
          flush();
          out.push(piece(el));
        }
      }
      flush();
      return out;
    };

    return (
      <header className={`ui-nav${shape === "tabs" || shape === "breadcrumb" ? " bare" : ""}`}>
        <div className="ui-nav-zone left">{zoneBody(zones.left)}</div>
        {zones.centre.length > 0 && <div className="ui-nav-zone centre">{zoneBody(zones.centre)}</div>}
        <div className="ui-nav-zone right">{zoneBody(zones.right)}</div>
        {addCluster(
          addEl(
            "nav-item",
            shape === "breadcrumb" ? "Add crumb" : shape === "tabs" ? "Add tab" : "Add link",
            shape === "breadcrumb" ? "+ Crumb" : shape === "tabs" ? "+ Tab" : "+ Link",
            "text",
          ),
          true,
        )}
      </header>
    );
  };

  // ── List ──────────────────────────────────────────────────────────────────

  const renderList = (): ReactNode => {
    const columns = byType("column");
    const headerEl = first("column-header");
    const selectEl = first("select-column");
    const rowActions = byType("row-action");
    const searchEl = first("search");
    const filters = byType("filter");
    const pagerEl = first("pagination");
    const rows: Record<string, string>[] = Array.isArray(cmp.props?.rows) ? (cmp.props.rows as Record<string, string>[]) : [{}, {}, {}];

    const cell = (col: ElementNode, ri: number, className?: string) => {
      const own = rows[ri]?.[col.id];
      // A bound dataset wins, then the column's own sample values, then the
      // per-kind pool, offset per column so twins differ.
      const ds = datasetOf(col);
      const samples = ds?.values.length ? ds.values : splitList(col.data?.samples);
      const sample = own != null ? "" : samples.length ? samples[ri % samples.length] : sampleFor(col.data?.kind, ri + hashOf(col.id));
      const value = own ?? null;
      const shown = own ?? sample;
      const kind = ds?.kind ?? col.data?.kind;
      const cls = className ?? (kind === "status" || isStatus(shown) ? `ui-badge${statusTone(shown)}` : "");
      // Cells carry their column's identity as secondary tokens: a click on
      // sample data selects the column (a headerless table still reaches the
      // Inspector), a double click edits the cell value as before.
      return tok(cls, value, sample, (t) => edit?.setListCell(ri, col.id, t), undefined, { key: elKey(col.id), index: null }, true, fsStyle(col));
    };
    const colOfKind = (...kinds: string[]) => columns.find((c) => kinds.includes(c.data?.kind ?? ""));

    const head = headerInline || filters.length > 0 || searchEl ? (
      <div className="ui-card-head">
        {headerInline && elTok(headerInline, "ui-card-title")}
        <div className="ui-row">
          {filters.map((f) => <Fragment key={f.id}>{filterChip(f)}</Fragment>)}
          {searchEl && searchBox(searchEl, "sm")}
        </div>
      </div>
    ) : null;
    const addBar = addCluster(
      <>
        {shape !== "feed" && addEl("column", "Add column", "+ Column", "text")}
        {add((e) => e.addRow(), shape === "feed" ? "Add event" : "Add row", "+ Row", "text")}
      </>,
    );
    const foot = pagerEl ? <div className="ui-card-foot">{pagination(pagerEl)}</div> : null;

    if (shape === "table" || columns.length === 0) {
      return (
        <div className="ui-card ui-table-card">
          {head}
          <div className="ui-table-scroll">
            <table className="ui-table">
              {headerEl && (
                <thead>
                  {/* Clicking the row background selects the header element
                      itself (so it can be removed); th tokens select columns.
                      Bespoke render path, so the row and the select cell carry
                      their own annotation marker classes (see markCls). */}
                  <tr
                    className={`${isSelected(headerEl) ? "el-sel-row" : ""}${markCls(headerEl)}`.trim() || undefined}
                    onClick={selectClick(headerEl)}
                    {...markHoverProps(headerEl)}
                  >
                    {selectEl && (
                      <th
                        className={`ui-td-select${isSelected(selectEl) ? " el-sel-cell" : ""}${markCls(selectEl)}`}
                        onClick={selectClick(selectEl)}
                        {...markHoverProps(selectEl)}
                      >
                        <i className="ui-checkbox" aria-hidden />
                      </th>
                    )}
                    {columns.map((col) => <th key={col.id} className={isSelected(col) ? "el-sel-cell" : undefined}>{elTok(col, "")}</th>)}
                    {rowActions.length > 0 && <th />}
                  </tr>
                </thead>
              )}
              <tbody>
                {rows.map((_, ri) => (
                  <tr key={ri}>
                    {selectEl && (
                      <td className={`ui-td-select${isSelected(selectEl) ? " el-sel-cell" : ""}`} onClick={selectClick(selectEl)}>
                        <i className="ui-checkbox" aria-hidden />
                      </td>
                    )}
                    {columns.map((col) => (
                      <td key={col.id} className={isSelected(col) ? "el-sel-cell" : undefined} onClick={selectClick(col)}>
                        {cell(col, ri)}
                      </td>
                    ))}
                    {rowActions.length > 0 && (
                      <td className="ui-td-actions">{rowActions.map((a) => <Fragment key={a.id}>{elTok(a, "ui-btn sm")}</Fragment>)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {foot}
          {addBar}
        </div>
      );
    }

    if (shape === "feed") {
      const personCol = colOfKind("person");
      const whenCol = colOfKind("time", "date");
      const textCols = columns.filter((c) => c !== personCol && c !== whenCol);
      return (
        <div className="ui-card">
          {head}
          <ul className="ui-feed">
            {rows.map((_, ri) => (
              <li key={ri}>
                <span className="ui-avatar sm">{initialsOf(personCol ? String(rows[ri]?.[personCol.id] ?? sampleFor("person", ri)) : INITIALS[ri % INITIALS.length])}</span>
                <div className="ui-feed-body">
                  <div className="ui-feed-text">{textCols[0] ? cell(textCols[0], ri, "") : null}</div>
                  <div className="ui-feed-time">{whenCol ? cell(whenCol, ri, "") : null}</div>
                </div>
                {rowActions.length > 0 && (
                  <div className="ui-row end ui-feed-actions">{rowActions.map((a) => <Fragment key={a.id}>{elTok(a, "ui-btn sm")}</Fragment>)}</div>
                )}
              </li>
            ))}
          </ul>
          {foot}
          {addBar}
        </div>
      );
    }

    const titleCol = columns[0];
    const statusCol = colOfKind("status");
    const rest = columns.filter((c) => c !== titleCol && c !== statusCol);

    if (shape === "cards") {
      return (
        <div className="ui-listwrap">
          {head}
          <div className={`ui-cards${layout === "horizontal" ? " scroll" : layout === "vertical" ? " one-col" : ""}`}>
            {rows.map((_, ri) => (
              <div key={ri} className="ui-card ui-card-item">
                <div className="ui-card-item-head">
                  <span className="ui-card-item-title">{titleCol ? cell(titleCol, ri, "") : null}</span>
                  {statusCol && cell(statusCol, ri)}
                </div>
                {rest.map((col) => (
                  <div key={col.id} className="ui-card-line">
                    <span className="ui-card-line-label">{elTok(col, "")}</span>
                    {cell(col, ri)}
                  </div>
                ))}
                {rowActions.length > 0 && <div className="ui-row end">{rowActions.map((a) => <Fragment key={a.id}>{elTok(a, "ui-btn sm")}</Fragment>)}</div>}
              </div>
            ))}
          </div>
          {foot}
          {addBar}
        </div>
      );
    }

    // shape === "rows": simple stacked rows.
    return (
      <div className="ui-card">
        {head}
        <ul className={`ui-rows${layout === "horizontal" ? " scroll" : ""}`}>
          {rows.map((_, ri) => (
            <li key={ri} className="ui-rowitem">
              <span className="ui-rowitem-title">{titleCol ? cell(titleCol, ri, "") : null}</span>
              {rest[0] && <span className="ui-rowitem-sub">{cell(rest[0], ri, "")}</span>}
              <span className="spacer" />
              {statusCol && cell(statusCol, ri)}
              {rowActions.map((a) => <Fragment key={a.id}>{elTok(a, "ui-btn sm")}</Fragment>)}
            </li>
          ))}
        </ul>
        {foot}
        {addBar}
      </div>
    );
  };

  // ── Form ──────────────────────────────────────────────────────────────────

  const renderForm = (): ReactNode => {
    const steps = byType("step");
    const buttons = byType("button");
    const flow = els.filter((e) => e.type !== "step" && e.type !== "button" && e.type !== "header");

    if (shape === "inline") {
      return (
        <div className="ui-filters">
          {headerInline && elTok(headerInline, "ui-card-title")}
          {flow.map((el) => {
            const fw = el.type === "section-heading" || el.type === "help-text" ? null : fieldWidget(el);
            return <Fragment key={el.id}>{fw ? elBox(el, "", fw) : widget(el)}</Fragment>;
          })}
          {buttons.map((b) => <Fragment key={b.id}>{elTok(b, btnClass(b, "sm"))}</Fragment>)}
          {addCluster(addEl("text-input", "Add field", "+ Field", "text"), true)}
        </div>
      );
    }

    const gridClass = `ui-form-grid${layout === "two-column" ? " cols-2" : ""}${layout === "horizontal" ? " labels-beside" : ""}`;
    return (
      <div className="ui-card ui-form">
        {headerInline && <div className="ui-card-head">{elTok(headerInline, "ui-card-title")}</div>}
        {shape === "wizard" && steps.length > 0 && (
          <ol className="ui-stepper">
            {steps.map((s2, i) => (
              <li key={s2.id} className={`ui-step${i === 0 ? " active" : ""}`}>
                <span className="ui-step-dot">{i === 0 ? i + 1 : i < 1 ? <CheckIcon /> : i + 1}</span>
                {elTok(s2, "")}
                {i < steps.length - 1 && <span className="ui-step-line" aria-hidden />}
              </li>
            ))}
          </ol>
        )}
        <div className={gridClass}>
          {flow.map((el) => {
            if (el.type === "section-heading") return <div key={el.id} className="ui-field wide ui-form-section">{elTok(el, "ui-h3")}</div>;
            if (el.type === "help-text") return <div key={el.id} className="ui-field wide">{widget(el)}</div>;
            return elBox(
              el,
              `ui-field${wideField(el) ? " wide" : ""}`,
              <>
                {el.type !== "checkbox" && el.type !== "toggle" && fieldLabel(el)}
                {fieldWidget(el) ?? widget(el)}
              </>,
            );
          })}
        </div>
        {buttons.length > 0 && (
          <div className="ui-form-actions">
            {buttons.map((b) => <Fragment key={b.id}>{elTok(b, btnClass(b))}</Fragment>)}
          </div>
        )}
        {addCluster(
          <>
            {addEl("text-input", "Add field", "+ Field", "text")}
            {shape === "wizard" && addEl("step", "Add step", "+ Step", "text")}
            {addEl("button", "Add button", "+ Button", "text")}
          </>,
        )}
      </div>
    );
  };

  // ── Graph ─────────────────────────────────────────────────────────────────

  const renderGraph = (): ReactNode => {
    const series = byType("series");
    const catAxis = first("category-axis");
    const valueAxis = first("value-axis");
    const legendEl = first("legend");
    const rangeEl = first("range-selector");
    const stats = byType("stat");

    const head = headerInline || legendEl || valueAxis || rangeEl ? (
      <div className="ui-card-head">
        {headerInline && elTok(headerInline, "ui-card-title")}
        <div className="ui-row">
          {legendEl && elBox(legendEl, "ui-legend-box", series.map((sr) => <Fragment key={sr.id}>{elTok(sr, "ui-chip sm")}</Fragment>))}
          {valueAxis && dataTok(valueAxis, "unit", "", "ui-chip sm")}
          {rangeEl && elTok(rangeEl, "ui-chip sm")}
        </div>
      </div>
    ) : null;

    if (shape === "stats") {
      return (
        <div className="ui-listwrap">
          {head}
          <div className="ui-kpis" style={{ gridTemplateColumns: `repeat(${Math.max(1, stats.length)}, minmax(0, 1fr))` }}>
            {stats.map((el) => {
              const delta = el.data?.delta ?? "";
              return elBox(
                el,
                "ui-card ui-kpi",
                <>
                  <div className="ui-kpi-label">{elTok(el, "")}</div>
                  <div className="ui-kpi-value">{dataTok(el, "value", "12,408")}</div>
                  <div className={`ui-kpi-delta${delta.startsWith("−") || delta.startsWith("-") ? " down" : ""}`}>{dataTok(el, "delta", "+4.2%")}</div>
                </>,
              );
            })}
          </div>
          {addCluster(addEl("stat", "Add metric", "+ Metric", "text"))}
        </div>
      );
    }

    const categories = splitList(catAxis?.data?.categories);
    const primary = series[0];
    const rawValues = splitList(primary?.data?.values);
    const n = Math.max(categories.length, rawValues.length, 4);
    const values = Array.from({ length: n }, (_, i) => numberOf(rawValues[i] ?? "", CHART_VALUES[i % CHART_VALUES.length]));
    const max = Math.max(1, ...values);
    const setSeriesValue = (i: number, t: string) => {
      if (!primary) return;
      const next = Array.from({ length: n }, (_, j) => (j === i ? t.trim() : rawValues[j] ?? String(values[j])));
      edit?.setElementData(primary.id, "values", next.join(", "));
    };
    const setCategory = (i: number, t: string) => {
      if (!catAxis) return;
      const next = Array.from({ length: n }, (_, j) => (j === i ? t.trim() : categories[j] ?? "")).filter((v, j) => v || j < n);
      edit?.setElementData(catAxis.id, "categories", next.join(", "));
    };

    // Tokens inside the plot belong to their axis/series element, so clicking
    // a value or category label selects something the Inspector can act on.
    const seriesTok = (value: Val, sample: string, commit?: (t: string) => void) =>
      tok("", value, sample, commit, undefined, primary ? { key: elKey(primary.id), index: null } : undefined, true);
    const categoryTok = (i: number, sample = `C${i + 1}`) =>
      tok("", categories[i] ?? null, sample, catAxis ? (t) => setCategory(i, t) : undefined, undefined, catAxis ? { key: elKey(catAxis.id), index: null } : undefined, true);

    let plot: ReactNode;
    if (shape === "pie" || shape === "donut") {
      const total = values.reduce((a, b) => a + b, 0) || 1;
      let acc = 0;
      const stops = values.map((v, i) => {
        const from = (acc / total) * 100;
        acc += v;
        return `${PIE_COLOURS[i % PIE_COLOURS.length]} ${from}% ${(acc / total) * 100}%`;
      });
      plot = (
        <div className="ui-pie-wrap">
          <div className={`ui-pie${shape === "donut" ? " donut" : ""}`} style={{ background: `conic-gradient(${stops.join(", ")})` }} />
          <div className="ui-pie-legend">
            {values.map((_, i) => (
              <span key={i} className="ui-pie-key">
                <i style={{ background: PIE_COLOURS[i % PIE_COLOURS.length] }} aria-hidden />
                {categoryTok(i, `Slice ${i + 1}`)}
                <b>{seriesTok(rawValues[i] ?? null, String(values[i]), primary ? (t) => setSeriesValue(i, t) : undefined)}</b>
              </span>
            ))}
          </div>
        </div>
      );
    } else if (shape === "line" || shape === "area" || shape === "scatter") {
      const pts = (vals: number[]) => vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * 100},${40 - (v / max) * 36}`);
      plot = (
        <div className="ui-chart">
          <div className="ui-chart-plot">
            <div className="ui-chart-grid" aria-hidden><i /><i /><i /><i /></div>
            <svg className="ui-chart-svg" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
              {series.map((sr, si) => {
                const vals = Array.from({ length: n }, (_, i) => numberOf(splitList(sr.data?.values)[i] ?? "", CHART_VALUES[(i + si * 3) % CHART_VALUES.length]));
                const colour = PIE_COLOURS[si % PIE_COLOURS.length];
                if (shape === "scatter") {
                  return pts(vals).map((p, i) => {
                    const [x, y] = p.split(",");
                    return <circle key={`${sr.id}-${i}`} cx={x} cy={y} r="1.6" fill={colour} />;
                  });
                }
                return (
                  <Fragment key={sr.id}>
                    {shape === "area" && <polygon points={`0,40 ${pts(vals).join(" ")} 100,40`} fill={colour} opacity="0.18" />}
                    <polyline points={pts(vals).join(" ")} fill="none" stroke={colour} strokeWidth="1.4" />
                  </Fragment>
                );
              })}
            </svg>
          </div>
          <div className="ui-chart-x">
            {Array.from({ length: n }, (_, i) => (
              <Fragment key={i}>{categoryTok(i)}</Fragment>
            ))}
          </div>
        </div>
      );
    } else {
      // bar (default)
      plot = (
        <div className={`ui-chart${layout === "horizontal" ? " horiz" : ""}`}>
          <div className="ui-chart-plot">
            <div className="ui-chart-grid" aria-hidden><i /><i /><i /><i /></div>
            <div className="ui-chart-bars">
              {values.map((v, i) => (
                <div key={i} className="ui-chart-col">
                  <div className="ui-chart-value">{seriesTok(rawValues[i] ?? null, String(v), primary ? (t) => setSeriesValue(i, t) : undefined)}</div>
                  <div className="ui-chart-bar" style={layout === "horizontal" ? { width: `${Math.max(2, (v / max) * 100)}%` } : { height: `${Math.max(2, (v / max) * 100)}%` }} />
                </div>
              ))}
            </div>
          </div>
          <div className="ui-chart-x">
            {Array.from({ length: n }, (_, i) => (
              <Fragment key={i}>{categoryTok(i)}</Fragment>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="ui-card">
        {head}
        {plot}
      </div>
    );
  };

  // ── Calendar ──────────────────────────────────────────────────────────────

  const DAY_COLS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dayIndexOf = (when: string | undefined, fallback: number): number => {
    const m = /mon|tue|wed|thu|fri|sat|sun/i.exec(when ?? "");
    return m ? DAY_COLS.findIndex((d2) => d2.toLowerCase() === m[0].toLowerCase()) : fallback % 7;
  };

  const renderCalendar = (): ReactNode => {
    const events = byType("event");
    const navEl = first("calendar-nav");
    const viewsEl = first("view-switcher");
    const legendEl = first("calendar-legend");
    const compact = layout === "compact";

    const evChip = (ev: ElementNode, withWhen = false) => (
      <Fragment key={ev.id}>
        <span className={`ui-cal-ev ${ev.data?.kind ?? "meeting"}`}>
          {elTok(ev, "")}
          {withWhen && dataTok(ev, "when", "Tue 10:00", "ui-cal-when")}
        </span>
      </Fragment>
    );

    const head = (
      <div className="ui-card-head">
        {headerInline && elTok(headerInline, "ui-card-title")}
        <div className="ui-row">
          {navEl &&
            elBox(
              navEl,
              "ui-cal-nav",
              <>
                <span className="ui-pager-btn" aria-hidden>‹</span>
                <span className="ui-pager-btn" aria-hidden>Today</span>
                <span className="ui-pager-btn" aria-hidden>›</span>
              </>,
            )}
          {text("period", str("period", "March 2026"), "ui-cal-period")}
        </div>
        {viewsEl && (
          <div className="ui-row">
            {elBox(
              viewsEl,
              "ui-tabs sm",
              splitList(viewsEl.data?.views).map((v, i) => (
                <span key={i} className={`ui-tab${sameView(v, shape) ? " active" : ""}`}>{v}</span>
              )),
            )}
          </div>
        )}
      </div>
    );
    const legend = legendEl
      ? elBox(
          legendEl,
          "ui-cal-legend",
          splitList(legendEl.data?.kinds).map((k, i) => (
            <span key={i} className="ui-pie-key"><i className={`ui-cal-dot ${k.toLowerCase()}`} aria-hidden />{k}</span>
          )),
        )
      : null;

    let body: ReactNode;
    if (shape === "day") {
      body = (
        <ul className="ui-agenda">
          {events.map((ev) => (
            <li key={ev.id}>
              {dataTok(ev, "when", "Tue 10:00", "ui-agenda-when")}
              {elTok(ev, "ui-agenda-title")}
              <span className={`ui-cal-dot ${ev.data?.kind ?? "meeting"}`} aria-hidden />
            </li>
          ))}
        </ul>
      );
    } else if (shape === "schedule") {
      const lanes = byType("resource-row");
      const laneList = lanes.length ? lanes : [null];
      body = (
        <div className="ui-schedule">
          {laneList.map((lane, li) => (
            <div key={lane?.id ?? li} className="ui-schedule-lane">
              <span className="ui-schedule-name">{lane ? elTok(lane, "") : null}</span>
              <div className="ui-schedule-track">
                {events.filter((_, i) => i % laneList.length === li).map((ev, i) => (
                  <span key={ev.id} className={`ui-cal-ev bar ${ev.data?.kind ?? "meeting"}`} style={{ marginLeft: `${(i * 18 + dayIndexOf(ev.data?.when, i) * 8) % 45}%` }}>
                    {elTok(ev, "")}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    } else if (shape === "week") {
      body = (
        <div className="ui-cal-week">
          {DAY_COLS.map((d2, ci) => (
            <div key={d2} className="ui-cal-daycol">
              <div className="ui-cal-dayhead">{d2}</div>
              <div className="ui-cal-daybody">
                {events.filter((ev, i) => dayIndexOf(ev.data?.when, i) === ci).map((ev) => evChip(ev, !compact))}
              </div>
            </div>
          ))}
        </div>
      );
    } else {
      // month (default) and mini
      const mini = shape === "mini";
      const cells = Array.from({ length: 35 }, (_, i) => i);
      const byCell = new Map<number, ElementNode[]>();
      events.forEach((ev, i) => {
        const cellIdx = dayIndexOf(ev.data?.when, i) + 7 * (1 + (i % 3));
        byCell.set(cellIdx, [...(byCell.get(cellIdx) ?? []), ev]);
      });
      body = (
        <div className={`ui-cal-grid${mini ? " mini" : ""}`}>
          {DAY_COLS.map((d2) => <div key={d2} className="ui-cal-dayhead">{mini ? d2.slice(0, 1) : d2}</div>)}
          {cells.map((i) => (
            <div key={i} className="ui-cal-cell">
              <span className="ui-cal-date">{i + 1 <= 31 ? i + 1 : ""}</span>
              {mini
                ? byCell.get(i) && <span className="ui-cal-dot meeting" aria-hidden />
                : (byCell.get(i) ?? []).map((ev) => evChip(ev))}
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className={`ui-card ui-cal${compact ? " compact" : ""}${shape === "mini" ? " as-mini" : ""}`}>
        {head}
        {body}
        {legend}
        {addCluster(
          <>
            {addEl("event", "Add event", "+ Event", "text")}
            {shape === "schedule" && addEl("resource-row", "Add resource", "+ Resource", "text")}
          </>,
        )}
      </div>
    );
  };

  // ── Canvas ────────────────────────────────────────────────────────────────

  /** Ctrl/⌘+click on a canvas child: grow or shrink the drag group. The
   *  clicked element becomes the single selection either way; a group of one
   *  collapses back to a plain selection. */
  const toggleCanvasSel = (el: ElementNode) => {
    if (!chrome?.onSelectElement) return;
    if (multi.includes(el.id)) {
      const rest = multi.filter((id) => id !== el.id);
      setMulti(rest.length > 1 ? rest : []);
      if (selectedElKey === elKey(el.id) && rest.length) chrome.onSelectElement(elKey(rest[rest.length - 1]), null);
    } else {
      // Seed the group with whichever canvas child is already selected, so
      // the first Ctrl+click extends rather than replaces.
      const seed = multi.length ? multi : els.filter((x) => elKey(x.id) === selectedElKey).map((x) => x.id);
      if (seed.length) setMulti([...seed, el.id]);
      chrome.onSelectElement(elKey(el.id), null);
    }
  };

  /** Pointer drag anywhere on a canvas child moves it — and, when it belongs
   *  to the Ctrl/⌘ group, every member, rigidly (the delta is clamped so no
   *  member crosses the canvas edge). Movement only begins past a small
   *  threshold, so clicks still select and double-clicks still edit text. */
  const startCanvasDrag = (el: ElementNode) => (e: ReactPointerEvent) => {
    if (!edit || e.button !== 0) return;
    // Text editing, the toolbar, the resize grip and open menus own their
    // own pointer gestures.
    if ((e.target as HTMLElement).closest(".inline-edit-input, .ui-canvas-tools, .ui-canvas-el-resize, .ui-select-menu")) return;
    // Cancelling pointerdown stops the draggable .cmp ancestor from starting
    // a native HTML5 drag (which would pointercancel this gesture midway).
    // click and dblclick still fire, so select and edit are unaffected.
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const group = multi.includes(el.id) ? multi : [el.id];
    const from = new Map<string, { x: number; y: number }>();
    for (const id of group) {
      const member = els.find((x) => x.id === id);
      if (member) from.set(id, { x: numberOf(member.data?.x ?? "16", 16), y: numberOf(member.data?.y ?? "16", 16) });
    }
    if (!from.size) return;
    const minX = Math.min(...[...from.values()].map((p) => p.x));
    const minY = Math.min(...[...from.values()].map((p) => p.y));
    let started = false;
    let latest: Record<string, { x: number; y: number }> = {};
    const prevUserSelect = document.body.style.userSelect;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!started) {
        if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        started = true;
        // From here the gesture is a drag, not a text selection.
        document.body.style.userSelect = "none";
        window.getSelection()?.removeAllRanges();
        // Dragging an element outside the group selects it alone (the sync
        // effect then clears the group).
        if (!multi.includes(el.id)) chrome?.onSelectElement?.(elKey(el.id), null);
      }
      const cdx = Math.max(dx, -minX);
      const cdy = Math.max(dy, -minY);
      latest = {};
      from.forEach((p, id) => {
        latest[id] = { x: p.x + cdx, y: p.y + cdy };
      });
      setDragPos((prev) => ({ ...prev, ...latest }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      if (!started) return;
      document.body.style.userSelect = prevUserSelect;
      // The click this release fires must not reselect or toggle; the flag
      // outlives it by one task at most.
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      });
      setDragPos((prev) => {
        const next = { ...prev };
        from.forEach((_, id) => delete next[id]);
        return next;
      });
      const moves = [...from]
        .filter(([id, p]) => latest[id] && (latest[id].x !== p.x || latest[id].y !== p.y))
        .map(([id]) => ({ id, x: latest[id].x, y: latest[id].y }));
      if (moves.length) edit.moveElementsTo(moves);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  /** Corner drag on a canvas child: sets its width and height; one commit on
   *  release. The starting size is the rendered box, so the first resize of
   *  an auto-sized element feels continuous. */
  const startCanvasElResize = (el: ElementNode) => (e: ReactPointerEvent) => {
    if (!edit || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const box = (e.currentTarget as HTMLElement).closest(".ui-canvas-el");
    const rect = box?.getBoundingClientRect();
    const fromW = numberOf(el.data?.w ?? "", Math.round(rect?.width ?? 120));
    const fromH = numberOf(el.data?.h ?? "", Math.round(rect?.height ?? 40));
    const startX = e.clientX;
    const startY = e.clientY;
    let latest = { w: fromW, h: fromH };
    const move = (ev: PointerEvent) => {
      latest = {
        w: Math.max(40, Math.min(2000, Math.round(fromW + ev.clientX - startX))),
        h: Math.max(24, Math.min(2000, Math.round(fromH + ev.clientY - startY))),
      };
      setDragSize((s) => ({ ...s, [el.id]: latest }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      setDragSize((s) => {
        const next = { ...s };
        delete next[el.id];
        return next;
      });
      if (latest.w !== fromW || latest.h !== fromH) edit.resizeElementTo(el.id, latest.w, latest.h);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  /** Drag the canvas's bottom edge to set its height; one commit on release. */
  const startCanvasResize = (e: ReactPointerEvent) => {
    if (!edit || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const from = numberOf(scalarOf("height") ?? "", 280);
    let latest = from;
    const move = (ev: PointerEvent) => {
      latest = Math.max(0, Math.min(2000, Math.round(from + ev.clientY - startY)));
      setLiveHeight(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      setLiveHeight(null);
      if (latest !== from) edit.setPropValue("height", String(latest));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const renderCanvas = (): ReactNode => {
    // "float" sizes like "fill" (the .cmp wrapper overlays the region; see
    // .cmp.float in the stylesheet) — no fixed height, no resize bar. A
    // generic box height (props.h, set by the component's resize grips)
    // sizes the wrapper instead, so the drawing area turns elastic inside
    // it the same way.
    const fill = layout === "fill" || layout === "float" || numberOf(scalarOf("h") ?? "", 0) > 0;
    const height = liveHeight ?? numberOf(scalarOf("height") ?? "", 280);
    // The drawing area's own background would otherwise sit over the cmp
    // wrapper's user-set colour; backgroundColor (not the shorthand) keeps
    // the grid shape's dot pattern.
    const bg = scalarOf("bg");
    return (
      <div className={`ui-canvas-wrap${fill ? " fill" : ""}`}>
        <div
          className={`ui-canvas ${shape}${fill ? " fill" : ""}`}
          style={{ ...(fill ? undefined : { height }), ...(bg ? { backgroundColor: bg } : undefined) }}
        >
          {els.map((el) => {
            const live = dragPos[el.id];
            const liveSize = dragSize[el.id];
            const x = live?.x ?? numberOf(el.data?.x ?? "16", 16);
            const y = live?.y ?? numberOf(el.data?.y ?? "16", 16);
            const w = liveSize?.w ?? (el.data?.w ? numberOf(el.data.w, 0) : null);
            const h = liveSize?.h ?? (el.data?.h ? numberOf(el.data.h, 0) : null);
            const selected = chrome?.selected?.key === elKey(el.id);
            const cls = [
              "ui-canvas-el",
              edit ? "movable" : "",
              selected ? "selected" : "",
              multi.includes(el.id) && !selected ? "grouped" : "",
              live || liveSize ? "dragging" : "",
              w || h ? "sized" : "",
              // The toolbar sits above the element; near the canvas top that
              // would be clipped (overflow: hidden), so it flips below.
              y < 30 ? "tools-below" : "",
            ].filter(Boolean).join(" ");
            return (
              <div
                key={el.id}
                className={cls}
                style={{ left: x, top: y, width: w ?? undefined, height: h ?? undefined }}
                onPointerDown={edit ? startCanvasDrag(el) : undefined}
                // Capture phase: it must run before the text tokens' own
                // click handlers (which stop propagation), so Ctrl+click on
                // a label still reaches the group logic.
                onClickCapture={
                  chrome?.onSelectElement
                    ? (e) => {
                        if (suppressClick.current) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        if ((e.target as HTMLElement).closest(".ui-canvas-tools, .ui-canvas-el-resize")) return;
                        if (e.ctrlKey || e.metaKey) {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleCanvasSel(el);
                        } else if (multi.length) {
                          // A plain click collapses the group to the clicked
                          // element; the bubble handlers do the selecting.
                          setMulti([]);
                        }
                      }
                    : undefined
                }
                onClick={
                  chrome?.onSelectElement
                    ? (e) => {
                        e.stopPropagation();
                        chrome.onSelectElement!(elKey(el.id), null);
                      }
                    : undefined
                }
              >
                {edit && (
                  <span className="ui-canvas-tools">
                    <button
                      type="button"
                      className="ui-canvas-x"
                      title="Remove"
                      aria-label={`Remove ${el.label || el.type}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        edit.removeElement(el.id);
                      }}
                    >
                      ×
                    </button>
                  </span>
                )}
                {widget(el, "canvas")}
                {edit && (
                  <button
                    type="button"
                    className="ui-canvas-el-resize"
                    title="Drag to resize"
                    aria-label={`Resize ${el.label || el.type}`}
                    onPointerDown={startCanvasElResize(el)}
                  />
                )}
              </div>
            );
          })}
          {els.length === 0 && <div className="ui-canvas-hint">{edit ? "Add elements from the library's Elements tab" : null}</div>}
        </div>
        {edit && !fill && (
          <div className="ui-canvas-resize" title="Drag to resize" onPointerDown={startCanvasResize}>
            <span aria-hidden />
          </div>
        )}
      </div>
    );
  };

  const body = ((): ReactNode => {
    switch (cmp.type) {
      case "navbar": return renderNavbar();
      case "list": return renderList();
      case "form": return renderForm();
      case "graph": return renderGraph();
      case "canvas": return renderCanvas();
      case "calendar": return renderCalendar();

      case "custom":
      case "editable-component": {
        const def = defs.find((x) => x.id === cmp.customId);
        if (def) return <CustomSchematic def={def} />;
        return (
          <div className="ui-card ui-custom-empty">
            <div className="ui-h3">{title}</div>
            <p className="ui-p">
              {cmp.type === "custom"
                ? `The component definition "${cmp.customId ?? "?"}" no longer exists.`
                : edit
                  ? "This component has no structure yet. Double-click it, or use the pencil control, to build one."
                  : "This component has no structure yet."}
            </p>
          </div>
        );
      }
      default:
        return (
          <div className="ui-card ui-custom-empty">
            <div className="ui-h3">{title}</div>
            <p className="ui-p">No renderer for “{cmp.type}” yet.</p>
          </div>
        );
    }
  })();

  // A header placed "above" sits on its own line over the component.
  if (headerEl && !headerInline) {
    return (
      <div className="ui-headed">
        {elTok(headerEl, "ui-card-title")}
        {body}
      </div>
    );
  }
  return body;
}

const sameView = (view: string, shape: string): boolean => view.trim().toLowerCase().startsWith(shape === "day" ? "day" : shape);

const initialsOf = (name: string): string => {
  const trimmed = name.trim();
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") : "?";
};

/** Inline style from freeform style keys (element `data`, component/region
 *  `props`): background, text colour, web-safe font, capitalisation. The
 *  background also overrides the --panel token so carded UI inside follows
 *  the colour; the text colour likewise overrides the text tokens so dim and
 *  muted spans (labels, placeholders, captions) follow rather than keeping
 *  their own greys; the font overrides --font-display so headings and
 *  buttons follow too. */
export function styleData(d: Record<string, unknown> | undefined): CSSProperties | undefined {
  if (!d) return undefined;
  const s: Record<string, unknown> = {};
  if (typeof d.bg === "string" && d.bg) {
    s.background = d.bg;
    s["--panel"] = d.bg;
    s["--panel-2"] = d.bg;
  }
  if (typeof d.fg === "string" && d.fg) {
    s.color = d.fg;
    s["--text"] = d.fg;
    s["--text-dim"] = d.fg;
    s["--text-mute"] = d.fg;
  }
  const stack = typeof d.font === "string" ? fontStack(d.font) : undefined;
  if (stack) {
    s.fontFamily = stack;
    s["--font-display"] = stack;
  }
  if (d.caps === "caps") s.textTransform = "uppercase";
  else if (d.caps === "lower") s.textTransform = "none";
  return Object.keys(s).length ? (s as CSSProperties) : undefined;
}

/** Small deterministic hash so two same-kind columns show different samples. */
function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h % 4;
}
