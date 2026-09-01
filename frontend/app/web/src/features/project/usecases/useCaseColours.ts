// Colour coding for the use case diagram: each user type gets a colour sampled
// evenly along the brand gradient (orange → violet → blue), so the first is
// always brand orange and the last brand blue, with the rest spaced between.

/** Stops of --gradient-iridescent in brand.css. */
const STOPS: [number, number, number][] = [
  [0xff, 0x5b, 0x1a], // #FF5B1A orange
  [0x7c, 0x5c, 0xff], // #7C5CFF violet
  [0x25, 0x40, 0xe8], // #2540E8 blue
];

/** Colour at position t ∈ [0, 1] along the gradient, as "rgb(r, g, b)". */
export function gradientAt(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const [a, b] = [STOPS[i], STOPS[i + 1]];
  const mix = (k: number) => Math.round(a[k] + (b[k] - a[k]) * f);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

/** Colour for the i-th of n user types. A single user type is brand orange. */
export function actorColour(index: number, count: number): string {
  if (count <= 1) return gradientAt(0);
  return gradientAt(index / (count - 1));
}

/** The same colour with an alpha, for fills behind text. */
export function withAlpha(rgb: string, alpha: number): string {
  return rgb.replace(/^rgb\((.+)\)$/, `rgba($1, ${alpha})`);
}

/** A colour per actor id, in the order given. */
export function actorColours(ids: string[]): Map<string, string> {
  return new Map(ids.map((id, i) => [id, actorColour(i, ids.length)]));
}
