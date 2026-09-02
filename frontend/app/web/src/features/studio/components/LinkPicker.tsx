// The element link control: what following this element does. Quick options
// link through a region of this page (a new page placed there — the outlet
// model) or mint a stand-alone page; existing pages are chosen from a
// searchable tree of the wireframe's page hierarchy rather than a flat list.
// The menu expands in flow: the inspector body scrolls, so an absolutely
// positioned dropdown would be clipped by its overflow.
import { KeyboardEvent, useMemo, useState } from "react";
import type { PageSummary } from "../../projects/projectsApi";
import { regionDisplayName, regionIds } from "../model/tree";
import { BACK_PAGE_ID, LayoutNode, LinkTarget } from "../model/types";
import { pageDisplayName } from "./PageSelect";

interface TreeRow {
  page: PageSummary;
  depth: number;
}

/** Pages as a tree by placement parentage, depth-first, in pos order. Pages
 *  whose parent is missing (or cyclic) list at the root rather than vanish. */
export function pageTreeRows(pages: readonly PageSummary[]): TreeRow[] {
  const ids = new Set(pages.map((p) => p.id));
  const kids = new Map<string, PageSummary[]>();
  const roots: PageSummary[] = [];
  for (const p of pages) {
    const parent = p.placement?.page_id;
    if (parent && parent !== p.id && ids.has(parent)) {
      const list = kids.get(parent);
      if (list) list.push(p);
      else kids.set(parent, [p]);
    } else roots.push(p);
  }
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const visit = (p: PageSummary, depth: number) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    rows.push({ page: p, depth });
    for (const child of kids.get(p.id) ?? []) visit(child, depth + 1);
  };
  for (const p of roots) visit(p, 0);
  for (const p of pages) visit(p, 0);
  return rows;
}

export function LinkPicker({
  pages, root, ownRegionId, link, disabled, onSet, onCreatePage,
}: {
  pages: PageSummary[];
  root: LayoutNode;
  /** The region holding the linked element's component ("this region"). */
  ownRegionId: string | null;
  link: LinkTarget | null;
  disabled: boolean;
  onSet(target: LinkTarget | null): void;
  /** Create a page placed in `regionId` (null = a stand-alone page) and link it. */
  onCreatePage(regionId: string | null): void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"menu" | "pages">("menu");
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const isBack = link?.pageId === BACK_PAGE_ID;
  const targetPage = link && !isBack ? pages.find((p) => p.id === link.pageId) ?? null : null;
  const summary = !link ? "None" : isBack ? "‹ Back (previous page)" : targetPage ? pageDisplayName(targetPage, pages) : "Missing page";

  const rows = useMemo(() => pageTreeRows(pages), [pages]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    // A search result loses its slot in the tree, so it shows its full path.
    return rows
      .filter(({ page }) => pageDisplayName(page, pages).toLowerCase().includes(q) || (page.route ?? "").toLowerCase().includes(q))
      .map(({ page }) => ({ page, depth: 0 }));
  }, [rows, query, pages]);

  const close = () => {
    setOpen(false);
    setView("menu");
    setQuery("");
  };
  const pick = (target: LinkTarget | null) => {
    onSet(target);
    close();
  };
  const create = (regionId: string | null) => {
    onCreatePage(regionId);
    close();
  };

  const regions = regionIds(root);
  const ordered = ownRegionId && regions.includes(ownRegionId) ? [ownRegionId, ...regions.filter((r) => r !== ownRegionId)] : regions;

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { setHighlight((h) => Math.min(h + 1, filtered.length - 1)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setHighlight((h) => Math.max(h - 1, 0)); e.preventDefault(); }
    else if (e.key === "Enter") { if (filtered[highlight]) pick({ pageId: filtered[highlight].page.id }); e.preventDefault(); }
    else if (e.key === "Escape") close();
  };

  return (
    <div className="link-picker" onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
      <button type="button" className="link-trigger" disabled={disabled} onClick={() => (open ? close() : setOpen(true))}>
        <span className="name">{summary}</span>
        <span className="caret">▾</span>
      </button>

      {open && view === "menu" && (
        <div className="link-menu">
          <div className={`link-opt${!link ? " active" : ""}`} onClick={() => pick(null)}>None</div>
          <div className={`link-opt${isBack ? " active" : ""}`} onClick={() => pick({ pageId: BACK_PAGE_ID })}>‹ Back (previous page)</div>
          <div className="link-group">New page in region</div>
          {ordered.map((rid) => (
            <div key={rid} className="link-opt" onClick={() => create(rid)}>
              {regionDisplayName(root, rid)}
              {rid === ownRegionId && <span className="link-note">this region</span>}
            </div>
          ))}
          <div className="link-group">Page</div>
          <div className="link-opt" onClick={() => setView("pages")}>Go to a page…</div>
          <div className="link-opt" onClick={() => create(null)}>New stand-alone page…</div>
        </div>
      )}

      {open && view === "pages" && (
        <div className="link-menu">
          <div className="link-opt back" onClick={() => { setView("menu"); setQuery(""); }}>‹ All link options</div>
          <input
            autoFocus
            className="link-search"
            placeholder="Search pages…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={onSearchKey}
          />
          <div className="link-pages">
            {filtered.map(({ page: p, depth }, i) => (
              <div
                key={p.id}
                className={`link-opt${p.id === link?.pageId ? " active" : ""}${i === highlight ? " highlight" : ""}`}
                style={{ paddingLeft: 10 + depth * 14 }}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick({ pageId: p.id })}
              >
                {depth > 0 && <span className="twig">└</span>}
                <span className="name">{query.trim() ? pageDisplayName(p, pages) : p.name}</span>
              </div>
            ))}
            {filtered.length === 0 && <div className="link-empty">No pages match “{query}”</div>}
          </div>
        </div>
      )}
    </div>
  );
}
