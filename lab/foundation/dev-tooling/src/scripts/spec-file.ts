import type { EnvLocation, EnvVarSpec } from "./check-env.ts";

const LOCATIONS: readonly EnvLocation[] = ["next-public", "next-server", "convex-deployment", "cli"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a JSON env spec: an array of
 * `{ name, location, required, description? }`. Throws with a path-qualified
 * message on the first problem.
 */
export function parseEnvSpec(input: unknown): EnvVarSpec[] {
  if (!Array.isArray(input)) throw new Error("spec must be a JSON array");
  return input.map((item, i): EnvVarSpec => {
    if (!isRecord(item)) throw new Error(`spec[${i}] must be an object`);
    const { name, location, required, description } = item;
    if (typeof name !== "string") throw new Error(`spec[${i}].name must be a string`);
    if (typeof location !== "string" || !LOCATIONS.includes(location as EnvLocation)) {
      throw new Error(`spec[${i}].location must be one of ${LOCATIONS.join(", ")}`);
    }
    if (typeof required !== "boolean") throw new Error(`spec[${i}].required must be a boolean`);
    if (description !== undefined && typeof description !== "string") {
      throw new Error(`spec[${i}].description must be a string`);
    }
    return { name, location: location as EnvLocation, required, description: description ?? "" };
  });
}
