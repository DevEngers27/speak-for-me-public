# 14 首个场景：软件服务范围变更（事件溯源候选）· part1：目录、约束、规则、模板、fixture

> 分两片：part1（本文件）；`14-scenario-scope-change-part2.md` 完整走查（含预算下调），以事件序列写出。
> 全部数字为 **Simulated example**：seed 产生的事件 `simulated: true`，界面显示徽章。数字只在 `convex/scenarios/scopeChange/fixtures.ts` 定义一次，测试从这里导入。

## 1. 决定

| # | 决定 | 理由 |
| --- | --- | --- |
| SC-1 | 采用"带加急费行项目"的目录（审查候选 1） | 唯一能同时复现 README 的 $1,400 全量 / $900 一期 / $4,900 承诺，并在降到 $4,800 后给出真实取舍（日期 vs 范围）的目录 |
| SC-2 | 必需/期望/可延后放在 customer 简报，目录只描述供给 | 必需与否是客户的判断（F02.1 整理者注） |
| SC-3 | 加急是 term（`RUSH`，$100 固定），不是条目 | 金额来自已确认报价的条款，代码按交付方式加入 |
| SC-4 | 降到 $4,800 后主线落在"恰好等于余量"的 $800 | 保持 README 数字；该边界同时是必测用例（≤ 通过） |

## 2. 目录（provider 确认的报价）

| itemKey | title | priceCents | standardLeadDays | rushLeadDays | taskTemplates |
| --- | --- | --- | --- | --- | --- |
| `LOGIN_SSO` | SSO login rework | 45000 | 18 | 11 | "Implement SSO login", "SSO regression tests" |
| `USAGE_REPORTS` | Usage reports | 35000 | 18 | 11 | "Build usage reports" |
| `CSV_EXPORT` | CSV export | 50000 | 21 | 11 | "Build CSV export" |
| term `RUSH` | Rush delivery fee | +10000（方案选择 rush 交付时，按方案收一次） | — | — | — |

交付日 = `today + max(所选条目的 leadDays)`（日历日，房间时区 `America/Los_Angeles`）。fixture `today = 2026-11-02`。

## 3. 约束（各方简报 + 预算）

| 来源 | 字段 | 值 | 硬/软 | 默认共享 |
| --- | --- | --- | --- | --- |
| customer | requiredItemKeys | [LOGIN_SSO] | 硬 | ✓ |
| customer | desiredItemKeys | [USAGE_REPORTS] | 硬（影响排序与 deferred） | ✓ |
| customer | deferrableItemKeys | [CSV_EXPORT] | 硬 | ✓ |
| customer | deadline | 2026-11-27 | 硬 | ✓ |
| customer | preferredDate | 2026-11-13 | 软，私密 | ✗ |
| provider | earliestStartDate | 2026-11-02 | 硬 | ✓ |
| finance | budget.totalCents | 500000 | 硬（budget.update） | 仅买方 |
| system | baseline commitment | 400000（"Existing SOW"，simulated） | 台账 | 仅买方 |

## 4. 候选表（today = 2026-11-02）

| candidateId | 金额 | 交付日 | 满足必需 | 预算 $5,000 时（余量 100000） | 预算 $4,800 时（余量 80000） |
| --- | --- | --- | --- | --- | --- |
| C-LOGIN_SSO+USAGE_REPORTS+CSV_EXPORT-rush | 140000 | 11-13 | ✓ | ✗ OVER_BUDGET | ✗ |
| C-LOGIN_SSO+USAGE_REPORTS+CSV_EXPORT-standard | 130000 | 11-23 | ✓ | ✗ | ✗ |
| C-LOGIN_SSO+USAGE_REPORTS-rush | 90000 | 11-13 | ✓ | ✓（主线一期） | ✗（超 10000） |
| C-LOGIN_SSO+USAGE_REPORTS-standard | 80000 | 11-20 | ✓ | ✓ | ✓（恰好等于余量） |
| C-LOGIN_SSO+CSV_EXPORT-standard | 95000 | 11-23 | ✓ | ✓ | ✗ |
| C-LOGIN_SSO-rush | 55000 | 11-13 | ✓ | ✓ | ✓（缺 desired） |
| C-LOGIN_SSO-standard | 45000 | 11-20 | ✓ | ✓ | ✓ |
| 不含 LOGIN_SSO 的组合 | — | — | ✗ MISSING_REQUIRED_ITEM | ✗ | ✗ |

