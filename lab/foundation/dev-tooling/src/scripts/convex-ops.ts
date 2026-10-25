/**
 * Guarded wrapper around `npx convex run` for operational functions such as
 * seeding and resetting data.
 *
 * Function names are NOT hard-coded here: the consuming repo maps operation
 * names (for example "seed", "reset") to Convex function paths in a config
 * file. This module only enforces the guards:
 *
 *   1. the deployment target is derived from the environment and must be
 *      unambiguous (see deployment-target.ts);
 *   2. the target's type must be in the operation's allowlist;
 *   3. destructive operations can never target "prod", whatever the config says,
 *      and require --confirm-deployment <name> matching the selected deployment;
 *   4. nothing runs without an explicit --yes.
 */
import { DEPLOYMENT_TYPES, resolveDeploymentTarget, type DeploymentTarget, type DeploymentType } from "./deployment-target.ts";

export type JsonObject = { readonly [key: string]: unknown };

export interface OperationSpec {
  /** Convex function path, e.g. "path/to/module:exportName". */
  readonly function: string;
  readonly destructive: boolean;
  readonly allowedDeploymentTypes: readonly DeploymentType[];
  readonly defaultArgs: JsonObject;
  readonly description: string;
}

export interface ConvexOpsConfig {
  readonly operations: Readonly<Record<string, OperationSpec>>;
}

export interface OpsRequest {
  readonly operation: string;
  /** Shallow-merged over the operation's defaultArgs. */
  readonly args?: JsonObject;
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly confirmDeployment?: string;
}

export const EXIT = Object.freeze({ ok: 0, commandFailed: 1, refused: 2, confirmationRequired: 3 });

export type OpsPlan =
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "needs-confirmation"; readonly target: DeploymentTarget; readonly command: readonly string[] }
  | { readonly kind: "dry-run"; readonly target: DeploymentTarget; readonly command: readonly string[] }
  | { readonly kind: "execute"; readonly target: DeploymentTarget; readonly command: readonly string[] };

/** Never allowed for destructive operations, regardless of configuration. */
export const DESTRUCTIVE_FORBIDDEN: readonly DeploymentType[] = ["prod"];

const OPERATION_NAME = /^[a-z][a-z0-9-]*$/;
// "dir/module:export", "dir/module.js:export" or "dir/module" (default export).
// Must not start with "-" so it can never be read as a CLI flag.
const FUNCTION_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]*(?::[A-Za-z_$][A-Za-z0-9_$]*)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseOpsConfig(input: unknown): ConvexOpsConfig {
  if (!isRecord(input) || !isRecord(input.operations)) throw new Error('config must be an object with an "operations" object');
  const operations: Record<string, OperationSpec> = {};
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
      if (!DEPLOYMENT_TYPES.includes(type as DeploymentType)) {
        throw new Error(`${at}.allowedDeploymentTypes: unknown type ${JSON.stringify(type)}`);
      }
      if (raw.destructive && DESTRUCTIVE_FORBIDDEN.includes(type as DeploymentType)) {
        throw new Error(`${at}: destructive operations can never be allowed on "${String(type)}"`);
      }
    }
    if (raw.defaultArgs !== undefined && !isRecord(raw.defaultArgs)) throw new Error(`${at}.defaultArgs must be an object`);
    if (raw.description !== undefined && typeof raw.description !== "string") throw new Error(`${at}.description must be a string`);
    operations[name] = {
      function: fn,
      destructive: raw.destructive,
      allowedDeploymentTypes: [...new Set(allowed as DeploymentType[])],
      defaultArgs: (raw.defaultArgs as JsonObject | undefined) ?? {},
      description: (raw.description as string | undefined) ?? "",
    };
  }
  if (Object.keys(operations).length === 0) throw new Error("config defines no operations");
  return { operations };
}

/** Parses the --args value: must be a JSON object. */
export function parseArgsJson(raw: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("--args must be valid JSON");
  }
  if (!isRecord(value)) throw new Error("--args must be a JSON object");
  return value;
}

export function buildCommand(spec: OperationSpec, args: JsonObject | undefined): string[] {
  // Fixed argv, no shell: the function path is validated and the arguments are
  // one JSON argument. Deployment selection is left to the environment that
  // planOperation() inspected, so no --prod / --deployment flags are ever added.
  return ["npx", "convex", "run", spec.function, JSON.stringify({ ...spec.defaultArgs, ...args })];
}

export function planOperation(
  config: ConvexOpsConfig,
  request: OpsRequest,
  env: Readonly<Record<string, string | undefined>>,
): OpsPlan {
  const spec = Object.hasOwn(config.operations, request.operation) ? config.operations[request.operation] : undefined;
  if (!spec) {
    const known = Object.keys(config.operations).join(", ");
    return { kind: "refused", reason: `Unknown operation "${request.operation}". Configured: ${known}.` };
  }
  const resolution = resolveDeploymentTarget(env);
  if (!resolution.ok) return { kind: "refused", reason: resolution.reason };
  const { target } = resolution;
  if (spec.destructive && DESTRUCTIVE_FORBIDDEN.includes(target.type)) {
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
  const command = buildCommand(spec, request.args);
  if (request.dryRun) return { kind: "dry-run", target, command };
  if (!request.yes) return { kind: "needs-confirmation", target, command };
  return { kind: "execute", target, command };
}

/** Quotes argv for display only; execution never goes through a shell. */
export function formatCommand(command: readonly string[]): string {
  return command.map((part) => (/^[A-Za-z0-9_./:=@-]+$/.test(part) ? part : `'${part.replace(/'/g, `'\\''`)}'`)).join(" ");
}
