import { w2BatteryCases } from '../../convex-helpers/w2Battery.fixture';
import { describe, it as vitestIt } from "vitest";

// W2-4: real scheduler assertions retain the registry titles below.
import { runtimeCase } from '../../convex-helpers/runtimeCases.w2-4.fixture';
const implemented: Record<string, () => Promise<void>> = {
  'CE-036': runtimeCase('CE-036'),
  'INV-20': w2BatteryCases['INV-20']!
};
const it = { todo(title: string) { const body = implemented[title.split(' ')[0]!]; if (body) vitestIt(title, body); else vitestIt.todo(title); } };
// End W2-4.

describe("CT · 02-agent-advisory", () => {
  it.todo("INV-20 `approvals` 每行 `userId ∈ members(roomId)` 且只由 `approvals.record`（`memberMutation`）写入；不存在任何 internal mutation / action 写 `approvals`；`recommend_accept` 只写 `turns` 与 `events`（`turn_completed`，03 §3.11.1；没有 `agent_recommended` 事件，评估动作对他方不外显）");
  it.todo("CE-036 三方代理（stub）全部 `recommend_accept`；读 `approvals` 行数与 run 状态");
});
