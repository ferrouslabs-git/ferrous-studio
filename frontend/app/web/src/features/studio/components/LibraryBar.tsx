// The library as two slim strips instead of a side panel. The component bar
// rides under the top bar and offers every catalogue component; the element
// bar keeps a permanent row under the canvas and fills with the vocabulary of
// whichever catalogue component is selected: one chip per element type, its
// shapes in a menu that opens from the chip (FS-REQ-84). Each entry is a chip — an icon and a short name —
// click to add, or drag onto the canvas. The full label and description live
// in the chip's tooltip.
import { ReactNode, useEffect, useRef, useState } from "react";
import { COMPONENTS, elementGroups } from "../catalog";
import { DragPayload, setPayload } from "./dnd";
import { LIB_ICONS } from "./icons";

/** Bar order: these lead, and anything added to the catalogue later follows. */
const PRIMARY = ["navbar", "list", "form", "wizard", "graph", "canvas", "calendar"];

/** Chip captions, where the catalogue label runs long. */
const SHORT_NAMES: Record<string, string> = {
  navbar: "Nav",
  brand: "Brand",
  search: "Search",
  avatar: "Avatar",
  "workspace-switcher": "Workspace",
  "group-heading": "Group",
  "column-header": "Headers",
  "row-action": "Action",
  "select-column": "Bulk select",
  filter: "Filter",
  "filter-multi": "Multi-filter",
  "filter-multi-search": "Multi + search",
  "multi-select": "Multi-select",
  "section-heading": "Section",
  "help-text": "Help",
  "category-axis": "X axis",
  "value-axis": "Y axis",
  "range-selector": "Range",
  stat: "Stat",
  "view-switcher": "Views",
  "calendar-legend": "Legend",
};

/** A one-click structural recipe offered beside a component's own elements: it
 *  builds a whole working pattern rather than adding a single element. Only the
 *  caption and the host type live here — what a recipe DOES is the studio's
 *  business (see runCrudRecipe in StudioPage), because it spans pages and the
 *  network, which no element chip does. */
export interface RecipeMeta {
  id: string;
  label: string;
  desc: string;
  /** The component type whose element bar offers it. */
  hostType: string;
}

export const RECIPES: RecipeMeta[] = [
  {
    id: "crud",
    label: "CRUD",
    desc: "Add Edit and Archive row actions, a status filter, a create button, and an edit drawer whose inputs mirror the columns",
    hostType: "list",
  },
];

/* The chip strip. A mouse wheel only yields vertical deltas and the strip has
   no vertical axis, so those are steered along it — chips clipped by a panel
   edge stay reachable without aiming at the 6px scrollbar. Trackpads emit
   their own deltaX and pass through untouched. */
function BarScroll({ children }: { children: ReactNode }) {
  return (
    <div
      className="lib-bar-scroll"
      onWheel={(e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
      }}
    >
      {children}
    </div>
  );
}

function Chip({
  type, label, desc, fallback, drag, onClick,
}: {
  type: string; label: string; desc: string; fallback: string; drag: DragPayload; onClick(): void;
}) {
  return (
    <button
      type="button"
      className="lib-chip"
      title={`${label} — ${desc}`}
      draggable
      onClick={onClick}
      onDragStart={(e) => {
        e.currentTarget.classList.add("dragging");
        setPayload(e, drag, "copy");
      }}
      onDragEnd={(e) => e.currentTarget.classList.remove("dragging")}
    >
      {LIB_ICONS[type] ?? <span className="lib-chip-code">{fallback.slice(0, 2).toUpperCase()}</span>}
      <span className="lib-chip-name">{SHORT_NAMES[type] ?? label}</span>
    </button>
  );
}

export function ComponentBar({ canWrite, onAdd }: { canWrite: boolean; onAdd(type: string): void }) {
  if (!canWrite) return null;
  const ordered = [
    ...PRIMARY.map((t) => COMPONENTS[t]),
    ...Object.values(COMPONENTS).filter((c) => !PRIMARY.includes(c.type)),
  ];
  return (
    <div className="lib-bar cmp-bar">
      <span className="lib-bar-tag">Components</span>
      <BarScroll>
        {ordered.map((meta) => (
          <Chip
            key={meta.type}
            type={meta.type}
            label={meta.label}
            desc={meta.desc}
            fallback={meta.icon}
            drag={{ kind: "component", type: meta.type }}
            onClick={() => onAdd(meta.type)}
          />
        ))}
      </BarScroll>
    </div>
  );
}

/** The chip that stands for a whole type: the glyph of its most typical
 *  shape, else its first. */
const GROUP_ICON: Record<string, string> = {
  text: "heading", input: "text-input", action: "button", ui: "badge", image: "image", basic: "square",
};

