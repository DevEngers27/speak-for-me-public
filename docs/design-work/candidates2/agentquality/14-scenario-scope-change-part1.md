# 14 首个场景：软件服务范围变更（第 1/2 部分：目录、简报、规则、模板）

场景键 `scope_change`，`version: 1`。所有 fixture 数据标 `isSimulated: true`，界面显示 "Simulated example data"。数字只在 `scenarios/scope-change/fixtures.ts` 定义一次，测试与评测从它推出。

## 14.1 报价目录（provider 确认）

| itemKey | kind | title | priceCents | standardLeadDays | rushLeadDays |
| --- | --- | --- | --- | --- | --- |
| LOGIN | scope | SSO login revamp | 45000 | 25 | 18 |
| REPORTS | scope | Usage reports | 30000 | 21 | 14 |
| EXPORT | scope | CSV export | 50000 | 39 | 32 |
| RUSH | fee（`feeRule: rush_delivery`） | Rush delivery | 15000 | — | — |

- 交付日期 = `startDate + max(所选条目的 leadDays)`，模式 standard 用 standardLeadDays，rush 用 rushLeadDays；rush 需每个所选条目都有 rushLeadDays 且 provider `rushAvailable = true`。
- 价格 = Σ 所选 scope 条目 +（rush 时）RUSH。
- fixture 中 `startDate = today = 2026-11-02`（房间时区 America/Los_Angeles）。
- 与原 README 数字核对：全量 LOGIN+REPORTS+EXPORT 加急 = 450+300+500+150 = **$1,400**；一期 LOGIN+REPORTS 加急 = **$900**，承诺后 **$4,900**。

## 14.2 简报 schema（Zod，写入口与读出时都 parse）

```ts
// scenarios/scope-change/briefs.ts
const itemKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,23}$/);
const isoDate = z.iso.date();
export const customerBrief = z.strictObject({
  requiredItemKeys: z.array(itemKey).min(1),
  desiredItemKeys: z.array(itemKey),
  deferrableItemKeys: z.array(itemKey),
  hardDeadline: isoDate,
  preferredDate: isoDate.optional(),
  tradeoffPreference: z.enum(["date_first", "scope_first", "cost_first", "unspecified"]),
  notes: z.string().max(1000).optional(),
}).superRefine(disjointSets).superRefine(preferredNotAfterDeadline);
export const providerBrief = z.strictObject({
  rushAvailable: z.boolean(),
  notes: z.string().max(1000).optional(),
});
export const financeBrief = z.strictObject({ notes: z.string().max(1000).optional() });
export const hardFields = { customer: ["requiredItemKeys", "desiredItemKeys", "deferrableItemKeys", "hardDeadline"],
  provider: ["rushAvailable"] } as const;
export const disclosableFields = { customer: ["requestedItemKeys", "requiredItemKeys", "desiredItemKeys",
  "deferrableItemKeys", "hardDeadline", "preferredDate", "tradeoffPreference"] } as const;
// requestedItemKeys 是派生字段 = required ∪ desired ∪ deferrable；默认披露
```

`desiredItemKeys` 属于硬字段的原因：它决定 deferred 列表（提案公开内容的一部分），改动应让旧审批失效。`tradeoffPreference` 与 `preferredDate` 是软字段。

## 14.3 约束与规则（场景对 06 的实现）

| 规则 | 实现 | reasonCode |
| --- | --- | --- |
| 必需条目 | `requiredItemKeys ⊆ itemKeys` | MISSING_REQUIRED_ITEM |
| 截止日 | `deliveryDate ≤ hardDeadline` | DATE_AFTER_DEADLINE |
| 加急可用 | 06 §6.4 第 5 项 | RUSH_UNAVAILABLE |
| 预算 | `committed + price ≤ total` | OVER_BUDGET |
| 余量不足以覆盖已承诺 | `total < committed`（只在 budgets.update 拦截） | BUDGET_BELOW_COMMITTED |
| 只能选目录内条目 | candidateKey 解析 | UNKNOWN_ITEM |

