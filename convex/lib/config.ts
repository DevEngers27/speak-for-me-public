import type { QueryCtx } from "../_generated/server";
import { appError } from "./errors";

export type DeploymentTier = "dev" | "preview" | "prod" | "test";
export const CONFIG_ENV_NAMES = [
  "DEPLOYMENT_TIER", "AGENT_MODE", "AGENTS_ENABLED", "MODEL_FALLBACKS",
  "ANTHROPIC_API_KEY", "CLERK_JWT_ISSUER_DOMAIN",
] as const;
type Environment = Readonly<Record<string, string | undefined>>;

/** Only presence and closed enums leave this boundary; never return secrets. */
export function readConfig(env: Environment = process.env) {
  const tier = env.DEPLOYMENT_TIER;
  const agentMode: "live" | "stub" = env.AGENT_MODE === "live" ? "live" : "stub";
  const invalidFields: (typeof CONFIG_ENV_NAMES[number])[] = [];
  if (!["dev", "preview", "prod"].includes(tier ?? "")) invalidFields.push("DEPLOYMENT_TIER");
  if (env.AGENT_MODE !== undefined && !["stub", "live"].includes(env.AGENT_MODE)) invalidFields.push("AGENT_MODE");
  for (const field of ["AGENTS_ENABLED", "MODEL_FALLBACKS"] as const) {
    if (env[field] !== undefined && !["true", "false"].includes(env[field]!)) invalidFields.push(field);
  }
  const anthropicKeyConfigured = Boolean(env.ANTHROPIC_API_KEY?.trim());
  if (tier === "preview" && agentMode !== "stub") invalidFields.push("AGENT_MODE");
  if (agentMode === "live" && !anthropicKeyConfigured) invalidFields.push("ANTHROPIC_API_KEY");
  return {
    tier: ["dev", "preview", "prod"].includes(tier ?? "") ? tier as Exclude<DeploymentTier, "test"> : null,
    agentMode,
    agentsEnabled: env.AGENTS_ENABLED !== "false",
    modelFallbacks: env.MODEL_FALLBACKS === "true",
    clerkIssuerConfigured: Boolean(env.CLERK_JWT_ISSUER_DOMAIN?.trim()),
    anthropicKeyConfigured,
    configValid: invalidFields.length === 0,
    invalidFields,
  };
}

/** Test tier is determined by the runtime, never an environment override. */
export async function assertTier(
  ctx: { meta: Pick<QueryCtx["meta"], "getDeploymentMetadata"> },
  allowed: readonly DeploymentTier[],
  options: { confirmDeployment?: string } = {},
): Promise<void> {
  const metadata = await ctx.meta.getDeploymentMetadata();
  const tier = metadata.name === "test" ? "test" : readConfig().tier;
  if (tier === null || !allowed.includes(tier) ||
      (options.confirmDeployment !== undefined && options.confirmDeployment !== metadata.name)) {
    throw appError("internal");
  }
}
