import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test recommends edge-runtime so function code sees web APIs that
    // are close to the Convex default (non-"use node") runtime.
    environment: "edge-runtime",
    // convex-test must be transformed by vite so `import.meta.glob` and its
    // module discovery work inside the test environment.
    server: { deps: { inline: ["convex-test"] } },
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
});
