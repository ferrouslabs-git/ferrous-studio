// Right panel: the current selection first — element, then its parent
// component, or the region — with page settings always at the bottom. Text
// inputs commit on blur or Enter so one edit is one undo step. Element
// selections carry the link picker: a link targets a page, or creates a new
// page inside a region of this one (the outlet model).
import { useEffect, useRef, useState } from "react";
import type { PageSummary } from "../../projects/projectsApi";
import { COMPONENTS, elementMeta, FONTS, LOGO_ICONS, NAV_ALIGN_OPTIONS, navAlign } from "../catalog";
import { elementLink, elementValue, EL_PREFIX, findElement, isElKey, locateCmp, TYPE_OPTIONS } from "../model/actions";
import { byPos } from "../model/positions";
import { findNode, SplitSide } from "../model/tree";
import { BACK_PAGE_ID, ComponentNode, LinkTarget, PageRecord, Size } from "../model/types";
import { LinkPicker } from "./LinkPicker";
import { PanelCollapse } from "./PanelRail";
import { ElementSel, Selection } from "./selection";

interface Props {
  onCollapse(): void;
  page: PageRecord;
  pages: PageSummary[];
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
  onRegionLabel(id: string, label: string): void;
  onRegionBg(id: string, bg: string): void;
  onRegionSize(id: string, size: Size): void;
  onSplit(id: string, side: SplitSide): void;
  onRemoveRegion(id: string): void;
  onElementText(sel: ElementSel, text: string): void;
  onElementData(sel: ElementSel, key: string, value: string): void;
  /** Step the element one place earlier/later in its component's order. */
  onMoveElement(sel: ElementSel, delta: -1 | 1): void;
  onRemoveElement(sel: ElementSel): void;
  onSetLink(sel: ElementSel, target: LinkTarget | null): void;
  onCreateLinkedPage(sel: ElementSel, regionId: string | null): void;
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

/** Colour swatch that commits ~400ms after the last change (native pickers
 *  fire continuously while dragging) plus a Clear back to the default. */
function ColourField({ label, value, onCommit, disabled }: { label: string; value: string; onCommit(v: string): void; disabled?: boolean }) {
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
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#f4f1ea"} disabled={disabled} onChange={(e) => set(e.target.value)} />
        {value && !disabled && <button className="btn small ghost" onClick={() => onCommit("")}>Clear</button>}
      </div>
    </div>
  );
}

/** Background / font / capitalisation — the same trio for components and
 *  elements; nothing is enforced, these are the user's wireframe choices. */
function StyleFields({ bg, font, caps, set, ro }: { bg: string; font: string; caps: string; set(key: "bg" | "font" | "caps", v: string): void; ro: boolean }) {
  return (
    <>
      <ColourField label="Background" value={bg} onCommit={(v) => set("bg", v)} disabled={ro} />
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

/** Read an image file, downscale it to at most `maxPx`, and hand back a
 *  data URL for inline storage (small marks stay PNG for transparency;
 *  larger pictures become JPEG). */
function readImageFile(file: File, maxPx: number, cb: (dataUrl: string) => void) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    cb(canvas.toDataURL(maxPx > 128 ? "image/jpeg" : "image/png", 0.85));
  };
  img.src = url;
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

/** Brand logo: a built-in icon, an uploaded image (downscaled to 96px and
 *  stored inline), or no logo at all. */
function LogoField({ value, onCommit, disabled }: { value: string; onCommit(v: string): void; disabled?: boolean }) {
  const isImage = value.startsWith("data:");
  const upload = (file: File) => readImageFile(file, 96, onCommit);
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

const sizeMode = (size: Size): "fill" | "px" | "auto" => (size === "auto" ? "auto" : typeof size === "number" ? "px" : "fill");

export function Inspector(props: Props) {
  const { page, pages, selection, selectedCmp, canWrite } = props;
  const ro = !canWrite;
  const doc = page.document;

  const regionSel = selection?.kind === "region" ? findNode(doc.root, selection.id) : null;
  const regionNode = regionSel?.node.kind === "region" ? regionSel.node : null;
  const elementSel = selection?.kind === "element" && selectedCmp ? selection : null;
  const link = elementSel && selectedCmp ? elementLink(selectedCmp, elementSel.key, elementSel.index) : null;
  const isBackLink = !!link && link.pageId === BACK_PAGE_ID;
  const linkTargetPage = link && !isBackLink ? pages.find((p) => p.id === link.pageId) : null;
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

  return (
    <aside className="panel" id="rightPanel">
      {/* Mirrors the Library header: button on the canvas-facing edge, label on the outer edge. */}
      <div className="panel-head panel-head-right">
        <PanelCollapse side="right" label="Inspector" shortcut="Ctrl/⌘+I" onCollapse={props.onCollapse} />
        Inspector
      </div>
      <div className="panel-body">
        {elementSel && selectedCmp && (
          <div className="insp-section">
            <h4>{elementNodeMeta ? `Element · ${elementNodeMeta.label}` : "Element"}</h4>
            <div className="field">
              <label>Text</label>
              <CommitInput
                value={elementValue(selectedCmp, elementSel.key, elementSel.index)}
                onCommit={(v) => props.onElementText(elementSel, v)}
                disabled={ro}
              />
            </div>
            {elementNode &&
              elementNodeMeta?.dataFields.map((f) => (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  {f.kind === "logo" ? (
                    <LogoField
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
              ))}
            {elementNode && (
              <>
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
                  font={elementNode.data?.font ?? ""}
                  caps={elementNode.data?.caps ?? ""}
                  set={(k, v) => props.onElementData(elementSel, k, v)}
                  ro={ro}
                />
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
              </>
            )}
            <div className="field link-field">
              <label>Link</label>
              <LinkPicker
                key={`${elementSel.cmpId}:${elementSel.key}:${elementSel.index ?? ""}`}
                pages={pages}
                root={doc.root}
                ownRegionId={locateCmp(doc, elementSel.cmpId)?.region ?? null}
                link={link}
                disabled={ro}
                onSet={(target) => props.onSetLink(elementSel, target)}
                onCreatePage={(regionId) => props.onCreateLinkedPage(elementSel, regionId)}
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
            <div className="field">
              <label>Label</label>
              <CommitInput value={selectedCmp.label} onCommit={(v) => props.onCmpLabel(selectedCmp.id, v)} disabled={ro} />
            </div>
            <StyleFields
              bg={String(selectedCmp.props?.bg ?? "")}
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
                    Remove region (content merges into its neighbour)
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
        </div>
      </div>
    </aside>
  );
}
