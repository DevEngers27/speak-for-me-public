#!/usr/bin/env node
// Guarded Convex seed/reset. Refuses unless --yes is explicit.
//
//   node scripts/convex-ops.mjs <operation> [--config scripts/convex-ops.config.json]
//        [--args '<json object>'] [--dry-run] [--yes] [--confirm-deployment <name>]
//
// The guard reads `.env.local` and `.env` with the same no-override order as
// `convex run`, then blanks every deployment selector the chosen target does
// not use before spawning the CLI.
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { describeTarget } from "./lib/deployment-target.mjs";
import { EXIT, formatCommand, loadConvexCliEnv, parseArgsJson, parseOpsConfig, planOperation } from "./lib/convex-ops.mjs";

export const spawnRunner = (command, args, env) =>
  new Promise((resolve, reject) => {
    const childEnv = {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string") childEnv[key] = value;
    }
    const child = spawn(command, [...args], { stdio: "inherit", shell: false, env: childEnv });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(signal ? 128 : (code ?? 1)));
  });

function readEnvFile(readFile, name) {
  try {
    return readFile(name);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

export async function runConvexOpsCli(argv, io) {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        config: { type: "string", default: "scripts/convex-ops.config.json" },
        args: { type: "string" },
        yes: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        "confirm-deployment": { type: "string" },
      },
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return EXIT.refused;
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1 || !positionals[0]) {
    io.error("Usage: convex-ops <operation> [--config file] [--args json] [--dry-run] [--yes] [--confirm-deployment name]");
    return EXIT.refused;
  }
  let config;
  let args;
  try {
    config = parseOpsConfig(JSON.parse(io.readFile(values.config)));
    args = values.args === undefined ? undefined : parseArgsJson(values.args);
  } catch (error) {
    io.error(`Refused: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.refused;
  }
  const env = loadConvexCliEnv(io.env, {
    envLocal: readEnvFile(io.readFile, ".env.local"),
    env: readEnvFile(io.readFile, ".env"),
  });
  const plan = planOperation(
    config,
    {
      operation: positionals[0],
      yes: values.yes,
      dryRun: values["dry-run"],
      ...(args === undefined ? {} : { args }),
      ...(values["confirm-deployment"] === undefined ? {} : { confirmDeployment: values["confirm-deployment"] }),
    },
    env,
  );
  switch (plan.kind) {
    case "refused":
      io.error(`Refused: ${plan.reason}`);
      return EXIT.refused;
    case "dry-run":
      io.log(`Target: ${describeTarget(plan.target)}`);
      io.log(`Would run: ${formatCommand(plan.command)}`);
      return EXIT.ok;
    case "needs-confirmation":
      io.log(`Target: ${describeTarget(plan.target)}`);
      io.log(`Would run: ${formatCommand(plan.command)}`);
      io.error("Not executed: re-run with --yes to confirm.");
      return EXIT.confirmationRequired;
    case "execute": {
      io.log(`Target: ${describeTarget(plan.target)}`);
      io.log(`Running: ${formatCommand(plan.command)}`);
      const [command, ...rest] = plan.command;
      const code = await io.runner(command ?? process.execPath, rest, plan.childEnv);
      return code === 0 ? EXIT.ok : EXIT.commandFailed;
    }
    default:
      return EXIT.refused;
  }
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
  process.exitCode = await runConvexOpsCli(process.argv.slice(2), {
    env: process.env,
    readFile: (path) => readFileSync(path, "utf8"),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    runner: spawnRunner,
  });
}
