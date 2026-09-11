// Minimal inline-SVG icon set for the board, ported from the reference app's
// static/js/icons.js. stroke uses currentColor so an icon always matches the
// text beside it.
const ICONS: Record<string, string> = {
  flag: '<line x1="5" y1="3" x2="5" y2="21"/><path d="M5 4 L18 4 L15 8 L18 12 L5 12"/>',
  timer: '<circle cx="12" cy="13" r="8"/><line x1="12" y1="13" x2="12" y2="8"/><line x1="9" y1="2" x2="15" y2="2"/>',
  requirement: '<rect x="3" y="5" width="18" height="14" rx="2"/><line x1="15" y1="5" x2="15" y2="19" stroke-dasharray="2 2"/>',
  message: '<path d="M4 5 L20 5 L20 17 L9 17 L4 21 L4 17 Z"/>',
};

export type BoardIconName = keyof typeof ICONS;

export function Icon({ name, small = false }: { name: BoardIconName; small?: boolean }) {
  const body = ICONS[name];
  if (!body) return null;
  return (
    <svg
      className={`ico${small ? " ico-sm" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Static markup from this file, never user input.
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
