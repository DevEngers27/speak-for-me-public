/** Operations DTO adapter; config.ts owns every configuration rule/default. */
import { readConfig, type CONFIG_ENV_NAMES } from './config';
export type AgentModeName = ReturnType<typeof readConfig>['agentMode'];
export type DeploymentTierName = NonNullable<ReturnType<typeof readConfig>['tier']> | 'missing';
const HEALTH_FIELD = {
  DEPLOYMENT_TIER: 'tier', AGENT_MODE: 'agentMode', AGENTS_ENABLED: 'agentsEnabled',
  MODEL_FALLBACKS: 'modelFallbacks', ANTHROPIC_API_KEY: 'anthropicKeyConfigured',
  CLERK_JWT_ISSUER_DOMAIN: 'clerkIssuerConfigured',
} as const satisfies Record<typeof CONFIG_ENV_NAMES[number], string>;
export function reportedAgentMode(env: Readonly<Record<string, string | undefined>>): AgentModeName {
  return readConfig(env).agentMode;
}
export function configHealthFrom(env: Readonly<Record<string, string | undefined>>, draining: boolean) {
  const config = readConfig(env);
  return { ...config, tier: config.tier ?? 'missing' as const, draining,
    invalidFields: config.invalidFields.map(field => HEALTH_FIELD[field]) };
}
export type ConfigHealth = ReturnType<typeof configHealthFrom>;
export function checkConfigHealth(env: Readonly<Record<string, string | undefined>>) {
  const health = configHealthFrom(env, false);
  return { ...health, ok: health.configValid };
}
