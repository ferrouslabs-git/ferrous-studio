// Server-side entry used only by scripts/prerender.mjs at build time to turn
// the landing page into static HTML. Nothing here runs in the browser.
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { LandingPage } from "./features/marketing/LandingPage";

export function renderLanding(): string {
  return renderToString(
    <StaticRouter location="/">
      <LandingPage />
    </StaticRouter>,
  );
}
