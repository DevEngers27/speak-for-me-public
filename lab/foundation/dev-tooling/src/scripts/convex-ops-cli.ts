#!/usr/bin/env node
// Guarded `npx convex run` for operational functions (seed, reset, ...).
//
// Usage:
//   convex-ops-cli.ts <operation> [--config convex-ops.config.json]
//                     [--args '<json object>'] [--dry-run] [--yes]
//                     [--confirm-deployment <name>]
//
// Exit codes: 0 ok, 1 the convex command failed, 2 refused or usage error,
// 3 confirmation required (re-run with --yes).
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { describeTarget } from "./deployment-target.ts";
import { EXIT, formatCommand, parseArgsJson, parseOpsConfig, planOperation, type JsonObject } from "./convex-ops.ts";

export type CommandRunner = (
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
) => Promise<number>;

/** Spawns without a shell and streams output to the terminal. */
export const spawnRunner: CommandRunner = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: "inherit", shell: false, env: { ...env } });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(signal ? 128 : (code ?? 1)));
  });

export interface CliIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readFile: (path: string) => string;
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
  readonly runner: CommandRunner;
}

export async function runConvexOpsCli(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        config: { type: "string", default: "convex-ops.config.json" },
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
  let args: JsonObject | undefined;
  try {
    config = parseOpsConfig(JSON.parse(io.readFile(values.config)));
    args = values.args === undefined ? undefined : parseArgsJson(values.args);
  } catch (error) {
    io.error(`Refused: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.refused;
  }
  const plan = planOperation(
    config,
    {
      operation: positionals[0],
      yes: values.yes,
      dryRun: values["dry-run"],
      ...(args === undefined ? {} : { args }),
      ...(values["confirm-deployment"] === undefined ? {} : { confirmDeployment: values["confirm-deployment"] }),
    },
    io.env,
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
      const code = await io.runner(command ?? "npx", rest, io.env);
      return code === 0 ? EXIT.ok : EXIT.commandFailed;
    }
  }
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === import.meta.filename;
  } catch {
    return false;
  }
}

const isMain = invokedDirectly();
if (isMain) {
  process.exitCode = await runConvexOpsCli(process.argv.slice(2), {
    env: process.env,
    readFile: (p) => readFileSync(p, "utf8"),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    runner: spawnRunner,
  });
}
