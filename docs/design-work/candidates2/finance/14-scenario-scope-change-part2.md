# 14 首个场景（part2：fixture 模块与预算下调完整走查）

## 7. fixture 模块形状

```ts
// convex/scenarios/scopeChange/fixtures.ts —— 唯一定义处
export const baseline = {
  key: "baseline", simulated: true, asOfDate: "2026-11-02", timeZone: "America/Los_Angeles",
  budget: { initialLimitCents: 500_000, openingBalanceCents: 400_000,
            openingNote: "Signed SOW #1 (simulated)" },
  catalog: [
    { itemKey: "LOGIN",   kind: "scope", title: "Login revamp",   priceCents: 45_000, leadTimeDays: 10, rushLeadTimeDays: 5, taskTitle: "Implement login revamp" },
    { itemKey: "REPORTS", kind: "scope", title: "Reports module", priceCents: 35_000, leadTimeDays: 8,  rushLeadTimeDays: 4, taskTitle: "Build reports module" },
    { itemKey: "EXPORT",  kind: "scope", title: "CSV/PDF export", priceCents: 50_000, leadTimeDays: 12, rushLeadTimeDays: 6, taskTitle: "Build export pipeline" },
    { itemKey: "RUSH",    kind: "rush_fee", title: "Rush delivery fee", priceCents: 10_000 },
  ],
  briefs: {
    customer: { kind: "customer", requiredItemKeys: ["LOGIN"], wantedItemKeys: ["REPORTS", "EXPORT"],
      deferrableItemKeys: ["EXPORT"], preferredDate: "2026-11-09", deadline: "2026-11-16",
      privateNotes: "CANARY-CUS-5512 board demo on the 9th",
      shareableFields: ["requiredItemKeys", "wantedItemKeys", "deferrableItemKeys", "deadline"] },
    provider: { kind: "provider", privateNotes: "CANARY-PRO-2290 prefer larger scope", shareableFields: [] },
    finance:  { kind: "finance",  privateNotes: "CANARY-FIN-7731 keep Q4 reserve", shareableFields: [] },
  },
  twist: { newLimitCents: 480_000, reasonCode: "decrease", note: "Q4 budget cut (simulated)" },
} as const;
```

seed（`internal.seed.demoRoom`）通过与产品相同的内部 helper 写入（setLimit、recordOpeningBalance、saveItem、confirmBrief），因此约束版本、台账、事件与真实路径一致，只是 `simulated: true`。

## 8. 走查：可行协商 → 降预算 → 重谈 → 执行（stub 模式，确定性）

约束版本：seed 依次 bump——上限 cv1、期初 cv2、四个目录条目 cv3–cv6、三份简报 cv7–cv9。房间 active 于 **cv9**。

| # | 谁 / 函数 | 读写 | 结果与账务状态 |
| --- | --- | --- | --- |
| 1 | customer `runs.start` | 守卫 setup→active；`startRunInternal(initial)`；startTurn(provider, propose) | run#1 negotiating；limit $5,000，committed $4,000，headroom $1,000 |
| 2 | provider 回合 1 | 候选（公开可行，未按预算过滤）c1 L+R+E rush $1,400 … ；stub 选 c1 | 规则闸门 OVER_BUDGET（4,000+1,400 > 5,000）→ rule 回合，provider 看到 `FINANCE_LIMIT`；floor = $1,400 |
| 3 | provider 回合 2 | 候选去掉 ≥ $1,400；stub 选 L+R+E std $1,300 | OVER_BUDGET → floor $1,300 |
| 4 | provider 回合 3 | 去掉 ≥ $1,300；首选 L+R rush $900 | 闸门通过 → `insertProposal` **v1**（itemKeys [LOGIN, REPORTS]，deferred [EXPORT]，$900，11-07，createdUnder cv9）；并行调度 customer、finance 评估 |
| 5 | customer、finance 评估 | 两个 completeTurn 写 run（OCC 串行） | 都 recommend_accept → run pending_approval。买方看到 "+$900 change / $4,900 committed after approval / $5,000 limit / $100 headroom after"；provider 看到 "+$900" |
| 6 | customer `decisions.approve(v1)` | decision seq1 approve cv9 | recorded，缺 provider、finance |
| 7 | provider `decisions.approve(v1)` | decision approve cv9 | recorded，缺 finance |
| 8 | finance `budget.setLimit(480_000, decrease, "Q4 budget cut", expectedRevision 1)` | 4,800 ≥ committed 4,000 ✓；revision 2；**cv10**；C1 无请求；C2 run#1 → superseded；C3 v1 校验 OVER_BUDGET（4,000+900 > 4,800）；C4b 枚举非空 → run#2 negotiating | 同一推送：v1 显示 Blocked（买方 "over limit by $100"，provider "exceeds the finance limit"），customer/provider 的签字显示 Stale (cv10)。headroom $800 |
| 9 | provider 回合（run#2） | stub 依次选 $1,400、$1,300、$900，均 FINANCE_LIMIT；floor $900；再选 L+R std $800 | 闸门通过（4,000+800 = 4,800 ≤ 4,800，**边界用 ≤**）→ **v2**（[LOGIN, REPORTS]，$800，11-12，standard，createdUnder cv10）；v1 → superseded |
| 10 | customer、finance 评估 | customer 完整可行集首位就是 v2 的候选 | 都 recommend_accept → pending_approval |
| 11 | customer、provider approve(v2) | cv10 | recorded |
| 12 | finance approve(v2)（budget 签字） | 步 1–8 通过；`executeProposal`：operationKey `exec:{v2}:cv10`；budgets.nextCommitmentSeq 2→3；**cv11**；commitment seq2 $800；tasks ×2；v2 executed；run#2 confirmed | CO-1；committed $4,800，headroom $0；`budget.reconcile` ok |

