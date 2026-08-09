import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects the dev server on a fixed port and a fixed host.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
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
