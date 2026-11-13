#!/usr/bin/env node
// Checks a built prototype is what Studio can show: ONE self-contained HTML
// file. Studio frames it in a sandbox with an opaque origin, so anything it
// would fetch, and any use of browser storage, fails there.
//
//   node check_build.mjs <project-dir>
//
// Exits non-zero, listing every problem, if the build is not acceptable.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_BYTES = 25 * 1024 * 1024;
const project = process.argv[2];
if (!project) {
  console.error("usage: node check_build.mjs <project-dir>");
  process.exit(2);
}

const dist = join(project, "dist");
const problems = [];
let files = [];
try {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  files = walk(dist);
} catch {
  console.error(`No build output at ${dist}. Run "npm run build" first.`);
  process.exit(1);
}

const htmlPath = join(dist, "index.html");
const extra = files.filter((file) => file !== htmlPath);
if (!files.includes(htmlPath)) problems.push("dist/index.html is missing");
if (extra.length) {
  problems.push(
    `the build is not a single file; also emitted: ${extra.map((f) => f.slice(dist.length + 1)).join(", ")}. ` +
      "Import assets from src/ so they are inlined, rather than placing them in public/.",
  );
}

if (files.includes(htmlPath)) {
  const size = statSync(htmlPath).size;
  const html = readFileSync(htmlPath, "utf8");
  if (size > MAX_BYTES) problems.push(`index.html is ${(size / 1048576).toFixed(1)} MB; the limit is 25 MB`);
  if (!/^\s*<!doctype html/i.test(html)) problems.push("index.html does not start with <!doctype html>");

  // Tags that would fetch something at run time. Inline <script> and <style>
  // carry no src/href, and data: URLs are already in the file.
  const fetching = /<(script|link|img|iframe|source|video|audio)\b[^>]*?\b(src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(fetching)) {
    const [, tag, attribute, url] = match;
    if (/^(data:|#)/i.test(url)) continue;
    problems.push(`<${tag} ${attribute}="${url.slice(0, 80)}"> is fetched at run time; inline it`);
  }
  for (const api of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"]) {
    if (html.includes(api)) {
      problems.push(`the bundle references ${api}, which throws in Studio's sandboxed frame; keep state in memory`);
    }
  }
  if (!problems.length) console.log(`OK  ${htmlPath}  ${(size / 1024).toFixed(0)} KB, self-contained`);
}

if (problems.length) {
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
