import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the Go API so the browser talks to one origin.
export default defineConfig({
  plugins: [react()],
  // Monaco is intentionally lazy-loaded by the editor route and ships as a
  // large standalone chunk. Keep warning noise focused on unexpected growth.
  build: {
    chunkSizeWarningLimit: 4500,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