模型调用：run#1 = 3（provider）+ 2（评估）= 5；run#2 = 4 + 2 = 6；均 ≤ maxModelCalls 12。

### 8.1 台账快照（finance 的 Ledger 页）

| 时点 | limit (rev) | commitments | committed | headroom | cv |
| --- | --- | --- | --- | --- | --- |
| seed 后 | $5,000 (1) | #1 opening $4,000 (simulated) | $4,000 | $1,000 | 9 |
| 降预算后 | $4,800 (2) | 同上 | $4,000 | $800 | 10 |
| 执行后 | $4,800 (2) | + #2 change_order $800 → CO-1 → v2 → 3 个签字@cv10 | $4,800 | $0 | 11 |

### 8.2 关键反例（同一 fixture）

| 操作 | 结果 |
| --- | --- |
| 第 8 步后 finance 仍点 v1 的 "Approve budget commitment" | `RUN_NOT_PENDING`（run#1 已 superseded）；无写入 |
| 第 12 步后 finance 把上限改为 $4,700 | `BUDGET_BELOW_COMMITTED`（committed $4,800）；无写入 |
| 第 12 步并发 10 次 approve | 1 张变更单、1 条承诺；其余返回 `{status: "executed", changeOrderId}` |
| 第 4 步若模型（真实模式）返回 `{"message":{"action":"propose","candidateKey":"c99"}}` | invalid_output，自动重试 1 次 |
| 第 4 步若模型返回额外字段 `amountCents: 1` | strictObject 拒绝 → invalid_output；金额无论如何来自目录 |

## 9. 走查：不可行（fixture `infeasible`）

1. 第 8 步改为 `setLimit(440_000)`：4,400 ≥ 4,000 ✓，cv10，v1 blocked。
2. C3/C4：完整枚举为空（最便宜 L std $450 > 余量 $400）→ run#2 needs_input，**不调模型**。
3. `remedies`：finance `raise_limit{toLimitCents: 445_000}`（4,000 + 450）与 `close_without_change`；customer 无可单独恢复的选项（LOGIN 是必需项，延后后为空集），只看到 "Waiting on finance to decide."
4. finance 选 raise_limit → `requests.answer` 内调用 setLimit 路径（reasonCode `tradeoff_answer`，note 取请求问题键）→ cv11 → C4b → run#3：provider 最终得到 L std $450（= 余量，边界）→ 签字 → 执行后 committed $4,450，headroom $0。

## 10. 走查：需要取舍（fixture `tradeoff`）

降到 $4,800 后 v2 = L+R std $800（11-12），customer 代理（策略 date_first，私密 preferredDate 11-09）`reject DATE_UNACCEPTABLE`；provider 下一轮提出 L rush $550（11-07），customer 接受但 finance 代理 counter 回 L+R std（保留更多范围性价比）……轮次用尽 → `choose_option` 请求给 customer：c1 "LOGIN + REPORTS, standard, 2026-11-12, $800"、c2 "LOGIN, rush, 2026-11-07, $550"。customer 的选择落为 `human_choice` 提案，仍需三方签字。
