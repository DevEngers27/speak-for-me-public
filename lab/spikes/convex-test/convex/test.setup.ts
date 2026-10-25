/// <reference types="vite/client" />
// All function modules, excluding files with two dots (*.test.ts, test.setup.ts,
// test.helpers.ts). NOTE: the extglob form "./**/!(*.*.*)*.*s" from the
// convex-test docs matched NOTHING under vitest 5.0.5 / vite (verified in this
// spike), so use a positive + negative pattern array instead.
export const modules = import.meta.glob(["./**/*.*s", "!./**/*.*.*s"]);
