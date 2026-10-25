# 14 首个场景（part2）：公共文本模板、取舍请求规划、fixture 规格

> 分片清单见 part1。

## 14.6 公共文本模板（英文，按查看者能力选择）

能力由投影给出：`B` = 在预算受众内（finance、默认 customer）；`D` = 能看到 customer 截止日；`R` = 本角色（私密理由）。`{amount}` 等由 `formatCents` / `formatDate` 渲染。

| 键 | 条件 | 模板 |
| --- | --- | --- |
| `proposal.summary` | 全体 | `{author} proposed v{version}: {itemTitles}, {mode} delivery {date}, {amount}.{deferred? " Deferred: " + deferredTitles + "."}` |
| `proposal.author` | — | agent：`Provider agent`（stub 加 `(simulated)`）；human：`Provider (manual)`；fixture：`Seeded fixture (simulated)` |
| `check.budget` | B | `+{amount} change · {after} committed after approval · cap {cap} · {ok ? "within budget" : "over by " + overBy}` |
| `check.budget` | 非 B | `+{amount} · {ok ? "Within the finance limit" : "Blocked: exceeds the finance limit"}` |
| `check.budget.below` | B | `Budget cap {cap} is below committed spend {before}. No change can be approved.` |
| `check.budget.below` | 非 B | `Blocked: the finance limit does not allow new commitments.` |
| `check.deadline` | D | `Delivery {date} is after the customer deadline {deadline}.` |
| `check.deadline` | 非 D | `Blocked: conflicts with a customer constraint.` |
| `check.required` | 必需项受众内 | `Missing required item(s): {titles}.` ；否则 `Blocked: missing scope the customer requires.` |
| `check.sources` | 全体 | `The quote for {title} changed after this proposal (now v{n}).` / `{title} was withdrawn by the provider.` |
| `check.header` | 全体 | `Checked against constraints v{cv} on {today}.` |
| `event.constraints_changed` | 全体 | `{Role} updated a constraint (v{prev} → v{cv}).` |
| `event.budget_cap_changed` | B | `Budget cap changed from {old} to {new}. Reason: {reason}` |
| `event.reapproval_required` | 全体 | `Terms of v{n} are unchanged, but constraints changed to v{cv}. Everyone needs to approve again.` |
| `event.agent_verdict` | 全体 | `{Role} agent recommends accepting v{n} (advisory only).` / `{Role} agent prefers {candidateLabel}: {reasonText}.` / `{Role} agent cannot recommend v{n}: {reasonText}.` / `{Role} agent gave no recommendation (agent unavailable).` |
| `event.decision_recorded` | 全体 | `{Role} accepted the terms of v{n}` / `approved the budget commitment for v{n}` / `rejected v{n} ({reasonText})` / `withdrew their decision on v{n}` + ` under constraints v{cv}.` |
| `event.execution_completed` | 全体 | `Change order recorded for v{n}: {amount}, {taskCount} task(s). Internal record only.` |
| `event.run_waiting_human` | 全体 | `Negotiation needs input from {roles}.` |
| `event.negotiation_blocked` | 全体 | `No agreement is possible under the current constraints. Everyone asked has declined to change them.` |
| `turn.rationale` | R | `Your agent's note: {rationale}` |

`reasonText`：`prefers_more_scope` → "keeps more of the requested scope"；`prefers_earlier_date` → "earlier delivery"；`prefers_lower_cost` → "lower cost"；`prefers_standard_delivery` → "standard delivery"；`scope_insufficient` → "the scope is not enough"；`date_unacceptable` → "the delivery date does not work"；`cost_unacceptable` → "the cost is too high"；人工理由码同理。`candidateLabel` = `{itemTitles} ({mode}, {date}, {amount})`，只用公开字段。

## 14.7 取舍请求规划 `planHumanRequests`

