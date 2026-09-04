// The library as two slim strips instead of a side panel. The component bar
// rides under the top bar and offers every catalogue component; the element
// bar keeps a permanent row under the canvas and fills with the vocabulary of
// whichever catalogue component is selected. Each entry is a chip — an
// icon and a short name — click to add, or drag onto the canvas. The full
// label and description live in the chip's tooltip.
import { ReactNode } from "react";
import { COMPONENTS } from "../catalog";
import { DragPayload, setPayload } from "./dnd";
import { LIB_ICONS } from "./icons";

/** Bar order: these lead, and anything added to the catalogue later follows. */
const PRIMARY = ["navbar", "list", "form", "graph", "canvas", "calendar"];

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
  pagination: "Pages",
  "text-input": "Input",
  "radio-group": "Radio",
  "date-picker": "Date",
  "file-upload": "Upload",
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
    desc: "Add Edit and Archive row actions, a status filter, and an edit drawer whose inputs mirror the columns",
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
  if (!canWrite) return null;
  // The row is always in the layout so the canvas keeps its height — selecting
  // and deselecting must not reflow the page. Without a selection the strip
  // sits empty under its bare tag.
  return (
    <div className="lib-bar el-bar">
      <span className="lib-bar-tag">{meta ? `${SHORT_NAMES[meta.type] ?? meta.label} elements` : "Elements"}</span>
      <BarScroll>
        {meta?.elements.map((e) => (
          <Chip
            key={e.type}
            type={e.type}
            label={e.label}
            desc={e.desc}
            fallback={e.icon}
            drag={{ kind: "element", type: e.type }}
            onClick={() => onAdd(e.type)}
          />
        ))}
      </BarScroll>
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
