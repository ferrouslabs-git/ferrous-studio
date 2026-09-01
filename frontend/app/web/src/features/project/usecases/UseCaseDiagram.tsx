// The use case diagram: stick-figure actors either side of a system boundary
// holding an ellipse per use case. Relationships are shown by colour rather
// than lines: every user type has a colour from the brand gradient, an
// ellipse is tinted by the first user type that can perform it and carries a
// dot for each one that can. Sized to its container (ResizeObserver),
// filterable by user type, "Rearrange" cycles the layout seed, and hovering
// an element dims everything not related to it.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { actorColours, withAlpha } from "./useCaseColours";
import { ACTOR_HEIGHT, ACTOR_LABEL_GAP, ACTOR_LINE, layoutUseCaseDiagram, MAX_COLUMNS } from "./useCaseLayout";
import { UseCase, UseCaseActor } from "./useCasesApi";

const DOT_R = 4;
const DOT_GAP = 11;

type Focus = { kind: "actor" | "usecase"; id: string };

/** What the controls edit and the diagram reads; owned by the page so the
 *  controls can sit in the tab row while the diagram sits below it. */
export interface DiagramState {
  /** Selected user type ids; empty means all. */
  filter: Set<string>;
  /** 0 = automatic from the width. */
  columns: number;
  /** Bumped by "Rearrange". */
  seed: number;
}

export const INITIAL_DIAGRAM_STATE: DiagramState = { filter: new Set(), columns: 0, seed: 0 };

interface ControlledProps {
  actors: UseCaseActor[];
  state: DiagramState;
  onChange: (next: DiagramState) => void;
}

/** The toolbar: user-type filter, column count and Rearrange. */
export function UseCaseDiagramControls({ actors, state, onChange, autoColumns }: ControlledProps & { autoColumns: number }) {
  const colour = useMemo(() => actorColours(actors.map((a) => a.id)), [actors]);
  const toggle = (id: string) => {
    const next = new Set(state.filter);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...state, filter: next });
  };
  return (
    <div className="usecase-toolbar">
      <UserTypeSelect
        actors={actors}
        colour={colour}
        selected={state.filter}
        onToggle={toggle}
        onClear={() => onChange({ ...state, filter: new Set() })}
      />
      <select
        className="select"
        value={state.columns}
        onChange={(e) => onChange({ ...state, columns: Number(e.target.value) })}
        aria-label="Columns"
      >
        <option value={0}>Auto ({autoColumns} {autoColumns === 1 ? "column" : "columns"})</option>
        {Array.from({ length: MAX_COLUMNS }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n} {n === 1 ? "column" : "columns"}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn small"
        onClick={() => onChange({ ...state, seed: state.seed + 1 })}
        title="Try a different arrangement"
      >
        Rearrange
      </button>
    </div>
  );
}

/** The column count the automatic layout would pick, for the "Auto (n)"
 *  option label. Same maths as the diagram, so the two always agree. */
export function useAutoColumns(actors: UseCaseActor[], useCases: UseCase[], state: DiagramState, width: number | undefined): number {
  return useMemo(() => {
    const { shownActors, shownCases } = applyFilter(actors, useCases, state.filter);
    return layoutUseCaseDiagram(shownActors, shownCases, { width, seed: state.seed }).columns;
  }, [actors, useCases, state.filter, state.seed, width]);
}

function applyFilter(actors: UseCaseActor[], useCases: UseCase[], filter: Set<string>) {
  const filtering = filter.size > 0;
  const shownActors = filtering ? actors.filter((a) => filter.has(a.id)) : actors;
  const shownCases = filtering ? useCases.filter((u) => u.actor_ids.some((id) => filter.has(id))) : useCases;
  return { shownActors, shownCases };
}

