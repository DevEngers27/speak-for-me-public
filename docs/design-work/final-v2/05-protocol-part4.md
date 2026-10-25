# 05 · 协商协议（part4：回合与轮次）

> 分片清单见 `05-protocol.md` 开头。本节只定义协议推进规则；守卫、调度、重试、看门狗在 10，run 迁移全表在 04。

## 5.8 回合与轮次

### 5.8.1 术语

| 术语 | 定义 |
| --- | --- |
| round | `run.roundNo`，从 1 起；0 表示本 run 还没有开始任何轮（例如新 run 预检后直接 `pending_approval`）。一轮 = provider 1 个 propose 回合 + 按场景 `evaluatorOrder`（首个场景 `['customer', 'finance']`）各 1 个 evaluate 回合 |
| turn | run 内第 `turnSeq` 个回合（从 1 起，单调递增，**从不复用**）；`run.activeTurnSeq` 是当前唯一允许落库的回合（守卫 G2） |
| attempt | 一个回合的第 `attemptNo` 次模型调用（10）；协议只关心回合的最终结果 |
| 轮数上限 | `run.maxRounds`（场景配置，默认 3）；`rounds_exhausted` 请求以 `keep_as_is` 回答时 `maxRounds += 1` 且 `roundsExtended = true`（每 run 一次，03 §3.8、04 R14）。没有派生的 `effectiveMaxRounds` |

### 5.8.2 串行时序

| 步 | 触发 → 函数 | 读 | 写 / 调度 | 结果与失败 |
| --- | --- | --- | --- | --- |
| S0 | `runs.start` / `openIfReady` / `react()` → `startRunTx`（04 §4.3.3、09；canon §1.6 唯一建 run 的 helper）→ `planFirstStep(run)` | room、briefs、catalogItems、ledgerEntries、sharedFacts、上一 run 的 `currentProposalId` | 见右 | ① `cause = constraints_changed` 且刚 stale 的提案在新 cv 下仍 `passesChecks`（含 `version.stale_source`，被人拒绝的不算）→ run 直接 `pending_approval`，`currentProposalId` 指向**同一** proposalId，零回合（canon D06）；② `buyerFeasible = enumerateCandidates(fullView, { mode: 'feasibility' })` 为空（feasibility 模式无 `limit`，06 §10） → `needs_input` + `infeasible` 请求（§5.11），零模型调用；③ 否则 `roundNo = 1`，创建 provider propose 回合并经 `turns.beginAttempt` 调度 |
| S1 | provider 回合完成 → `turns.complete` → `applyMove` | turn、run、room、catalog | 见右 | `propose`：`checkProposal` 通过 → 插入提案（§5.7.3）并同事务创建 customer evaluate 回合；blocked → **不插提案、不消耗版本号**，turn 记 `outcome.blockedCandidateKey`，不花评估调用，进入 §5.8.4 的"下一轮或用尽"。`clarify` → §5.9。`reject(cannot_deliver)` → `needs_input` + `agent_escalated` 请求给 provider（§5.11）。`escalate` → §5.10：接受 → `needs_input`；不接受 → 本轮记"无提案"，进入下一轮或用尽 |
| S2 | customer 回合完成 | 同上 | 见右 | 必须打扰人的结果（`clarify`；被接受的 `escalate`）→ **短路**：立即 `needs_input`，不再调度 finance 回合；否则记录评估，同事务创建 finance evaluate 回合 |
| S3 | finance 回合完成 | 同上 | 见右 | 同样先检查短路；否则调用 `resolveRound`（§5.8.3） |
| S4 | `resolveRound` 的决定 → `applyRoundDecision` | — | runs、proposals、turns、humanRequests、events | `pending_approval`、下一轮（新 provider 回合）、或 `needs_input` |

- run 任意时刻至多一个在途 attempt，至多一个非终态回合（canon D08）；每个"创建下一回合"都发生在上一个回合落库的**同一事务**里，所以不存在"run 在 negotiating 却没有在途回合"的窗口；万一出现（缺陷、守卫命中），`runs.reconcile` 负责恢复（10）。
- 短路只在"必须打扰人"时发生。`counter` 与 `reject` 不短路：finance 对 base 的评估仍有价值（它决定第 3 行是否成立），且顺序固定，不会出现并行 counter 的合并问题。
- 评估方只评估**通过全部检查**的提案；被阻断的提案永远不会出现在评估回合里。

