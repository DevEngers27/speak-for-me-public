# 14 首个场景：软件服务范围变更（`scenarioKey: "scope_change"`）

> 全部数字只在 `convex/scenarios/scopeChange/fixtures.ts` 定义一次；测试从 fixture 推出数字，不另写。fixture 数据一律 `simulated: true`，界面标 "Simulated quote / Simulated budget"。日期相对 seed 当天 D 计算，下文以 D = 2026-11-02 举例。

## 1. 角色与流程配置

| 项 | 值 |
| --- | --- |
| roles | customer、provider、finance |
| proposerRole | provider |
| evaluatorRoles（顺序） | customer → finance |
| approverRoles | customer（"Accept terms"）、provider（"Accept terms"）、finance（"Approve budget commitment"） |
| tieBreakerRole | customer |
| maxRounds | 3 |
| rejectCodes | `WANTS_MORE_SCOPE`、`DATE_TOO_LATE`、`PRICE_TOO_HIGH` |
| changeCodes | `INITIAL`、`BUDGET_REVISED`、`EXTERNAL_SPEND`、`SCOPE_PRIORITY_CHANGED`、`DEADLINE_CHANGED`、`QUOTE_REVISED`、`NOTES_UPDATED` |

## 2. 报价目录（provider 简报 v1，simulated）

| itemKey | title | priceCents | earliestDeliveryDate | taskTitle |
| --- | --- | --- | --- | --- |
| `LOGIN` | SSO login rework | 50000 | D+10（2026-11-12） | Implement SSO login rework |
| `REPORTS` | Usage reports dashboard | 40000 | D+12（2026-11-14） | Build usage reports dashboard |
| `EXPORT` | CSV/PDF export | 50000 | D+15（2026-11-17） | Add CSV/PDF export |

provider 私密：`preferredItemKeys: ["EXPORT"]`，notes "Prefer bundling export; team free mid-November."

全量 LOGIN+REPORTS+EXPORT = $1,400；一期 LOGIN+REPORTS = $900（与原 README 数字一致）。

## 3. 约束字段

| 角色 | 字段 | fixture 值 | 类别 / 受众 |
| --- | --- | --- | --- |
| customer | requiredItemKeys | `["LOGIN"]` | disclosable → provider、finance（fixture 勾选） |
| customer | wantedItemKeys | `["REPORTS","EXPORT"]` | disclosable → provider、finance（勾选） |
| customer | deadline | D+21（2026-11-23） | disclosable（勾选） |
| customer | preferredDate | D+14（2026-11-16） | private |
| finance | totalBudgetCents | 500000 | disclosable → customer（勾选） |
| finance | priorCommittedCents | 400000（simulated baseline） | disclosable → customer（勾选） |

## 4. 规则（06 §2 的具体化）

- 金额 = 目录价格之和；交付日 = 所选条目最早日期的最大值；`deferred = (required ∪ wanted) − itemKeys`。
- 硬约束：`required ⊆ itemKeys`；`deliveryDate ≤ deadline`；`deliveryDate ≥ today`；`prior + Σ已执行 + amount ≤ total`（等于通过）。
- 评估方 stub 规则与真实代理的指导一致：在本方可见约束下，若存在 wanted 覆盖更多的合格组合则 `WANTS_MORE_SCOPE`，否则建议接受。

## 5. 公开文本模板（场景实现 05 §6 的键）

- `proposal.created`："Provider agent proposes LOGIN + REPORTS for $900, delivery 2026-11-14; EXPORT deferred."
- `proposal.blocked`（全员）："Blocked: exceeds the finance limit"；（customer/finance，可见预算时）"+$900 change · $4,900 committed after approval · $4,800 cap · over by $100"
- `brief.confirmed`："Finance updated constraints (budget revised). Constraints are now v4."
- `request.waiting`："Waiting on a decision from finance and customer."
- 请求问题（仅 targetRole）：finance "No option fits the current cap. Raise the cap by $100 to $4,900?"；customer "No option fits. Allow REPORTS to be delivered in a later change?"

## 6. 主线完整走查（含预算下调）

