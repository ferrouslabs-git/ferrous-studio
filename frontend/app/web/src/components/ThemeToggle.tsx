// The light/dark switch that sits in every sidebar footer. Self-contained on
// purpose: it owns its own theme state and needs nothing from the shell, so
// any future sidebar can drop it into its footer unchanged.
//
// Nothing else re-renders when the theme changes — applyTheme() flips
// <html data-theme>, and the CSS custom properties in styles/brand.css do the
// rest — so this component's local state is the whole of the wiring.
import { ReactNode } from "react";
import { useTheme } from "../core/theme";

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  const light = theme === "light";
  // Describe the destination, not the current state: the control is a switch,
  // and a screen reader reading "Light mode, off" while in dark mode is the
  // reading we want.
  const label = light ? "Light mode" : "Dark mode";

  return (
    <button
      type="button"
      className="sidebar-item sidebar-theme"
      onClick={toggle}
      role="switch"
      aria-checked={light}
      title={light ? "Switch to dark mode" : "Switch to light mode"}
    >
      <span className="sidebar-icon">{light ? <SunIcon /> : <MoonIcon />}</span>
      <span className="sidebar-label sidebar-theme-text">{label}</span>
      <span className="sidebar-theme-track" aria-hidden="true">
        <span className="sidebar-theme-knob" />
      </span>
    </button>
  );
}

function SunIcon() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Svg>
  );
}

function MoonIcon() {
  return (
    <Svg>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
    </Svg>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
