// Right panel: page settings, the selected region / component / element, and
// the live JSON. Text inputs commit on blur or Enter so one edit is one undo
// step. Element selections carry the link picker: a link targets a page, or
// creates a new page inside a region of this one (the outlet model).
import { useEffect, useState } from "react";
import type { PageSummary } from "../../projects/projectsApi";
import { COMPONENTS, elementMeta } from "../catalog";
import { elementLink, elementValue, EL_PREFIX, findElement, isElKey, TYPE_OPTIONS } from "../model/actions";
import { serializePage } from "../model/serialize";
import { findNode, regionDisplayName, regionIds, SplitSide } from "../model/tree";
import { ComponentNode, LinkTarget, PageRecord, Size } from "../model/types";
import { JsonView } from "./JsonView";
import { PanelCollapse } from "./PanelRail";
import { ElementSel, Selection } from "./selection";
import { pageDisplayName } from "./Tabs";

interface Props {
  onCollapse(): void;
  page: PageRecord;
  pages: PageSummary[];
  selection: Selection | null;
  selectedCmp: ComponentNode | null;
  canWrite: boolean;
  onPageField(field: "name" | "route", value: string): void;
  onCmpType(id: string, type: string): void;
  onCmpShape(id: string, shape: string): void;
  onCmpLayout(id: string, layout: string): void;
  onCmpLabel(id: string, label: string): void;
  onRegionLabel(id: string, label: string): void;
  onRegionSize(id: string, size: Size): void;
  onSplit(id: string, side: SplitSide): void;
  onRemoveRegion(id: string): void;
  onElementText(sel: ElementSel, text: string): void;
  onElementData(sel: ElementSel, key: string, value: string): void;
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

const sizeMode = (size: Size): "fill" | "px" | "auto" => (size === "auto" ? "auto" : typeof size === "number" ? "px" : "fill");

export function Inspector(props: Props) {
  const { page, pages, selection, selectedCmp, canWrite } = props;
  const ro = !canWrite;
  const doc = page.document;

  const regionSel = selection?.kind === "region" ? findNode(doc.root, selection.id) : null;
  const regionNode = regionSel?.node.kind === "region" ? regionSel.node : null;
  const elementSel = selection?.kind === "element" && selectedCmp ? selection : null;
  const link = elementSel && selectedCmp ? elementLink(selectedCmp, elementSel.key, elementSel.index) : null;
  const linkTargetPage = link ? pages.find((p) => p.id === link.pageId) : null;
  const cmpMeta = selectedCmp ? COMPONENTS[selectedCmp.type] ?? null : null;
  // A selected element node (as opposed to a scalar prop token).
  const elementNode =
    elementSel && selectedCmp && isElKey(elementSel.key) ? findElement(selectedCmp, elementSel.key.slice(EL_PREFIX.length)) : null;
  const elementNodeMeta = elementNode && selectedCmp ? elementMeta(selectedCmp.type, elementNode.type) : null;

  return (
    <aside className="panel" id="rightPanel">
      {/* Mirrors the Library header: button on the canvas-facing edge, label on the outer edge. */}
      <div className="panel-head panel-head-right">
        <PanelCollapse side="right" label="Inspector" shortcut="Ctrl/⌘+I" onCollapse={props.onCollapse} />
        Inspector
      </div>
      <div className="panel-body">
        <div className="insp-section">
          <h4>Page</h4>
          <div className="field">
            <label>Name</label>
            <CommitInput value={page.name} onCommit={(v) => props.onPageField("name", v)} disabled={ro} />
          </div>
          <div className="field">
            <label>Route</label>
            <CommitInput value={page.route ?? ""} onCommit={(v) => props.onPageField("route", v)} disabled={ro} />
          </div>
          {page.placement && (
            <div className="insp-hint">
              Renders inside <b>{pages.find((p) => p.id === page.placement!.page_id)?.name ?? "its parent"}</b>. The parent's
              shell shows read-only around this page.
            </div>
          )}
        </div>

        {regionNode && (
          <div className="insp-section">
            <h4>Region</h4>
            <div className="field">
              <label>Label</label>
              <CommitInput value={regionNode.label ?? ""} onCommit={(v) => props.onRegionLabel(regionNode.id, v)} disabled={ro} />
            </div>
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
            <div className="field">
              <label>ID</label>
              <input value={selectedCmp.id} disabled />
            </div>
          </div>
        )}

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
                  {f.kind === "select" ? (
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
                  {f.hint && <div className="insp-hint">{f.hint}</div>}
                </div>
              ))}
            <div className="field">
              <label>Link</label>
              <select
                value={link ? `page:${link.pageId}` : ""}
                disabled={ro}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "") props.onSetLink(elementSel, null);
                  else if (v.startsWith("page:")) props.onSetLink(elementSel, { pageId: v.slice(5) });
                  else if (v === "new") props.onCreateLinkedPage(elementSel, null);
                  else if (v.startsWith("new-in:")) props.onCreateLinkedPage(elementSel, v.slice(7));
                }}
              >
                <option value="">None</option>
                {pages.length > 0 && (
                  <optgroup label="Go to page">
                    {pages.map((p) => (
                      <option key={p.id} value={`page:${p.id}`}>{pageDisplayName(p, pages)}</option>
                    ))}
                  </optgroup>
                )}
                {!ro && (
                  <optgroup label="Create">
                    <option value="new">New page…</option>
                    {regionIds(doc.root).map((rid) => (
                      <option key={rid} value={`new-in:${rid}`}>
                        New page in {regionDisplayName(doc.root, rid)}…
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            {link && (
              <div className="insp-hint">
                {linkTargetPage
                  ? linkTargetPage.placement
                    ? `Swaps ${pages.find((p) => p.id === linkTargetPage.placement!.page_id)?.name ?? "the parent"}'s region for "${linkTargetPage.name}". Double-click the element to follow.`
                    : `Opens the page "${linkTargetPage.name}". Double-click the element to follow.`
                  : "The target page no longer exists."}
              </div>
            )}
            {elementNode && !ro && (
              <button className="btn small ghost danger" onClick={() => props.onRemoveElement(elementSel)}>
                Remove element
              </button>
            )}
          </div>
        )}

        {!selection && (
          <div className="insp-section">
            <h4>Selection</h4>
            <div className="insp-hint">
              Click a region's background, a component, or a single item inside one (a nav link, a button) to edit it here.
            </div>
          </div>
        )}

        <div className="insp-section" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <h4>PageDefinition JSON</h4>
        </div>
        <JsonView value={serializePage(page)} />
      </div>
    </aside>
  );
}
