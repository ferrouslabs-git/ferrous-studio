// The app theme as React state: <html data-theme> observed, so a chart or a
// rendered diagram whose colours are baked in at draw time can redraw when
// the user toggles the theme.
import { useEffect, useState } from "react";
import { currentTheme, Theme } from "../../../core/theme";

export function useThemeAttr(): Theme {
  const [theme, setTheme] = useState<Theme>(() => (typeof document === "undefined" ? "dark" : currentTheme()));
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

// A CSS custom property's current value, for libraries that paint in device
// pixels and cannot read var() themselves.
export const cssVar = (name: string, el: Element = document.documentElement): string =>
  getComputedStyle(el).getPropertyValue(name).trim();