buyer 视角排序（必需 → desired 覆盖 → 交付日 → 金额）在 $5,000 时首选 `AB-rush`（$900），在 $4,800 时首选 `AB-standard`（$800），次选 `A-rush`（$550）。

## 5. 规则配置（插件常量）

```ts
export const scopeChange: ScenarioPlugin = {
  key: "scope_change", version: 1, maxRounds: 3,
  roles: [{ role: "customer", side: "buyer", label: "Customer" },
          { role: "provider", side: "seller", label: "Provider" },
          { role: "finance",  side: "buyer", label: "Finance" }],
  requiredApprovals: [{ role: "customer", kind: "terms" }, { role: "provider", kind: "terms" },
                      { role: "finance", kind: "budget" }],
  brief: {
    customer: { hardFields: ["requiredItemKeys", "desiredItemKeys", "deferrableItemKeys", "deadline"],
                shareableFields: ["requiredItemKeys", "desiredItemKeys", "deferrableItemKeys", "deadline"],
                defaultShared: ["requiredItemKeys", "desiredItemKeys", "deferrableItemKeys", "deadline"], zodForForm },
    provider: { hardFields: ["earliestStartDate"], shareableFields: ["earliestStartDate"], defaultShared: ["earliestStartDate"], zodForForm },
    finance:  { hardFields: [], shareableFields: [], defaultShared: [], zodForForm },
  },
  // validate / enumerateCandidates / buildHumanRequest / deriveTasks / templates / agentBriefing / fixtures
};
```

## 6. Fixture 变体（`fixtures.ts`）

| fixtureKey | 预算 | 已承诺 | 用途 | 预期 |
| --- | --- | --- | --- | --- |
| `scope_change.main` | 500000 → 下调 480000 | 400000 | 主走查（part2） | 重谈 → customer 取舍 → 执行 $800 |
| `scope_change.renegotiable` | 500000 → 下调 490000 | 400000 | 下调后仍有 AB-rush 可行 | 新 run 直接 pending_approval |
| `scope_change.infeasible` | 500000 → 下调 440000 | 400000 | 余量 40000 < LOGIN 的 45000 | 不调模型；finance 请求 raise_budget 到 445000 |
| `scope_change.below_committed` | 500000 → 下调 390000 | 400000 | 总额低于已承诺 | BUDGET_BELOW_COMMITTED；finance 请求 |
| `scope_change.deadline_conflict` | 500000 | 400000 | customer deadline 2026-11-12 | 所有候选 DATE_AFTER_DEADLINE；customer 请求 relax_deadline 到 2026-11-13 |
| `scope_change.canary` | 同 main | 同 main | 隐私测试：notes 与 preferredDate 中植入 `CANARY-CUS-5513`、预算值改为 `497531` 等独特数 | 16 §4 |

seed 一律通过与真实用户相同的命令管线生成事件（actor `system`，`simulated:true`），不直接写投影，也不预置审批等中间状态（Q11 裁决：中间状态只能来自真实命令或标注 "seeded from run <id>" 的存档回放）。

## 7. 公共文本模板（节选，完整清单见 `templates.ts`）

| 模板键 | buyers | provider |
| --- | --- | --- |
| proposal.created | "Provider agent proposed v{v}: {items} for {amount}, delivery {date}{rushNote}; {deferred} deferred. {budgetLine}" — budgetLine: "Within budget ({headroomAfter} left)." / "Over budget by {shortfall}." | 同左，但 budgetLine: "" / "Blocked: exceeds the finance limit." |
| budget.changed | "Finance changed the budget cap from {old} to {new} ({reason}). Constraints v{cv}." | "A finance constraint changed. Constraints v{cv}." |
| request.opened(tradeoff→customer) | customer: "Choose: {optionA} or {optionB}, or cancel this change." finance: "Waiting for the customer to choose between {n} options." | "Waiting for a customer decision." |
| decision.recorded | "{role} approved v{v} (constraints v{cv})." / "rejected v{v}: {reasonCode}" | 同左 |
| execution.completed | "Change order executed: +{amount}. Committed {before} → {after} of {total}." | "Change order executed: +{amount}. {n} tasks assigned to you." |
