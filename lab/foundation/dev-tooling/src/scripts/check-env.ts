/**
 * Environment presence check.
 *
 * Reports whether each expected variable is set. It never prints, returns,
 * hashes or measures a value: the only facts that leave this module are
 * variable names and booleans. Variables that live in the Convex deployment
 * are listed but not checked locally (use `npx convex env list`, which only
 * prints names).
 */

/** Where a variable must be configured. */
export type EnvLocation =
  /** Next.js, browser-visible; inlined into client bundles at build time. */
  | "next-public"
  /** Next.js server only. */
  | "next-server"
  /** Convex deployment environment (`npx convex env set`); not visible locally. */
  | "convex-deployment"
  /** Local CLI / CI selection variables (for example CONVEX_DEPLOYMENT). */
  | "cli";

export interface EnvVarSpec {
  readonly name: string;
  readonly location: EnvLocation;
  /** Missing required variables make the check fail. */
  readonly required: boolean;
  readonly description: string;
}

export type EnvStatus = "set" | "missing" | "remote";

export interface EnvCheckEntry {
  readonly name: string;
  readonly location: EnvLocation;
  readonly required: boolean;
  readonly status: EnvStatus;
}

export interface EnvCheckReport {
  readonly entries: readonly EnvCheckEntry[];
  readonly missingRequired: readonly string[];
  /**
   * Names of variables that are set, start with NEXT_PUBLIC_ and look like a
   * secret. Next.js would inline them into browser bundles.
   */
  readonly exposureWarnings: readonly string[];
  readonly ok: boolean;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Platform variables named by the platform constraints (Next 16, Clerk 7,
 * Convex 1.48). Product-specific variables are added by the consuming repo.
 */
export const DEFAULT_ENV_SPEC: readonly EnvVarSpec[] = Object.freeze([
  {
    name: "NEXT_PUBLIC_CONVEX_URL",
    location: "next-public",
    required: true,
    description: "Convex deployment URL for the browser client.",
  },
  {
    name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    location: "next-public",
    required: true,
    description: "Clerk publishable key (browser-visible by design).",
  },
  { name: "CLERK_SECRET_KEY", location: "next-server", required: true, description: "Clerk server key for proxy and server components." },
  {
    name: "CONVEX_DEPLOYMENT",
    location: "cli",
    required: false,
    description: "Deployment the Convex CLI targets locally (written by `convex dev`).",
  },
  {
    name: "CLERK_JWT_ISSUER_DOMAIN",
    location: "convex-deployment",
    required: true,
    description: "Clerk issuer for convex/auth.config.ts.",
  },
  {
    name: "ANTHROPIC_API_KEY",
    location: "convex-deployment",
    required: true,
    description: "Model API key; only Convex actions may hold it.",
  },
]);

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const SECRET_LOOKING = /(SECRET|PRIVATE|PASSWORD|TOKEN|API_KEY|DEPLOY_KEY|ADMIN_KEY)/;

/** True when the variable is defined and not only whitespace. */
export function isPresent(env: EnvSource, name: string): boolean {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export function validateSpec(spec: readonly EnvVarSpec[]): void {
  const seen = new Set<string>();
  for (const entry of spec) {
    if (!ENV_NAME.test(entry.name)) throw new Error(`Invalid variable name in spec: ${JSON.stringify(entry.name)}`);
    if (seen.has(entry.name)) throw new Error(`Duplicate variable in spec: ${entry.name}`);
    seen.add(entry.name);
    if (entry.location === "next-public" && !entry.name.startsWith("NEXT_PUBLIC_")) {
      throw new Error(`${entry.name} is declared next-public but lacks the NEXT_PUBLIC_ prefix.`);
    }
    if (entry.location !== "next-public" && entry.name.startsWith("NEXT_PUBLIC_")) {
      throw new Error(`${entry.name} has the NEXT_PUBLIC_ prefix, so Next.js would ship it to browsers.`);
    }
  }
}

export function checkEnv(spec: readonly EnvVarSpec[], env: EnvSource): EnvCheckReport {
  validateSpec(spec);
  const entries: EnvCheckEntry[] = spec.map((s) => ({
    name: s.name,
    location: s.location,
    required: s.required,
    status: s.location === "convex-deployment" ? "remote" : isPresent(env, s.name) ? "set" : "missing",
  }));
  const missingRequired = entries.filter((e) => e.required && e.status === "missing").map((e) => e.name);
  const exposureWarnings = Object.keys(env)
    .filter((name) => name.startsWith("NEXT_PUBLIC_") && SECRET_LOOKING.test(name) && isPresent(env, name))
    .sort();
  return { entries, missingRequired, exposureWarnings, ok: missingRequired.length === 0 && exposureWarnings.length === 0 };
}

/** Human-readable report. Contains names and statuses only. */
export function formatEnvReport(report: EnvCheckReport): string {
  const width = Math.max(...report.entries.map((e) => e.name.length), 10);
  const lines = report.entries.map((e) => {
    const status = e.status === "remote" ? "not checked here (Convex deployment)" : e.status;
    return `${e.name.padEnd(width)}  ${status.padEnd(9)}  ${e.location}${e.required ? "" : " (optional)"}`;
  });
  if (report.entries.some((e) => e.status === "remote")) {
    lines.push("Convex deployment variables: run `npx convex env list` (prints names only).");
  }
  for (const name of report.exposureWarnings) {
    lines.push(`WARNING ${name}: NEXT_PUBLIC_ variables are inlined into browser bundles; this name looks like a secret.`);
  }
  if (report.missingRequired.length > 0) {
    lines.push(`Missing required: ${report.missingRequired.join(", ")}`);
  }
  lines.push(report.ok ? "Environment check passed." : "Environment check failed.");
  return lines.join("\n");
}
