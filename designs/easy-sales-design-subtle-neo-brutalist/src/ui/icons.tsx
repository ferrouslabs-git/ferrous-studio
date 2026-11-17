// A small stroke icon set, drawn inline so nothing is fetched at run time.
// 16px on a 24 grid, 1.75 stroke: quiet enough to sit beside 14px text.
const PATHS: Record<string, string> = {
  building: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  shield: "M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6zM9.5 12l1.8 1.8L15 10",
  chart: "M4 20h16M7 16v-5M12 16V7M17 16v-8",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M9 20h6M10 17h4v3h-4z",
  play: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5v7l6-3.5z",
  settings: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4",
  users:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6.5 6.5 0 0 1 3.5 6",
  report: "M7 3h7l5 5v13H7zM14 3v5h5M10 17v-3M13 17v-5M16 17v-2",
  close: "M6 6l12 12M18 6L6 18",
  menu: "M4 7h16M4 12h16M4 17h16",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  plus: "M12 5v14M5 12h14",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
  check: "M5 12.5l4.5 4.5L19 7",
  alert: "M12 8v5M12 16.5v.5M10.3 4.2L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z",
  bookmark: "M7 4h10v17l-5-3.5L7 21z",
  chevron: "M7 10l5 5 5-5",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  file: "M7 3h7l5 5v13H7zM14 3v5h5",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
