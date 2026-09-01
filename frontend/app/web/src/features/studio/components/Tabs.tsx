// Page tab strip above the canvas. Child pages (rendered inside a parent's
// region) show their ancestry: "Home ▸ Users".
import type { PageSummary } from "../../projects/projectsApi";

export function pageDisplayName(page: PageSummary, all: readonly PageSummary[]): string {
  const byId = new Map(all.map((p) => [p.id, p]));
  const names = [page.name];
  const seen = new Set([page.id]);
  let cur = page;
  while (cur.placement && byId.has(cur.placement.page_id) && !seen.has(cur.placement.page_id)) {
    cur = byId.get(cur.placement.page_id)!;
    seen.add(cur.id);
    names.unshift(cur.name);
  }
  return names.join(" ▸ ");
}

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
          <span>{pageDisplayName(p, pages)}</span>
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
