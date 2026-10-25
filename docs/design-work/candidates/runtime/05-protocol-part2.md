# 05 协商协议（part2）：应用规则、轮次、澄清与升级、取舍请求、示例

> 分片清单见 part1。

## 5.5 `applyTurnOutput(ctx, run, turn, output)` —— 每个动作的确定性后果

在 apply 守卫通过后、同一事务内执行（10 part3 §10.6.5）。

| 回合 / 动作 | 写入 | 推进 |
| --- | --- | --- |
| propose / `propose`，候选 ≠ 当前提案候选 | `insertProposal`：terms 原样取自 `run.candidates[key].terms`，`authorKind: "agent"`、`authorRoleKey: provider`、`agentMode`、`requiredApprovals` 取场景声明并快照、`checksAtCreation` 用 `evaluateProposal` 的结果码；patch `rooms.currentProposalId`、`runs.currentProposalId`；事件 `proposal_created` | 为每个评审角色 `startTurn(review, baseProposalId)`，并行调度 |
| propose / `propose`，候选 = 房间当前提案的候选，第 1 轮（例如澄清回答或重谈请求后的新 run） | 不插入新版本；`runs.currentProposalId` 指向现有当前提案 | 照常安排评审回合 |
| propose / `propose`，候选 = 本 run 当前提案的候选，第 2 轮起 | 不插入提案；result 标记 held | run → awaiting_approval，outcome `proposer_held`（不再请评审，省调用） |
| propose / `clarify` | 创建 humanRequest（kind clarify，`requestedByTurnId`）；`clarifyUsed += 1` | run → waiting_human，outcome `clarify` |
| propose / `reject` | 规划请求：给提议方的人一个 `blocked` 请求（选项：`propose_manually` / 编辑目录 `edit_constraints` / `decline`） | run → waiting_human，outcome `agent_declined` |
| review / 任一动作 | 写 result 与 privateRationale；事件 `agent_verdict`（模板化） | 若本轮全部评审 turn 已终态 → `concludeRound` |
| review / `clarify` | 先只记录在 result（`accepted: false`），由 `concludeRound` 决定是否采纳 | 同上 |

评审回合的 JSON Schema 中，`counterCandidateKey` 的枚举会去掉当前提案的候选，从解码层面减少 `SEM_COUNTER_SAME`。

## 5.6 回合与轮次规则（GAP-10）

- **一轮** = 提议方 1 个 propose 回合 + 所有评审方各 1 个 review 回合（并行）。串行深度 2。
- **第 1 轮**总是从提议方开始；**第 r+1 轮**只在第 r 轮未收敛时开始，提议方在上下文中看到第 r 轮全部评审的公开结果（动作、候选、理由码）。
- `maxRounds` 由场景配置（首个场景 3，README 的"最多 3 个完整轮次"）。clarify 不消耗轮次，但每 run 至多被采纳 1 次。
- 评审回合失败按 fail-open 记为 `no_recommendation`（10 part2 F20）；提议回合失败让 run failed（F21）。

`concludeRound(ctx, run)` 判定表（本轮所有评审 turn 均已终态时调用，按顺序取第一条命中的规则）：

| # | 条件 | 结果 |
| --- | --- | --- |
| C1 | 有评审 `clarify` 且 `clarifyUsed < MAX_CLARIFY_PER_RUN` | 按 `reviewerRoleKeys` 顺序采纳第一个（`accepted: true`），创建 humanRequest，`clarifyUsed += 1`；run → waiting_human（outcome clarify） |
| C2 | 全部结果 ∈ {recommend_accept, no_recommendation}（未被采纳的 clarify 视同 no_recommendation） | run → awaiting_approval（outcome converged） |
| C3 | 有 counter / reject 且 `currentRound < maxRounds` | `currentRound += 1`，`startTurn(propose)` |
| C4 | 有 counter / reject 且已到 `maxRounds` | run → awaiting_approval（outcome round_cap）；界面在提案卡上显示"代理未达成一致"及各方公开结论 |

不论 C2 还是 C4，进入人工审批的提案都由代码保证在当前约束版本下可执行（候选本身是可行集合的成员）。代理的结论只是供人参考的信号。

## 5.7 澄清、升级与不可行

**升级只由代码触发**，四种原因：

| 原因（`run.outcome`） | 触发点 | 请求目标 |
| --- | --- | --- |
| `no_feasible` | `startRunTx` 枚举候选为空 | 场景规划器按阻断原因挑选能解除阻断的角色（可能多人并行） |
| `clarify` | 代理 clarify 被采纳（5.5、C1） | 问题声明的目标角色 |
| `agent_declined` | 提议方 `reject` | 提议方的人 |
| `blocked` | 本约束版本下拒绝触发的 run 已达 3 个（04 T3） | 提议方的人（手动选择）与最近一次拒绝者（说明需要什么） |