```text
planHumanRequests(reason, input, run):
  case "clarify":         一个请求，来自问题目录（05 §5.7）
  case "agent_declined":  provider ← q.agent_declined   options: propose_manually, edit_catalog, decline
  case "blocked":         provider ← q.rejection_loop   options: propose_manually, edit_catalog, decline
                          最近一次拒绝者 ← q.no_option   options: edit_brief, decline
  case "no_feasible":
    C = committedCents, cap = finance.budgetCapCents
    if cap < C:  return [ finance ← q.budget_below_committed { minCapCents: C + minAmount(放宽预算) } : edit_budget, decline ]
    Rb = enumerate(input, 关闭 budget.cap)            → 有解：minAmount = 最便宜候选金额
    Rd = enumerate(input, 关闭 date.deadline)         → 有解：earliestDate = 最早交付日
    Rk = { k ∈ required : enumerate(input, 把 k 视为非必需) 有解 }
    drafts = []
    if Rb 非空:  finance  ← q.budget_shortfall { minCapCents: C + minAmount } : edit_budget, decline
                provider ← q.cheaper_quote { itemKeys: required }（不含任何金额） : edit_catalog, decline
    if Rd 非空:  customer ← q.deadline_conflict { earliestFeasibleDate }（customer 本人可见） : edit_brief, decline
                provider ← q.earlier_delivery { itemKeys }（不含截止日） : edit_catalog, decline
    for k in Rk: customer ← q.relax_required { itemKey: k } : edit_brief, decline
    if drafts 为空（没有单一放宽能解决）: 三方各 ← q.no_option : 各自的 edit_*, decline
    按目标角色合并（每角色一个请求，多个选项），并经 assertRequestDrafts（05 §5.8）检查参数受众
```

关键的隐私约束：给 provider 的请求只说明"预算 / 日期是阻断原因"，不带上限、余量、截止日；给 customer 的请求只在 customer 处于预算受众内时附带金额。`minCapCents` 只给 finance。

## 14.8 fixture 规格

`fixtures.ts` 导出 `FixtureSpec`（与 Next、Convex、测试共同导入；测试里的数字从这里推出，不另写一份，F14.2）：

```ts
export const scopeChangeStandard: FixtureSpec = {
  key: "scope_change.standard.v1",
  room: { title: "Analytics portal change request", goal: "Add SSO login and reporting before the Q4 board review",
          timeZone: "America/Los_Angeles" },
  relativeTo: "seedDate",                 // 所有日期 = 种子日 + 偏移（天）
  catalog: [
    { itemKey: "LOGIN",   title: "SSO login migration",       priceCents: 45_000, standard: 18, rush: 11 },
    { itemKey: "REPORTS", title: "Monthly usage reports",     priceCents: 35_000, standard: 18, rush: 11 },
    { itemKey: "EXPORT",  title: "CSV and Excel data export", priceCents: 50_000, standard: 32, rush: 25 },
    { termKey: "RUSH", title: "Expedited delivery", feeCents: 10_000 },
  ],
  briefs: {
    customer: { requestedItems: ["LOGIN", "REPORTS", "EXPORT"], requiredItemKeys: ["LOGIN"],
                importantItemKeys: ["REPORTS"], deadline: 18, preferredDate: 11,
                disclosures: { requiredItemKeys: "room", importantItemKeys: "private", deadline: "private", preferredDate: "private" },
                privateNotes: "Board demo on day 12; reports would help. CANARY-CUS-4417" },
    provider: { preferredDeliveryMode: "either", disclosures: { preferredDeliveryMode: "private" },
                privateNotes: "Team can deliver at most two items by day 18. CANARY-PRO-2290" },
    finance:  { budgetCapCents: 500_000, disclosures: { budgetCapCents: ["customer"] },
                privateNotes: "Q4 budget is under review. CANARY-FIN-7731" },
  },
  baselineCommitmentCents: 400_000,        // 一条 simulated baseline
  variants: {
    A_renegotiate:   { capChangeTo: 480_000, reason: "Q4 budget revision" },   // 主线：重谈成功（$800 恰好等于余量）
    B_infeasible:    { capChangeTo: 440_000, reason: "Q4 budget revision" },   // 余量 $400 < LOGIN $450 → 问人
    C_belowCommitted:{ capChangeTo: 390_000, reason: "Spending freeze" },      // 低于已承诺 → 只问 finance
    D_reportsRequired:{ briefs: { customer: { requiredItemKeys: ["LOGIN", "REPORTS"], importantItemKeys: [] } } },  // 降到 $4,800 后只剩一个候选
    E_offByOne:      { capChangeTo: 479_900 },                                 // $799 余量：LOGIN+REPORTS 标准不可行
  },
};
```

- 种子函数（15 §15.6）**走与生产相同的写入路径**：建房 → 写参与者（已知账号）→ 确认目录 → 确认三份简报 → 记录基线，每一步都调用同一组内部 helper 并逐次递增约束版本（RA-F03 修正三、Q11 的决定：不直接写入"已有审批"等中间状态）。
- 私密备注里的金丝雀串用于隐私测试（16 PV-*），出现在 fixture 而不是测试代码里，保证演示房间也能被扫描。
- 与 Role A fixture 的差异：REPORTS 由"必需"改为"重要（软）"，以产生真实的取舍分支；变体 D 保留"两项都必需"的原设定（ADR-24）。
