// Right-hand panel: the selected element's type and text. Every edit goes
// through the graph model so it is undoable and triggers autosave.
import { useEffect, useState } from "react";
import { GraphHandle } from "../graph/createGraph";
import { EDGE_TYPES, FAMILIES, hasCompartments, isEdgeType, isNodeType, PALETTE, UmlEdgeType, UmlNodeType } from "../graph/umlTypes";
import { Selection } from "../graph/useGraph";

export function Inspector({ selection, handleRef, disabled }: { selection: Selection; handleRef: React.MutableRefObject<GraphHandle | null>; disabled: boolean }) {
  const one = selection.one;
  if (!one) {
    return (
      <aside className="diagram-inspector">
        <div className="panel-head">Inspector</div>
        <div className="inspector-empty muted">
          {selection.cells.length > 1
            ? `${selection.cells.length} elements selected${disabled ? "" : " — press Delete to remove them."}`
            : `Select an element to edit it. Double-click a shape to rename it${disabled ? "" : ", or press Delete to remove it"}.`}
        </div>
      </aside>
    );
  }
  return (
    <aside className="diagram-inspector">
      <div className="panel-head">{one.isEdge ? "Connector" : "Element"}</div>
      <div className="inspector-body">
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
        {one.umlType === "note" && (
          <TextField label="Text" multiline value={one.text} disabled={disabled} onCommit={(v) => handleRef.current?.setAttrs(one.cell, { text: v })} />
        )}
        {!disabled && (
          <button type="button" className="btn ghost small" title="Delete (Del)" onClick={() => handleRef.current?.deleteSelection()}>
            Delete
          </button>
        )}
      </div>
    </aside>
  );
}

/** Commits on blur or Enter (Ctrl+Enter for multi-line) so each edit is one undo step. */
function TextField({ label, hint, value, multiline, disabled, onCommit }: { label: string; hint?: string; value: string; multiline?: boolean; disabled: boolean; onCommit: (v: string) => void }) {
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
          rows={4}
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
