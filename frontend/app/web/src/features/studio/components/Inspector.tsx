// Right panel: the current selection first — element, then its parent
// component, or the region — with page settings always at the bottom. Text
// inputs commit on blur or Enter so one edit is one undo step. Element
// selections carry the link picker: a link targets a page, or creates a new
// page inside a region of this one (the outlet model).
import { useEffect, useRef, useState } from "react";
import type { Dataset } from "../../project/datasets/datasetsApi";
import { parseDatasetValues, splitTerms } from "../../project/datasets/datasetValues";
import type { PageSummary } from "../../projects/projectsApi";
import {
  anyElementMeta, borderShown, COMPONENTS, DataFieldMeta, EL_FILL_OPTIONS, EL_ROTATION_OPTIONS, ElementTypeMeta, EL_VARIANT_OPTIONS, elementGroups, elementMeta, FONTS, FORM_SPAN_OPTIONS, imageList, INPUT_TYPES, isFormFieldType, LIST_ALIGN_OPTIONS, LIST_ALIGNABLE, listAlign,
  LOGO_ICONS, NAV_ALIGN_OPTIONS, NAV_ICONS, navAlign,
} from "../catalog";
import { elementLink, elementTypeOptions, elementValue, EL_PREFIX, findElement, isElKey, locateCmp, TYPE_OPTIONS } from "../model/actions";
import { ComposedRegions } from "../model/linkRegions";
import { byPos } from "../model/positions";
import { cmpSize, findNode, SplitSide } from "../model/tree";
import { BACK_PAGE_ID, ComponentNode, LinkTarget, PageDocument, PagePresentation, PageRecord, Size } from "../model/types";
import { NAV_ICON_MARKS, navIconGlyph } from "./icons";
import { isSvgFile, readImageFile } from "./imageFile";
import type { ProjectPageSummary } from "../../project/wireframes/wireframesApi";
import { LinkPicker } from "./LinkPicker";
import { ElementSel, Selection } from "./selection";

interface Props {
  page: PageRecord;
  /** Every document on the canvas: the open page's first, then its ancestor
   *  shells — a selection can live in any of them. */
  documents: readonly PageDocument[];
  pages: PageSummary[];
  /** Every page of the project — other wireframes' pages are linkable as
   *  shared pages. */
  projectPages?: ProjectPageSummary[];
  wireframeId?: string;
  /** Bindable datasets: platform defaults (read-only) + this project's own. */
  datasets: readonly Dataset[];
  selection: Selection | null;
  selectedCmp: ComponentNode | null;
  canWrite: boolean;
  onPageField(field: "name", value: string): void;
  onCmpType(id: string, type: string): void;
  onCmpShape(id: string, shape: string): void;
  onCmpLayout(id: string, layout: string): void;
  onCmpLabel(id: string, label: string): void;
  /** Freeform style props (bg, font, caps) on the component. */
  onCmpProp(id: string, key: string, value: string): void;
  /** Height mode: hug content, fill the region, or a fixed pixel height. */
  onCmpHeight(id: string, mode: "hug" | "fill" | number): void;
  /** Fixed pixel width, or null to fit the region again. */
  onCmpWidth(id: string, w: number | null): void;
  /** Float the component over its region (stacking) or return it to the flow. */
  onCmpFloat(id: string, floating: boolean): void;
  /** Canvases in the selected component's region it can be placed inside. */
  canvasesBeside: { id: string; label: string }[];
  onCmpCanvas(id: string, canvasId: string | null): void;
  onRegionLabel(id: string, label: string): void;
  onRegionBg(id: string, bg: string): void;
  onRegionSize(id: string, size: Size): void;
  onRegionDir(id: string, dir: "row" | "col" | "free"): void;
  onSplit(id: string, side: SplitSide): void;
  onRemoveRegion(id: string): void;
  /** The shell region the selected region's page is placed in, if any. */
  enclosingRegion: { id: string; label: string } | null;
  onSelectRegion(id: string): void;
  onElementText(sel: ElementSel, text: string): void;
  onElementData(sel: ElementSel, key: string, value: string): void;
  /** Turn the element into another type of its component's vocabulary. */
  onElementType(sel: ElementSel, type: string): void;
  /** Step the element one place earlier/later in its component's order, or
   *  jump it to either end (a canvas child's stacking order). */
  onMoveElement(sel: ElementSel, delta: -1 | 1 | "front" | "back"): void;
  onRemoveElement(sel: ElementSel): void;
  onSetLink(sel: ElementSel, target: LinkTarget | null): void;
  onCreateLinkedPage(sel: ElementSel, regionId: string | null, presentation?: PagePresentation): void;
  /** The link menu's Region list is hovering a region: the canvas outlines it. */
  onHoverLinkRegion(regionId: string | null): void;
  /** The visible composition's regions (open page + ancestor shells), for
   *  the link menu's Region list. */
  linkRegions: ComposedRegions;
  /** How this page opens when linked to: navigate (null), modal or drawer. */
  onPagePresentation(value: PagePresentation | null): void;
  /** Open the new-dataset drawer; on save the element's `fieldKey` binds to it. */
  onCreateDataset(sel: ElementSel, fieldKey: string): void;
  onUpdateDatasetValues(id: string, values: string[]): void;
  onUpdateDatasetTerms(id: string, terms: string[]): void;
  /** Delete a project dataset and clear this element's binding to it. */
  onDeleteDataset(sel: ElementSel, fieldKey: string, id: string): void;
}

