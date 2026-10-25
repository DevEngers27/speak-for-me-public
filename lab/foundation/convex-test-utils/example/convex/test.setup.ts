/// <reference types="vite/client" />
// Function modules for convexTest(schema, modules): every file under this
// directory except names with two dots (test.setup.ts, *.test.ts).
// NOTE: the extglob "./**/!(*.*.*)*.*s" from the convex-test docs matches
// nothing under vitest 5 (found by the convex-test spike); use this form.
export const modules = import.meta.glob(["./**/*.*s", "!./**/*.*.*s"]);
