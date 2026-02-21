import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const rootDir = resolve(process.cwd(), "client");

export default defineConfig({
  plugins: [react()],
  root: rootDir,
  build: {
    outDir: resolve(rootDir, "dist"),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/process": "http://localhost:8787"
    }
  },
  preview: {
    port: 4173
  }
});
