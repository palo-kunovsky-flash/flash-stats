import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port; fail fast if it is taken.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  plugins: [react()],
  server: {
    host: host || "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: "safari15",
    minify: "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    outDir: "dist",
  },
});
