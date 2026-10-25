#!/usr/bin/env node
// Usage: check-env-cli.ts [--spec spec.json] [--allow-missing] [--json]
// Load .env.local with Node itself, e.g.
//   node --env-file-if-exists=.env.local check-env-cli.ts
// Exit codes: 0 ok (or --allow-missing), 1 check failed, 2 usage error.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkEnv, DEFAULT_ENV_SPEC, formatEnvReport, type EnvVarSpec } from "./check-env.ts";
import { parseEnvSpec } from "./spec-file.ts";

function main(argv: readonly string[]): number {
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
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  let spec: readonly EnvVarSpec[] = DEFAULT_ENV_SPEC;
  if (values.spec !== undefined) {
    try {
      spec = parseEnvSpec(JSON.parse(readFileSync(values.spec, "utf8")));
    } catch (error) {
      console.error(`Invalid --spec file: ${error instanceof Error ? error.message : String(error)}`);
      return 2;
    }
  }
  const report = checkEnv(spec, process.env);
  console.log(values.json ? JSON.stringify(report, null, 2) : formatEnvReport(report));
  if (report.ok) return 0;
  // Exposure warnings are never waived: a secret-looking NEXT_PUBLIC_ name is a bug.
  if (values["allow-missing"] && report.exposureWarnings.length === 0) return 0;
  return 1;
}

process.exitCode = main(process.argv.slice(2));
