// Spike-only probe. Replays the esbuild options Convex 1.48.0 uses for the default
// (isolate) runtime (node_modules/convex/src/bundler/debugBundle.ts innerEsbuild),
// offline, to check that `@core/*` paths from convex/tsconfig.json resolve.
// Convex passes no `tsconfig` option, so esbuild auto-discovers convex/tsconfig.json.
import path from "node:path";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";

const require = createRequire(realpathSync("node_modules/convex/package.json"));
const esbuild = require("esbuild");
const dir = path.resolve("convex");
const entryPoints = ["engine/health.ts", "engine/auth.ts", "engine/tables.ts", "scenarios/scopeChange/tables.ts"].map((p) => path.join(dir, p));

const result = await esbuild.build({
  entryPoints, bundle: true, platform: "browser", format: "esm", target: "esnext",
  jsx: "automatic", outdir: "out", outbase: dir, conditions: ["convex", "module"],
  write: false, splitting: true, chunkNames: "_deps/[hash]", treeShaking: true,
  minifySyntax: true, minifyIdentifiers: true, keepNames: true,
  define: { "process.env.NODE_ENV": '"production"' }, metafile: true, logLevel: "warning",
  external: ["convex", "convex/*"],
});
console.log("esbuild version:", esbuild.version);
console.log("errors:", result.errors.length, "warnings:", result.warnings.length);
console.log("inputs:", Object.keys(result.metafile.inputs).filter((p) => !p.includes("node_modules")));
for (const f of result.outputFiles) console.log("output:", path.relative(process.cwd(), f.path), f.text.length, "bytes");