| # | 动作 | 结果（cv = constraintsVersion） |
| --- | --- | --- |
| 1 | `seed.scopeChangeRoom` 建房、三份简报 v1（simulated）、三个席位邀请 | cv 3；run#1 自动开始（briefs_ready）。系统可行性：headroom $1,000，合格 {L} $500、{L,R} $900、{L,E} $1,000 → 非空 |
| 2 | 回合 r1·provider（候选按 provider 视角：{L,R,E}、{L,R}、{L,E}、{L}） | propose LOGIN+REPORTS+EXPORT → **v1** $1,400，2026-11-17，`OVER_BUDGET`。全员见 "Blocked: exceeds the finance limit"；买方另见 "over by $400"。round → 2 |
| 3 | r2·provider（上下文含 v1 的公开 reasonCode） | propose LOGIN+REPORTS → **v2** $900，2026-11-14，EXPORT deferred，校验通过 |
| 4 | r2·customer | 本方可见约束下 {L,E} 与 {L,R} wanted 覆盖相同 → recommend_accept（不是批准） |
| 5 | r2·finance | recommend_accept → run#1 `pending_approval` |
| 6 | customer、provider 各点 "Accept terms" v2 | 2 条 approve；waitingOn [finance] |
| 7 | **finance 确认简报 v2：total 480000，reason "Q4 budget revision"，changeCode BUDGET_REVISED** | cv 4；run#1 superseded；v2 不可执行（版本不匹配 + OVER_BUDGET $100）；两条审批 invalidated；run#2 开始。系统可行性：headroom $800 → 只有 {L} $500 |
| 8 | 提交瞬间三窗口 | provider："v2 superseded · Constraints changed (budget revised) · +$900 · Blocked: exceeds the finance limit"；买方："+$900 / $4,900 after approval / $4,800 cap / over by $100" |
| 9 | run#2 r1·provider（上下文：v2 在当前约束下 `OVER_BUDGET`） | propose LOGIN → **v3** $500，2026-11-12，REPORTS、EXPORT deferred，通过 |
| 10 | r1·customer → recommend_accept（可见预算下没有覆盖更多的合格组合）；r1·finance → recommend_accept | run#2 `pending_approval` |
| 11 | 三方批准 v3（finance 最后） | 同一事务：changeOrder{v3, cv4, $500, commitment{before 400000, after 450000, total 480000}}、task "Implement SSO login rework" due 2026-11-12；run#2 executed |
| 12 | finance 双击/重放 | `already_executed`，同一 changeOrderId，无新行 |

## 7. 变体（每个都是回归用例）

| 变体 | 设定 | 期望 |
| --- | --- | --- |
| 边界通过 | run#1 中 provider 提 {L,E} $1,000（= headroom） | 通过（≤） |
| 需要取舍（不可行） | customer required = [LOGIN, REPORTS]；步骤 7 后 | {L,R} $900 > $800 → run#2 直接 needs_input（不调模型）；finance 请求 "Raise cap by $100 to $4,900"（patch total 490000）；customer 请求 "Allow REPORTS to be deferred"。finance 先答 → cv 5，run#3；provider 提 {L,R} $900 → 4000+900 = 4900 ≤ 4900 通过（边界） |
| 真正无解值 | total 445000（headroom $450 < LOGIN $500） | needs_input；finance "Raise cap by $50 to $4,500"；customer "Allow LOGIN to be deferred"（移出后 {R} $400 合格） |
| 低于已承诺 | finance 提交 total 390000 | 写入被拒 `BUDGET_BELOW_COMMITTED`，cv 不变 |
| 截止日冲突 | customer deadline 改为 D+11 | 含 REPORTS/EXPORT 的组合都 `DELIVERY_AFTER_DEADLINE`；provider 提 {L} |
| 改价 | provider v2 把 REPORTS 改为 45000 | cv +1；旧提案即使"重放"也 `SOURCE_MISMATCH` |
| 轮次用尽 | 评估方连续 3 轮 reject | needs_input；customer 收到 `select_proposal` 选项（本 run 中通过校验的提案） |
| 代理澄清 | customer 代理 clarify "Is EXPORT needed this quarter?" | needs_input；只有 customer 看到原文；选项 continue 或去改简报 |
| RA-B01 回归 | cap 4800、已承诺 4000，provider 目录加 {ARCHIVE $700, D+40} | 提 {ARCHIVE} → `MISSING_REQUIRED_ITEM` + `DELIVERY_AFTER_DEADLINE`，不可批准 |

## 8. 场景插件文件

```text
convex/scenarios/scopeChange/
  index.ts         // 导出 ScenarioPlugin 实例
  validators.ts    // 03 part2 §1 的 v 定义
  rules.ts         // computeTerms / validateProposal / enumerateFeasible / buildRequests / deriveTasks / budgetFigures
  disclosure.ts    // 07 §3 的声明
  templates.ts     // 公开文本
  prompts.ts       // system 与各角色固定指令（英文）
  fixtures.ts      // feasible / renegotiate / infeasible 三套，含相对日期
```

## 9. 场景层面的限制（如实写进产品）

- 交付日不可协商（由条目决定）；加急费、分期付款、付款条件是 17 号扩展。
- 一房一预算；`priorCommittedCents` 由 finance 手工维护，不连接真实财务系统。
- 首个场景假定组织形态："外包工作室 + 有独立预算负责人的中型客户"（假设，F01.4）。
