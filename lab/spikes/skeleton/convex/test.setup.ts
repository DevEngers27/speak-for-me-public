/// <reference types="vite/client" />
// Module map for convex-test. The file name has two dots, so the Convex bundler
// skips it (never deployed). The glob must include `_generated`.
// NOTE: Vite 8 does not support the extglob `./**/!(*.*.*)*.*s` from the Convex
// docs (it matches nothing); use explicit negations instead.
export const modules = import.meta.glob([
  "./**/*.ts",
  "./**/*.js",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
  "!./**/*.config.ts",
  "!./test.setup.ts",
]);
