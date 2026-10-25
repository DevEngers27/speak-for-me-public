# 14 首个场景（part3）：预算下调完整走查与其他路径

> 分片清单见 part1。以 stub 模式（确定性）展示；live 模式下代理的具体选择和轮数可能不同，但每一步的守卫、写入与可见性完全相同。种子日 D0 = 2026-11-02。

## 14.9 主线：$5,000 → $4,800，重谈成功（变体 A）

准备阶段结束时 `constraintsVersion = 7`（四个目录条目、customer 与 finance 的首次确认、基线各递增一次；provider 简报只有软字段，不递增）。

| 步 | 谁 → 函数 | 关键读写 | 结果与各方所见 |
| --- | --- | --- | --- |
| 1 | customer → `runs.start({expectedConstraintsVersion: 7})` | `startRunTx`：`loadRuleInput(v7)` → 候选（公开排序）：① `LOGIN+REPORTS@standard` $800 / 11-20；② `LOGIN+REPORTS@rush` $900 / 11-13；③ `LOGIN@standard` $450；④ `LOGIN@rush` $550（含 EXPORT 的组合全部晚于截止日被排除）；插入 run#1（cv 7）、provider 的 propose turn、attempt + watchdog | 全体："Negotiation started (run 1)"；run 面板 "Provider agent drafting…" |
| 2 | 调度器 → provider propose 回合 | claim → stub 选排序第一 → record → apply：插入提案 **v1**（`LOGIN+REPORTS@standard`，$800，EXPORT 延后）；customer、finance 的 review turn 并行调度 | 全体："Provider agent proposed v1: SSO login migration, Monthly usage reports, standard delivery 2026-11-20, $800. Deferred: CSV and Excel data export." |
| 3 | 两个评审回合（并行） | customer 评分：v1 = 2（含重要项 REPORTS），`LOGIN+REPORTS@rush` = 3（另满足首选日）→ `counter`，理由 `prefers_earlier_date`；finance → `recommend_accept`；最后一个 apply 调 `concludeRound` → C3 → round 2 | 全体："Customer agent prefers SSO login migration + Monthly usage reports (rush, 2026-11-13, $900): earlier delivery." 与 "Finance agent recommends accepting v1 (advisory only)." customer 本人另见本方理由 |
| 4 | provider propose（round 2） | stub 选得到支持最多的 counter → 提案 **v2**（`LOGIN+REPORTS@rush`，$900）；评审：第 2 轮 → 均 `recommend_accept` → C2 → run#1 awaiting_approval（converged） | 买方："+$900 change · $4,900 committed after approval · cap $5,000 · within budget"；provider："+$900 · Within the finance limit" |
| 5 | customer、provider → `decisions.decide(approve, expectedConstraintsVersion: 7, expectedTermsKey)` | 两条 decisions（terms，cv 7）；`executeIfReady` E1 未齐（缺 finance/budget） | 审批面板：customer ✔、provider ✔、finance pending |
| 6 | finance → 预算面板预览（只给 finance："v2 would be over the cap by $100; 2 approvals will need to be redone; 3 options remain"）→ `briefs.confirm({budgetCapCents: 480000, changeNote: "Q4 budget revision"})` | finance 简报 v2；ruleKey 变 → `bumpConstraints` → **cv 8**；run#1 superseded；评估 v2 @ cv8：`budget.over_cap`（over by $100）→ 不可执行；候选 @ cv8：`LOGIN+REPORTS@standard` $800（4,800 ≤ 4,800，边界通过）、`LOGIN@standard`、`LOGIN@rush` → run#2（trigger constraints_changed）running，第一个 attempt 延迟 3 s | **同一次推送**：v2 Blocked；customer 与 provider 的审批变为 stale（"You approved v2 under constraints v7; constraints are now v8"）；买方："over by $100"；provider："Blocked: exceeds the finance limit"；全体事件 "Finance updated a constraint (v7 → v8)."；finance 与 customer 另见 "Budget cap changed from $5,000 to $4,800. Reason: Q4 budget revision" |
| 7 | provider propose（run#2 round 1） | 提案 **v3**（`LOGIN+REPORTS@standard`，$800） | 全体："Provider agent proposed v3: …, standard delivery 2026-11-20, $800. Deferred: CSV and Excel data export." |
| 8 | 评审 | customer 评分：v3 = 2，`LOGIN@rush` = 1，`LOGIN@standard` = 0 → `recommend_accept`；finance → `recommend_accept` → run#2 awaiting_approval | 买方："+$800 · $4,800 committed after approval · cap $4,800 · within budget"；provider："+$800 · Within the finance limit" |
| 9 | provider、customer 接受条款；finance → `decide(approve)` | 第三条决定触发 `executeIfReady`：E1 齐（三个不同 userId）；E2 台账汇总 $4,000 = 快照；E3 `exec:<v3>:8` 未用；E5 插入 execution、变更单（批准 LOGIN、REPORTS；延后 EXPORT；标准 2026-11-20；$800；执行前 $4,000 → 后 $4,800；上限 $4,800）、承诺 $800、任务 2 条（provider，截止 11-20）；run#2 executed；`bumpConstraints(execution_recorded)` → cv 9（无活跃 run，不重谈） | 全体："Change order recorded for v3: $800, 2 task(s). Internal record only."；结果页显示变更单；买方另见预算影响快照 |
| 10 | finance 重复点击 approve | 第 4 步：已执行且本人最新决定为 approve → 返回已有 execution | 无新行、无新事件；ops 计数 +1 |

