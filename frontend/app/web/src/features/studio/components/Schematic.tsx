// Per-component rendering for the canvas. A component is drawn as the UI it
// stands for — a real nav bar, table, form or calendar — so a frame reads as
// a screen rather than a labelled schematic.
//
// A component renders its `elements` (typed children, pos order) branched by
// its `shape` and `layout`. Every string on screen is an EditableToken backed
// by an element label, element data or a scalar prop, so nothing is baked
// into the renderer: double-click to edit; committing an empty element label
// removes the element. With no `edit` handlers everything is read-only.
import { Fragment, PointerEvent as ReactPointerEvent, ReactNode, useState } from "react";
import { CustomDef, elKey } from "../model/actions";
import { byPos } from "../model/positions";
import { getDefaultProps } from "../model/regions";
import { ComponentNode, ElementNode, LinkTarget } from "../model/types";
import { CustomSchematic } from "./CustomSchematic";
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
  /** Canvas free placement; one call per completed drag. */
  moveElementTo(id: string, x: number, y: number): void;
}

/** Canvas-supplied element behaviour: selection, link lookup and follow.
 *  Scoped to one component (the ElementSels never carry another cmpId). */
export interface SchematicChrome {
  selected: ElementSel | null;
  editing: ElementSel | null;
  linkOf(key: string, index: number | null): LinkTarget | null;
  onSelectElement?: (key: string, index: number | null) => void;
  onFollow(target: LinkTarget): void;
  onEditEnd?: () => void;
}

interface Props {
  cmp: ComponentNode;
  defs: readonly CustomDef[];
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
const PIE_COLOURS = ["#6aa0ff", "#58c08d", "#e0b341", "#e06060", "#a080ff", "#60c0e0", "#e0a060"];

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
const InboxIcon = () => (
  <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden>
    <path d="M2 9h3.5l1 2h3l1-2H14v4H2V9Z" />
    <path d="M4 9V3h8v6" />
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

export function Schematic({ cmp, defs, edit, chrome }: Props) {
  const d = getDefaultProps(cmp.type);
  const els = byPos(cmp.elements ?? []);
  const byType = (...types: string[]) => els.filter((e) => types.includes(e.type));
  const first = (type: string): ElementNode | undefined => els.find((e) => e.type === type);
  const shape = cmp.shape ?? "";
  const layout = cmp.layout ?? "";
  const title = cmp.label || cmp.type;
  /** Live x/y override while a canvas child drag is in flight. */
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }>>({});

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
  ) => {
    const blank = value === "";
    if (blank && !edit) return null;
    const link = el && chrome ? chrome.linkOf(el.key, el.index) : null;
    const element =
      el && chrome
        ? {
            selected: sameElement(chrome.selected, el),
            linked: !!link,
            editing: sameElement(chrome.editing, el),
            onSelect: chrome.onSelectElement ? () => chrome.onSelectElement!(el.key, el.index) : undefined,
            onFollow: link ? () => chrome.onFollow(link) : undefined,
            onEditEnd: chrome.onEditEnd,
          }
        : undefined;
    return (
      <EditableToken
        className={`ui-edit${blank ? " blank" : ""} ${className}`.trim()}
        value={value ?? sample}
        onCommit={edit && commit ? commit : undefined}
        element={element}
      >
        {blank ? "…" : children}
      </EditableToken>
    );
  };
  /** An element's label; empty commit removes the element. */
  const elTok = (el: ElementNode, className: string, children?: ReactNode) =>
    tok(className, el.label, "", (t) => edit?.setElementLabel(el.id, t), children, { key: elKey(el.id), index: null });
  /** One slot of an element's representative data; blanking restores the sample. */
  const dataTok = (el: ElementNode, key: string, sample: string, className = "") =>
    tok(className, el.data?.[key], sample, (t) => edit?.setElementData(el.id, key, t));
  /** A scalar prop (heading, copyright, period…). */
  const text = (key: string, fallback: string, className = "") =>
    tok(className, scalarOf(key), fallback, (t) => edit?.setPropValue(key, t));

