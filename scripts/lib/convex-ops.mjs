/**
 * Guarded `convex run` for dev operations. Function names come from config.
 * Canon dev entry points are `seed.fromFixture` and `seed.reset`.
 * Nothing runs without `--yes`. Destructive ops cannot target prod and need
 * `--confirm-deployment` equal to the selected deployment name.
 */
import { fileURLToPath } from "node:url";
import { parseDotenv } from "./check-env.mjs";
import { DEPLOYMENT_TYPES, pinSelectorEnv, resolveDeploymentTarget } from "./deployment-target.mjs";

export { pinSelectorEnv, resolveDeploymentTarget };

export const DESTRUCTIVE_FORBIDDEN_TYPES = ["prod"];

export const EXIT = Object.freeze({ ok: 0, commandFailed: 1, refused: 2, confirmationRequired: 3 });

const OPERATION_NAME = /^[a-z][a-z0-9-]*$/;
const FUNCTION_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]*(?::[A-Za-z_$][A-Za-z0-9_$]*)?$/;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOpsConfig(input) {
  if (!isRecord(input) || !isRecord(input.operations)) throw new Error('config must be an object with an "operations" object');
  const operations = Object.create(null);
  for (const [name, raw] of Object.entries(input.operations)) {
    const at = `operations.${name}`;
    if (!OPERATION_NAME.test(name)) throw new Error(`${at}: operation names must match ${OPERATION_NAME}`);
    if (!isRecord(raw)) throw new Error(`${at} must be an object`);
    const fn = raw.function;
    if (typeof fn !== "string" || !FUNCTION_PATH.test(fn) || fn.includes("..")) {
      throw new Error(`${at}.function must be a Convex function path like "module/path:exportName"`);
    }
    if (typeof raw.destructive !== "boolean") throw new Error(`${at}.destructive must be a boolean (be explicit)`);
    const allowed = raw.allowedDeploymentTypes;
    if (!Array.isArray(allowed) || allowed.length === 0) throw new Error(`${at}.allowedDeploymentTypes must be a non-empty array`);
    for (const type of allowed) {
      if (!DEPLOYMENT_TYPES.includes(type)) throw new Error(`${at}.allowedDeploymentTypes: unknown type ${JSON.stringify(type)}`);
      if (raw.destructive && DESTRUCTIVE_FORBIDDEN_TYPES.includes(type)) {
        throw new Error(`${at}: destructive operations can never be allowed on "${String(type)}"`);
      }
    }
    if (raw.defaultArgs !== undefined && !isRecord(raw.defaultArgs)) throw new Error(`${at}.defaultArgs must be an object`);
    if (raw.description !== undefined && typeof raw.description !== "string") throw new Error(`${at}.description must be a string`);
    operations[name] = {
      function: fn,
      destructive: raw.destructive,
      allowedDeploymentTypes: [...new Set(allowed)],
      defaultArgs: raw.defaultArgs ?? {},
      description: raw.description ?? "",
    };
  }
  if (Object.keys(operations).length === 0) throw new Error("config defines no operations");
  return { operations };
}

export function parseArgsJson(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("--args must be valid JSON");
  }
  if (!isRecord(value)) throw new Error("--args must be a JSON object");
  return value;
}

/** Installed Convex CLI. Avoids `npx` fetching an arbitrary version. */
export function convexBinPath() {
  return fileURLToPath(new URL("../../node_modules/convex/bin/main.js", import.meta.url));
}

export function buildCommand(spec, args, extras) {
  const merged = { ...spec.defaultArgs, ...args, ...(extras ?? {}) };
  if (spec.function === 'seed:fromFixture' && merged.provenance !== undefined && !['seeded', 'stub'].includes(merged.provenance)) {
    throw new Error('seed provenance must be seeded or stub');
  }
  return [process.execPath, convexBinPath(), "run", spec.function, JSON.stringify(merged)];
}

/**
 * Merge process env with `.env.local` then `.env`, matching
 * `dotenv.config({ path: ".env.local" }); dotenv.config()` (no override).
 * Existing process values win. Empty strings stay empty so a file cannot fill them.
 */
export function loadConvexCliEnv(processEnv, files) {
  const env = { ...processEnv };
  for (const text of [files.envLocal ?? "", files.env ?? ""]) {
    for (const [key, value] of Object.entries(parseDotenv(text))) {
      if (env[key] === undefined) env[key] = value;
    }
  }
  return env;
}

export function planOperation(config, request, env) {
  const spec = Object.hasOwn(config.operations, request.operation) ? config.operations[request.operation] : undefined;
  if (!spec) {
    const known = Object.keys(config.operations).join(", ");
    return { kind: "refused", reason: `Unknown operation "${request.operation}". Configured: ${known}.` };
  }
  const resolution = resolveDeploymentTarget(env);
  if (!resolution.ok) return { kind: "refused", reason: resolution.reason };
  const { target } = resolution;
  if (spec.destructive && DESTRUCTIVE_FORBIDDEN_TYPES.includes(target.type)) {
    return { kind: "refused", reason: `"${request.operation}" is destructive and can never run against a ${target.type} deployment.` };
  }
  if (!spec.allowedDeploymentTypes.includes(target.type)) {
    return {
      kind: "refused",
      reason: `"${request.operation}" is allowed on [${spec.allowedDeploymentTypes.join(", ")}] deployments; the selected one is ${target.type}.`,
    };
  }
  if (spec.destructive) {
    if (target.name === null) {
      return { kind: "refused", reason: `"${request.operation}" is destructive and the selected deployment has no name to confirm.` };
    }
    if (request.confirmDeployment !== target.name) {
      return {
        kind: "refused",
        reason: `"${request.operation}" is destructive: pass --confirm-deployment ${target.name} to confirm the target.`,
      };
    }
  }
  const extras = {};
  if (spec.destructive && request.confirmDeployment) extras.confirmDeployment = request.confirmDeployment;
  if (spec.function === "seed:reset" && (request.args === undefined || request.args.fixtureKey === undefined)) extras.fixtureKey = null;
  const command = buildCommand(spec, request.args, extras);
  const childEnv = pinSelectorEnv(env, target);
  if (request.dryRun) return { kind: "dry-run", target, command, childEnv };
  if (!request.yes) return { kind: "needs-confirmation", target, command, childEnv };
  return { kind: "execute", target, command, childEnv };
}

export function formatCommand(command) {
  return command.map((part) => (/^[A-Za-z0-9_./:=@+-]+$/.test(part) ? part : `'${part.replaceAll("'", `'\\''`)}'`)).join(" ");
}

export const DESTRUCTIVE_FORBIDDEN = DESTRUCTIVE_FORBIDDEN_TYPES;
