// Minimal inline-SVG icon set for the board, ported from the reference app's
// static/js/icons.js. stroke uses currentColor so an icon always matches the
// text beside it.
const ICONS: Record<string, string> = {
  map: '<path d="M3 6 L9 4 L15 6 L21 4 L21 18 L15 20 L9 18 L3 20 Z"/><line x1="9" y1="4" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="20"/>',
  flag: '<line x1="5" y1="3" x2="5" y2="21"/><path d="M5 4 L18 4 L15 8 L18 12 L5 12"/>',
  timer: '<circle cx="12" cy="13" r="8"/><line x1="12" y1="13" x2="12" y2="8"/><line x1="9" y1="2" x2="15" y2="2"/>',
  requirement: '<rect x="3" y="5" width="18" height="14" rx="2"/><line x1="15" y1="5" x2="15" y2="19" stroke-dasharray="2 2"/>',
  layers: '<polygon points="12,3 21,8 12,13 3,8"/><polyline points="3,12 12,17 21,12"/><polyline points="3,16 12,21 21,16"/>',
  fileText:
    '<path d="M6 2 L15 2 L19 6 L19 22 L6 22 Z"/><path d="M15 2 L15 6 L19 6"/><line x1="9" y1="13" x2="16" y2="13"/><line x1="9" y1="17" x2="16" y2="17"/>',
  activity: '<polyline points="3,12 8,12 10,6 14,18 16,12 21,12"/>',
  message: '<path d="M4 5 L20 5 L20 17 L9 17 L4 21 L4 17 Z"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><polyline points="8,12 11,15 16,8"/>',
  trash: '<path d="M4 7 L20 7 M9 7 L9 4 L15 4 L15 7 M6 7 L7 21 L17 21 L18 7"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><rect x="2" y="9" width="3" height="2"/><rect x="2" y="13" width="3" height="2"/><rect x="19" y="9" width="3" height="2"/><rect x="19" y="13" width="3" height="2"/><rect x="9" y="2" width="2" height="3"/><rect x="13" y="2" width="2" height="3"/><rect x="9" y="19" width="2" height="3"/><rect x="13" y="19" width="2" height="3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
};

export type BoardIconName = keyof typeof ICONS;

export function Icon({ name, small = false, className }: { name: BoardIconName; small?: boolean; className?: string }) {
  const body = ICONS[name];
  if (!body) return null;
  return (
    <svg
      className={`ico${small ? " ico-sm" : ""}${className ? ` ${className}` : ""}`}
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
