/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In development the API runs separately; in production Express serves both.
    proxy: { "/api": "http://localhost:4000" },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["src/test-setup.ts"],
    // Full page walkthroughs load lazy routes and the calendar library on first use.
    testTimeout: 20_000,
  },
});
