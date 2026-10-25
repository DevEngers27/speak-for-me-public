#!/usr/bin/env node
// Reports presence (never values) of Next-side and Convex-side variables.
// Load .env.local the same way other local commands do:
//   node --env-file-if-exists=.env.local scripts/check-env.mjs
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { DEFAULT_ENV_SPEC, checkEnv, formatEnvReport, parseEnvSpec } from "./lib/check-env.mjs";

export function runCheckEnv(argv, env, io) {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        spec: { type: "string" },
        "allow-missing": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  let spec = DEFAULT_ENV_SPEC;
  if (values.spec !== undefined) {
    try {
      spec = parseEnvSpec(JSON.parse(io.readFile(values.spec)));
    } catch (error) {
      io.error(`Invalid --spec file: ${error instanceof Error ? error.message : String(error)}`);
      return 2;
    }
  }
  const report = checkEnv(spec, env);
  io.log(values.json ? JSON.stringify(report) : formatEnvReport(report));
  if (report.ok) return 0;
  if (values["allow-missing"] && report.exposureWarnings.length === 0 && report.localRemoteWarnings.length === 0) return 0;
  return 1;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  process.exitCode = runCheckEnv(process.argv.slice(2), process.env, {
    readFile: (path) => readFileSync(path, "utf8"),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
