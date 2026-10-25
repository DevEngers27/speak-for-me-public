import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test docs recommend the edge-runtime environment so the code runs
    // with web APIs closer to the Convex default runtime.
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
    include: ["convex/**/*.test.ts"],
  },
});