### 5.8.3 `resolveRound`（纯函数，`core/engine/protocol/resolveRound.ts`）

```ts
export type Evaluation =
  | { role: Role; action: 'recommend_accept' }
  | { role: Role; action: 'reject'; reasonKey: string }
  | { role: Role; action: 'counter'; candidateKey: string; counterPasses: boolean } // counterPasses：按全量 RuleInput 物化并 checkProposal
  | { role: Role; action: 'clarify'; handledBy: 'human' | 'code' }
  | { role: Role; action: 'escalate'; accepted: boolean };

export type RoundDecision =
  | { kind: 'needs_input'; cause: 'clarify' | 'escalate' }
  | { kind: 'pending_approval'; proposalId: Id<'proposals'> }
  | { kind: 'next_round'; feedback: RoundFeedback }
  | { kind: 'rounds_exhausted' };

export function resolveRound(i: {
  roundNo: number; maxRounds: number; evaluatorOrder: readonly Role[];   // maxRounds 已含 keep_as_is 的延长（03 §3.8）
  proposalId: Id<'proposals'>; proposalPassesNow: boolean; evals: readonly Evaluation[];
}): RoundDecision;
```

| 优先级 | 本轮评估结果 | 决定 |
| --- | --- | --- |
| 1 | 任一 `clarify` 需要人回答 | `needs_input(clarify)`（正常已在 S2 / S3 短路） |
| 2 | 任一 `escalate` 通过策略检查 | `needs_input(escalate)`（同上） |
| 3 | `evaluatorOrder` 中每个角色都 `recommend_accept`，且提案**此刻**仍 `passesChecks`（在 mutation 内重算，防跨午夜 `date.in_past`） | `pending_approval`，`currentProposalId` = 本轮提案 |
| 4 | customer `counter` 且 `counterPasses` | `roundNo < maxRounds` → `next_round`（反馈含 counter 的 `candidateKey`，在 provider 新快照中重新标号）；否则 `rounds_exhausted` |
| 5 | 其他（`reject`、`counterPasses = false` 的 counter、代码代答的 clarify、未通过策略的 escalate） | `roundNo < maxRounds` → `next_round`；否则 `rounds_exhausted` |

- 第 3 行不要求 provider 表态：提案就是 provider 的表态（P07）。
- 不存在"按是否通过全局检查选 counter"：只有 customer 能 counter，没有多 counter 合并，因而也没有"为什么不选我"的推断通道（security 底稿 §5.6 的顾虑在串行单 counter 下自然消失）。

### 5.8.4 counter 的转发与 blocked 的反馈

- **counter 转发**：customer 的 counter 不直接成为提案。`turns.complete` 把它物化为条款并做全量检查（结果只影响流程）：通过 → 下一轮 provider 快照强制纳入该 `candidateKey`，`<room_state>` 写明 "The customer suggested O4"；不通过 → 不转发，provider 只看到 "v3 not accepted"。转发与否是服务端处置，写入 customer 本回合的 `turns.outcome.counterForwarded`（通过 `true`、不通过 `false`；03 §3.8 `turns.outcome` 封闭 validator 中的可选布尔，与 `candidateKey` 同在 outcome 内）；`turns.result` 只存 `agentMoveV` 形状的 move，不加任何服务端字段；下一轮 provider 快照是否强制纳入只读这个 outcome 字段。customer 从 `counterForwarded: false` 得到 1 bit，属 07 显式解密清单中的"可行性 1 bit"。
- **blocked 反馈**：被阻断的候选没有提案行、没有版本号；provider 下一回合的 `<room_state>` 只写 "Round 1: your option (O2) was blocked"（复述 provider 自己选过的候选条款，`fit: 'blocked'`，无 reasonCode、无 checkId、无任何他方数字，canon D12 ①）；被阻断的 `candidateKey` 进入本 run 的剔除集合，下一快照不再出现。
- **provider 接受 counter** 就是在下一轮 `propose` 同一个 `optionKey`；新提案照常经过 customer、finance 评估。