function CommitInput({ value, onCommit, disabled, id }: { value: string; onCommit(v: string): void; disabled?: boolean; id?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <input
      id={id}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(value);
      }}
    />
  );
}

/** Multi-line commit-on-blur editor, one entry per line (dataset values). */
function CommitTextarea({ value, onCommit, disabled }: { value: string; onCommit(v: string): void; disabled?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <textarea
      rows={4}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") setText(value);
      }}
    />
  );
}

/** Dataset binding: "Custom values" (unbound), the platform defaults, or one
 *  of this project's own lists — plus "New…" to create one from here. */
function DatasetPicker({
  datasets, value, disabled, onPick, onNew,
}: {
  datasets: readonly Dataset[];
  value: string;
  disabled?: boolean;
  onPick(id: string): void;
  onNew(): void;
}) {
  const platform = datasets.filter((d) => d.scope === "platform");
  const project = datasets.filter((d) => d.scope === "project");
  const known = datasets.some((d) => d.id === value);
  return (
    <div className="insp-logo">
      <select value={known ? value : ""} disabled={disabled} onChange={(e) => onPick(e.target.value)}>
        <option value="">Custom values</option>
        {platform.length > 0 && (
          <optgroup label="Standard">
            {platform.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </optgroup>
        )}
        {project.length > 0 && (
          <optgroup label="This project">
            {project.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </optgroup>
        )}
      </select>
      {!disabled && <button type="button" className="btn small ghost" onClick={onNew}>New…</button>}
    </div>
  );
}

/** Colour swatch that commits ~400ms after the last change (native pickers
 *  fire continuously while dragging) plus a Clear back to the default. */
function ColourField({ label, value, onCommit, disabled, fallback = "#f4f1ea" }: { label: string; value: string; onCommit(v: string): void; disabled?: boolean; fallback?: string }) {
  const [c, setC] = useState(value);
  const timer = useRef<number>();
  useEffect(() => setC(value), [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const set = (v: string) => {
    setC(v);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onCommit(v), 400);
  };
  return (
    <div className="field">
      <label>{label}</label>
      <div className="insp-colour">
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : fallback} disabled={disabled} onChange={(e) => set(e.target.value)} />
        {value && !disabled && <button className="btn small ghost" onClick={() => onCommit("")}>Clear</button>}
      </div>
    </div>
  );
}

/** Background / text colour / font / capitalisation — the same set for
 *  components and elements; nothing is enforced, these are the user's
 *  wireframe choices. */
function StyleFields({ bg, fg, font, caps, set, ro }: { bg: string; fg: string; font: string; caps: string; set(key: "bg" | "fg" | "font" | "caps", v: string): void; ro: boolean }) {
  return (
    <>
      <ColourField label="Background" value={bg} onCommit={(v) => set("bg", v)} disabled={ro} />
      <ColourField label="Text colour" value={fg} onCommit={(v) => set("fg", v)} disabled={ro} fallback="#16161C" />
      <div className="field">
        <label>Font</label>
        <select value={font} disabled={ro} onChange={(e) => set("font", e.target.value)}>
          <option value="">Default</option>
          {FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Text</label>
        <select value={caps} disabled={ro} onChange={(e) => set("caps", e.target.value)}>
          <option value="">Default</option>
          <option value="caps">Capitals</option>
          <option value="lower">Lower case</option>
        </select>
      </div>
    </>
  );
}

/** Bold / italic / underline / strikethrough toggles for an element's text,
 *  stored as "1" (on) or blank (off) under data.bold/italic/underline/strike. */
const TEXT_EMPHASIS = [
  { key: "bold", label: "Bold", glyph: <b>B</b> },
  { key: "italic", label: "Italic", glyph: <i>I</i> },
  { key: "underline", label: "Underline", glyph: <u>U</u> },
  { key: "strike", label: "Strikethrough", glyph: <s>S</s> },
] as const;

function EmphasisField({ data, set, ro }: { data: Record<string, string> | undefined; set(key: string, v: string): void; ro: boolean }) {
  return (
    <div className="field">
      <label>Emphasis</label>
      <div className="seg insp-emphasis" role="group" aria-label="Text emphasis">
        {TEXT_EMPHASIS.map((t) => {
          const on = data?.[t.key] === "1";
          return (
            <button
              key={t.key}
              type="button"
              className={on ? "active" : ""}
              title={t.label}
              aria-label={t.label}
              aria-pressed={on}
              disabled={ro}
              onClick={() => set(t.key, on ? "" : "1")}
            >
              {t.glyph}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** An element's border: on / off (data.border; choosing the type's own
 *  default clears the key) and, while it shows, its colour. */
function BorderField({ meta, data, set, ro }: { meta: ElementTypeMeta; data: Record<string, string> | undefined; set(key: string, v: string): void; ro: boolean }) {
  const shown = borderShown(meta, data);
  const choose = (on: boolean) => set("border", on === !!meta.borderByDefault ? "" : on ? "on" : "off");
  return (
    <>
      <div className="field">
        <label>Border</label>
        <div className="seg" role="group" aria-label="Border">
          <button type="button" className={shown ? "active" : ""} aria-pressed={shown} disabled={ro} onClick={() => choose(true)}>On</button>
          <button type="button" className={shown ? "" : "active"} aria-pressed={!shown} disabled={ro} onClick={() => choose(false)}>Off</button>
        </div>
      </div>
      {shown && <ColourField label="Border colour" value={data?.borderColour ?? ""} onCommit={(v) => set("borderColour", v)} disabled={ro} fallback="#B4BCC5" />}
    </>
  );
}

/** Plain image upload (the image element): upload / replace / remove. */
function ImageField({ value, onCommit, disabled }: { value: string; onCommit(v: string): void; disabled?: boolean }) {
  return (
    <div className="insp-logo">
      {!disabled && (
        <label className="btn small ghost insp-upload">
          {value ? "Replace…" : "Upload…"}
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readImageFile(f, 640, onCommit);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {value && !disabled && <button className="btn small ghost" onClick={() => onCommit("")}>Remove</button>}
      {disabled && <span className="insp-hint">{value ? "Image set" : "No image"}</span>}
    </div>
  );
}

/** Several images (an image column's pictures, FS-REQ-70): numbered
 *  thumbnails in the order the rows use them, dragged to reorder and removed
 *  one by one, and an upload that takes any number at once. Each is
 *  downscaled to 320px and stored inline; the field holds a JSON array. */
function ImagesField({ value, onCommit, disabled }: { value: string; onCommit(v: string): void; disabled?: boolean }) {
  const images = imageList(value);
  /** The thumbnail being dragged, and the one it would land before. */
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...images];
    const [src] = next.splice(from, 1);
    next.splice(to, 0, src);
    save(next);
  };
  const save = (next: string[]) => onCommit(next.length ? JSON.stringify(next) : "");
  const upload = (files: File[]) => {
    const read: string[] = new Array(files.length);
    let left = files.length;
    files.forEach((f, i) =>
      readImageFile(f, 320, (url) => {
        read[i] = url;
        if (--left === 0) save([...images, ...read.filter(Boolean)]);
      }),
    );
  };
  return (
    <div className="insp-images">
      {images.length > 0 && (
        <div className="insp-image-grid">
          {images.map((src, i) => (
            <div
              key={i}
              className={`insp-image-thumb${!disabled ? " movable" : ""}${dragFrom === i ? " dragging" : ""}${dropAt === i && dragFrom !== i ? " drop" : ""}`}
              draggable={!disabled}
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (dragFrom == null) return;
                e.preventDefault();
                if (dropAt !== i) setDropAt(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom != null) move(dragFrom, i);
                setDragFrom(null);
                setDropAt(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDropAt(null);
              }}
            >
              <img src={src} alt={`Image ${i + 1}`} draggable={false} />
              <span className="insp-image-n">{i + 1}</span>
              {!disabled && (
                <button
                  type="button"
                  className="insp-image-x"
                  title="Remove image"
                  aria-label={`Remove image ${i + 1}`}
                  onClick={() => save(images.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!disabled && (
        <label className="btn small ghost insp-upload">
          {images.length ? "Add images…" : "Upload images…"}
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/") || isSvgFile(f));
              if (files.length) upload(files);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {disabled && <span className="insp-hint">{images.length ? `${images.length} image${images.length === 1 ? "" : "s"}` : "No images"}</span>}
    </div>
  );
}

/** Brand logo: a built-in icon, an uploaded image (downscaled to 240px and
 *  stored inline as PNG — enough for a wide logo sized up in the bar), or no
 *  logo at all. */
function LogoField({ value, onCommit, disabled }: { value: string; onCommit(v: string): void; disabled?: boolean }) {
  const isImage = value.startsWith("data:");
  const upload = (file: File) => readImageFile(file, 240, onCommit, true);
  return (
    <div className="insp-logo">
      <select
        value={isImage ? "__image" : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value !== "__image") onCommit(e.target.value);
        }}
      >
        <option value="">Default mark</option>
        <option value="none">No logo</option>
        {LOGO_ICONS.map((n) => <option key={n} value={n}>{n[0].toUpperCase() + n.slice(1)}</option>)}
        {isImage && <option value="__image">Uploaded image</option>}
      </select>
      {!disabled && (
        <label className="btn small ghost insp-upload">
          Upload…
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Nav-item icon: a built-in mark, an uploaded image (downscaled to 96px and
 *  stored inline), or unset — the canvas placeholder square. The set is big,
 *  so the control is a trigger + menu with a search box over the glyph grid.
 *  Unlike the link picker's in-flow menu, this one OVERLAYS the fields below
 *  (the grid is tall; pushing everything down read badly), so it also closes
 *  on an outside click. */
function IconPicker({ value, onCommit, disabled }: { value: string; onCommit(v: string): void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const isImage = value.startsWith("data:");
  const glyph = isImage ? null : navIconGlyph(value);
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const pick = (v: string) => {
    onCommit(v);
    close();
  };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const filtered = NAV_ICONS.filter((n) => n.includes(query.trim().toLowerCase()));
  return (
    <div ref={rootRef} className="link-picker icon-picker" onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
      <button type="button" className="link-trigger" disabled={disabled} onClick={() => (open ? close() : setOpen(true))}>
        {isImage ? <img className="icon-thumb" src={value} alt="" /> : glyph ? <span className="icon-glyph" aria-hidden>{glyph}</span> : <span className="ui-icon" aria-hidden />}
        <span className="name">{isImage ? "Uploaded image" : glyph ? cap(value) : "Placeholder"}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="link-menu icon-menu">
          <input
            autoFocus
            className="link-search"
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered[0]) { pick(filtered[0]); e.preventDefault(); }
            }}
          />
          <div className="icon-grid">
            {filtered.map((n) => (
              <button key={n} type="button" className={`insp-icon-btn${value === n ? " on" : ""}`} title={cap(n)} onClick={() => pick(n)}>
                {NAV_ICON_MARKS[n]}
              </button>
            ))}
            {filtered.length === 0 && <div className="link-empty">No icons match “{query}”</div>}
          </div>
          <div className="icon-menu-foot">
            <div className={`link-opt${!value ? " active" : ""}`} onClick={() => pick("")}>
              <span className="ui-icon" aria-hidden />
              Placeholder
            </div>
            <label className={`link-opt${isImage ? " active" : ""}`}>
              {isImage ? "Replace image…" : "Upload image…"}
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) readImageFile(f, 96, pick);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

const sizeMode = (size: Size): "fill" | "px" | "auto" => (size === "auto" ? "auto" : typeof size === "number" ? "px" : "fill");

/** Switching a component to "Fixed (px)" freezes its current rendered box —
 *  measured off the canvas — so nothing jumps; fallbacks only apply when the
 *  component is somehow not on screen. */
function renderedCmpSize(cmpId: string): { w: number; h: number } {
  // offset*, not the bounding rect: a fitted stage renders the device smaller
  // than the pixels the size is stored in (see stage.tsx).
  const el = document.querySelector(`.cmp[data-cmp-id="${CSS.escape(cmpId)}"]`) as HTMLElement | null;
  return { w: el?.offsetWidth || 320, h: el?.offsetHeight || 200 };
}

/** The data fields to show for an element: a manual text field (samples,
 *  options) steps aside while the dataset field superseding it is bound to a
 *  list that still exists — a dangling binding brings the manual field back. */
function visibleDataFields(
  meta: { dataFields: DataFieldMeta[] } | null,
  data: Record<string, string> | undefined,
  datasets: readonly Dataset[],
): DataFieldMeta[] {
  if (!meta) return [];
  const offered = (f: DataFieldMeta) => !f.forKinds || f.forKinds.includes(data?.kind ?? "");
  const replaced = new Set(meta.dataFields.filter(offered).flatMap((f) => f.replaces ?? []));
  return meta.dataFields.filter(
    (f) =>
      offered(f) &&
      !replaced.has(f.key) &&
      !meta.dataFields.some(
        (dsf) => dsf.kind === "dataset" && dsf.supersedes === f.key && datasets.some((d) => d.id === data?.[dsf.key]),
      ),
  );
}

export function Inspector(props: Props) {
  const { page, documents, pages, selection, selectedCmp, canWrite } = props;
  const ro = !canWrite;

  /** The document holding the selected component — the open page's, or an
   *  ancestor shell's when a shell component is selected. */
  const docOfCmp = (cmpId: string): PageDocument => documents.find((d) => locateCmp(d, cmpId)) ?? page.document;

  const regionSel =
    selection?.kind === "region"
      ? documents.map((d) => findNode(d.root, selection.id)).find((found) => found != null) ?? null
      : null;
  const regionNode = regionSel?.node.kind === "region" ? regionSel.node : null;
  const elementSel = selection?.kind === "element" && selectedCmp ? selection : null;
  const link = elementSel && selectedCmp ? elementLink(selectedCmp, elementSel.key, elementSel.index) : null;
  const isBackLink = !!link && link.pageId === BACK_PAGE_ID;
  const linkTargetPage = link && !isBackLink
    ? pages.find((p) => p.id === link.pageId) ?? props.projectPages?.find((p) => p.id === link.pageId)
    : null;
  const cmpMeta = selectedCmp ? COMPONENTS[selectedCmp.type] ?? null : null;
  // A selected element node (as opposed to a scalar prop token).
  const elementNode =
    elementSel && selectedCmp && isElKey(elementSel.key) ? findElement(selectedCmp, elementSel.key.slice(EL_PREFIX.length)) : null;
  const elementNodeMeta = elementNode && selectedCmp ? elementMeta(selectedCmp.type, elementNode.type) : null;
  // Order and alignment: elements render in pos order; a horizontal nav bar
  // additionally splits into left/centre/right zones by data.align.
  const sortedEls = selectedCmp?.elements ? byPos(selectedCmp.elements) : [];
  const elIndex = elementNode ? sortedEls.findIndex((e) => e.id === elementNode.id) : -1;
  const showAlign =
    !!elementNode && selectedCmp?.type === "navbar" && (selectedCmp.layout ?? cmpMeta?.defaultLayout) === "horizontal";
  // A list's filters, search and buttons each pick a side of their line.
  const showListAlign = !!elementNode && selectedCmp?.type === "list" && LIST_ALIGNABLE.has(elementNode.type);
  // A form field's share of its row (FS-REQ-74); an inline form is one row.
  const showFormSpan =
    !!elementNode && selectedCmp?.type === "form" && (selectedCmp.shape ?? cmpMeta?.defaultShape) !== "inline" && isFormFieldType(elementNode.type);
  const listBesideTitle = !!selectedCmp?.elements?.some((e) => e.type === "header" && e.data?.placement !== "above");
  // Nav items carry an icon only in the Icons shape (it is what draws them).
  const showIcon =
    elementNode?.type === "nav-item" && selectedCmp?.type === "navbar" && (selectedCmp.shape ?? cmpMeta?.defaultShape) === "icons";

  // The aside/panel-head shell (with the collapse button and the
  // Inspector | Notes | Tasks tab strip) lives in StudioPage now; this
  // renders only the body, so the tabs can swap it for the AnnotationsPanel.
  return (
    <div className="panel-body">
        {elementSel && selectedCmp && (
          <div className="insp-section">
            <h4>{elementNodeMeta ? `Element · ${elementNodeMeta.label}` : "Element"}</h4>
            {elementNode && elementNodeMeta && (() => {
              // Type → shape (FS-REQ-84): changing the type moves to its first
              // shape this component still has room for.
              const groups = elementGroups(selectedCmp.type);
              const full = new Set(elementTypeOptions(selectedCmp, elementNode.id).filter((o) => o.full).map((o) => o.type));
              // A list column is plain text, an input in every cell (data.input
              // names the input shape), or a picture (the image data kind):
              // its Type and Shape choose between those rather than turning
              // it into some other element.
              if (elementNode.type === "column") {
                const set = (k: string, v: string) => props.onElementData(elementSel, k, v);
                const input = elementNode.data?.input ?? "";
                const colType = elementNode.data?.kind === "image" ? "image" : input ? "input" : "text";
                const pickType = (t: string) => {
                  if (t === colType) return;
                  if (t === "image") {
                    set("kind", "image");
                    if (input) set("input", "");
                  } else {
                    if (colType === "image") set("kind", "text");
                    set("input", t === "input" ? "text-input" : "");
                  }
                };
                return (
                  <>
                    <div className="field">
                      <label>Type</label>
                      <select value={colType} disabled={ro} onChange={(e) => pickType(e.target.value)}>
                        <option value="text">Text</option>
                        <option value="input">Input</option>
                        <option value="image">Image</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>Shape</label>
                      {colType === "input" ? (
                        <select value={input} disabled={ro} onChange={(e) => set("input", e.target.value)}>
                          {INPUT_TYPES.map((t) => (
                            <option key={t} value={t}>{anyElementMeta(t)?.label ?? t}</option>
                          ))}
                        </select>
                      ) : (
                        <select value="column" disabled>
                          <option value="column">{colType === "image" ? "Picture" : "Column"}</option>
                        </select>
                      )}
                    </div>
                  </>
                );
              }
              const shapes = groups.find((g) => g.id === elementNodeMeta.group)?.shapes ?? [];
              return (
                <>
                  <div className="field">
                    <label>Type</label>
                    <select
                      value={elementNodeMeta.group}
                      disabled={ro}
                      onChange={(e) => {
                        const first = groups.find((g) => g.id === e.target.value)?.shapes.find((m) => !full.has(m.type));
                        if (first) props.onElementType(elementSel, first.type);
                      }}
                    >
                      {groups.map((g) => (
                        <option key={g.id} value={g.id} disabled={g.shapes.every((m) => full.has(m.type))}>{g.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Shape</label>
                    <select
                      value={elementNode.type}
                      disabled={ro}
                      onChange={(e) => props.onElementType(elementSel, e.target.value)}
                    >
                      {shapes.map((m) => (
                        <option key={m.type} value={m.type} disabled={full.has(m.type)}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </>
              );
            })()}
            {/* A nav bar dropdown has no visible text of its own (it reads
                "Select" until a dataset gives it a value), and an icon or a
                line draws none, so no Text field. */}
            {!(elementNode?.type === "select" && selectedCmp.type === "navbar") && !elementNodeMeta?.noText && (
              <div className="field">
                <label>Text</label>
                <CommitInput
                  value={elementValue(selectedCmp, elementSel.key, elementSel.index)}
                  onCommit={(v) => props.onElementText(elementSel, v)}
                  disabled={ro}
                />
              </div>
            )}
            {elementNode &&
              visibleDataFields(elementNodeMeta, elementNode.data, props.datasets).map((f) => {
                if (f.kind === "dataset") {
                  const bound = props.datasets.find((d) => d.id === elementNode.data?.[f.key]) ?? null;
                  return (
                    <div key={f.key}>
                      <div className="field">
                        <label>{f.label}</label>
                        <DatasetPicker
                          datasets={props.datasets}
                          value={elementNode.data?.[f.key] ?? ""}
                          disabled={ro}
                          onPick={(id) => props.onElementData(elementSel, f.key, id)}
                          onNew={() => props.onCreateDataset(elementSel, f.key)}
                        />
                      </div>
                      {bound && (
                        <div className="field">
                          <label>Values</label>
                          <CommitTextarea
                            value={bound.values.join("\n")}
                            disabled={ro || bound.scope === "platform"}
                            onCommit={(text) =>
                              props.onUpdateDatasetValues(
                                bound.id,
                                parseDatasetValues(text),
                              )
                            }
                          />
                        </div>
                      )}
                      {bound && (
                        <div className="field">
                          <label>Matching terms</label>
                          <CommitInput
                            value={(bound.match_terms ?? []).join(", ")}
                            disabled={ro || bound.scope === "platform"}
                            onCommit={(text) => props.onUpdateDatasetTerms(bound.id, splitTerms(text))}
                          />
                        </div>
                      )}
                      {bound && bound.scope === "project" && !ro && (
                        <div className="field">
                          <label />
                          <div className="insp-btn-row">
                            <button
                              className="btn small ghost danger"
                              onClick={() => props.onDeleteDataset(elementSel, f.key, bound.id)}
                            >
                              Delete dataset
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  {f.kind === "icon" ? (
                    <IconPicker
                      value={elementNode.data?.[f.key] ?? ""}
                      onCommit={(v) => props.onElementData(elementSel, f.key, v)}
                      disabled={ro}
                    />
                  ) : f.kind === "logo" ? (
                    <LogoField
                      value={elementNode.data?.[f.key] ?? ""}
                      onCommit={(v) => props.onElementData(elementSel, f.key, v)}
                      disabled={ro}
                    />
                  ) : f.kind === "images" ? (
                    <ImagesField
                      value={elementNode.data?.[f.key] ?? ""}
                      onCommit={(v) => props.onElementData(elementSel, f.key, v)}
                      disabled={ro}
                    />
                  ) : f.kind === "image" ? (
                    <ImageField
                      value={elementNode.data?.[f.key] ?? ""}
                      onCommit={(v) => props.onElementData(elementSel, f.key, v)}
                      disabled={ro}
                    />
                  ) : f.kind === "select" ? (
                    <select
                      value={elementNode.data?.[f.key] ?? ""}
                      disabled={ro}
                      onChange={(e) => props.onElementData(elementSel, f.key, e.target.value)}
                    >
                      {!(f.options ?? []).includes(elementNode.data?.[f.key] ?? "") && <option value="">—</option>}
                      {(f.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <CommitInput
                      value={elementNode.data?.[f.key] ?? ""}
                      onCommit={(v) => props.onElementData(elementSel, f.key, v)}
                      disabled={ro}
                    />
                  )}
                </div>
                );
              })}
            {elementNode && (
              <>
                {showIcon && (
                  <div className="field">
                    <label>Icon</label>
                    <IconPicker
                      value={elementNode.data?.icon ?? ""}
                      onCommit={(v) => props.onElementData(elementSel, "icon", v)}
                      disabled={ro}
                    />
                  </div>
                )}
                {elementNodeMeta?.rotatable && (
                  <div className="field">
                    <label>Rotation</label>
                    <select
                      value={elementNode.data?.rotate || "0"}
                      disabled={ro}
                      onChange={(e) => props.onElementData(elementSel, "rotate", e.target.value === "0" ? "" : e.target.value)}
                    >
                      {EL_ROTATION_OPTIONS.map((r) => (
                        <option key={r} value={r}>{r}°</option>
                      ))}
                    </select>
                  </div>
                )}
                {elementNodeMeta?.variantable && (
                  <div className="field">
                    <label>Variant</label>
                    <select
                      value={elementNode.data?.variant ?? ""}
                      disabled={ro}
                      onChange={(e) => props.onElementData(elementSel, "variant", e.target.value)}
                    >
                      <option value="">Default</option>
                      {EL_VARIANT_OPTIONS.map((s) => (
                        <option key={s} value={s}>{cap(s)}</option>
                      ))}
                    </select>
                  </div>
                )}
                {elementNodeMeta?.fillable && (
                  <div className="field">
                    <label>Fill</label>
                    <select
                      value={elementNode.data?.fill ?? ""}
                      disabled={ro}
                      onChange={(e) => props.onElementData(elementSel, "fill", e.target.value)}
                    >
                      <option value="">Default</option>
                      {EL_FILL_OPTIONS.map((f) => (
                        <option key={f} value={f}>{cap(f)}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="field">
                  <label>Font size</label>
                  <CommitInput
                    value={elementNode.data?.fontSize ?? ""}
                    onCommit={(v) => props.onElementData(elementSel, "fontSize", v)}
                    disabled={ro}
                  />
                </div>
                <StyleFields
                  bg={elementNode.data?.bg ?? ""}
                  fg={elementNode.data?.fg ?? ""}
                  font={elementNode.data?.font ?? ""}
                  caps={elementNode.data?.caps ?? ""}
                  set={(k, v) => props.onElementData(elementSel, k, v)}
                  ro={ro}
                />
                {!elementNodeMeta?.noText && (
                  <EmphasisField data={elementNode.data} set={(k, v) => props.onElementData(elementSel, k, v)} ro={ro} />
                )}
                {elementNodeMeta?.bordered && (
                  <BorderField meta={elementNodeMeta} data={elementNode.data} set={(k, v) => props.onElementData(elementSel, k, v)} ro={ro} />
                )}
                {showAlign && (
                  <div className="field">
                    <label>Alignment</label>
                    <select
                      value={navAlign(elementNode)}
                      disabled={ro}
                      onChange={(e) => props.onElementData(elementSel, "align", e.target.value)}
                    >
                      {NAV_ALIGN_OPTIONS.map((a) => (
                        <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                )}
                {showListAlign && (
                  <div className="field">
                    <label>Alignment</label>
                    <select
                      value={listAlign(elementNode, listBesideTitle)}
                      disabled={ro}
                      onChange={(e) => props.onElementData(elementSel, "align", e.target.value)}
                    >
                      {LIST_ALIGN_OPTIONS.map((a) => (
                        <option key={a} value={a}>{cap(a)}</option>
                      ))}
                    </select>
                  </div>
                )}
                {showFormSpan && (
                  <div className="field">
                    <label>Row width</label>
                    <select
                      value={elementNode.data?.span ?? ""}
                      disabled={ro}
                      onChange={(e) => props.onElementData(elementSel, "span", e.target.value)}
                    >
                      <option value="">Follow layout</option>
                      {FORM_SPAN_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                {selectedCmp.type !== "canvas" && !ro && (
                  <div className="field">
                    <label>Order</label>
                    <div className="insp-btn-row">
                      <button className="btn small" disabled={elIndex <= 0} onClick={() => props.onMoveElement(elementSel, -1)}>
                        Earlier
                      </button>
                      <button
                        className="btn small"
                        disabled={elIndex < 0 || elIndex >= sortedEls.length - 1}
                        onClick={() => props.onMoveElement(elementSel, 1)}
                      >
                        Later
                      </button>
                    </div>
                  </div>
                )}
                {selectedCmp.type === "canvas" && !ro && (
                  <div className="field">
                    <label>Stacking</label>
                    <div className="insp-btn-row">
                      <button
                        className="btn small"
                        disabled={elIndex < 0 || elIndex >= sortedEls.length - 1}
                        onClick={() => props.onMoveElement(elementSel, "front")}
                      >
                        To front
                      </button>
                      <button
                        className="btn small"
                        disabled={elIndex < 0 || elIndex >= sortedEls.length - 1}
                        onClick={() => props.onMoveElement(elementSel, 1)}
                      >
                        Forward
                      </button>
                      <button className="btn small" disabled={elIndex <= 0} onClick={() => props.onMoveElement(elementSel, -1)}>
                        Backward
                      </button>
                      <button className="btn small" disabled={elIndex <= 0} onClick={() => props.onMoveElement(elementSel, "back")}>
                        To back
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="field link-field">
              <label>Link</label>
              <LinkPicker
                key={`${elementSel.cmpId}:${elementSel.key}:${elementSel.index ?? ""}`}
                pages={pages}
                projectPages={props.projectPages}
                wireframeId={props.wireframeId}
                regions={props.linkRegions}
                ownRegionId={locateCmp(docOfCmp(elementSel.cmpId), elementSel.cmpId)?.region ?? null}
                link={link}
                disabled={ro}
                onSet={(target) => props.onSetLink(elementSel, target)}
                onCreatePage={(regionId, presentation) => props.onCreateLinkedPage(elementSel, regionId, presentation)}
                onHoverRegion={props.onHoverLinkRegion}
              />
            </div>
            {link && !isBackLink && !linkTargetPage && <div className="insp-hint">The target page no longer exists.</div>}
            {elementNode && !ro && (
              <button className="btn small ghost danger" onClick={() => props.onRemoveElement(elementSel)}>
                Remove element
              </button>
            )}
          </div>
        )}

        {(selection?.kind === "cmp" || selection?.kind === "element") && selectedCmp && (
          <div className="insp-section">
            <h4>Component</h4>
            <div className="field">
              <label>Type</label>
              <select value={selectedCmp.type} disabled={ro} onChange={(e) => props.onCmpType(selectedCmp.id, e.target.value)}>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{COMPONENTS[t]?.label ?? t}</option>
                ))}
              </select>
            </div>
            {cmpMeta && cmpMeta.shapes.length > 1 && (
              <div className="field">
                <label>Shape</label>
                <select value={selectedCmp.shape ?? cmpMeta.defaultShape} disabled={ro} onChange={(e) => props.onCmpShape(selectedCmp.id, e.target.value)}>
                  {cmpMeta.shapes.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
            {cmpMeta && cmpMeta.layouts.length > 0 && (
              <div className="field">
                <label>Layout</label>
                <select value={selectedCmp.layout ?? cmpMeta.defaultLayout} disabled={ro} onChange={(e) => props.onCmpLayout(selectedCmp.id, e.target.value)}>
                  {cmpMeta.layouts.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
              </div>
            )}
            {/* A card list's fields stack, or sit wherever they are dragged
                within the card (FS-REQ-69). */}
            {selectedCmp.type === "list" && (selectedCmp.shape ?? cmpMeta?.defaultShape) === "cards" && (
              <div className="field">
                <label>Card fields</label>
                <select
                  value={selectedCmp.props?.cardLayout === "free" ? "free" : ""}
                  disabled={ro}
                  onChange={(e) => props.onCmpProp(selectedCmp.id, "cardLayout", e.target.value)}
                >
                  <option value="">Stacked</option>
                  <option value="free">Position freely</option>
                </select>
              </div>
            )}
            {/* A canvas sizes through its Layout (fixed / fill / float). */}
            {selectedCmp.type !== "canvas" && (
              <>
                <div className="field">
                  <label>Placement</label>
                  <select
                    value={
                      typeof selectedCmp.props?.inCanvas === "string" && props.canvasesBeside.some((c) => c.id === selectedCmp.props?.inCanvas)
                        ? `canvas:${selectedCmp.props.inCanvas}`
                        : selectedCmp.props?.float === true
                          ? "float"
                          : "flow"
                    }
                    disabled={ro}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("canvas:")) {
                        props.onCmpCanvas(selectedCmp.id, v.slice("canvas:".length));
                        return;
                      }
                      if (typeof selectedCmp.props?.inCanvas === "string") props.onCmpCanvas(selectedCmp.id, null);
                      props.onCmpFloat(selectedCmp.id, v === "float");
                    }}
                  >
                    <option value="flow">In flow</option>
                    <option value="float">Float over region</option>
                    {props.canvasesBeside.map((c) => (
                      <option key={c.id} value={`canvas:${c.id}`}>Inside {c.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Height</label>
                  <select
                    value={cmpSize(selectedCmp).h != null ? "px" : selectedCmp.props?.size === "fill" ? "fill" : "hug"}
                    disabled={ro}
                    onChange={(e) => {
                      const mode = e.target.value;
                      props.onCmpHeight(selectedCmp.id, mode === "px" ? renderedCmpSize(selectedCmp.id).h : mode === "fill" ? "fill" : "hug");
                    }}
                  >
                    <option value="hug">Hug content</option>
                    <option value="fill">Fill region</option>
                    <option value="px">Fixed (px)</option>
                  </select>
                </div>
                {cmpSize(selectedCmp).h != null && (
                  <div className="field">
                    <label>Pixels</label>
                    <CommitInput
                      value={String(cmpSize(selectedCmp).h)}
                      onCommit={(v) => {
                        const n = Math.round(Number(v));
                        if (Number.isFinite(n) && n >= 24) props.onCmpHeight(selectedCmp.id, n);
                      }}
                      disabled={ro}
                    />
                  </div>
                )}
                <div className="field">
                  <label>Width</label>
                  <select
                    value={cmpSize(selectedCmp).w != null ? "px" : "fit"}
                    disabled={ro}
                    onChange={(e) =>
                      props.onCmpWidth(selectedCmp.id, e.target.value === "px" ? renderedCmpSize(selectedCmp.id).w : null)
                    }
                  >
                    <option value="fit">Fit region</option>
                    <option value="px">Fixed (px)</option>
                  </select>
                </div>
                {cmpSize(selectedCmp).w != null && (
                  <div className="field">
                    <label>Pixels</label>
                    <CommitInput
                      value={String(cmpSize(selectedCmp).w)}
                      onCommit={(v) => {
                        const n = Math.round(Number(v));
                        if (Number.isFinite(n) && n >= 40) props.onCmpWidth(selectedCmp.id, n);
                      }}
                      disabled={ro}
                    />
                  </div>
                )}
              </>
            )}
            <div className="field">
              <label>Label</label>
              <CommitInput value={selectedCmp.label} onCommit={(v) => props.onCmpLabel(selectedCmp.id, v)} disabled={ro} />
            </div>
            <StyleFields
              bg={String(selectedCmp.props?.bg ?? "")}
              fg={String(selectedCmp.props?.fg ?? "")}
              font={String(selectedCmp.props?.font ?? "")}
              caps={String(selectedCmp.props?.caps ?? "")}
              set={(k, v) => props.onCmpProp(selectedCmp.id, k, v)}
              ro={ro}
            />
            <div className="field">
              <label>ID</label>
              <input value={selectedCmp.id} disabled />
            </div>
          </div>
        )}

        {regionNode && (
          <div className="insp-section">
            <h4>Region</h4>
            {props.enclosingRegion && (
              <div className="field">
                <label>Inside</label>
                <button
                  type="button"
                  className="btn small"
                  title="Select this region"
                  onClick={() => props.onSelectRegion(props.enclosingRegion!.id)}
                >
                  {props.enclosingRegion.label}
                </button>
              </div>
            )}
            <div className="field">
              <label>Label</label>
              <CommitInput value={regionNode.label ?? ""} onCommit={(v) => props.onRegionLabel(regionNode.id, v)} disabled={ro} />
            </div>
            <ColourField label="Background" value={regionNode.bg ?? ""} onCommit={(v) => props.onRegionBg(regionNode.id, v)} disabled={ro} />
            <div className="field">
              <label>Size</label>
              <select
                value={sizeMode(regionNode.size)}
                disabled={ro}
                onChange={(e) => {
                  const mode = e.target.value;
                  props.onRegionSize(regionNode.id, mode === "auto" ? "auto" : mode === "px" ? 280 : { fr: 1 });
                }}
              >
                <option value="fill">Fill available space</option>
                <option value="px">Fixed (px)</option>
                <option value="auto">Hug content</option>
              </select>
            </div>
            {typeof regionNode.size === "number" && (
              <div className="field">
                <label>Pixels</label>
                <CommitInput
                  value={String(regionNode.size)}
                  onCommit={(v) => {
                    const n = Math.round(Number(v));
                    if (Number.isFinite(n) && n >= 48) props.onRegionSize(regionNode.id, n);
                  }}
                  disabled={ro}
                />
              </div>
            )}
            <div className="field">
              <label>Layout</label>
              <select
                value={regionNode.dir ?? "col"}
                disabled={ro}
                onChange={(e) => {
                  const v = e.target.value;
                  props.onRegionDir(regionNode.id, v === "row" ? "row" : v === "free" ? "free" : "col");
                }}
              >
                <option value="col">Stack vertically</option>
                <option value="row">Stack horizontally</option>
                <option value="free">Position freely</option>
              </select>
            </div>
            {!ro && (
              <>
                <div className="field">
                  <label>Split</label>
                  <div className="insp-btn-row">
                    <button className="btn small" onClick={() => props.onSplit(regionNode.id, "left")}>+ Left</button>
                    <button className="btn small" onClick={() => props.onSplit(regionNode.id, "top")}>+ Above</button>
                    <button className="btn small" onClick={() => props.onSplit(regionNode.id, "bottom")}>+ Below</button>
                    <button className="btn small" onClick={() => props.onSplit(regionNode.id, "right")}>+ Right</button>
                  </div>
                </div>
                {regionSel?.parent && (
                  <button className="btn small ghost danger" onClick={() => props.onRemoveRegion(regionNode.id)}>
                    Delete region
                  </button>
                )}
              </>
            )}
          </div>
        )}

        <div className="insp-section">
          <h4>Page</h4>
          <div className="field">
            <label>Name</label>
            <CommitInput value={page.name} onCommit={(v) => props.onPageField("name", v)} disabled={ro} />
          </div>
          <div className="field">
            <label>Opens as</label>
            <select
              className="select"
              value={page.presentation ?? ""}
              disabled={ro}
              onChange={(e) => props.onPagePresentation((e.target.value || null) as PagePresentation | null)}
            >
              <option value="">Page</option>
              <option value="modal">Modal</option>
              <option value="drawer">Right drawer</option>
              <option value="drawer-left">Left drawer</option>
            </select>
          </div>
        </div>
    </div>
  );
}
