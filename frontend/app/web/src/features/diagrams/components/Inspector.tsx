// Right-hand panel: the selected element's type and text, where it sits in the
// stack, and the clipboard. Every edit goes through the graph model so it is
// undoable and triggers autosave.
import { useEffect, useState } from "react";
import { ARROW_KINDS, ArrowEnd, ArrowKind, arrowKindOf } from "../graph/arrows";
import { GraphHandle } from "../graph/createGraph";
import { EDGE_TYPES, FAMILIES, hasCompartments, isEdgeType, isNodeType, noteBody, PALETTE, UmlEdgeType, UmlNodeType } from "../graph/umlTypes";
import { Selection } from "../graph/useGraph";

interface InspectorProps {
  selection: Selection;
  handleRef: React.MutableRefObject<GraphHandle | null>;
  disabled: boolean;
  canPaste: boolean;
}

export function Inspector({ selection, handleRef, disabled, canPaste }: InspectorProps) {
  const one = selection.one;
  const count = selection.cells.length;
  return (
    <aside className="diagram-inspector">
      <div className="panel-head">{one ? (one.isEdge ? "Connector" : "Element") : "Inspector"}</div>
      <div className="inspector-body">
        {one ? (
          <>
            <label className="drawer-field">
              <span className="drawer-field-label">Type</span>
              {one.isEdge ? (
                <select className="select" value={one.umlType} disabled={disabled} onChange={(e) => handleRef.current?.setEdgeType(one.cell, e.target.value as UmlEdgeType)}>
                  {EDGE_TYPES.map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                </select>
              ) : (
                <select className="select" value={one.umlType} disabled={disabled} onChange={(e) => handleRef.current?.setNodeType(one.cell, e.target.value as UmlNodeType)}>
                  {FAMILIES.map((f) => (
                    <optgroup key={f} label={f}>
                      {PALETTE.filter((p) => p.family === f).map((p) => (
                        <option key={p.type} value={p.type}>
                          {p.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </label>
            {one.isEdge && (
              <div className="field-row">
                {(["start", "end"] as ArrowEnd[]).map((end) => (
                  <label key={end} className="drawer-field">
                    <span className="drawer-field-label">{end === "start" ? "Start arrow" : "End arrow"}</span>
                    <select className="select" value={arrowKindOf(one.cell.style, end)} disabled={disabled} onChange={(e) => handleRef.current?.setArrow(one.cell, end, e.target.value as ArrowKind)}>
                      {ARROW_KINDS.map((a) => (
                        <option key={a.kind} value={a.kind}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            {one.umlType === "note" ? (
              // A note is one block of text and nothing else. Writing it here
              // retires the attribute older notes kept their body in.
              <TextField label="Text" multiline rows={10} value={noteBody(one)} disabled={disabled} onCommit={(v) => handleRef.current?.setAttrs(one.cell, { label: v, text: "" })} />
            ) : (
              <>
                <TextField label="Label" value={one.label} disabled={disabled} onCommit={(v) => handleRef.current?.setAttrs(one.cell, { label: v })} />
                {(one.isEdge || isNodeType(one.umlType)) && (
                  <TextField
                    label="Stereotype"
                    hint={one.isEdge && isEdgeType(one.umlType) ? "Shown as «stereotype» when the label is empty." : "e.g. entity, service, boundary"}
                    value={one.stereotype}
                    disabled={disabled}
                    onCommit={(v) => handleRef.current?.setAttrs(one.cell, { stereotype: v })}
                  />
                )}
                {hasCompartments(one.umlType) && (
                  <>
                    <TextField label="Attributes" multiline hint="One per line, e.g. total: Money" value={one.attributes} disabled={disabled} onCommit={(v) => handleRef.current?.setAttrs(one.cell, { attributes: v })} />
                    <TextField label="Operations" multiline hint="One per line, e.g. cancel(reason)" value={one.operations} disabled={disabled} onCommit={(v) => handleRef.current?.setAttrs(one.cell, { operations: v })} />
                  </>
                )}
              </>
            )}
          </>
        ) : (
          <div className="inspector-empty muted">
            {count > 1
              ? `${count} elements selected`
              : `Select an element to edit it. Double-click a shape to rename it${disabled ? "" : ", or press Delete to remove it"}.`}
          </div>
        )}

        {count > 0 && !disabled && (
          <div className="drawer-field">
            <span className="drawer-field-label">Order</span>
            <div className="button-row">
              <button type="button" className="btn ghost small" title="Bring to front (Ctrl+Shift+])" onClick={() => handleRef.current?.order("front")}>
                Front
              </button>
              <button type="button" className="btn ghost small" title="Bring forward (Ctrl+])" onClick={() => handleRef.current?.order("forward")}>
                Forward
              </button>
              <button type="button" className="btn ghost small" title="Send backward (Ctrl+[)" onClick={() => handleRef.current?.order("backward")}>
                Backward
              </button>
              <button type="button" className="btn ghost small" title="Send to back (Ctrl+Shift+[)" onClick={() => handleRef.current?.order("back")}>
                Back
              </button>
            </div>
          </div>
        )}

        {!disabled && (
          <div className="button-row">
            <button type="button" className="btn ghost small" disabled={!count} title="Copy (Ctrl+C)" onClick={() => handleRef.current?.copySelection()}>
              Copy
            </button>
            <button type="button" className="btn ghost small" disabled={!count} title="Cut (Ctrl+X)" onClick={() => handleRef.current?.cutSelection()}>
              Cut
            </button>
            <button type="button" className="btn ghost small" disabled={!canPaste} title="Paste (Ctrl+V)" onClick={() => handleRef.current?.paste()}>
              Paste
            </button>
            <button type="button" className="btn ghost small" disabled={!count} title="Delete (Del)" onClick={() => handleRef.current?.deleteSelection()}>
              Delete
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Commits on blur or Enter (Ctrl+Enter for multi-line) so each edit is one undo step. */
function TextField({
  label,
  hint,
  value,
  multiline,
  rows = 4,
  disabled,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: string;
  multiline?: boolean;
  rows?: number;
  disabled: boolean;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <label className="drawer-field">
      <span className="drawer-field-label">{label}</span>
      {multiline ? (
        <textarea
          className="input textarea"
          rows={rows}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
          }}
        />
      ) : (
        <input
          className="input"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      )}
      {hint && <span className="drawer-field-hint">{hint}</span>}
    </label>
  );
}