调用次数：run#1 = 2 次提议 + 4 次评审，run#2 = 1 + 2，共 9 次模型调用（stub 模式为 9 次 stub 计算）。约束版本 7 → 8 → 9；提案 v1、v2、v3 与全部决定原样保留，任何时刻都可以用 `loadRuleInput(v7)` / `(v8)` 复现当时的评估。

## 14.10 其他路径

**变体 B：无可行方案（上限降到 $4,400）**。第 6 步改为 cap 440,000：v2 被阻断；候选为空（余量 $400 < LOGIN 的 $450）→ run#2 直接 waiting_human（`no_feasible`），**不调模型**。规划器（14.7）：finance ← `q.budget_shortfall`（"A cap of at least $4,450 would allow the cheapest option that keeps required scope"，只给 finance）；provider ← `q.cheaper_quote`（"No option fits the buyer's limit. Can you offer a cheaper quote for SSO login migration?"，无数值）；customer ← `q.relax_required{LOGIN}`（customer 在预算受众内，可附 "REPORTS alone would fit"）。
- 若 provider 确认 LOGIN v2 = $380 → `catalog_changed` → cv 9 → run#2 superseded、其余请求 superseded → run#3 候选只剩 `LOGIN@standard` $380 → 协商 → 审批 → 执行。
- 若三方都选 decline → `negotiation_blocked`："No agreement is possible under the current constraints…"，run 停在 waiting_human；系统不伪造一致（AC-S2、AC-07）。

**变体 C：上限低于已承诺（$3,900）**。finance 确认前看到警告；之后 run → waiting_human，只有 finance 收到 `q.budget_below_committed`（minCap $4,450）；他方只见 "Negotiation needs input from Finance." 与 "Blocked: the finance limit does not allow new commitments."。

**拒绝路径**。第 5 步改为 finance 拒绝 v2（`price_too_high`，备注私密）：run#1 superseded；run#2（trigger rejection）的候选排除 `LOGIN+REPORTS@rush`；provider 代理在历史中看到 "Finance rejected v2: the price is too high" → 提出 `LOGIN+REPORTS@standard` → …

**代理故障路径**。run#2 的提议回合连续 3 次 overloaded（F07）→ turn failed `RETRY_EXHAUSTED` → run#2 failed。全体看到 "Provider agent is unavailable (retried 3 times)"；任一参与者可点 "Retry"（`runs.resume`，≤ 2 次），provider 本人可点 "Choose an option manually" → 从候选列表选 `LOGIN+REPORTS@standard` → 提案 v3 `authorKind: human` → run#2 awaiting_approval → 审批与执行完全同主线（R9）。

**截止日变化路径（RG-02）**。customer 把截止日提前到 D0+11 并确认：cv +1；任何标准交付的提案报 `date.after_deadline`；provider 只见 "Blocked: conflicts with a customer constraint"；新候选只剩加急方案。

**边界**：变体 E（cap $4,799）在第 6 步后 `LOGIN+REPORTS@standard` 不可行，候选只剩两个只含 LOGIN 的方案——customer 代理会在"首选日期"与"成本"之间取舍；这是 RG-14 边界用例的对照组。
