// 示例：convex/test/setup.ts —— convex-test 工具（§3.3）。设计稿，未运行。
// 待验证（V1）：convexTest / withIdentity / import.meta.glob 的确切 API。
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

export const modules = import.meta.glob("../**/*.ts");

export const TEST_ISSUER = "https://clerk.test.invalid";

export type TestRole = "customer" | "provider" | "finance";

function identity(subject: string) {
  return {
    issuer: TEST_ISSUER,
    subject,
    tokenIdentifier: `${TEST_ISSUER}|${subject}`, // 与 Clerk 真实格式同构：<iss>|<sub>
  };
}

export const IDENTITIES = {
  customer: identity("user_customer"),
  provider: identity("user_provider"),
  finance: identity("user_finance"),
  stranger: identity("user_stranger"), // 已登录但非成员
} as const;

export function makeT() {
  const t = convexTest(schema, modules);
  return {
    t,
    as: {
      customer: t.withIdentity(IDENTITIES.customer),
      provider: t.withIdentity(IDENTITIES.provider),
      finance: t.withIdentity(IDENTITIES.finance),
      stranger: t.withIdentity(IDENTITIES.stranger),
    },
    anon: t,
  };
}

/** 调用与 CLI 相同的内部 seed 函数，再把三个测试身份写成成员。 */
export async function seedRoom(
  t: ReturnType<typeof convexTest>,
  fixtureKey: "feasible" | "tradeoff" | "infeasible" | "below_committed" | "canary",
): Promise<{ roomId: Id<"rooms"> }> {
  const { roomId } = await t.mutation(internal.seed.fromFixture, {
    fixtureKey,
    anchorDate: "2026-10-26", // 固定锚点（fixtures-walkthrough D2）
  });
  for (const role of ["customer", "provider", "finance"] as const) {
    await t.mutation(internal.seed.attachMember, {
      roomId,
      role,
      tokenIdentifier: IDENTITIES[role].tokenIdentifier,
    });
  }
  return { roomId };
}

/** 以三个身份逐个调用公开的简报确认函数（函数名以 12-api 为准）。 */
export async function confirmAllBriefs(
  as: ReturnType<typeof makeT>["as"],
  roomId: Id<"rooms">,
): Promise<void> {
  for (const role of ["customer", "provider", "finance"] as const) {
    await as[role].mutation(api.briefs.confirmBrief, { roomId });
  }
}
