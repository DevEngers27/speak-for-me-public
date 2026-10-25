import { checkPureRoundInvariant } from '../../engine/protocolChecks';
import { describe, it as vitestIt } from "vitest";

// W2-4: runtime contracts retain the registry titles below.
import { runtimePureCases } from '../../engine/runtimeBattery';
const implemented: Record<string, () => void> = {
  'INV-68': runtimePureCases['INV-68']!,
  'CE-143': runtimePureCases['CE-143']!,
};
const it = Object.assign((title: string, body: () => void) => vitestIt(title, body), { todo(title: string) { const body = implemented[title.split(' ')[0]!]; if (body) vitestIt(title, body); else vitestIt.todo(title); } });
// End W2-4.

describe("P · 09-run-lifecycle", () => {
  it.todo("INV-68 串行回合：∀ run 至多一个 `running` attempt，`runs.activeTurnSeq` 指向其 turn；每轮 = proposer（provider）1 个 `propose` 回合 + customer、finance 各 1 个 `evaluate` 回合，顺序固定；没有 `pendingTurnSeqs` / `openTurnCount` 之类计数器；轮次推进只由纯函数 `resolveRound(proposal, evaluations)` 决定");
  it("INV-74 `resolveRound` 优先级：任一 `clarify` 需人回答 → `needs_input(clarify)`；任一 `escalate` 过策略检查 → `needs_input`（`escalate(infeasible)` → 按 `relaxationOrder` 选收件人的 `infeasible` 请求；`escalate(needs_tradeoff)` → customer 的 `agent_escalated` 请求，05 §5.10 / §5.11.2）；全部 `recommend_accept` ∧ `isExecutable` → `pending_approval`；customer `counter` 可行 → 下一轮 proposer 回合（反馈只带 counter 的 candidateKey、不带 customer 快照里的 O 标号，provider 看到的 O 标号在其新快照构建时分配；`counter` 与 `reject` 不短路，finance 仍评估 base）；其他（reject / 可代答 clarify）→ 下一轮；`roundNo === maxRounds(3)` 且无合格提案 → customer `rounds_exhausted` 请求（`choose_candidate` / `keep_as_is` / `end_run`）；provider 所选候选被规则阻断 → 不插提案、不消耗版本号、不花评估调用，`turn.outcome.blockedCandidateKey` 记录后直接下一轮只反馈 `blocked`；可行集只有 1 个候选仍跑完一轮", checkPureRoundInvariant);
  it.todo("CE-143 穷举 `RUN_TRANSITIONS` / 提案 / 请求 / attempt 迁移表：对每个 (from, to) 调用 `assertTransition`");
});
