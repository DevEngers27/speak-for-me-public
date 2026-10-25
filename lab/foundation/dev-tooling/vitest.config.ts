import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // ESLint with the TypeScript resolver warms up slowly on a cold cache.
    testTimeout: 60_000,
  },
});
