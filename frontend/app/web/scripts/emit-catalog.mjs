// Emits backend/app/studio/catalog.json from the frontend's own catalogue,
// so the bundle validator checks bundles against exactly what the canvas
// editor allows -- not a hand-maintained copy that can drift.
//
// Runs the same way prerender.mjs does: an SSR build resolves the
// catalogue module's own relative imports through Vite/esbuild, then this
// process imports the compiled output directly. `catalog.mirror.test.ts`
// imports buildCatalogMirror() the ordinary way (via Vitest's own
// transform) and deep-equals it against this file's output, so editing the
// catalogue without re-running this fails the frontend test suite.
//
// Run via `npm run catalog:emit`.
import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SSR_DIR = "dist-catalog";
const OUT_PATH = "../../../backend/app/studio/catalog.json";

execSync(`npx vite build --ssr src/features/studio/catalogMirror.ts --outDir ${SSR_DIR} --logLevel warn`, {
  stdio: "inherit",
});

const { buildCatalogMirror } = await import(pathToFileURL(`${SSR_DIR}/catalogMirror.js`).href);
const catalog = buildCatalogMirror();

writeFileSync(OUT_PATH, JSON.stringify(catalog, null, 2) + "\n");
rmSync(SSR_DIR, { recursive: true, force: true });

console.log(`catalog:emit -> ${OUT_PATH}`);
