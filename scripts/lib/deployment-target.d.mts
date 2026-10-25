export type DeploymentTarget = { type: 'dev' | 'prod' | 'preview' | 'local' | 'self-hosted'; name: string | null; source: 'CONVEX_DEPLOY_KEY' | 'CONVEX_DEPLOYMENT' | 'CONVEX_SELF_HOSTED_URL' };
export const DEPLOYMENT_TYPES: readonly string[];
export const SELECTOR_VARS: readonly string[];
export function resolveDeploymentTarget(env: Record<string, string | undefined>): { ok: true; target: DeploymentTarget } | { ok: false; reason: string; target?: undefined };
export function describeTarget(target: DeploymentTarget): string;
export function pinSelectorEnv(env: Record<string, string | undefined>, target: DeploymentTarget): Record<string, string | undefined>;
