# 05 协商协议（第 2/2 部分：回合、裁决、不可行、人工请求、示例）

## 5.4 回合与轮次规则

一轮（round）= 一个在审提案的生命周期：

```text
round r:  [proposer turn]  (只在本轮没有现成提案时：首轮、或上一轮以 reject 结束)
             ↓ propose → materializeTerms → validateProposal
          [code adjudication]  硬约束失败 → 不调评估方；记公开阻断结果，回到 proposer（r+1）
             ↓ 硬约束通过
          [evaluator turns, 并行]  customer、finance 各一次（同一 mutation 调度两个 action）
             ↓ 两个 completeTurn 都提交后（openTurnCount 归零）
          [resolveRound]
```

`resolveRound`（纯函数，engine/negotiation/reduce.ts）按优先级：

| 优先级 | 本轮评估结果 | 结果 |
| --- | --- | --- |
| 1 | 任一 `clarify` 被接受 | 生成 clarification 请求；run → needs_input（R5）。同轮其他结果保留在 turn 记录中，恢复时被打断角色重做 |
| 2 | 任一 `counter` | 取场景 `counterPriority`（首个场景：customer > finance）最高者的候选物化为新提案（author = 该角色），旧提案 superseded；另一方的 counter 记 `effect=counter_unused`。下一轮评估方 = 除新作者外的所有角色（包括 provider） |
| 3 | 全部 `recommend_accept` | proposal → endorsed；run → pending_approval（R4） |
| 4 | 有 `reject`、无 counter | 回到提议方：下一轮 proposer turn，上下文带上本轮拒绝码（不带他方 rationale） |
| — | 任意情况下 `roundIndex == maxRounds` 且未到 3 | 升级：给 `tieBreakerRole`（customer）发 choose_option 请求，选项为 `jointFeasible` 按系统排序的前 3 个；`jointFeasible` 为空则走 5.5 |

细则：
1. **提议方**：场景声明 `proposerRole = "provider"`。counter 被采纳后，作者角色视为背书，不再评估自己的提案。
2. **代码裁决硬违规**：provider 不知道预算，提出超预算方案是正常的；代码直接给出 `OVER_BUDGET` 阻断（provider 只见 `EXCEEDS_FINANCE_LIMIT`），不浪费两个评估调用。硬违规的提议**不插入 proposals**（proposals 只收进入评审的版本），只记在 turn（`effect=blocked_by_rules`、`validation` 码）与公共事件中，可追溯性不受影响。这一步也算一轮，受 maxRounds 约束。
3. **默认 maxRounds = 4**（场景配置）；每 run `modelCallLimit = 16`；每 turn 最多 2 次 attempt。最坏调用数 = 4 轮 × 3 回合 × 2 attempt = 24 > 16，所以上限由 `modelCallLimit` 兜底，触发时 run → paused(call_limit)。
4. **首轮短路**：`jointFeasible` 只有一个候选时仍然走代理（产品承诺是三方代理协商），但评测报告单列此类情况。
5. **人拒绝**（R11）：拒绝码进入下一轮所有角色上下文（模板形式："Finance declined v3: SPEND_TOO_HIGH"），被拒候选加入 `proposedCandidateKeys`。

## 5.5 不可行识别与升级（代码决定，零模型调用）

`analyzeFeasibility(systemView)` 在 R1/R2、每次 bump 后、轮次用尽时调用：

```ts
type FeasibilityReport =
  | { kind: "feasible"; candidateKeys: string[] }
  | { kind: "infeasible"; relaxations: Relaxation[] };   // 每条都是"改这一项就至少有一个候选可行"
type Relaxation =
  | { ownerRole: "finance"; kind: "raise_budget"; minTotalCents: Cents; unlocks: string[] }
  | { ownerRole: "customer"; kind: "extend_deadline"; minDate: IsoDate; unlocks: string[] }
  | { ownerRole: "customer"; kind: "make_deferrable"; itemKey: string; unlocks: string[] }
  | { ownerRole: "provider"; kind: "enable_rush"; unlocks: string[] };
```

