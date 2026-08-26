// Page and frame tab strips above the canvas.
import { PageSummary } from "../../projects/projectsApi";
import { Frame } from "../model/types";

export function PageTabs({
  pages, activeId, canWrite, onSelect, onAdd, onDelete,
}: {
  pages: PageSummary[]; activeId: string | null; canWrite: boolean;
  onSelect(id: string): void; onAdd(): void; onDelete(id: string): void;
}) {
  return (
    <div className="page-tabs">
      {pages.map((p) => (
        <div key={p.id} className={`page-tab${p.id === activeId ? " active" : ""}`} onClick={() => onSelect(p.id)}>
          <span>{p.name}</span>
          <span className="route">{p.route}</span>
          {canWrite && pages.length > 1 && (
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(p.id);
              }}
            >
              ×
            </span>
          )}
        </div>
      ))}
      {canWrite && (
        <div className="add-btn" title="Add page" onClick={onAdd}>
          +
        </div>
      )}
    </div>
  );
}

export function FrameTabs({
  frames, activeId, canWrite, onSelect, onAdd, onDelete,
}: {
  frames: Frame[]; activeId: string | null; canWrite: boolean;
  onSelect(id: string): void; onAdd(): void; onDelete(id: string): void;
}) {
  return (
    <div className="frame-tabs">
      <span style={{ fontSize: 11, color: "var(--text-mute)", marginRight: 4 }}>Frames:</span>
      {frames.map((f) => (
        <div key={f.id} className={`frame-tab${f.id === activeId ? " active" : ""}`} onClick={() => onSelect(f.id)}>
          {f.label}
          {canWrite && frames.length > 1 && (
            <span
              className="close"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(f.id);
              }}
            >
              ×
            </span>
          )}
        </div>
      ))}
      {canWrite && (
        <div className="add-btn" style={{ fontSize: 12, padding: "0 6px" }} onClick={onAdd}>
          +
        </div>
      )}
    </div>
  );
}