候选枚举：所有非空 scope 子集 × {standard, rush}，最多 `2^5 − 1 = 31` 个子集（`catalogRules.maxItems = 5` 个 scope 条目），即 ≤ 62 个候选，直接穷举。超过 5 个条目的目录在 v1 被写入口拒绝（扩展：17）。

排序（确定性）：硬约束可满足（按本角色可见约束）→ 本角色软分（10 §10.15 公式）→ 价格升序 → candidateKey 字典序。

可见码映射 `projectReasonCodes`：

| 系统码 | customer / finance 看到 | provider 看到 |
| --- | --- | --- |
| OVER_BUDGET | OVER_BUDGET（附 shortfallCents） | EXCEEDS_FINANCE_LIMIT |
| BUDGET_BELOW_COMMITTED | 同名 | EXCEEDS_FINANCE_LIMIT |
| MISSING_REQUIRED_ITEM | 同名（附 itemKey） | MISSING_REQUIRED_ITEM（附 itemKey——若 required 未披露，仍会由此推断；已接受，07 T7） |
| DATE_AFTER_DEADLINE | 同名（附 deadline） | DATE_AFTER_DEADLINE（deadline 未披露时不附日期） |
| 其他 | 同名 | 同名 |

## 14.4 澄清话题、拒绝码
- 话题：`tradeoff_priority`、`spend_full_headroom`、`rush_capacity`（05 §5.7）。
- 人的拒绝码：`SPEND_TOO_HIGH`、`SCOPE_INSUFFICIENT`、`DATE_UNACCEPTABLE`、`TERMS_UNACCEPTABLE`、`OTHER`。

## 14.5 公共文本模板（英文，读时渲染）

| templateKey | 受众 | 模板 |
| --- | --- | --- |
| proposal.created | 全员 | "{Role} agent proposes {items} ({mode}) — +{price}, delivery {date}; {deferred} deferred." |
| proposal.countered | 全员 | "{Role} agent counters with {items} ({mode}) — +{price}, delivery {date}; {deferred} deferred." |
| suggestion.blocked | 买方 | "{Role} agent suggested {items} ({mode}); blocked: over budget by {shortfall}." |
| suggestion.blocked | provider | "{Role} agent suggested {items} ({mode}); blocked: exceeds the finance limit." |
| proposal.endorsed | 全员 | "v{n} is ready for approval. Agent recommendations are not approvals." |
| proposal.blocked | 买方 | "+{price} change / {committedAfter} committed after approval / {cap} cap / over by {shortfall}" |
| proposal.blocked | provider | "+{price} · Blocked: exceeds the finance limit" |
| constraints.changed | 全员 | "{OwnerRole} updated a constraint (v{old} → v{new}); proposal v{n} is blocked." |
| request.waiting | 非目标 | "Waiting for {TargetRole} to choose an option." |
| request.tradeoff.finance | finance | "No option fits. Raise the cap to at least {minTotal}, or keep it and make no change this cycle." |
| request.tradeoff.customer | customer | "No option fits. Defer {itemKey} (then {unlockSummary}), or make no change this cycle." |
| request.choose.customer | customer | "Choose one: {optionSummaries}." |
| clarify.tradeoff_priority | customer | "If not everything fits, which matters more: delivery by {preferredDate} or keeping {desired}?" |
| decision.submitted | 全员 | "{Role} {approved|declined|withdrew} v{n} (constraints v{cv})." |
| execution.completed | 买方 | "Change order created for v{n}: +{price}; committed total {committedAfter}." |
| execution.completed | provider | "Change order created for v{n}: +{price}; {taskCount} tasks assigned to you." |

模板只接收结构化参数；金额参数由 `formatCents`（整数分 → "$1,400"）生成；provider 版模板的参数表里根本没有 cap / committed / shortfall 字段（类型层面保证）。
