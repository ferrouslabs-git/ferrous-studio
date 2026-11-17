import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained dist/index.html: every script, style and imported asset
// inlined. Studio shows that single file in a sandboxed iframe, so nothing may
// be left to fetch at run time.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { target: "es2020", chunkSizeWarningLimit: 4096 },
});
