import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup.ts"],
    // Tests share one PostgreSQL database, so run files sequentially.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