算法：对每个可放松维度单独放松、其余保持，求使至少一个候选可行的最小改动（预算取所需最小 total；日期取最早满足的日期；必需条目逐个试延后）。每个 ownerRole 至多一个请求，共用一个 `groupId`；任一请求被答复，同组其余 canceled。每个请求都包含 `no_change` 选项（"保持现状，本周期不变更"），选中后 run → canceled，房间显示 "No agreement this cycle"——**不强行达成一致**（核心 8）。

## 5.6 人工请求结构

```ts
type RequestEffect =
  | { type: "set_budget"; totalCents: Cents }                 // hard → bumpConstraints
  | { type: "extend_deadline"; date: IsoDate }                // hard
  | { type: "make_deferrable"; itemKey: string }              // hard
  | { type: "enable_rush" }                                   // hard
  | { type: "choose_candidate"; candidateKey: string }        // 直接生成 endorsed 提案（R9）
  | { type: "set_preference"; key: string; value: string; disclose: boolean } // soft，不 bump（R8）
  | { type: "no_change" };                                    // run → canceled
type HumanRequestDraft = {
  kind: "tradeoff" | "choose_option" | "clarification";
  targetRole: string; questionKey: string; params: Record<string, unknown>;
  options: { optionKey: string; labelKey: string; params: Record<string, unknown>; effect: RequestEffect }[];
};
```

问题与选项文本由场景模板按 `questionKey/labelKey + params` 在读取时渲染；参数只含目标角色有权看到的值（例如给 finance 的 `minTotalCents`，给 customer 的候选价格）。`humanRequests.answer` 只接受 `optionKey`，不接受自由文本。

## 5.7 澄清话题（clarify）

模型只说"想问哪个话题"，问题和选项由场景话题表生成，并发给**信息所有者本人**（不是对方代理）：

| topicKey | 可提问角色 | ownerRole | 选项 → 效果 |
| --- | --- | --- | --- |
| `tradeoff_priority` | provider、finance、customer | customer | date_first / scope_first → `set_preference(tradeoffPreference)`；答复页写明 "Your answer will be visible to the room" 并由用户选择是否披露 |
| `spend_full_headroom` | customer、provider | finance | yes / no → `set_preference(spendFullHeadroom)` |
| `rush_capacity` | customer、finance | provider | yes / no → `enable_rush`（hard）或 no_change |

每角色每 run 最多一次 clarify；话题若已在当前约束版本下被答复则不出现在 `topicKeys` 中。

## 5.8 示例：预算降到 $4,800 后的新 run

| 步 | 谁 | 输入（摘要） | 输出 / 代码结果 | 公共时间线（模板） |
| --- | --- | --- | --- | --- |
| 0 | 系统 | bump → constraints v2；`jointFeasible = {LOGIN+REPORTS|standard, LOGIN|rush, LOGIN|standard}` | run#2 negotiating | "Finance updated a constraint; proposal v1 is blocked." |
| 1 | provider | 候选中 `LOGIN+REPORTS|rush` 标 `knownBlocked: EXCEEDS_FINANCE_LIMIT`（来自旧提案 v1 的派生阻断，provider 界面上本来就看得到） | `propose LOGIN+REPORTS|standard` → OK（v2 $750，11-27） | "Provider agent proposes LOGIN + REPORTS (standard) — +$750, delivery 2026-11-27; EXPORT deferred." |
| 1' | provider（对照） | 若它仍选了已阻断候选 | 代码裁决 OVER_BUDGET，不插入 proposal，turn `effect=blocked_by_rules`，回到 provider；评测记为"忽视已知阻断" | "Provider agent suggested LOGIN + REPORTS (rush); blocked: exceeds the finance limit." |
| 3a | customer | 简报 `tradeoffPreference = date_first` | `counter LOGIN|rush`（v3 $600，11-20） | "Customer agent counters with LOGIN (rush) — +$600, delivery 2026-11-20; REPORTS, EXPORT deferred." |
| 3b | finance | — | `recommend_accept`（记 counter_unused 不适用） | — |
| 4 | provider、finance 并行 | 评估 v3 | 两者 `recommend_accept` | "v3 is ready for approval." |

若 customer 简报 `tradeoffPreference = unspecified`，customer 代理通常 `clarify tradeoff_priority`，代码给 customer 本人发请求（R5）。