### 5.8.5 轮次用尽、provider 无可选候选

以下任一情况进入"轮次用尽"处理：`resolveRound` 返回 `rounds_exhausted`；被阻断后 `roundNo = maxRounds`；provider 快照在剔除后为空；provider 本 run 已 propose 4 次（canon D12 ⑤）；run 的 attempt 上限或美元上限用尽（10，`cause: 'call_limit' | 'spend_limit'`）。原因（`questionKey` 的后缀）按触发映射：前两种 → `rounds`；provider 快照剔除后为空、provider 本 run 已 propose 4 次 → `no_candidates`（provider 的提案上限不是 `call_limit`）；`call_limit` / `spend_limit` 只用于 run 的 attempt 上限与美元上限。

处理：run → `needs_input`，恰好开一个 `kind: 'rounds_exhausted'` 请求给 customer（canon D15；`questionKey = request.rounds_exhausted.{rounds | no_candidates | call_limit | spend_limit}` 区分文案，04 R6 / U5 同此），选项（§5.11.2）：`choose_candidate` ×≤3（本 run 当前提案若仍 `passesChecks` 且未被人拒绝则排第一，其余来自 customer 自己的视图并剔除本 run 已阻断、被拒与复核失败的候选，当前仍通过的提案排第一，§5.11.2）、`keep_as_is`（每 run 至多 1 次；且原因为 `rounds`、attempt / 美元上限未用尽、provider 仍有可提的候选且未达 4 次时才提供，否则再给一轮也必然立刻用尽；提供与回答共用同一个资格谓词，回答时从请求的 `questionKey` 读回原因复核，不成立等价 `end_run`）、`end_run`。

- 不再调用模型（np E15）。
- 为什么"有合格提案"也走请求而不是直接 `pending_approval`：canon D08 规定 `roundNo === maxRounds → needs_input`；把合格提案放在 `choose_candidate` 首位，customer 一次点击即可送审（同一 proposalId，不复制版本，§5.11.4），代理没有共识时由人显式决定是否送审。

### 5.8.6 人在 `pending_approval` 阶段拒绝

08 A5 的 `approvals.record(reject)` 在同一事务调用 `onProposalRejected(run)`（本章定义语义，04 定义迁移）：提案 → `rejected`，其 `candidateKey` 进入剔除集合；`roundNo < maxRounds` → run → `negotiating`、`roundNo + 1`，同事务创建 provider propose 回合（反馈：provider 只见 "v3 rejected"，买方代理见 "v3 rejected by {role}"；**不含 `reasonKey`**，08 A13）；否则 → §5.8.5。

### 5.8.7 上限汇总

| 上限 | 默认值 | 落点 | 超限后 |
| --- | --- | --- | --- |
| 每 run 轮数 | `maxRounds = 3`（场景） | `runs.maxRounds` | §5.8.5 |
| 额外一轮 | 每 run 1 次（`keep_as_is` → `maxRounds += 1`） | `runs.roundsExtended` | 请求里不再提供 `keep_as_is` |
| 每角色每 run 的 propose / counter | 4（canon D12 ⑤） | 按 `runId` 统计提案行 / 回合结果 | provider 不再建回合；customer 去 `counter` |
| 每角色每 run 的 clarify | 1（代答或问人都算） | 回合结果 | 去 `clarify` |
| 每角色每 run 的 escalate | 1 | 回合结果 | 去 `escalate` |
| 每 run 被接受的 `needs_tradeoff` | 1 | 请求行 | 策略检查不通过 |
| 每 run open 请求 | 恰好 0 或 1 | 不变量 INV-P7 | — |
| 每 run attempt | `maxAttempts = maxRounds × 3 × 2 = 18`（canon D17，10 执行） | `runs.attemptCount` | §5.8.5（`cause: call_limit`） |

最坏回合数：4 轮 × 3 回合 + 3 次 clarify 后的重开回合 = 15 个回合；每回合至多 2 个自动 attempt → 30 > 18，所以真正的上界是 `maxAttempts`。典型收敛：首轮 3 次调用；被阻断一次再收敛：4 次（§5.15）。串行墙钟约为每轮 3 次调用之和（canon U4，接受）。