**问题目录**（场景声明，`questionKey → { allowedTargets, needsItemKey, options[] }`）。首个场景：

| questionKey | 允许的目标 | 选项（effect） |
| --- | --- | --- |
| `q.defer_item`（需要 itemKey） | customer | `defer_ok`（share_answer：把该项标为可延后的事实披露给房间）、`keep_item`（share_answer）、`edit_brief`（edit_constraints） |
| `q.flexible_date` | customer | `standard_ok`（share_answer：接受标准交付）、`need_preferred`（share_answer）、`edit_brief`（edit_constraints） |
| `q.price_flex`（需要 itemKey） | provider | `edit_catalog`（edit_constraints：确认更便宜的新版本）、`decline` |
| `q.budget_flex` | finance | `edit_budget`（edit_constraints）、`decline` |

`share_answer` 的回答是该角色对全房间的**人工显式披露**；新 run 的所有代理在 `<shared_facts>` 中看到它（例如 `customer: REPORTS may be deferred`）。

## 5.8 向具体的人请求取舍的结构

```ts
type RequestDraft = {
  targetRoleKey: string;
  kind: "tradeoff" | "clarify" | "blocked";
  blockingCodes: string[];                    // 来自 06 的 reasonCode，例如 ["budget.over_cap"]
  questionKey: string;                        // 模板键，问题文本由模板渲染
  questionParams: Record<string, Param>;      // 只含目标角色可见的值
  options: { optionKey: string; effect: "share_answer" | "edit_constraints" | "propose_manually" | "decline";
             params: Record<string, Param>; deepLink?: string }[];
};
// 场景插件实现：
planHumanRequests(reason: EscalationReason, input: RuleInput, run: RunSnapshot): RequestDraft[];
```

引擎对规划结果的要求（`assertRequestDrafts`）：每个 draft 至少一个非 decline 选项；`questionParams` 与 `options[].params` 中的每个键都必须在场景的"受众—参数"声明中允许目标角色可见（防止把预算数值发给 provider）；同一 run 每个目标角色至多一个 open 请求。

请求**并行**发给所有能解除阻断的角色（Q8）：先发生的约束变化会取代本 run 及其余全部 open 请求（04 H3），不会出现两个互相矛盾的变更都被应用后又各自重谈的情况——第二个变更会基于第一个变更后的新约束版本再评估。首个场景的规划算法见 14 §14.7。

## 5.9 人在协议中的动作

| 动作 | 函数 | 协议效果 |
| --- | --- | --- |
| 手动提出候选 | `proposals.proposeManually`（仅提议方角色） | `authorKind: "human"` 的提案；run → awaiting_approval（T8–T10）。代理不可用时的主路径（R9） |
| 带理由的拒绝 | `decisions.decide({decision:"reject", reasonCode, reasonNote?, reasonNoteAudience})` | 当前 run superseded；新 run（trigger rejection）把被拒提案的候选加入 `excludedCandidateKeys`；新 run 的提议方在历史中看到"Customer rejected v3: date_unacceptable"（理由码公开；备注按本人选择的受众）。消除 Role A 的"拒绝是死路"（RA-B16） |
| 回答请求 | `requests.answer` | 见 04 §4.8 |
| 请求重谈 | `runs.requestRenegotiation`（任一参与者） | 当前 run 为 awaiting_approval，或最近的 run 已执行（修订已执行的协议）时可用；当前 run superseded，新 run（trigger renegotiation_requested）。受房间调用预算约束 |
| 恢复失败的 run | `runs.resume` | 04 T7 |

## 5.10 示例：一次提议回合的完整消息流

信封（由 turn / attempt 字段组成，模型看不到 ID）：

```json
{ "protocolVersion": 1, "roomId": "r_7…", "runId": "run_3…", "round": 1, "turnId": "t_9…",
  "attemptId": "mc_4…", "roleKey": "provider", "turnKind": "propose", "constraintsVersion": 6,
  "candidateSetKey": "LOGIN+REPORTS@standard|LOGIN@rush|LOGIN@standard" }
```

模型输出（扁平）：

```json
{ "action": "propose", "candidateKey": "LOGIN+REPORTS@standard", "clarify": null, "rejectReason": null,
  "rationale": "Keeps REPORTS from the requested scope; standard delivery still covers the shared required item." }
```

公开结果与渲染（customer 视角与 provider 视角相同，因为只用公开条款）：

```json
{ "action": "propose", "candidateKey": "LOGIN+REPORTS@standard", "proposalId": "p_12…" }
```
`"Provider agent proposed v4: LOGIN + REPORTS, standard delivery 2026-11-20, $800. EXPORT deferred."`

`rationale` 只出现在 provider 本人的"我的代理"面板里。
