// Build-time prerender of the landing page.
//
// A client-rendered SPA landing page is indexed late and unreliably. This
// renders the "/" route to static HTML and writes it into dist/index.html, so
// crawlers (and users on slow connections) get the copy immediately. The
// client then hydrates the same markup. Other routes are unaffected: FastAPI
// serves the same index.html for them and React takes over as usual.
//
// Runs after `vite build`: `node scripts/prerender.mjs`.
import { execSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SSR_DIR = "dist-ssr";

execSync(`npx vite build --ssr src/entry-server.tsx --outDir ${SSR_DIR} --logLevel warn`, {
  stdio: "inherit",
});

const { renderLanding } = await import(pathToFileURL(`${SSR_DIR}/entry-server.js`).href);
const html = renderLanding();

const indexPath = "dist/index.html";
const shell = readFileSync(indexPath, "utf8");
const marker = '<div id="root"></div>';
if (!shell.includes(marker)) {
  throw new Error(`prerender: ${marker} not found in ${indexPath}`);
}
writeFileSync(indexPath, shell.replace(marker, `<div id="root">${html}</div>`));
rmSync(SSR_DIR, { recursive: true, force: true });

console.log(`prerender: landing page written into ${indexPath} (${html.length} chars)`);