export function UseCaseDiagram({
  systemName,
  actors,
  useCases,
  state,
  onChange,
  onWidth,
}: ControlledProps & { systemName: string; useCases: UseCase[]; onWidth?: (w: number | undefined) => void }) {
  const { seed, columns, filter } = state;
  // Hover highlights; a click pins the highlight until a click anywhere else.
  const [hover, setHover] = useState<Focus | null>(null);
  const [pinned, setPinned] = useState<Focus | null>(null);
  const focus = pinned ?? hover;
  const { ref, width } = useContainerWidth();
  useEffect(() => onWidth?.(width), [width, onWidth]);

  useEffect(() => {
    if (!pinned) return;
    const onDown = () => setPinned(null);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pinned]);

  const pin = (next: Focus) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setPinned((p) => (p && p.kind === next.kind && p.id === next.id ? null : next));
  };
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const isPinned = (kind: Focus["kind"], id: string) => (pinned && pinned.kind === kind && pinned.id === id ? " is-pinned" : "");

  // Colours follow the full actor list, so filtering never recolours anyone.
  const colour = useMemo(() => actorColours(actors.map((a) => a.id)), [actors]);

  // Drop filter entries for actors that no longer exist.
  useEffect(() => {
    const next = new Set([...filter].filter((id) => actors.some((a) => a.id === id)));
    if (next.size !== filter.size) onChange({ ...state, filter: next });
  }, [actors, filter, state, onChange]);

  const filtering = filter.size > 0;
  const shownActors = filtering ? actors.filter((a) => filter.has(a.id)) : actors;
  const shownCases = filtering ? useCases.filter((u) => u.actor_ids.some((id) => filter.has(id))) : useCases;
  const shownIds = useMemo(() => new Set(shownActors.map((a) => a.id)), [shownActors]);
  const caseActors = useMemo(() => new Map(useCases.map((u) => [u.id, u.actor_ids])), [useCases]);

  const layout = useMemo(
    () => layoutUseCaseDiagram(shownActors, shownCases, { width, seed, columns: columns || undefined }),
    [shownActors, shownCases, width, seed, columns],
  );

  // Connected set for the hover focus.
  const related = useMemo(() => {
    if (!focus) return null;
    const ids = new Set<string>([focus.id]);
    for (const l of layout.links) {
      if (focus.kind === "actor" && l.actorId === focus.id) ids.add(l.useCaseId);
      if (focus.kind === "usecase" && l.useCaseId === focus.id) ids.add(l.actorId);
    }
    return ids;
  }, [focus, layout.links]);
  const dim = (id: string) => (related && !related.has(id) ? " is-dim" : "");

  return (
    <div className="stack">
      <div className="section usecase-canvas" ref={ref}>
        {shownCases.length === 0 && shownActors.length === 0 ? (
          <div className="usecase-empty">Nothing to show for this filter.</div>
        ) : (
          <svg
            className="usecase-svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width={layout.width}
            height={layout.height}
            role="img"
            aria-label={`Use case diagram for ${systemName}`}
            onMouseLeave={() => setHover(null)}
            onMouseDown={stop}
            onClick={() => setPinned(null)}
          >
            <rect
              className="usecase-boundary"
              x={layout.boundary.x}
              y={layout.boundary.y}
              width={layout.boundary.width}
              height={layout.boundary.height}
              rx={6}
            />
            <text className="usecase-boundary-title" x={layout.boundary.x + 14} y={layout.boundary.y + 24}>
              {systemName}
            </text>

            {layout.useCases.map((u) => {
              // Dots only for user types currently shown; tint by the first.
              const performers = (caseActors.get(u.id) ?? []).filter((id) => shownIds.has(id));
              const primary = performers[0] ? colour.get(performers[0]) : undefined;
              const dotsWidth = (performers.length - 1) * DOT_GAP;
              return (
                <g
                  key={u.id}
                  className={`usecase-ellipse${dim(u.id)}${isPinned("usecase", u.id)}`}
                  onMouseEnter={() => setHover({ kind: "usecase", id: u.id })}
                  onClick={pin({ kind: "usecase", id: u.id })}
                >
                  <title>{u.name}</title>
                  <ellipse
                    cx={u.x}
                    cy={u.y}
                    rx={u.rx}
                    ry={u.ry}
                    style={primary ? { stroke: primary, fill: withAlpha(primary, 0.16) } : undefined}
                  />
                  <text x={u.x} y={u.y + (performers.length ? 1 : 4)} textAnchor="middle">
                    {truncate(u.name, 30)}
                  </text>
                  {performers.map((id, i) => (
                    <circle
                      key={id}
                      className="usecase-dot"
                      cx={u.x - dotsWidth / 2 + i * DOT_GAP}
                      cy={u.y + u.ry - 8}
                      r={DOT_R}
                      style={{ fill: colour.get(id) }}
                    >
                      <title>{actors.find((a) => a.id === id)?.name ?? ""}</title>
                    </circle>
                  ))}
                </g>
              );
            })}

            {layout.actors.map((a) => {
              const c = colour.get(a.id);
              return (
                <g
                  key={a.id}
                  className={`usecase-actor${dim(a.id)}${isPinned("actor", a.id)}`}
                  transform={`translate(${a.x} ${a.y})`}
                  onMouseEnter={() => setHover({ kind: "actor", id: a.id })}
                  onClick={pin({ kind: "actor", id: a.id })}
                  style={c ? { color: c } : undefined}
                >
                  <title>{a.name}</title>
                  {/* Invisible hit area so the gaps between the limbs still hover/click. */}
                  <rect
                    className="usecase-actor-hit"
                    x={-40}
                    y={-12}
                    width={80}
                    height={ACTOR_HEIGHT + ACTOR_LABEL_GAP + a.labelLines.length * ACTOR_LINE + 12}
                  />
                  <circle cx={0} cy={0} r={7} />
                  <path d={`M0 7v22M-14 15h28M0 29l-12 ${ACTOR_HEIGHT - 40}M0 29l12 ${ACTOR_HEIGHT - 40}`} />
                  <text x={0} y={ACTOR_HEIGHT + ACTOR_LABEL_GAP + ACTOR_LINE - 3} textAnchor="middle">
                    {a.labelLines.map((line, i) => (
                      <tspan key={i} x={0} dy={i === 0 ? 0 : ACTOR_LINE}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}

/** Multi-select of user types: a button showing the selection, opening a
 *  checklist. Empty selection means "all". */
function UserTypeSelect({
  actors,
  colour,
  selected,
  onToggle,
  onClear,
}: {
  actors: UseCaseActor[];
  colour: Map<string, string>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chosen = actors.filter((a) => selected.has(a.id));
  const label =
    chosen.length === 0 ? "All user types" : chosen.length === 1 ? chosen[0].name : `${chosen.length} user types`;

  return (
    <div className="usecase-select" ref={ref}>
      <button
        type="button"
        className="select usecase-select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {chosen.length > 0 && (
          <span className="usecase-select-swatches" aria-hidden="true">
            {chosen.slice(0, 4).map((a) => (
              <span key={a.id} className="chip-swatch" style={{ background: colour.get(a.id) }} />
            ))}
          </span>
        )}
        <span className="usecase-select-label">{label}</span>
        <span className="usecase-select-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="usecase-select-menu" role="listbox" aria-multiselectable="true" aria-label="User types">
          <label className="usecase-check">
            <input type="checkbox" checked={selected.size === 0} onChange={onClear} />
            <span>All user types</span>
          </label>
          <div className="usecase-select-divider" />
          {actors.map((a) => (
            <label key={a.id} className="usecase-check" role="option" aria-selected={selected.has(a.id)}>
              <input type="checkbox" checked={selected.has(a.id)} onChange={() => onToggle(a.id)} />
              <span className="chip-swatch" style={{ background: colour.get(a.id) }} aria-hidden="true" />
              <span>{a.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** Width of the element the ref is attached to, tracked with ResizeObserver. */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width: width || undefined };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
