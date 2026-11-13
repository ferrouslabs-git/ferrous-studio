// Builds the route tree from the page registry. There is nothing to edit here
// when pages are added: change src/pages.ts instead.
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Overlay } from "./lib/Overlay";
import { OverlayState, pathOf } from "./lib/nav";
import { LANDING_PAGE_ID, PAGES, PageEntry } from "./pages";

const ordinary = PAGES.filter((page) => !page.presentation);
const overlays = PAGES.filter((page) => page.presentation);

/** Nested <Route>s: a page with a `parentId` renders in its parent's <Outlet />. */
function routesUnder(parentId: string | undefined) {
  return ordinary
    .filter((page) => page.parentId === parentId)
    .map((page) => {
      const Component = page.component;
      const index = parentId !== undefined && page.path === "";
      return index ? (
        <Route key={page.id} index element={<Component />} />
      ) : (
        <Route key={page.id} path={page.path} element={<Component />}>
          {routesUnder(page.id)}
        </Route>
      );
    });
}

function overlayElement(page: PageEntry) {
  const Component = page.component;
  return (
    <Overlay presentation={page.presentation!} title={page.title}>
      <Component />
    </Overlay>
  );
}

export function App() {
  const location = useLocation();
  const background = (location.state as OverlayState | null)?.background;
  const landing = pathOf(LANDING_PAGE_ID);
  // An overlay opened by a link draws over the page it came from. Opened
  // directly (a reload, a pasted address) there is no such page, so it draws
  // over the landing page.
  const onOverlay = overlays.some((page) => pathOf(page.id) === location.pathname);
  const under = background ?? (onOverlay ? { ...location, pathname: landing } : location);

  return (
    <>
      <Routes location={under}>
        {routesUnder(undefined)}
        <Route path="*" element={<Navigate to={landing} replace />} />
      </Routes>
      {onOverlay && (
        <Routes>
          {overlays.map((page) => (
            <Route key={page.id} path={pathOf(page.id)} element={overlayElement(page)} />
          ))}
        </Routes>
      )}
    </>
  );
}
