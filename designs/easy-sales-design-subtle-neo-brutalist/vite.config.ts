import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained dist/index.html: every script, style and imported asset
// inlined. Studio shows that single file in a sandboxed iframe, so nothing may
// be left to fetch at run time. In Figma Make the dev server takes the port
// and host the runtime gives it.
// Read without @types/node: the config is type-checked with the app.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { target: "es2020", chunkSizeWarningLimit: 4096 },
  server: {
    port: env.FIGMA ? Number(env.PORT) : 5173,
    host: env.FIGMA ? env.FIGMA_DEV_SERVER_HOST || "0.0.0.0" : undefined,
    strictPort: Boolean(env.FIGMA),
  },
});
