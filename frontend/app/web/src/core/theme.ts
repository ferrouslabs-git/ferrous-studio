// Dark/light theme, persisted in localStorage and applied as
// <html data-theme="..."> so the CSS custom properties in styles/tokens.css
// switch. public/theme-init.js applies the stored value before first paint;
// this module owns it from then on. Ported from legacy/js/app.global.js.
import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "ferrous-theme";

export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode, blocked); the attribute still applies.
  }
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document === "undefined" ? "dark" : currentTheme(),
  );

  // Only an actual toggle writes: merely rendering a switch is not the user
  // choosing a theme, and persisting on mount would record a preference they
  // never expressed. The current theme is read back from the attribute rather
  // than from state so the flip is right even if something else set it.
  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }, []);

  return [theme, toggle];
}

/**
 * Show this page in one theme whatever the viewer last chose, without
 * storing it as their choice; the previous theme comes back when the page
 * unmounts. For public pages (a usability participant's links) that always
 * look the same to everyone.
 */
export function useFixedTheme(theme: Theme): void {
  useEffect(() => {
    const before = currentTheme();
    document.documentElement.setAttribute("data-theme", theme);
    return () => document.documentElement.setAttribute("data-theme", before);
  }, [theme]);
}
