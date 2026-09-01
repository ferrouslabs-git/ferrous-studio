// Pure layout for the use case diagram. Derived from the two lists on every
// render — the diagram is never stored, so there is nothing to keep in sync.
//
// Shape: use cases sit in a grid inside the system boundary. They are grouped
// by the first user type that can perform them and each group is a *band* of
// rows: a band starts on a fresh row and fills from the side its actor stands
// on, so a partial row hugs the actor. Within a band, use cases shared with
// the neighbouring bands' actors are sorted to the edge nearest them. Actors
// stand left and right of the boundary at the vertical centre of their band,
// pushed apart where they would overlap. `seed` rotates which actor leads and
// which side it takes, so "Rearrange" cycles through different arrangements.

export interface LayoutActor {
  id: string;
  name: string;
}

export interface LayoutUseCase {
  id: string;
  name: string;
  actor_ids: string[];
}

export interface LayoutOptions {
  /** Available width in CSS px; the grid picks its column count from it. */
  width?: number;
  /** Any integer; changes the actor order and side assignment. */
  seed?: number;
  /** Force this many columns (1–MAX_COLUMNS); omit for automatic. */
  columns?: number;
}

export interface PlacedActor extends LayoutActor {
  /** Centre of the stick figure's head. */
  x: number;
  y: number;
  side: "left" | "right";
  /** The name wrapped to fit the actor column. */
  labelLines: string[];
}

