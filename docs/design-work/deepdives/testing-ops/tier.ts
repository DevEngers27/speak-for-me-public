// 示例：convex/lib/tier.ts —— 部署层级守卫（TD-7、TD-8）。
// 所有危险的 internal 函数（seed.attachMember、seed.purgeSimulatedRooms、devProbe.*）入口第一行调用。
import { ConvexError } from "convex/values";

export const DEPLOYMENT_TIERS = ["test", "dev", "preview", "staging", "prod"] as const;
export type DeploymentTier = (typeof DEPLOYMENT_TIERS)[number];

export function currentTier(): DeploymentTier | null {
  const raw = process.env.DEPLOYMENT_TIER;
  return (DEPLOYMENT_TIERS as readonly string[]).includes(raw ?? "")
    ? (raw as DeploymentTier)
    : null;
}

/** 缺失或不在允许列表 → 拒绝（fail closed，反例 X8）。 */
export function assertTier(allowed: readonly DeploymentTier[]): DeploymentTier {
  const tier = currentTier();
  if (tier === null || !allowed.includes(tier)) {
    throw new ConvexError({ code: "TIER_FORBIDDEN" as const });
  }
  return tier;
}

/** STUB_DELAY_MS 只在 dev / staging 生效（L2 竞态探针）；其他层级恒为 0。 */
export function stubDelayMs(): number {
  const tier = currentTier();
  if (tier !== "dev" && tier !== "staging") return 0;
  const n = Number(process.env.STUB_DELAY_MS ?? "0");
  return Number.isSafeInteger(n) && n >= 0 && n <= 120_000 ? n : 0;
}

/**
 * purge 的二次确认：参数必须等于当前部署名。
 * 部署名来源待验证（ctx.meta.getDeploymentMetadata() 的字段名）；退路为解析 CONVEX_CLOUD_URL 的子域名。
 */
export function assertConfirmDeployment(confirmDeployment: string, deploymentName: string): void {
  if (confirmDeployment !== deploymentName) {
    throw new ConvexError({ code: "CONFIRM_MISMATCH" as const });
  }
}
