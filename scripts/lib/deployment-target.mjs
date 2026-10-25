/**
 * Which deployment `convex run` would select, using the same variables as
 * Convex CLI 1.48. The secret half of a deploy key (after the first "|") is
 * never stored on its own or included in a reason string.
 */

export const DEPLOYMENT_TYPES = ["dev", "prod", "preview", "local", "self-hosted"];

export const SELECTOR_VARS = [
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT_TOKEN",
  "CONVEX_DEPLOYMENT",
  "CONVEX_SELF_HOSTED_URL",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
];

const SELECTOR_FAMILIES = [
  { family: "CONVEX_DEPLOY_KEY", vars: ["CONVEX_DEPLOY_KEY"] },
  { family: "CONVEX_DEPLOYMENT_TOKEN", vars: ["CONVEX_DEPLOYMENT_TOKEN"] },
  { family: "CONVEX_SELF_HOSTED_URL", vars: ["CONVEX_SELF_HOSTED_URL", "CONVEX_SELF_HOSTED_ADMIN_KEY"] },
  { family: "CONVEX_DEPLOYMENT", vars: ["CONVEX_DEPLOYMENT"] },
];

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function present(env, name) {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function fromDeployKey(raw) {
  const bar = raw.indexOf("|");
  if (bar === -1) return { ok: true, target: { type: "prod", name: null, source: "CONVEX_DEPLOY_KEY" } };
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

function fromConfiguredDeployment(raw) {
  const parts = raw.trim().split(":");
  const kind = parts[0];
  const name = parts.length >= 2 ? parts.at(-1) : undefined;
  if ((kind === "dev" || kind === "prod" || kind === "preview" || kind === "local") && name && NAME.test(name)) {
    return { ok: true, target: { type: kind, name, source: "CONVEX_DEPLOYMENT" } };
  }
  return { ok: false, reason: 'CONVEX_DEPLOYMENT must look like "<dev|prod|preview|local>:<name>".' };
}

function fromSelfHosted(rawUrl) {
  try {
    const url = new URL(rawUrl.trim());
    return { ok: true, target: { type: "self-hosted", name: url.host, source: "CONVEX_SELF_HOSTED_URL" } };
  } catch {
    return { ok: false, reason: "CONVEX_SELF_HOSTED_URL is not a valid URL." };
  }
}

export function resolveDeploymentTarget(env) {
  const families = SELECTOR_FAMILIES.filter((family) => family.vars.some((name) => present(env, name))).map((family) => family.family);
  if (families.length === 0) {
    return { ok: false, reason: "No Convex deployment selected. Set CONVEX_DEPLOYMENT or CONVEX_DEPLOY_KEY." };
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

export function describeTarget(target) {
  return `${target.type}${target.name ? ` deployment "${target.name}"` : " deployment (unnamed)"} selected by ${target.source}`;
}

/**
 * Blank every selector the resolved target does not use. The Convex CLI loads
 * `.env.local` then `.env` with dotenv's no-override rule and treats "" as
 * unset, so a blanked key cannot be replaced by a file the guard did not choose.
 */
export function pinSelectorEnv(env, target) {
  const keep = new Set();
  if (target.source === "CONVEX_DEPLOY_KEY") keep.add("CONVEX_DEPLOY_KEY");
  else if (target.source === "CONVEX_DEPLOYMENT") keep.add("CONVEX_DEPLOYMENT");
  else if (target.source === "CONVEX_SELF_HOSTED_URL") {
    keep.add("CONVEX_SELF_HOSTED_URL");
    keep.add("CONVEX_SELF_HOSTED_ADMIN_KEY");
  }
  const pinned = { ...env };
  for (const name of SELECTOR_VARS) {
    if (!keep.has(name)) pinned[name] = "";
  }
  return pinned;
}