export interface PlacedUseCase {
  id: string;
  name: string;
  /** Ellipse centre and radii. */
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export interface PlacedLink {
  actorId: string;
  useCaseId: string;
}

export interface UseCaseDiagramLayout {
  width: number;
  height: number;
  columns: number;
  boundary: { x: number; y: number; width: number; height: number };
  actors: PlacedActor[];
  useCases: PlacedUseCase[];
  /** Every (actor, use case) pair that is drawn — used for hover focus. */
  links: PlacedLink[];
}

export const ACTOR_HEIGHT = 58; // head centre to feet
/** Line height of the label under the feet. */
export const ACTOR_LINE = 14;
/** Gap between the feet and the first label line. */
export const ACTOR_LABEL_GAP = 6;
export const MAX_COLUMNS = 5;
/** Characters per label line before wrapping (≈ 11px font in the column). */
export const LABEL_CHARS = 16;

const ACTOR_COLUMN = 130; // width reserved for the actor column on each side
const ACTOR_MIN_GAP = 16; // between one actor's label bottom and the next head
const BOUNDARY_TOP = 20;
const BOUNDARY_TITLE = 36;
const CASE_RX = 118;
const CASE_RY = 24;
const CASE_COL = CASE_RX * 2 + 20; // column pitch
const CASE_ROW = CASE_RY * 2 + 22; // row pitch
const PADDING = 20;
const DEFAULT_WIDTH = 1100;
/** The SVG scales to fit its container; accept shrinking this far before
 *  giving up a column. */
const MIN_SCALE = 0.8;

/** Height of a figure from head centre to the bottom of its label. */
export function actorFigureHeight(labelLines: number): number {
  return ACTOR_HEIGHT + ACTOR_LABEL_GAP + Math.max(labelLines, 1) * ACTOR_LINE;
}

/** Greedy word wrap; a single word longer than the limit stays whole. */
export function wrapLabel(name: string, maxChars: number = LABEL_CHARS): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) current = w;
    else if (current.length + 1 + w.length <= maxChars) current += ` ${w}`;
    else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function layoutUseCaseDiagram(
  actors: LayoutActor[],
  useCases: LayoutUseCase[],
  options: LayoutOptions = {},
): UseCaseDiagramLayout {
  const seed = options.seed ?? 0;
  const availableWidth = Math.max((options.width ?? DEFAULT_WIDTH) / MIN_SCALE, ACTOR_COLUMN * 2 + CASE_COL + PADDING * 2);

  // Actors: lead with the busiest, rotated by the seed, alternating sides.
  const count = new Map<string, number>(actors.map((a) => [a.id, 0]));
  for (const u of useCases) for (const id of u.actor_ids) if (count.has(id)) count.set(id, (count.get(id) ?? 0) + 1);
  const ordered = [...actors].sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const rotated = rotate(ordered, actors.length ? mod(seed, actors.length) : 0);
  const flip = Math.floor(seed / Math.max(actors.length, 1)) % 2 === 1;
  const sideOf = new Map<string, "left" | "right">(
    rotated.map((a, i) => [a.id, (i % 2 === 0) !== flip ? "left" : "right"]),
  );
  const rank = new Map<string, number>(rotated.map((a, i) => [a.id, i]));

  // Columns: forced, else as many as fit between the two actor columns.
  const fit = Math.floor((availableWidth - ACTOR_COLUMN * 2 - PADDING * 2) / CASE_COL);
  const wanted = options.columns ? Math.min(MAX_COLUMNS, Math.max(1, Math.floor(options.columns))) : Math.min(MAX_COLUMNS, fit);
  const columns = Math.max(1, Math.min(wanted, useCases.length || 1));
  const boundaryWidth = columns * CASE_COL + PADDING;
  const boundaryX = ACTOR_COLUMN;
  const width = ACTOR_COLUMN * 2 + boundaryWidth;

  // Bands: one per actor (in rotated order) holding the use cases it is the
  // first performer of; use cases nobody shown can perform go in a last band.
  const ownerOf = (u: LayoutUseCase) => u.actor_ids.find((id) => rank.has(id));
  const bands: { actorId: string | null; cases: LayoutUseCase[] }[] = rotated.map((a) => ({ actorId: a.id, cases: [] }));
  const orphans: LayoutUseCase[] = [];
  for (const u of useCases) {
    const owner = ownerOf(u);
    if (owner === undefined) orphans.push(u);
    else bands[rank.get(owner) as number].cases.push(u);
  }
  if (orphans.length) bands.push({ actorId: null, cases: orphans });

  // Within a band, shared use cases drift towards the band of their other
  // performer: earlier actors pull to the top, later ones to the bottom.
  for (const band of bands) {
    if (band.actorId === null) continue;
    const mine = rank.get(band.actorId) as number;
    const pull = (u: LayoutUseCase) => {
      const others = u.actor_ids.map((id) => rank.get(id)).filter((r): r is number => r !== undefined && r !== mine);
      if (others.length === 0) return 0;
      return Math.min(...others) < mine ? -1 : 1;
    };
    band.cases = band.cases.map((u, i) => ({ u, i })).sort((a, b) => pull(a.u) - pull(b.u) || a.i - b.i).map((x) => x.u);
  }

  const placedCases: PlacedUseCase[] = [];
  const bandRows: { actorId: string | null; firstRow: number; rows: number }[] = [];
  let row = 0;
  for (const band of bands) {
    if (band.cases.length === 0) {
      bandRows.push({ actorId: band.actorId, firstRow: row, rows: 0 });
      continue;
    }
    const fromRight = band.actorId !== null && sideOf.get(band.actorId) === "right";
    const rows = Math.ceil(band.cases.length / columns);
    band.cases.forEach((u, i) => {
      const r = row + Math.floor(i / columns);
      const c = i % columns;
      const col = fromRight ? columns - 1 - c : c;
      placedCases.push({
        id: u.id,
        name: u.name,
        x: boundaryX + PADDING / 2 + CASE_COL * col + CASE_COL / 2,
        y: BOUNDARY_TOP + BOUNDARY_TITLE + CASE_ROW * r + CASE_ROW / 2,
        rx: CASE_RX,
        ry: CASE_RY,
      });
    });
    bandRows.push({ actorId: band.actorId, firstRow: row, rows });
    row += rows;
  }
  const casesHeight = Math.max(row, 1) * CASE_ROW;
  const rowCentre = (r: number) => BOUNDARY_TOP + BOUNDARY_TITLE + CASE_ROW * r + CASE_ROW / 2;

  // Actors at the vertical centre of their band, then pushed apart per side.
  const desired = rotated.map((a) => {
    const band = bandRows.find((b) => b.actorId === a.id);
    const lines = wrapLabel(a.name);
    const figure = actorFigureHeight(lines.length);
    const centre =
      band && band.rows > 0
        ? (rowCentre(band.firstRow) + rowCentre(band.firstRow + band.rows - 1)) / 2
        : BOUNDARY_TOP + BOUNDARY_TITLE + casesHeight / 2;
    return { ...a, lines, figure, side: sideOf.get(a.id) ?? ("left" as const), y: centre - figure / 2 + 10 };
  });
  const placedActors: PlacedActor[] = [];
  let sidesBottom = 0;
  for (const side of ["left", "right"] as const) {
    const group = desired.filter((a) => a.side === side).sort((a, b) => a.y - b.y);
    let cursor = BOUNDARY_TOP + 10;
    for (const a of group) {
      const y = Math.max(a.y, cursor);
      cursor = y + a.figure + ACTOR_MIN_GAP;
      placedActors.push({
        id: a.id,
        name: a.name,
        side,
        labelLines: a.lines,
        x: side === "left" ? ACTOR_COLUMN / 2 : width - ACTOR_COLUMN / 2,
        y,
      });
      sidesBottom = Math.max(sidesBottom, y + a.figure);
    }
  }

  const boundaryHeight = BOUNDARY_TITLE + casesHeight + PADDING;
  const height = Math.max(boundaryHeight + BOUNDARY_TOP * 2, sidesBottom + BOUNDARY_TOP, 200);
  const boundary = { x: boundaryX, y: BOUNDARY_TOP, width: boundaryWidth, height: height - BOUNDARY_TOP * 2 };

  const links: PlacedLink[] = [];
  for (const u of useCases) for (const actorId of u.actor_ids) if (rank.has(actorId)) links.push({ actorId, useCaseId: u.id });

  // Keep the original list order for actors so callers can rely on it.
  const byId = new Map(placedActors.map((a) => [a.id, a]));
  return {
    width,
    height,
    columns,
    boundary,
    actors: actors.map((a) => byId.get(a.id) as PlacedActor),
    useCases: placedCases,
    links,
  };
}

function rotate<T>(list: T[], by: number): T[] {
  if (list.length === 0) return list;
  return [...list.slice(by), ...list.slice(0, by)];
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
