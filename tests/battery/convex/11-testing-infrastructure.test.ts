import { w2BatteryCases } from '../../convex-helpers/w2Battery.fixture';
import { describe, it as vitestIt } from "vitest";

// W2-4: real scheduler assertions retain the registry titles below.
import { runtimeCase } from '../../convex-helpers/runtimeCases.w2-4.fixture';
const implemented: Record<string, () => Promise<void>> = {
  'CE-160': runtimeCase('CE-160'),
  'CE-161': runtimeCase('CE-161'),
  'CE-158': w2BatteryCases['CE-158']!,
  'CE-172': w2BatteryCases['CE-172']!
};
const it = { todo(title: string) { const body = implemented[title.split(' ')[0]!]; if (body) vitestIt(title, body); else vitestIt.todo(title); } };
// End W2-4.

describe("CT · 11-testing-infrastructure", () => {
  it.todo("CE-158 在 convex-test 里 `Promise.all([approve, approve])` 得到 1 条执行，报告写\"并发安全\"");
  it.todo("CE-160 测试环境 `AGENT_MODE=stub`，脚本化模型队列从未被消费，RUN / STALE 组仍变绿");
  it.todo("CE-161 用 `finishAllScheduledFunctions(vi.runAllTimers)` 推进，看门狗与回合 action 同时触发");
  it.todo("CE-172 金丝雀 fixture 恰好把被泄露的字段披露给了攻击者角色，测试因此失明（评委对 security 底稿的发现）");
});
