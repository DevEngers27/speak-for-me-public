# 09 约束变更 · part2：预算下调的完整时序、即时阻断、"相关的人"、边界情形、历史

## 5. 预算下调时序（`briefs.updateBudgetCap`，原文 R:245 的核心转折）

前提：约束 v3 下 v2（+$900、2026-11-20）处于 pending_approval，customer 与 provider 已批准，finance 未批。

| 步 | 谁 / 函数 | 读写 | 可能的失败与失败后状态 |
| --- | --- | --- | --- |
| 1 | finance 在预算面板输入 $4,800 与原因 "Q4 budget revision"（勾选是否向房间公开原因）；客户端 `parseDollars` → 480000 | — | 非法金额：客户端即时提示 |
| 2 | `briefs.updateBudgetCap({ roomId, newCapCents: 480000, reason, reasonShared, baseVersionNo })` | `requireParticipant(role = finance)` | 非 finance → `FORBIDDEN_ROLE`；状态不变 |
| 3 | 以 finance 最新确认版本为底构造新内容（只改 budgetCapCents），进入 `commitBriefVersion` | 读 participants、briefVersions、currentConstraintSet | 版本冲突 → `BRIEF_VERSION_CONFLICT`；480000 < committed（400000）？否；若是 → `BUDGET_BELOW_COMMITTED`，状态不变 |
| 4 | 插入 finance v2；ruleDiff = [budgetCapCents] | 写 briefVersions、participants | — |
| 5 | `bumpConstraints` → constraintSet v4（committedCents 仍 400000） | 写 constraintSets、rooms | — |
| 6 | `onConstraintsChanged`：取消 open 请求（无）；run 为 pending_approval，复评 v2：`400000 + 90000 = 490000 > 480000` → OVER_BUDGET | 读 proposals、约束集 | — |
| 7 | run → superseded（endReason constraints_changed），`currentProposalId`、`currentRunId` 清空 | 写 runs、rooms | — |
| 8 | `startRun(constraint_change)`：预检 `enumerateFeasible`（变体 A 下 {SSO std + REPORTS lite, $750, 11-18} 可行）→ 新 run #2 negotiating，调度 provider 回合（`modelCallsUsed += 1`） | 写 runs、agentTurns、rooms、调度 | 调用预算耗尽 → 新 run 以 failed 起步，界面显示原因与"Retry"；变体 B 无可行 → awaiting_input + tradeoff 组 |
| 9 | 事件（同事务）：brief_confirmed（room，categories [budget]）、budget_changed_detail（finance）、constraints_changed（room：v3 → v4，causeKind brief，roleKey finance，sharedReason?）、run_status_changed（#1 → superseded）、run_started（#2） | 写 events | — |
| 10 | mutation 提交；三方的 `rooms.workspace` 订阅同时收到新结果 | — | — |

提交后各窗口在同一时刻看到：v2 显示为 superseded，附当前约束下的检查（finance/customer："over by $100"；provider："exceeds the finance limit"）；customer、provider 的批准显示为 stale_approve（"approved under constraints v3"）；run #2 显示 "Provider agent drafting…"。**阻断在 finance 提交的那个事务里就已完成，不等模型**（F09.3）；重谈随后异步出现。

## 6. 阻断是读取时派生（不回写）

- 不给提案写 blocked 状态，不删除、不修改旧决定（PR-1、DE-1）。`rooms.workspace` 对每个展示的提案用当前约束集调用 `evaluateProposal`，状态与原因实时可得（02 part3 §5）。
- 所以"约束变化 → 旧方案不可执行"没有可能遗漏的写入步骤：只要 bump 发生（CS-3 保证），所有读取者就按新约束评估。

## 7. 重新协商还是请求取舍；"相关的人"是谁（GAP-12、GAP-19、Role A Q7/Q8）

1. 当前提案仍可执行 → 不重谈，只需在新版本上重新批准（R-10 不迁移分支）。
2. 当前提案不可执行或 run 在协商中 → 旧 run superseded，新 run 预检：
   - 可行集非空 → 新 run 由代理重谈。代理在 `feedback.categories` 中得知"预算类约束变化"（不含数值）。
   - 可行集为空 → `tradeoffs` 生成请求组（06 §9），**同时**发给每个有可执行选项的角色：customer（把某些项改为可延后 / 接受公开提案的日期）、finance（把上限提到能容纳某个公开提案）、provider（修订报价）。并行而非顺序：顺序需要定义优先级且拖慢恢复；并行时第一个改变规则字段的回答 bump 约束、取消其余请求（CS-6），其他人看到"已因约束更新关闭"。
3. **预算上调**：若当前提案仍可执行，不自动寻找更优方案（避免未经请求的模型调用与"方案突然变了"）；任一参与方可 `runs.requestRenegotiation(reasonCode = "CONSTRAINTS_IMPROVED")` 主动重谈。
4. **谁有权改约束**：只有约束所有者本人（预算 = finance，必需项与截止日 = customer，报价 = provider），在审批期间也一样；没有"审批期间冻结约束"——冻结会把现实中的预算变化挡在系统外，而 bump 机制已经保证旧审批不会被误用。

## 8. 边界情形

| 情形 | 处理 |
| --- | --- |
| 新上限恰好等于"已承诺 + 提案金额" | 通过（`≤`）；fixture 中 cap $4,900 用作边界测试（14） |
| 新上限低于已承诺（例如 $3,900 < $4,000） | 拒绝写入，`BUDGET_BELOW_COMMITTED`，状态不变（EX-5，ADR-11） |
| 新上限与旧值相同 | `commitBriefVersion` 步骤 5 返回 unchanged，不 bump |
| 两人几乎同时改各自的约束 | M-ROOM 串行：两次 bump（v4、v5），第二次的 `onConstraintsChanged` 处理第一次启动的新 run（再次 superseded 并重启）；成本是一次可能浪费的调度，回合会被取消 |
| 同一人在两个标签页编辑草稿 | `baseVersionNo` 乐观并发，后确认者收到冲突 |
| 回合进行中降预算 | 回合被标 cancelled；若模型结果仍返回，`completeTurn` 发现状态非 running，只记用量（RN-3）——AC-S5 |
| 改必需项或截止日 | 与预算相同路径；旧审批同样失效（F09.4、Role A 回归 2） |
| provider 改价已被提案引用的行 | bump；旧提案 `SOURCE_MISMATCH`，不可执行（RA-B04 的回归） |
| setup 阶段反复确认 | 每次规则变化都 bump（廉价），不启动协商 |
| 执行后再改约束 | 只 bump；不自动开 run |

## 9. 历史保留

- 不可变：briefVersions（含变更原因与是否公开）、constraintSets（含原因类别与引用）、proposals、decisions、executions、commitments、events。
- 回答"v4 为什么出现"：`constraintSets[v4].cause` → finance briefVersion v2 → `changeReason`（只有 finance 本人可见，除非公开）→ 事件 seq。回答"为什么 v2 不能执行"：用 v4 的输入重算 v2 的检查。两者都不需要任何可变状态。

## 10. 测试映射

回合中降预算的迟到结果、改截止日使审批失效、改价引起 SOURCE_MISMATCH、低于已承诺被拒、边界等于余量通过、无可行解生成 tradeoff 组、并行请求中第一个回答取消其余、上调不自动重谈——全部列入 16 §3 与 §5。
