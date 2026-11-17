// When the brief has more than one wireframe, one prototype holds them all and
// this switches between them -- the counterpart of the wireframe dropdown in
// Studio's preview. With one wireframe it renders nothing. There is nothing
// to edit here: it reads WIREFRAMES and PAGES from src/pages.ts.
import { PAGES, WIREFRAMES } from "../pages";
import { pathOf, useGo, useShownLocation } from "./nav";

/** The wireframe whose page is on show (under any open overlay); the first
 *  one when none matches. */
function currentWireframeId(pathname: string): string {
  const page = PAGES.find((entry) => !entry.presentation && pathOf(entry.id) === pathname);
  return page?.wireframeId ?? WIREFRAMES[0].id;
}

export function WireframeSwitcher() {
  const shown = useShownLocation();
  const go = useGo();
  if (WIREFRAMES.length < 2) return null;

  return (
    <label className="wireframe-switcher">
      <span>Wireframe</span>
      <select
        value={currentWireframeId(shown.pathname)}
        onChange={(event) => {
          const target = WIREFRAMES.find((wireframe) => wireframe.id === event.target.value);
          if (target) go(target.landingPageId);
        }}
      >
        {WIREFRAMES.map((wireframe) => (
          <option key={wireframe.id} value={wireframe.id}>
            {wireframe.name}
          </option>
        ))}
      </select>
    </label>
  );
}
