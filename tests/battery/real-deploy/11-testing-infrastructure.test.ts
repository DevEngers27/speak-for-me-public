import { describe, it } from "vitest";

describe.skipIf(process.env.REAL_DEPLOY !== "1")("RD · 11-testing-infrastructure", () => {
  it.todo("CE-159 并行 `npx convex run` ×5 全部成功且只有 1 条执行，但 CLI 冷启动让调用从未重叠");
  it.todo("CE-162 `log_scan` 用 `npx convex logs --history 1000` 永不退出 / 回放不完整");
  it.todo("CE-164 变异检查：分别删除 `by_executionKey` 查重、`approvals.record` 的 run 状态守卫、G1–G3 之一");
});
