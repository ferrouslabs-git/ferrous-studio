// Palette glyphs for the basic shapes. The UML tiles get by on a character
// each, but sixteen pieces of geometry drawn from the Unicode block would be a
// row of near-identical circles on most Windows fonts, so these are drawn.
// Every path is on a 24x24 box and inherits the tile's colour.
import type { UmlNodeType } from "../graph/umlTypes";

const PATHS: Partial<Record<UmlNodeType, string>> = {
  rect: "M2 6h20v12H2z",
  roundRect: "M5 6h14a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3z",
  ellipse: "M12 6c5.5 0 10 2.7 10 6s-4.5 6-10 6S2 15.3 2 12s4.5-6 10-6z",
  circle: "M12 2.5c5.2 0 9.5 4.3 9.5 9.5s-4.3 9.5-9.5 9.5S2.5 17.2 2.5 12 6.8 2.5 12 2.5z",
  triangle: "M12 3l10 18H2z",
  diamond: "M12 2l10 10-10 10L2 12z",
  pentagon: "M12 2l10 7.3-3.8 11.7H5.8L2 9.3z",
  hexagon: "M7 4h10l5 8-5 8H7l-5-8z",
  star: "M12 2l2.7 6.6 7.3.5-5.6 4.6 1.8 7L12 17l-6.2 3.7 1.8-7L2 9.1l7.3-.5z",
  cross: "M9 2h6v7h7v6h-7v7H9v-7H2V9h7z",
  cylinder: "M4 6.5c0-2 3.6-3.5 8-3.5s8 1.5 8 3.5v11c0 2-3.6 3.5-8 3.5s-8-1.5-8-3.5zM4 6.5c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5",
  cloud: "M6.5 19a4.5 4.5 0 0 1-.4-9 6 6 0 0 1 11.3 1.2A4 4 0 0 1 17.5 19z",
  parallelogram: "M6 6h16l-4 12H2z",
  trapezium: "M6 6h12l4 12H2z",
  arrow: "M2 9h11V5l7 7-7 7v-4H2z",
  callout: "M2 4h20v11h-11l-5 5v-5H2z",
};

export function ShapeGlyph({ type, glyph }: { type: UmlNodeType; glyph: string }) {
  const path = PATHS[type];
  if (!path) {
    return (
      <span className="palette-glyph" aria-hidden="true">
        {glyph}
      </span>
    );
  }
  return (
    <svg className="palette-glyph" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
