// 示例：convex/lib/opsLog.ts —— 结构化日志助手（§4.4 日志纪律）。
// 目标：类型上无法把自由文本（简报、rationale、模型原文、错误原文）写进日志。
// convex/ 下除本文件外禁止裸 console.*（ESLint no-console + overrides）。
import type { GenericId } from "convex/values";

/** 品牌类型：只能由 asEnum() 产生，防止任意字符串冒充枚举。 */
declare const enumBrand: unique symbol;
export type EnumValue = string & { readonly [enumBrand]: true };

export function asEnum<const T extends string>(allowed: readonly T[], value: T): EnumValue {
  if (!allowed.includes(value)) throw new Error("opsLog: value not in enum");
  return value as unknown as EnumValue;
}

type LogValue = GenericId<string> | EnumValue | number | boolean | null;

export const OPS_EVENTS = [
  "turn_started",
  "turn_completed",
  "turn_failed",
  "turn_rejected_stale",
  "watchdog_fired",
  "config_invalid",
  "seed",
  "archive",
  "purge",
  "alert",
  "execution_committed",
] as const;
export type OpsEvent = (typeof OPS_EVENTS)[number];

export function opsLog(event: OpsEvent, fields: Record<string, LogValue>): void {
  // 单行 JSON，便于 `npx convex logs --jsonl` 后机器扫描（canary-scan）。
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ k: "ops", event, ...fields }));
}

// 用法示例：
// opsLog("turn_failed", {
//   turnId,                                   // Id<"agentTurns">
//   errorCode: asEnum(TURN_ERROR_CODES, "max_tokens"),
//   attempt: 2,
//   latencyMs: 8123,
// });
// opsLog("turn_failed", { detail: err.message }); // 编译错误：string 不是 LogValue
