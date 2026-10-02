// The element link control: what following this element does. The menu
// discloses progressively — Region (a new page placed in one of the visible
// composition's regions — the open page's AND its ancestor shells', the
// outlet model), New page (stand-alone, or an overlay), Page (any existing
// page: top-level ones first, then pages placed in a region, which open
// inside their host exactly as a nav item's page does) and Back. Hovering a region row reports it upward so the canvas
// can outline the region it would replace. The menu expands in flow: the
// inspector body scrolls, so an absolutely positioned dropdown would be
// clipped by its overflow.
import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import type { PageSummary } from "../../projects/projectsApi";
import { ComposedRegions } from "../model/linkRegions";
import { BACK_PAGE_ID, LinkTarget, PagePresentation, PRESENTATION_LABELS } from "../model/types";
import { pageDisplayName } from "./PageSelect";

/** Pages that root a placement tree: no parent, or a parent that no longer
 *  exists (an orphan lists as a root rather than vanish). */
export function rootPages(pages: readonly PageSummary[]): PageSummary[] {
  const ids = new Set(pages.map((p) => p.id));
  return pages.filter((p) => {
    const parent = p.placement?.page_id;
    return !parent || parent === p.id || !ids.has(parent);
  });
}

/** Every page a link may point at, top-level pages first, each with the name
 *  the picker shows: a placed page is named by its path ("Home ▸ Edit"). */
export function linkChoices(pages: readonly PageSummary[]): { page: PageSummary; label: string }[] {
  const roots = rootPages(pages);
  const rootIds = new Set(roots.map((p) => p.id));
  const placed = pages.filter((p) => !rootIds.has(p.id));
  return [...roots, ...placed].map((p) => ({ page: p, label: rootIds.has(p.id) ? p.name : pageDisplayName(p, pages) }));
}

type View = "menu" | "regions" | "new" | "pages";

export function LinkPicker({
  pages, regions, ownRegionId, link, disabled, onSet, onCreatePage, onHoverRegion,
}: {
  pages: PageSummary[];
  /** The visible composition's regions, in visual order, plus the aliases
   *  that map a bare placed page's root to the row that hosts it. */
  regions: ComposedRegions;
  /** The region holding the linked element's component ("this region") —
   *  raw from its owning document; aliases resolve it to a listed row. */
  ownRegionId: string | null;
  link: LinkTarget | null;
  disabled: boolean;
  onSet(target: LinkTarget | null): void;
  /** Create a page placed in `regionId` (null = a stand-alone page) and link
   *  it; with a `presentation` the page opens over this one as an overlay. */
  onCreatePage(regionId: string | null, presentation?: PagePresentation): void;
  /** A region row is being hovered: the canvas outlines that region. */
  onHoverRegion?(regionId: string | null): void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const isBack = link?.pageId === BACK_PAGE_ID;
  const targetPage = link && !isBack ? pages.find((p) => p.id === link.pageId) ?? null : null;
  const summary = !link ? "None" : isBack ? "‹ Back (previous page)" : targetPage ? pageDisplayName(targetPage, pages) : "Missing page";

  // Every page can be linked to: placed pages already are, by nav items, and
  // the one a list's Edit button should open is usually one of them. Top-level
  // pages come first; a placed page is named by its path ("Home ▸ Edit").
  const choices = useMemo(() => linkChoices(pages), [pages]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return choices;
    return choices.filter((c) => c.label.toLowerCase().includes(q) || (c.page.route ?? "").toLowerCase().includes(q));
  }, [choices, query]);

  const hover = (regionId: string | null) => onHoverRegion?.(regionId);
  // The picker can unmount mid-hover (selection change, page switch): never
  // leave a stale outline on the canvas.
  useEffect(() => () => onHoverRegion?.(null), [onHoverRegion]);

  const close = () => {
    setOpen(false);
    setView("menu");
    setQuery("");
    hover(null);
  };
  const backToMenu = () => {
    setView("menu");
    setQuery("");
    hover(null);
  };
  const pick = (target: LinkTarget | null) => {
    onSet(target);
    close();
  };
  const create = (regionId: string | null, presentation?: PagePresentation) => {
    onCreatePage(regionId, presentation);
    close();
  };

  const own = ownRegionId ? regions.alias[ownRegionId] ?? ownRegionId : null;

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
          <div className="link-opt" onClick={() => setView("regions")}>
            <span className="name">Region</span>
            <span className="caret">›</span>
          </div>
          <div className="link-opt" onClick={() => setView("new")}>
            <span className="name">New page</span>
            <span className="caret">›</span>
          </div>
          <div className="link-opt" onClick={() => setView("pages")}>
            <span className="name">Page</span>
            <span className="caret">›</span>
          </div>
          <div className={`link-opt${isBack ? " active" : ""}`} onClick={() => pick({ pageId: BACK_PAGE_ID })}>‹ Back (previous page)</div>
        </div>
      )}

      {open && view === "regions" && (
        <div className="link-menu" onMouseLeave={() => hover(null)}>
          <div className="link-opt back" onClick={backToMenu}>‹ All link options</div>
          <div className="link-group">New page in region</div>
          {regions.options.map((o) => (
            <div key={o.id} className="link-opt" onMouseEnter={() => hover(o.id)} onClick={() => create(o.id)}>
              <span className="name">{o.label}</span>
              {o.id === own ? <span className="link-note">this region</span> : o.note && <span className="link-note">{o.note}</span>}
            </div>
          ))}
        </div>
      )}

      {open && view === "new" && (
        <div className="link-menu">
          <div className="link-opt back" onClick={backToMenu}>‹ All link options</div>
          <div className="link-opt" onClick={() => create(null)}>New page…</div>
          <div className="link-opt" onClick={() => create(null, "modal")}>Modal…</div>
          <div className="link-opt" onClick={() => create(null, "drawer")}>Right drawer…</div>
          <div className="link-opt" onClick={() => create(null, "drawer-left")}>Left drawer…</div>
        </div>
      )}

      {open && view === "pages" && (
        <div className="link-menu">
          <div className="link-opt back" onClick={backToMenu}>‹ All link options</div>
          <input
            autoFocus
            className="link-search"
            placeholder="Search pages…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={onSearchKey}
          />
          <div className="link-pages">
            {filtered.map(({ page: p, label }, i) => (
              <div
                key={p.id}
                className={`link-opt${p.id === link?.pageId ? " active" : ""}${i === highlight ? " highlight" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick({ pageId: p.id })}
              >
                <span className="name">{label}</span>
                {p.presentation && <span className="link-note">{PRESENTATION_LABELS[p.presentation]}</span>}
              </div>
            ))}
            {filtered.length === 0 && <div className="link-empty">No pages match “{query}”</div>}
          </div>
        </div>
      )}
    </div>
  );
}
