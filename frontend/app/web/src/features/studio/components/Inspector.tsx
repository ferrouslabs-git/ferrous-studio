// Right panel: page/frame settings, the selected component, and the live
// JSON. Text inputs commit on blur or Enter so one edit is one undo step.
import { useEffect, useState } from "react";
import { TYPE_OPTIONS } from "../model/actions";
import { serializePage } from "../model/serialize";
import { ComponentNode, Frame, MainFlow, PageRecord } from "../model/types";
import { JsonView } from "./JsonView";

interface Props {
  page: PageRecord;
  frame: Frame | null;
  selected: ComponentNode | null;
  canWrite: boolean;
  onPageField(field: "name" | "route", value: string): void;
  onSelectFrame(id: string): void;
  onLayoutMode(mode: "flat" | "regions"): void;
  onSmartDock(on: boolean): void;
  onMainFlow(flow: MainFlow): void;
  onCmpType(id: string, type: string): void;
  onCmpLabel(id: string, label: string): void;
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

export function Inspector({ page, frame, selected, canWrite, onPageField, onSelectFrame, onLayoutMode, onSmartDock, onMainFlow, onCmpType, onCmpLabel }: Props) {
  const ro = !canWrite;
  const regions = frame?.layoutMode === "regions";
  return (
    <aside className="panel" id="rightPanel">
      <div className="panel-head">Inspector</div>
      <div className="panel-body">
        <div className="insp-section">
          <h4>Page</h4>
          <div className="field">
            <label>Name</label>
            <CommitInput value={page.name} onCommit={(v) => onPageField("name", v)} disabled={ro} />
          </div>
          <div className="field">
            <label>Route</label>
            <CommitInput value={page.route ?? ""} onCommit={(v) => onPageField("route", v)} disabled={ro} />
          </div>
          <div className="field">
            <label>Frame</label>
            <select value={frame?.id ?? ""} onChange={(e) => onSelectFrame(e.target.value)}>
              {page.document.frames.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Layout</label>
            <div className="seg" role="tablist">
              <button className={frame?.layoutMode === "flat" ? "active" : ""} disabled={ro} onClick={() => onLayoutMode("flat")}>Flat</button>
              <button className={regions ? "active" : ""} disabled={ro} onClick={() => onLayoutMode("regions")}>Regions</button>
            </div>
          </div>
          <div className="field">
            <label>Smart dock</label>
            <select
              value={regions && frame.layout.options.smartDock ? "on" : "off"}
              disabled={ro || !regions}
              onChange={(e) => onSmartDock(e.target.value === "on")}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </div>
          <div className="field">
            <label>Main flow</label>
            <select
              value={regions ? frame.layout.options.mainFlow : "stack"}
              disabled={ro || !regions}
              onChange={(e) => onMainFlow(e.target.value as MainFlow)}
            >
              <option value="stack">Stack</option>
              <option value="two-col">2 columns</option>
              <option value="three-col">3 columns</option>
            </select>
          </div>
        </div>

        <div className="insp-section">
          <h4>Selected component</h4>
          {selected ? (
            <>
              <div className="field">
                <label>Type</label>
                <select value={selected.type} disabled={ro} onChange={(e) => onCmpType(selected.id, e.target.value)}>
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Label</label>
                <CommitInput value={selected.label} onCommit={(v) => onCmpLabel(selected.id, v)} disabled={ro} />
              </div>
              <div className="field">
                <label>ID</label>
                <input value={selected.id} disabled />
              </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-mute)" }}>Click a component on the canvas to edit it.</div>
          )}
        </div>

        <div className="insp-section" style={{ borderBottom: 0, paddingBottom: 0 }}>
          <h4>PageDefinition JSON</h4>
        </div>
        <JsonView value={serializePage(page)} />
      </div>
    </aside>
  );
}
