import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects the dev server on a fixed port and a fixed host.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // In the Traycer worktree layout, `node_modules` is a junction to an
    // external directory (the source workspace's node_modules). Vite's strict
    // filesystem guard refuses to serve those assets via `@fs/` (403), which
    // breaks bundled fonts in the browser preview. Relax the guard for the
    // local dev server only — no effect on the production build, where fonts
    // are bundled into `dist/`.
    fs: {
      strict: false,
    },
    watch: {
      ignored: ["**/src-tauri/**", "**/bridge/**"],
    },
  },
  build: {
    target: "es2021",
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          graph: ["@xyflow/react", "dagre"],
          motion: ["framer-motion"],
        },
      },
    },
  },
});
