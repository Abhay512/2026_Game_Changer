import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Dev: the FastAPI backend runs on :8000 (`python -m app`); Vite proxies /api to it.
// Prod: `npm run build` writes dist/, which the backend serves at / itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 900 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