export function ElementBar({
  cmpType, canWrite, onAdd, recipeDisabled, onRunRecipe,
}: {
  /** Type of the component selected on the canvas; null empties the bar. */
  cmpType: string | null;
  canWrite: boolean;
  onAdd(type: string): void;
  /** Why the recipe cannot run right now, or null when it can. */
  recipeDisabled?(id: string): string | null;
  onRunRecipe?(id: string): void;
}) {
  const meta = cmpType ? COMPONENTS[cmpType] : null;
  const recipes = meta ? RECIPES.filter((r) => r.hostType === meta.type) : [];
  const groups = meta ? elementGroups(meta.type) : [];
  // The ribbon names only the types (FS-REQ-84 review); a type's shapes open
  // in a menu above its chip — on hover, or pinned open by a click until a
  // click lands anywhere else.
  const [open, setOpen] = useState<{ id: string; left: number; bottom: number; pinned: boolean } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const dragging = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const openFor = (id: string, chip: HTMLElement, pinned: boolean) => {
    window.clearTimeout(hideTimer.current);
    const r = chip.getBoundingClientRect();
    setOpen({ id, left: r.left, bottom: window.innerHeight - r.top + 4, pinned });
  };
  const hideSoon = () => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!dragging.current) setOpen((o) => (o?.pinned ? o : null));
    }, 200);
  };
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  // A selection change swaps the vocabulary: whatever was open goes with it.
  useEffect(() => setOpen(null), [cmpType]);
  useEffect(() => {
    if (!open?.pinned) return;
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (menuRef.current?.contains(t) || t?.closest?.(`[data-el-group="${open.id}"]`)) return;
      setOpen(null);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open?.pinned, open?.id]);
  if (!canWrite) return null;
  const shown = open ? groups.find((g) => g.id === open.id) : undefined;
  // The row is always in the layout so the canvas keeps its height — selecting
  // and deselecting must not reflow the page. Without a selection the strip
  // sits empty under its bare tag.
  return (
    <div className="lib-bar el-bar">
      <span className="lib-bar-tag">{meta ? `${SHORT_NAMES[meta.type] ?? meta.label} elements` : "Elements"}</span>
      <BarScroll>
        {groups.map((g) => {
          const icon = LIB_ICONS[GROUP_ICON[g.id] ?? ""] ?? LIB_ICONS[g.shapes[0].type];
          const isOpen = open?.id === g.id;
          return (
            <button
              key={g.id}
              type="button"
              className={`lib-chip lib-type${isOpen ? " open" : ""}${isOpen && open.pinned ? " pinned" : ""}`}
              data-el-group={g.id}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onPointerEnter={(e) => {
                if (open?.pinned && open.id !== g.id) return;
                if (!open?.pinned) openFor(g.id, e.currentTarget, false);
              }}
              onPointerLeave={() => {
                if (!open?.pinned) hideSoon();
              }}
              onClick={(e) => {
                if (isOpen && open.pinned) setOpen(null);
                else openFor(g.id, e.currentTarget, true);
              }}
            >
              {icon ?? <span className="lib-chip-code">{g.label.slice(0, 2).toUpperCase()}</span>}
              <span className="lib-chip-name">{g.label}</span>
              <span className="lib-type-caret" aria-hidden>▴</span>
            </button>
          );
        })}
      </BarScroll>
      {open && shown && (
        <div
          ref={menuRef}
          className="lib-shape-menu"
          role="menu"
          aria-label={`${shown.label} shapes`}
          style={{ left: open.left, bottom: open.bottom }}
          onPointerEnter={() => window.clearTimeout(hideTimer.current)}
          onPointerLeave={() => {
            if (!open.pinned) hideSoon();
          }}
          onDragStart={() => {
            dragging.current = true;
          }}
          onDragEnd={() => {
            dragging.current = false;
            if (!open.pinned) setOpen(null);
          }}
        >
          {shown.shapes.map((e) => (
            <Chip
              key={e.type}
              type={e.type}
              label={e.label}
              desc={e.desc}
              fallback={e.icon}
              drag={{ kind: "element", type: e.type }}
              onClick={() => {
                onAdd(e.type);
                if (!open.pinned) setOpen(null);
              }}
            />
          ))}
        </div>
      )}
      {/* Pinned outside the scrolling strip: a recipe builds the whole pattern,
          so it must not be the thing that scrolls out of sight. */}
      {recipes.length > 0 && (
        <div className="lib-recipes">
          {recipes.map((r) => {
            const why = recipeDisabled?.(r.id) ?? null;
            return (
              <button
                key={r.id}
                type="button"
                className="lib-chip recipe"
                disabled={!!why}
                title={why ? `${r.label} — ${why}` : `${r.label} — ${r.desc}`}
                onClick={() => onRunRecipe?.(r.id)}
              >
                <span className="lib-chip-name">{r.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