  /** A "+" affordance: invisible until the component is hovered or selected; absent for viewers. */
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

  const btnClass = (el: ElementNode, size = "") => {
    const style = el.data?.style;
    return `ui-btn${size ? ` ${size}` : ""}${style === "primary" ? " primary" : style === "danger" ? " danger" : ""}`;
  };
  const searchBox = (el: ElementNode, className = "") => (
    <div key={el.id} className={`ui-input search ${className}`.trim()}>
      <SearchIcon />
      {elTok(el, "ui-placeholder")}
    </div>
  );

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
      case "select":
        return body("select", <><span className="ui-placeholder">{inputPlaceholder(el)}</span><Chevron /></>);
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
      case "filter": return elTok(el, "ui-chip");
      case "row-action": return elTok(el, "ui-btn sm");
      case "image":
        return (
          <div className="ui-image-ph">
            <ImageIcon />
            {elTok(el, "ui-image-cap")}
          </div>
        );
      case "box": return <div className="ui-box">{elTok(el, "ui-box-cap")}</div>;
      case "divider": return <hr className="ui-divider" />;
      case "checkbox":
      case "toggle":
      case "radio-group":
        return (
          <div className="ui-field">
            {el.type === "radio-group" && <label className="ui-label">{elTok(el, "")}</label>}
            {fieldWidget(el)}
          </div>
        );
      case "text-input":
      case "text-area":
      case "select":
      case "date-picker":
      case "file-upload":
        return (
          <div className="ui-field">
            <label className="ui-label">{elTok(el, "")}</label>
            {fieldWidget(el)}
          </div>
        );
      case "column":
        return (
          <div className="ui-field">
            <label className="ui-label">{elTok(el, "")}</label>
            <span className="ui-chip sm">{el.data?.kind ?? "text"}</span>
          </div>
        );
      case "pagination": return pagination(el);
      case "column-header": return <div className="ui-box sm">{edit ? "Column header" : null}</div>;
      case "select-column": return <span className="ui-choice"><i className="ui-checkbox" aria-hidden /></span>;
      default: return elTok(el, "ui-chip");
    }
  };

  const pagination = (el: ElementNode) => (
    <div key={el.id} className="ui-pager">
      <span className="ui-pager-btn" aria-hidden>‹</span>
      <span className="ui-pager-btn on">1</span>
      <span className="ui-pager-btn">2</span>
      <span className="ui-pager-btn">3</span>
      <span className="ui-pager-btn" aria-hidden>›</span>
      {dataTok(el, "pageSize", "10", "ui-pager-size")} <span className="ui-pager-label">/ page</span>
    </div>
  );

  // ── Nav bar ───────────────────────────────────────────────────────────────

  const renderNavbar = (): ReactNode => {
    const brandEl = first("brand");
    const searchEl = first("search");
    const avatarEl = first("avatar");
    const workspaceEl = first("workspace-switcher");
    const buttons = byType("button");
    const flow = els.filter((e) => e.type === "nav-item" || e.type === "group-heading" || e.type === "divider");

    const navItem = (el: ElementNode, i: number, active: boolean) => {
      if (el.type === "divider") return <span key={el.id} className="ui-nav-divider" aria-hidden />;
      if (el.type === "group-heading") return <Fragment key={el.id}>{elTok(el, "ui-side-title inline")}</Fragment>;
      const cls =
        shape === "tabs" ? `ui-tab${active ? " active" : ""}` :
        shape === "breadcrumb" ? `ui-crumb${i === flow.length - 1 ? " current" : ""}` :
        `ui-nav-link${active ? " active" : ""}`;
      return (
        <Fragment key={el.id}>
          {shape === "breadcrumb" && i > 0 && <span className="ui-crumb-sep" aria-hidden>/</span>}
          {elTok(el, cls, shape === "icons" ? <><span className="ui-icon" aria-hidden />{el.label}</> : undefined)}
        </Fragment>
      );
    };

    if (layout === "vertical") {
      // Side rail: group headings start sections; chrome sits top and bottom.
      const sections: ReactNode[][] = [[]];
      for (const el of flow) {
        if (el.type === "group-heading" && sections[sections.length - 1].length) sections.push([]);
        const activeFirst = flow.find((e) => e.type === "nav-item") === el;
        if (el.type === "group-heading") {
          sections[sections.length - 1].push(<div key={el.id} className="ui-side-title">{elTok(el, "")}</div>);
        } else if (el.type === "divider") {
          sections[sections.length - 1].push(<hr key={el.id} className="ui-divider" />);
        } else {
          sections[sections.length - 1].push(
            <Fragment key={el.id}>
              {elTok(el, `ui-side-item${activeFirst ? " active" : ""}`, <><span className="ui-icon" aria-hidden /><span className="ui-side-label">{el.label}</span></>)}
            </Fragment>,
          );
        }
      }
      return (
        <aside className="ui-sidenav">
          {workspaceEl && (
            <div className="ui-workspace">
              <span className="ui-avatar sq sm" aria-hidden>{workspaceEl.label.slice(0, 1).toUpperCase()}</span>
              {elTok(workspaceEl, "ui-workspace-name")}
              <Chevron />
            </div>
          )}
          {brandEl && <div className="ui-side-section">{elTok(brandEl, "ui-brand")}</div>}
          {searchEl && <div className="ui-side-section">{searchBox(searchEl)}</div>}
          {sections.map((section, i) => (
            <div key={i} className="ui-side-section">
              {section}
              {i === sections.length - 1 && addEl("nav-item", "Add navigation item")}
            </div>
          ))}
          {buttons.length > 0 && <div className="ui-side-section"><div className="ui-row">{buttons.map((b) => <Fragment key={b.id}>{elTok(b, btnClass(b, "sm"))}</Fragment>)}</div></div>}
          {avatarEl && (
            <div className="ui-side-section foot">
              <div className="ui-side-user">
                {elTok(avatarEl, "ui-avatar sm")}
                <div className="ui-side-user-text">
                  <div className="ui-side-user-name">{dataTok(avatarEl, "name", "Ada Lovelace")}</div>
                  <div className="ui-side-user-role">{dataTok(avatarEl, "role", "Administrator")}</div>
                </div>
              </div>
            </div>
          )}
        </aside>
      );
    }

    const itemsArea =
      shape === "breadcrumb" ? (
        <nav className="ui-crumbs" aria-label="Breadcrumb">
          {flow.map((el, i) => navItem(el, i, false))}
          {addEl("nav-item", "Add crumb")}
        </nav>
      ) : shape === "tabs" ? (
        <div className="ui-tabs" role="tablist">
          {flow.map((el, i) => navItem(el, i, flow.find((e) => e.type === "nav-item") === el))}
          {addEl("nav-item", "Add tab")}
        </div>
      ) : (
        <nav className="ui-nav-links" aria-label="Primary">
          {flow.map((el, i) => navItem(el, i, flow.find((e) => e.type === "nav-item") === el))}
          {addEl("nav-item", "Add link")}
        </nav>
      );

    return (
      <header className={`ui-nav${shape === "tabs" || shape === "breadcrumb" ? " bare" : ""}`}>
        {brandEl && elTok(brandEl, "ui-brand")}
        {itemsArea}
        {searchEl && searchBox(searchEl, "ui-nav-search")}
        <div className="ui-nav-end">
          {buttons.map((b) => <Fragment key={b.id}>{elTok(b, btnClass(b, "sm"))}</Fragment>)}
          {avatarEl && elTok(avatarEl, "ui-avatar")}
        </div>
      </header>
    );
  };

  // ── List ──────────────────────────────────────────────────────────────────

  const renderList = (): ReactNode => {
    const columns = byType("column");
    const hasHeader = !!first("column-header");
    const hasSelect = !!first("select-column");
    const rowActions = byType("row-action");
    const searchEl = first("search");
    const filters = byType("filter");
    const pagerEl = first("pagination");
    const rows: Record<string, string>[] = Array.isArray(cmp.props?.rows) ? (cmp.props.rows as Record<string, string>[]) : [{}, {}, {}];

    const cell = (col: ElementNode, ri: number, className?: string) => {
      const own = rows[ri]?.[col.id];
      // The column's own sample values (representative data) win; the per-kind
      // pool fills in behind them, offset per column so twins differ.
      const samples = splitList(col.data?.samples);
      const sample = own != null ? "" : samples.length ? samples[ri % samples.length] : sampleFor(col.data?.kind, ri + hashOf(col.id));
      const value = own ?? null;
      const shown = own ?? sample;
      const cls = className ?? (col.data?.kind === "status" || isStatus(shown) ? `ui-badge${statusTone(shown)}` : "");
      return tok(cls, value, sample, (t) => edit?.setListCell(ri, col.id, t));
    };
    const colOfKind = (...kinds: string[]) => columns.find((c) => kinds.includes(c.data?.kind ?? ""));

    const head = (
      <div className="ui-card-head">
        <span className="ui-card-title">{text("title", title)}</span>
        <div className="ui-row">
          {filters.map((f) => <Fragment key={f.id}>{elTok(f, "ui-chip")}</Fragment>)}
          {shape === "table" && addEl("column", "Add column", "+ Column", "text")}
          {add((e) => e.addRow(), shape === "feed" ? "Add event" : "Add row", "+ Row", "text")}
          {searchEl && searchBox(searchEl, "sm")}
        </div>
      </div>
    );
    const foot = pagerEl ? <div className="ui-card-foot">{pagination(pagerEl)}</div> : null;

    if (shape === "table" || columns.length === 0) {
      return (
        <div className="ui-card ui-table-card">
          {head}
          <div className="ui-table-scroll">
            <table className="ui-table">
              {hasHeader && (
                <thead>
                  <tr>
                    {hasSelect && <th className="ui-td-select"><i className="ui-checkbox" aria-hidden /></th>}
                    {columns.map((col) => <th key={col.id}>{elTok(col, "")}</th>)}
                    {rowActions.length > 0 && <th />}
                  </tr>
                </thead>
              )}
              <tbody>
                {rows.map((_, ri) => (
                  <tr key={ri}>
                    {hasSelect && <td className="ui-td-select"><i className="ui-checkbox" aria-hidden /></td>}
                    {columns.map((col) => <td key={col.id}>{cell(col, ri)}</td>)}
                    {rowActions.length > 0 && (
                      <td className="ui-td-actions">{rowActions.map((a) => <Fragment key={a.id}>{elTok(a, "ui-btn sm")}</Fragment>)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {foot}
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
              </li>
            ))}
          </ul>
          {foot}
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
      </div>
    );
  };

  // ── Form ──────────────────────────────────────────────────────────────────

  const renderForm = (): ReactNode => {
    const steps = byType("step");
    const buttons = byType("button");
    const flow = els.filter((e) => e.type !== "step" && e.type !== "button");

    if (shape === "inline") {
      return (
        <div className="ui-filters">
          {flow.map((el) => (
            <Fragment key={el.id}>{el.type === "section-heading" || el.type === "help-text" ? widget(el) : fieldWidget(el) ?? widget(el)}</Fragment>
          ))}
          {buttons.map((b) => <Fragment key={b.id}>{elTok(b, btnClass(b, "sm"))}</Fragment>)}
          {addEl("text-input", "Add field")}
        </div>
      );
    }

    const gridClass = `ui-form-grid${layout === "two-column" ? " cols-2" : ""}${layout === "horizontal" ? " labels-beside" : ""}`;
    return (
      <div className="ui-card ui-form">
        {shape === "wizard" && steps.length > 0 && (
          <ol className="ui-stepper">
            {steps.map((s2, i) => (
              <li key={s2.id} className={`ui-step${i === 0 ? " active" : ""}`}>
                <span className="ui-step-dot">{i === 0 ? i + 1 : i < 1 ? <CheckIcon /> : i + 1}</span>
                {elTok(s2, "")}
                {i < steps.length - 1 && <span className="ui-step-line" aria-hidden />}
              </li>
            ))}
            {addEl("step", "Add step")}
          </ol>
        )}
        <div className={gridClass}>
          {flow.map((el) => {
            if (el.type === "section-heading") return <div key={el.id} className="ui-field wide ui-form-section">{elTok(el, "ui-h3")}</div>;
            if (el.type === "help-text") return <div key={el.id} className="ui-field wide">{widget(el)}</div>;
            return (
              <div key={el.id} className={`ui-field${wideField(el) ? " wide" : ""}`}>
                {el.type !== "checkbox" && el.type !== "toggle" && <label className="ui-label">{elTok(el, "")}</label>}
                {fieldWidget(el) ?? widget(el)}
              </div>
            );
          })}
          {addEl("text-input", "Add field")}
        </div>
        <div className="ui-form-actions">
          {buttons.map((b) => <Fragment key={b.id}>{elTok(b, btnClass(b))}</Fragment>)}
          {addEl("button", "Add button")}
        </div>
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

    if (shape === "stats") {
      return (
        <div className="ui-kpis" style={{ gridTemplateColumns: `repeat(${Math.max(1, stats.length)}, minmax(0, 1fr))${edit ? " auto" : ""}` }}>
          {stats.map((el) => {
            const delta = el.data?.delta ?? "";
            return (
              <div key={el.id} className="ui-card ui-kpi">
                <div className="ui-kpi-label">{elTok(el, "")}</div>
                <div className="ui-kpi-value">{dataTok(el, "value", "12,408")}</div>
                <div className={`ui-kpi-delta${delta.startsWith("−") || delta.startsWith("-") ? " down" : ""}`}>{dataTok(el, "delta", "+4.2%")}</div>
              </div>
            );
          })}
          {addEl("stat", "Add metric")}
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

    const head = (
      <div className="ui-card-head">
        <span className="ui-card-title">{text("title", title)}</span>
        <div className="ui-row">
          {legendEl && series.map((sr) => <Fragment key={sr.id}>{elTok(sr, "ui-chip sm")}</Fragment>)}
          {valueAxis && dataTok(valueAxis, "unit", "", "ui-chip sm")}
          {rangeEl && elTok(rangeEl, "ui-chip sm")}
        </div>
      </div>
    );

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
                {tok("", categories[i] ?? null, `Slice ${i + 1}`, catAxis ? (t) => setCategory(i, t) : undefined)}
                <b>{tok("", rawValues[i] ?? null, String(values[i]), primary ? (t) => setSeriesValue(i, t) : undefined)}</b>
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
              <Fragment key={i}>{tok("", categories[i] ?? null, `C${i + 1}`, catAxis ? (t) => setCategory(i, t) : undefined)}</Fragment>
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
                  <div className="ui-chart-value">{tok("", rawValues[i] ?? null, String(v), primary ? (t) => setSeriesValue(i, t) : undefined)}</div>
                  <div className="ui-chart-bar" style={layout === "horizontal" ? { width: `${Math.max(2, (v / max) * 100)}%` } : { height: `${Math.max(2, (v / max) * 100)}%` }} />
                </div>
              ))}
            </div>
          </div>
          <div className="ui-chart-x">
            {Array.from({ length: n }, (_, i) => (
              <Fragment key={i}>{tok("", categories[i] ?? null, `C${i + 1}`, catAxis ? (t) => setCategory(i, t) : undefined)}</Fragment>
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
        {navEl && (
          <span className="ui-cal-nav" aria-hidden>
            <span className="ui-pager-btn">‹</span>
            <span className="ui-pager-btn">Today</span>
            <span className="ui-pager-btn">›</span>
          </span>
        )}
        <span className="ui-card-title">{text("period", str("period", "March 2026"))}</span>
        <div className="ui-row">
          {viewsEl && (
            <div className="ui-tabs sm" role="tablist">
              {splitList(viewsEl.data?.views).map((v, i) => (
                <span key={i} className={`ui-tab${sameView(v, shape) ? " active" : ""}`}>{v}</span>
              ))}
            </div>
          )}
          {addEl("event", "Add event")}
        </div>
      </div>
    );
    const legend = legendEl ? (
      <div className="ui-cal-legend">
        {splitList(legendEl.data?.kinds).map((k, i) => (
          <span key={i} className="ui-pie-key"><i className={`ui-cal-dot ${k.toLowerCase()}`} aria-hidden />{k}</span>
        ))}
      </div>
    ) : null;

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
          {addEl("resource-row", "Add resource")}
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
      </div>
    );
  };

  // ── Canvas ────────────────────────────────────────────────────────────────

  const startCanvasDrag = (el: ElementNode) => (e: ReactPointerEvent) => {
    if (!edit || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const fromX = numberOf(el.data?.x ?? "16", 16);
    const fromY = numberOf(el.data?.y ?? "16", 16);
    let latest = { x: fromX, y: fromY };
    const move = (ev: PointerEvent) => {
      latest = { x: Math.max(0, fromX + ev.clientX - startX), y: Math.max(0, fromY + ev.clientY - startY) };
      setDragPos((p) => ({ ...p, [el.id]: latest }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      setDragPos((p) => {
        const next = { ...p };
        delete next[el.id];
        return next;
      });
      if (latest.x !== fromX || latest.y !== fromY) edit.moveElementTo(el.id, latest.x, latest.y);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const renderCanvas = (): ReactNode => (
    <div className={`ui-canvas ${shape}${layout === "fill" ? " fill" : ""}`}>
      {els.map((el) => {
        const live = dragPos[el.id];
        const x = live?.x ?? numberOf(el.data?.x ?? "16", 16);
        const y = live?.y ?? numberOf(el.data?.y ?? "16", 16);
        const selected = chrome?.selected?.key === elKey(el.id);
        return (
          <div
            key={el.id}
            className={`ui-canvas-el${selected ? " selected" : ""}${live ? " dragging" : ""}`}
            style={{ left: x, top: y }}
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
                <button type="button" className="ui-canvas-handle" title="Drag to move" aria-label={`Move ${el.label || el.type}`} onPointerDown={startCanvasDrag(el)}>⠿</button>
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
          </div>
        );
      })}
      {els.length === 0 && <div className="ui-canvas-hint">{edit ? "Add elements from the library's Elements tab" : null}</div>}
    </div>
  );

  // ── Kept components ───────────────────────────────────────────────────────

  const renderHero = (): ReactNode => {
    const headings = byType("heading");
    const texts = byType("text");
    const buttons = byType("button");
    const imageEl = first("image");
    const copy = (
      <>
        {headings[0] && <h1 className="ui-h1">{elTok(headings[0], "")}</h1>}
        {texts.map((t) => <p key={t.id} className="ui-lede">{elTok(t, "")}</p>)}
        <div className="ui-row">
          {buttons.map((b) => <Fragment key={b.id}>{elTok(b, btnClass(b))}</Fragment>)}
          {addEl("button", "Add button")}
        </div>
      </>
    );
    if (shape === "split") {
      return (
        <section className="ui-hero split">
          <div className="ui-hero-copy">{copy}</div>
          <div className="ui-image-ph tall">
            <ImageIcon />
            {imageEl ? elTok(imageEl, "ui-image-cap") : addEl("image", "Add image")}
          </div>
        </section>
      );
    }
    return <section className="ui-hero">{copy}</section>;
  };

  const renderDetail = (): ReactNode => {
    const fields = byType("field");
    const badges = byType("badge");
    const buttons = byType("button");
    const body = (
      <div className="ui-rpanel">
        <div className="ui-panel-head">
          <div className="ui-h3">{text("heading", str("heading", "Ada Lovelace"))}</div>
          {text("status", str("status", "Active"), `ui-badge${statusTone(scalarOf("status") ?? "Active")}`)}
          {badges.map((b) => <Fragment key={b.id}>{elTok(b, `ui-badge${statusTone(b.label)}`)}</Fragment>)}
        </div>
        <dl className="ui-dl">
          {fields.map((f) => {
            const v = f.data?.value ?? "";
            return (
              <Fragment key={f.id}>
                <dt>{elTok(f, "")}</dt>
                <dd>{dataTok(f, "value", "—", f.data?.kind === "status" || isStatus(v) ? `ui-badge${statusTone(v)}` : "")}</dd>
              </Fragment>
            );
          })}
          {addEl("field", "Add field")}
        </dl>
        {buttons.length > 0 && <div className="ui-row">{buttons.map((b) => <Fragment key={b.id}>{elTok(b, btnClass(b, "sm"))}</Fragment>)}</div>}
      </div>
    );
    return shape === "card" ? <div className="ui-card">{body}</div> : body;
  };

  const renderEmpty = (): ReactNode => {
    const headings = byType("heading");
    const texts = byType("text");
    const buttons = byType("button");
    return (
      <div className="ui-card ui-empty">
        <div className="ui-empty-icon" aria-hidden><InboxIcon /></div>
        {headings[0] && <div className="ui-h3">{elTok(headings[0], "")}</div>}
        {texts.map((t) => <p key={t.id} className="ui-p">{elTok(t, "")}</p>)}
        <div className="ui-row">
          {buttons.map((b) => <Fragment key={b.id}>{elTok(b, btnClass(b))}</Fragment>)}
          {addEl("button", "Add button")}
        </div>
      </div>
    );
  };

  const renderMain = (): ReactNode => (
    <article className="ui-article">
      {byType("section").map((s2) => (
        <section key={s2.id}>
          <h2 className="ui-h2">{elTok(s2, "")}</h2>
          <p className="ui-p">{dataTok(s2, "body", "Body text for this section.")}</p>
        </section>
      ))}
      {addEl("section", "Add section")}
    </article>
  );

  const renderModal = (): ReactNode => (
    <div className="ui-modal-scrim">
      <div className="ui-modal" role="dialog" aria-label={title}>
        <div className="ui-h3">{text("title", title)}</div>
        {byType("text").map((t) => <p key={t.id} className="ui-p">{elTok(t, "")}</p>)}
        <div className="ui-modal-foot">
          {byType("button").map((b) => <Fragment key={b.id}>{elTok(b, btnClass(b))}</Fragment>)}
          {addEl("button", "Add button")}
        </div>
      </div>
    </div>
  );

  const renderFooter = (): ReactNode => (
    <footer className="ui-footer">
      <span className="ui-footer-copy">{text("copyright", str("copyright", "© 2026 Acme"))}</span>
      <nav className="ui-footer-links">
        {byType("link").map((l) => <Fragment key={l.id}>{elTok(l, "ui-footer-link")}</Fragment>)}
        {addEl("link", "Add link")}
      </nav>
    </footer>
  );

  switch (cmp.type) {
    case "navbar": return renderNavbar();
    case "list": return renderList();
    case "form": return renderForm();
    case "graph": return renderGraph();
    case "canvas": return renderCanvas();
    case "calendar": return renderCalendar();
    case "hero": return renderHero();
    case "detail": return renderDetail();
    case "empty": return renderEmpty();
    case "main": return renderMain();
    case "modal": return renderModal();
    case "footer": return renderFooter();

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
}

const sameView = (view: string, shape: string): boolean => view.trim().toLowerCase().startsWith(shape === "day" ? "day" : shape);

const initialsOf = (name: string): string => {
  const trimmed = name.trim();
  if (/^[A-Z]{2}$/.test(trimmed)) return trimmed;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") : "?";
};

/** Small deterministic hash so two same-kind columns show different samples. */
function hashOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h % 4;
}
