/**
 * Works out which Convex deployment `npx convex run` would target, from the
 * same environment variables the Convex CLI (1.48) reads, and fails closed on
 * anything ambiguous.
 *
 * Secrets: CONVEX_DEPLOY_KEY is "<type>:<name>|<secret>". Only the part before
 * the first "|" is inspected; the secret part is never read into a variable,
 * printed or returned. Formats follow convex/src/cli/lib/deployment.ts
 * (deploymentTypeFromAdminKey, isPreviewDeployKey, isProjectKey).
 */

export type DeploymentType = "dev" | "prod" | "preview" | "local" | "self-hosted";

export const DEPLOYMENT_TYPES: readonly DeploymentType[] = ["dev", "prod", "preview", "local", "self-hosted"];

export type SelectorSource = "CONVEX_DEPLOY_KEY" | "CONVEX_DEPLOYMENT" | "CONVEX_SELF_HOSTED_URL";

export interface DeploymentTarget {
  readonly type: DeploymentType;
  /** Deployment name (or self-hosted host); null when the selector does not carry one. */
  readonly name: string | null;
  readonly source: SelectorSource;
}

export type TargetResolution =
  | { readonly ok: true; readonly target: DeploymentTarget }
  | { readonly ok: false; readonly reason: string };

type Env = Readonly<Record<string, string | undefined>>;

const SELECTOR_FAMILIES: ReadonlyArray<{ family: string; vars: readonly string[] }> = [
  { family: "CONVEX_DEPLOY_KEY", vars: ["CONVEX_DEPLOY_KEY"] },
  { family: "CONVEX_DEPLOYMENT_TOKEN", vars: ["CONVEX_DEPLOYMENT_TOKEN"] },
  { family: "CONVEX_SELF_HOSTED_URL", vars: ["CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"] },
  { family: "CONVEX_DEPLOYMENT", vars: ["CONVEX_DEPLOYMENT"] },
];

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function present(env: Env, name: string): boolean {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function fromDeployKey(raw: string): TargetResolution {
  const bar = raw.indexOf("|");
  if (bar === -1) {
    // Legacy keys without a prefix are production keys for the Convex CLI.
    return { ok: true, target: { type: "prod", name: null, source: "CONVEX_DEPLOY_KEY" } };
  }
  const parts = raw.slice(0, bar).trim().split(":");
  const [kind, ...rest] = parts;
  if (kind === "project") {
    return { ok: false, reason: "CONVEX_DEPLOY_KEY is a project key, which can target any deployment; use a deployment key." };
  }
  if (kind === "preview" && rest.length === 2) {
    return { ok: false, reason: "CONVEX_DEPLOY_KEY is a preview deploy key without a fixed deployment; use that preview deployment's own key." };
  }
  if ((kind === "dev" || kind === "prod" || kind === "preview") && rest.length === 1 && NAME.test(rest[0] ?? "")) {
    return { ok: true, target: { type: kind, name: rest[0] ?? null, source: "CONVEX_DEPLOY_KEY" } };
  }
  return { ok: false, reason: "CONVEX_DEPLOY_KEY has an unrecognised prefix." };
}

function fromConfiguredDeployment(raw: string): TargetResolution {
  const parts = raw.trim().split(":");
  const kind = parts[0];
  const name = parts.length >= 2 ? parts.at(-1) : undefined;
  if ((kind === "dev" || kind === "prod" || kind === "preview" || kind === "local") && name && NAME.test(name)) {
    return { ok: true, target: { type: kind, name, source: "CONVEX_DEPLOYMENT" } };
  }
  return { ok: false, reason: 'CONVEX_DEPLOYMENT must look like "<dev|prod|preview|local>:<name>".' };
}

function fromSelfHosted(rawUrl: string): TargetResolution {
  try {
    const url = new URL(rawUrl.trim());
    return { ok: true, target: { type: "self-hosted", name: url.host, source: "CONVEX_SELF_HOSTED_URL" } };
  } catch {
    return { ok: false, reason: "CONVEX_SELF_HOSTED_URL is not a valid URL." };
  }
}

export function resolveDeploymentTarget(env: Env): TargetResolution {
  const families = SELECTOR_FAMILIES.filter((f) => f.vars.some((v) => present(env, v))).map((f) => f.family);
  if (families.length === 0) {
    return {
      ok: false,
      reason:
        "No Convex deployment selected. Set CONVEX_DEPLOYMENT (for example via node --env-file-if-exists=.env.local) or CONVEX_DEPLOY_KEY.",
    };
  }
  if (families.length > 1) {
    return { ok: false, reason: `Ambiguous deployment selection: ${families.join(" and ")} are both set. Unset all but one.` };
  }
  switch (families[0]) {
    case "CONVEX_DEPLOY_KEY":
      return fromDeployKey(env.CONVEX_DEPLOY_KEY ?? "");
    case "CONVEX_DEPLOYMENT":
      return fromConfiguredDeployment(env.CONVEX_DEPLOYMENT ?? "");
    case "CONVEX_SELF_HOSTED_URL":
      if (!present(env, "CONVEX_SELF_HOSTED_URL")) {
        return { ok: false, reason: "CONVEX_SELF_HOSTED_ADMIN_KEY is set without CONVEX_SELF_HOSTED_URL." };
      }
      return fromSelfHosted(env.CONVEX_SELF_HOSTED_URL ?? "");
    default:
      return { ok: false, reason: "CONVEX_DEPLOYMENT_TOKEN selection is not supported by this script." };
  }
}

export function describeTarget(target: DeploymentTarget): string {
  return `${target.type}${target.name ? ` deployment "${target.name}"` : " deployment (unnamed)"} selected by ${target.source}`;
}
