// Searchable page picker in the top bar: replaces the old tab strip. Child
// pages (rendered inside a parent's region) show their ancestry: "Home ▸ Users".
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
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

export function PageSelect({
  pages, activeId, canWrite, onSelect, onAdd, onDelete,
}: {
  pages: PageSummary[]; activeId: string | null; canWrite: boolean;
  onSelect(id: string): void; onAdd(): void; onDelete(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = pages.find((p) => p.id === activeId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter(
      (p) => pageDisplayName(p, pages).toLowerCase().includes(q) || (p.route ?? "").toLowerCase().includes(q),
    );
  }, [pages, query]);

  // Any pointer press outside the control closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setQuery("");
    setHighlight(Math.max(0, pages.findIndex((p) => p.id === activeId)));
    setOpen(true);
  };

  const choose = (id: string) => {
    setOpen(false);
    onSelect(id);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { setHighlight((h) => Math.min(h + 1, filtered.length - 1)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setHighlight((h) => Math.max(h - 1, 0)); e.preventDefault(); }
    else if (e.key === "Enter") { if (filtered[highlight]) choose(filtered[highlight].id); e.preventDefault(); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div className="page-select" ref={rootRef}>
      <button type="button" className="btn ghost page-select-trigger" title="Switch page" onClick={toggle}>
        <span className="name">{active ? pageDisplayName(active, pages) : "Pages"}</span>
        {active?.route && <span className="route">{active.route}</span>}
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="page-select-menu">
          <input
            autoFocus
            className="input page-select-search"
            placeholder="Search pages…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={onKey}
          />
          <div className="page-select-list">
            {filtered.map((p, i) => (
              <div
                key={p.id}
                className={`page-select-item${p.id === activeId ? " active" : ""}${i === highlight ? " highlight" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(p.id)}
              >
                <span className="name">{pageDisplayName(p, pages)}</span>
                {p.route && <span className="route">{p.route}</span>}
                {canWrite && pages.length > 1 && (
                  <span
                    className="close"
                    title="Delete page"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(false);
                      onDelete(p.id);
                    }}
                  >
                    ×
                  </span>
                )}
              </div>
            ))}
            {filtered.length === 0 && <div className="page-select-empty">No pages match “{query}”</div>}
          </div>
          {canWrite && (
            <button type="button" className="page-select-add" onClick={() => { setOpen(false); onAdd(); }}>
              ＋ Add page
            </button>
          )}
        </div>
      )}
    </div>
  );
}
