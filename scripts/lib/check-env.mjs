/**
 * Presence check for local and remote configuration.
 * Reports names and statuses only. Values are never printed or returned.
 */
import { parseEnv } from "node:util";

export const ENV_LOCATIONS = ["next-public", "next-server", "convex-deployment", "cli"];

export const DEFAULT_ENV_SPEC = Object.freeze([
  { name: "NEXT_PUBLIC_CONVEX_URL", location: "next-public", required: true, description: "Convex deployment URL for the browser client." },
  { name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", location: "next-public", required: true, description: "Clerk publishable key (browser-visible by design)." },
  { name: "CLERK_SECRET_KEY", location: "next-server", required: true, description: "Clerk server key for proxy and server components." },
  { name: "CONVEX_DEPLOYMENT", location: "cli", required: false, description: "Deployment the Convex CLI targets locally." },
  { name: "CLERK_JWT_ISSUER_DOMAIN", location: "convex-deployment", required: true, description: "Clerk issuer for convex/auth.config.ts." },
  { name: "ANTHROPIC_API_KEY", location: "convex-deployment", required: true, description: "Model API key; only Convex actions may hold it." },
]);

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

export function isPresent(env, name) {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export function looksLikeSecret(name) {
  if (name.includes("PUBLISHABLE_KEY")) return false;
  return /(SECRET|PRIVATE|PASSWORD|TOKEN|API_KEY|DEPLOY_KEY|ADMIN_KEY|ANTHROPIC|CLAUDE|_KEY$)/.test(name);
}

export function validateSpec(spec) {
  const seen = new Set();
  for (const entry of spec) {
    if (!ENV_NAME.test(entry.name)) throw new Error(`Invalid variable name in spec: ${JSON.stringify(entry.name)}`);
    if (seen.has(entry.name)) throw new Error(`Duplicate variable in spec: ${entry.name}`);
    seen.add(entry.name);
    if (!ENV_LOCATIONS.includes(entry.location)) throw new Error(`${entry.name}: unknown location ${entry.location}`);
    if (entry.location === "next-public" && !entry.name.startsWith("NEXT_PUBLIC_")) {
      throw new Error(`${entry.name} is declared next-public but lacks the NEXT_PUBLIC_ prefix.`);
    }
    if (entry.location !== "next-public" && entry.name.startsWith("NEXT_PUBLIC_")) {
      throw new Error(`${entry.name} has the NEXT_PUBLIC_ prefix, so Next.js would ship it to browsers.`);
    }
  }
}

export function checkEnv(spec, env) {
  validateSpec(spec);
  const entries = spec.map((item) => ({
    name: item.name,
    location: item.location,
    required: item.required,
    status: item.location === "convex-deployment" ? "remote" : isPresent(env, item.name) ? "set" : "missing",
  }));
  const missingRequired = entries.filter((entry) => entry.required && entry.status === "missing").map((entry) => entry.name);
  const exposureWarnings = Object.keys(env)
    .filter((name) => name.startsWith("NEXT_PUBLIC_") && looksLikeSecret(name) && isPresent(env, name))
    .sort();
  const localRemoteWarnings = spec
    .filter((item) => item.location === "convex-deployment" && isPresent(env, item.name))
    .map((item) => item.name)
    .sort();
  const ok = missingRequired.length === 0 && exposureWarnings.length === 0 && localRemoteWarnings.length === 0;
  return { entries, missingRequired, exposureWarnings, localRemoteWarnings, ok };
}

export function formatEnvReport(report) {
  const width = Math.max(...report.entries.map((entry) => entry.name.length), 10);
  const lines = report.entries.map((entry) => {
    const status = entry.status === "remote" ? "not checked here (Convex deployment)" : entry.status;
    return `${entry.name.padEnd(width)}  ${status.padEnd(9)}  ${entry.location}${entry.required ? "" : " (optional)"}`;
  });
  if (report.entries.some((entry) => entry.status === "remote")) {
    lines.push("Convex-side variables (CLERK_JWT_ISSUER_DOMAIN, ANTHROPIC_API_KEY) are checked by `npx convex env list`.");
  }
  for (const name of report.exposureWarnings) {
    lines.push(`WARNING ${name}: NEXT_PUBLIC_ variables are inlined into browser bundles; this name looks like a secret.`);
  }
  for (const name of report.localRemoteWarnings) {
    lines.push(`WARNING ${name}: this variable belongs on the Convex deployment, not in the local environment.`);
  }
  if (report.missingRequired.length > 0) {
    lines.push(`Missing required: ${report.missingRequired.join(", ")}`);
    lines.push("Running in unconfigured mode: data features are disabled.");
  }
  lines.push(report.ok ? "Environment check passed." : "Environment check failed.");
  return lines.join("\n");
}

export function parseEnvSpec(input) {
  if (!Array.isArray(input)) throw new Error("spec must be a JSON array");
  return input.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error(`spec[${index}] must be an object`);
    const { name, location, required, description } = item;
    if (typeof name !== "string") throw new Error(`spec[${index}].name must be a string`);
    if (typeof location !== "string" || !ENV_LOCATIONS.includes(location)) {
      throw new Error(`spec[${index}].location must be one of ${ENV_LOCATIONS.join(", ")}`);
    }
    if (typeof required !== "boolean") throw new Error(`spec[${index}].required must be a boolean`);
    if (description !== undefined && typeof description !== "string") throw new Error(`spec[${index}].description must be a string`);
    return { name, location, required, description: description ?? "" };
  });
}

/** Same parser Node and the Convex CLI use for env files (`util.parseEnv` / dotenv, no override). */
export function parseDotenv(text) {
  if (typeof text !== "string" || text.trim() === "") return {};
  return parseEnv(text);
}
