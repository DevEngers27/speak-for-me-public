// Example root eslint.config.mjs for the application repository.
// The boundary blocks are additive: keep the framework presets first.
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
// Workspace package (or a relative path to tooling/dev-tooling/src/eslint/index.ts).
import { createBoundaryConfig } from "@speak-for-me/dev-tooling/eslint";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([".next/**", "convex/_generated/**", "next-env.d.ts", "coverage/**"]),
  ...createBoundaryConfig({
    rootDir: import.meta.dirname,
    // layout: { engine: "packages/engine", scenarios: "packages/scenarios", app: "apps/web/src" },
  }),
]);
