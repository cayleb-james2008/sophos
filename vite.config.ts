import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The worktree's node_modules is a junction to the shared install at
// C:/Users/Cayleb/Desktop/workspace/prime-agent-windows/node_modules. Vite's
// default fs.allow list does not include that real path, so @fontsource assets
// (Geist Mono) 403 and the e2e's 0-console-error gate fails. Allow the real
// junction target so fonts are served.
const sharedNodeModules = fileURLToPath(new URL("../../../../Desktop/workspace/prime-agent-windows/node_modules", import.meta.url));

// Tauri expects the dev server on a fixed port and a fixed host.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    fs: {
      allow: [".", sharedNodeModules],
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
