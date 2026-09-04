// Icon marks drawn by hand as 16-unit stroke SVGs.
//
// NAV_ICON_MARKS: the built-in navigation icons (names exported as NAV_ICONS
// in the catalogue; `satisfies` keeps the two in lock-step). Shared between
// the Schematic (drawn beside the item's label when the nav bar's shape is
// Icons) and the Inspector's icon picker, which shows the glyphs themselves.
// Kept apart from the brand marks: a brand wants an abstract mark, a nav item
// wants a recognisable destination.
//
// LIB_ICONS: one glyph per catalogue component and element type, drawn for
// the library bars where each entry is just an icon and a short name.
import { ReactNode } from "react";
import { NavIcon } from "../catalog";

const navSvg = (children: ReactNode) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const NAV_ICON_MARKS = {
  home: navSvg(<path d="M2.5 8.5 8 3l5.5 5.5M4.5 7.5V13h7V7.5" />),
  dashboard: navSvg(<><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></>),
  folder: navSvg(<path d="M2 12.5V3.5h4.5L8 5h6v7.5H2Z" />),
  document: navSvg(<><path d="M4 14.5V1.5h5.5l3 3v10H4Z" /><path d="M9.5 1.5v3h3M6.5 8h3M6.5 10.5h3" /></>),
  calendar: navSvg(<><rect x="2.5" y="3.5" width="11" height="10" rx="1" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></>),
  inbox: navSvg(<><path d="M2 9h3.5l1 2h3l1-2H14v4H2V9Z" /><path d="M4 9V3h8v6" /></>),
  user: navSvg(<><circle cx="8" cy="5" r="2.5" /><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" /></>),
  users: navSvg(<><circle cx="6" cy="5.5" r="2.25" /><path d="M2.5 13c0-2.2 1.6-3.5 3.5-3.5s3.5 1.3 3.5 3.5M10.5 3.6a2.25 2.25 0 0 1 0 3.8M11.5 9.8c1.2.5 2 1.7 2 3.2" /></>),
  chat: navSvg(<path d="M2 3h12v8H8.5L5 13.5V11H2V3Z" />),
  mail: navSvg(<><rect x="2" y="3.5" width="12" height="9" rx="1" /><path d="m2.5 4.5 5.5 4.5 5.5-4.5" /></>),
  phone: navSvg(<path d="M2 3c0-.55.45-1 1-1h2.2l1.3 3.2-1.7 1.4a10.5 10.5 0 0 0 4.6 4.6l1.4-1.7L14 10.8V13c0 .55-.45 1-1 1C7 14 2 9 2 3Z" />),
  bell: navSvg(<><path d="M8 2a4 4 0 0 1 4 4v3l1.5 2.5h-11L4 9V6a4 4 0 0 1 4-4Z" /><path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" /></>),
  search: navSvg(<><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></>),
  chart: navSvg(<path d="M2 13.5h12M4.5 13V8.5M8 13V4.5M11.5 13V6.5" />),
  database: navSvg(<><ellipse cx="8" cy="3.75" rx="5.5" ry="2.25" /><path d="M2.5 3.75v8.5c0 1.25 2.45 2.25 5.5 2.25s5.5-1 5.5-2.25v-8.5M2.5 8c0 1.25 2.45 2.25 5.5 2.25S13.5 9.25 13.5 8" /></>),
  layers: navSvg(<><path d="M8 2 14.5 5.5 8 9 1.5 5.5 8 2Z" /><path d="M1.5 8.75 8 12.25l6.5-3.5" /></>),
  globe: navSvg(<><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2a9.3 9.3 0 0 0 0 12M8 2a9.3 9.3 0 0 1 0 12" /></>),
  pin: navSvg(<><path d="M8 14.5S3 9.6 3 6.4a5 5 0 0 1 10 0c0 3.2-5 8.1-5 8.1Z" /><circle cx="8" cy="6.4" r="1.6" /></>),
  star: navSvg(<path d="m8 1.5 2 4.1 4.5.65-3.25 3.15.75 4.5L8 11.75 4 13.9l.75-4.5L1.5 6.25 6 5.6 8 1.5Z" />),
  heart: navSvg(<path d="M8 13.5C4 10.5 2 8.5 2 6a3 3 0 0 1 6-.5A3 3 0 0 1 14 6c0 2.5-2 4.5-6 7.5Z" />),
  flag: navSvg(<path d="M3.5 14.5V2M3.5 2.5h9L10.5 5.25 12.5 8h-9" />),
  tag: navSvg(<><path d="M2 2.5h5.5L14 9l-5 5-7-7V2.5Z" /><circle cx="5.25" cy="5.75" r="1" /></>),
  clock: navSvg(<><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></>),
  camera: navSvg(<><path d="M2 5h3l1.25-1.5h3.5L11 5h3v8.5H2V5Z" /><circle cx="8" cy="9" r="2.25" /></>),
  image: navSvg(<><rect x="2" y="3" width="12" height="10" rx="1" /><circle cx="5.5" cy="6.5" r="1" /><path d="m2 11 3.5-3 3 2.5L11 8l3 3" /></>),
  cart: navSvg(<><path d="M1.5 2.5h2L5.25 10H12l2-5.5H4.1" /><circle cx="6" cy="13" r="1.15" /><circle cx="11" cy="13" r="1.15" /></>),
  card: navSvg(<><rect x="1.5" y="3.5" width="13" height="9" rx="1" /><path d="M1.5 6.5h13M4 10h3" /></>),
  briefcase: navSvg(<><rect x="2" y="5" width="12" height="8.5" rx="1" /><path d="M6 5V3.5h4V5M2 8.5h12" /></>),
  building: navSvg(<path d="M3 13.5V2.5h7v11M10 6h3v7.5M2 13.5h12M5 5h1.5M5 7.5h1.5M5 10h1.5" />),
  book: navSvg(<><path d="M8 3.5C7 2.5 5.5 2 3 2v10.5c2.5 0 4 .5 5 1.5 1-1 2.5-1.5 5-1.5V2c-2.5 0-4 .5-5 1.5Z" /><path d="M8 3.5V14" /></>),
  clipboard: navSvg(<><rect x="3" y="2.5" width="10" height="12" rx="1" /><path d="M6 2.5v-1h4v1M6 7h4M6 9.5h4" /></>),
  bookmark: navSvg(<path d="M4 1.5h8v13L8 11l-4 3.5v-13Z" />),
  cloud: navSvg(<path d="M4.75 12.5a3.25 3.25 0 0 1-.5-6.45A4.25 4.25 0 0 1 12.5 7.4a2.6 2.6 0 0 1-.75 5.1h-7Z" />),
  download: navSvg(<path d="M8 2v7.5M4.75 6.25 8 9.5l3.25-3.25M2.5 13.5h11" />),
  lock: navSvg(<><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7V4.75a2.5 2.5 0 0 1 5 0V7" /></>),
  key: navSvg(<><circle cx="5" cy="11" r="2.75" /><path d="m7 9 6.5-6.5M10.5 5.5l2 2M12.5 3.5l1.5 1.5" /></>),
  shield: navSvg(<path d="M8 1.5 13.5 3.5v4.25c0 3.4-2.2 5.75-5.5 6.75-3.3-1-5.5-3.35-5.5-6.75V3.5L8 1.5Z" />),
  settings: navSvg(<><path d="M2 4h6.9M12.1 4H14M2 8h.9M6.1 8H14M2 12h4.9M10.1 12H14" /><circle cx="10.5" cy="4" r="1.6" /><circle cx="4.5" cy="8" r="1.6" /><circle cx="8.5" cy="12" r="1.6" /></>),
  help: navSvg(<><circle cx="8" cy="8" r="6" /><path d="M6.3 6.3A1.7 1.7 0 1 1 8 8.3v.9M8 11.4v.1" /></>),
} satisfies Record<NavIcon, ReactNode>;

/** The glyph for a stored `data.icon` name; null for uploads, strays and unset. */
export const navIconGlyph = (name: string | undefined): ReactNode | null =>
  name && name in NAV_ICON_MARKS ? NAV_ICON_MARKS[name as NavIcon] : null;

// ── Library glyphs ──────────────────────────────────────────────────────────
// Component and element types share one namespace (no catalogue type collides
// across the two), so a single record serves both bars. A few reuse the nav
// marks where the destination glyph already says the right thing.

const LEGEND_MARK = navSvg(
  <>
    <rect x="2.5" y="3" width="3" height="3" rx="1" />
    <path d="M7.5 4.5h6" />
    <rect x="2.5" y="10" width="3" height="3" rx="1" />
    <path d="M7.5 11.5h6" />
  </>,
);

export const LIB_ICONS: Record<string, ReactNode> = {
  // Components
  navbar: navSvg(<><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><path d="M2 6h12M4 4.25h4" /></>),
  list: navSvg(<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />),
  form: navSvg(<><rect x="2" y="2.5" width="12" height="4.5" rx="1" /><rect x="2" y="9" width="7.5" height="4.5" rx="2.25" /></>),
  graph: NAV_ICON_MARKS.chart,
  canvas: navSvg(<><rect x="2" y="2" width="12" height="12" rx="1.5" strokeDasharray="2.6 2.2" /><circle cx="8" cy="8" r="2" /></>),
  calendar: NAV_ICON_MARKS.calendar,
  // Nav bar elements
  brand: navSvg(<><rect x="2.5" y="2.5" width="11" height="11" rx="3" /><circle cx="8" cy="8" r="2" /></>),
  "nav-item": navSvg(<path d="M2.5 8H12M9 4.5 12.5 8 9 11.5" />),
  "group-heading": navSvg(<path d="M2.5 3.5h6M2.5 7.5h11M2.5 11.5h11" />),
  search: NAV_ICON_MARKS.search,
  select: navSvg(<><rect x="2" y="4" width="12" height="8" rx="1.5" /><path d="m9.75 7.25 1.5 1.5 1.5-1.5" /></>),
  button: navSvg(<><rect x="2" y="4.5" width="12" height="7" rx="3.5" /><path d="M5.5 8h5" /></>),
  avatar: NAV_ICON_MARKS.user,
  "workspace-switcher": NAV_ICON_MARKS.layers,
  divider: navSvg(<><path d="M2 8h12" /><path d="M4.5 3.5h7M4.5 12.5h7" opacity=".35" /></>),
  // List elements
  header: navSvg(<path d="M2 3.5h12M2 7.5h8M2 11h5" />),
  column: navSvg(<><rect x="6" y="2.5" width="4" height="11" rx="1" /><path d="M2.75 3.5v9M13.25 3.5v9" opacity=".4" /></>),
  "column-header": navSvg(<><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M2 6.5h12M6.5 6.5v6.5M10 6.5v6.5" /></>),
  "row-action": navSvg(<><circle cx="8" cy="3.5" r=".9" /><circle cx="8" cy="8" r=".9" /><circle cx="8" cy="12.5" r=".9" /></>),
  "select-column": navSvg(<><rect x="2.5" y="5" width="6" height="6" rx="1.25" /><path d="m4.25 8 1.25 1.25L7.5 6.75M11 6h3M11 10h3" /></>),
  filter: navSvg(<path d="M2.5 3h11L10 8.25V12l-4 1.75V8.25L2.5 3Z" />),
  pagination: navSvg(<><rect x="2" y="5.25" width="3.25" height="5.5" rx="1" /><rect x="6.4" y="5.25" width="3.25" height="5.5" rx="1" /><rect x="10.75" y="5.25" width="3.25" height="5.5" rx="1" /></>),
  // Form elements
  "text-input": navSvg(<><rect x="2" y="4.75" width="12" height="6.5" rx="1.25" /><path d="M4.75 7v2" /></>),
  "text-area": navSvg(<><rect x="2" y="3" width="12" height="10" rx="1.25" /><path d="M4.5 6h7M4.5 8.5h4.5" /></>),
  "radio-group": navSvg(<><circle cx="4.75" cy="5" r="2" /><circle cx="4.75" cy="5" r=".4" /><path d="M9.5 5H14M9.5 11H14" /><circle cx="4.75" cy="11" r="2" /></>),
  checkbox: navSvg(<><rect x="2.75" y="2.75" width="10.5" height="10.5" rx="2" /><path d="m5.25 8.25 2 2L11 6" /></>),
  toggle: navSvg(<><rect x="2" y="4.75" width="12" height="6.5" rx="3.25" /><circle cx="10.75" cy="8" r="1.9" /></>),
  "date-picker": NAV_ICON_MARKS.calendar,
  "file-upload": navSvg(<path d="M8 10.5V3.5M4.75 6.25 8 3l3.25 3.25M2.5 13h11" />),
  "section-heading": navSvg(<><path d="M2.5 4h6" /><path d="M2.5 8h11M2.5 11.5h11" opacity=".45" /></>),
  step: navSvg(<><circle cx="3.9" cy="8" r="1.9" /><path d="M5.8 8h4.3" /><circle cx="12" cy="8" r="1.9" /></>),
  "help-text": NAV_ICON_MARKS.help,
  // Graph elements
  series: navSvg(<path d="m2 11.5 3.5-4.5 3 2.5L14 4" />),
  "category-axis": navSvg(<><path d="M2.5 3v10h11" /><path d="M6 13v-2M9.5 13v-2M13 13v-2" opacity=".55" /></>),
  "value-axis": navSvg(<><path d="M2.5 3v10h11" /><path d="M2.5 6h2M2.5 9.5h2" opacity=".55" /></>),
  legend: LEGEND_MARK,
  "range-selector": navSvg(<path d="M3 4.5v7M13 4.5v7M3 8h10" />),
  stat: navSvg(<path d="m2 11 4-4 2.5 2.5L13.5 4M13.5 4H10M13.5 4v3.5" />),
  // Canvas elements
  heading: navSvg(<path d="M3.5 3v10M12.5 3v10M3.5 8h9" />),
  text: navSvg(<path d="M2 4h12M2 7.5h12M2 11h7" />),
  label: NAV_ICON_MARKS.tag,
  badge: navSvg(<rect x="2" y="5.25" width="12" height="5.5" rx="2.75" />),
  link: navSvg(<><path d="M9.5 6.5 6.5 9.5" /><path d="M8.75 4.25 10 3a2.83 2.83 0 0 1 4 4l-1.5 1.5" /><path d="M7.25 11.75 6 13a2.83 2.83 0 0 1-4-4l1.5-1.5" /></>),
  image: NAV_ICON_MARKS.image,
  box: navSvg(<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" strokeDasharray="2.6 2.2" />),
  // Calendar elements
  event: navSvg(<><rect x="2.5" y="3.5" width="11" height="10" rx="1" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /><circle cx="8" cy="10" r="1.4" /></>),
  "view-switcher": navSvg(<><rect x="2" y="4" width="5.25" height="8" rx="1" /><rect x="8.75" y="4" width="5.25" height="8" rx="1" /></>),
  "calendar-nav": navSvg(<path d="m6.5 4.5-3.5 3.5 3.5 3.5M9.5 4.5 13 8l-3.5 3.5" />),
  "resource-row": navSvg(<><path d="M2 4.5h12M2 11.5h12" opacity=".45" /><rect x="4" y="6.5" width="6.5" height="3" rx="1" /></>),
  "calendar-legend": LEGEND_MARK,
};
