# 14 首个场景：软件服务范围变更（part1：角色、字段、目录、条款、规则、模板）

> 本章分 3 个文件：part1（本文件）场景定义；part2 fixture 与金丝雀变体；part3 预算下调完整走查、无解与边界变体。
> 场景插件包：`packages/scenario-scope-change`（`key: "scope_change"`，`version: 1`，`rulesVersion: "scope_change@1"`）。

## 14.1 角色与能力

| roleKey | 标签 | 能力（引擎 Capability） | 必需审批 | 批准按钮文案 |
| --- | --- | --- | --- | --- |
| `customer` | Customer / project owner | `brief.confirmSelf`、`decision.make`、`request.answer`、`run.retry`、`run.renegotiate` | 是 | "Approve change v{n}" |
| `provider` | Service provider | 上述 + `catalog.publish`、`task.update` | 是 | "Accept terms v{n}" |
| `finance` | Finance owner | 上述 + `budget.update` | 是 | "Approve budget commitment v{n}" |

协议参数：`firstProposerRoleKey: "provider"`，`counterPriority: ["customer", "finance", "provider"]`，`tradeoffOwners: ["customer", "finance"]`，`maxRounds: 3`，`maxCalls: 12`，`maxCandidates: 12`，目录 ≤ 10 项。

## 14.2 字段声明

| fieldKey | 所有者 | 类别 | 类型与校验 | 可披露给 |
| --- | --- | --- | --- | --- |
| `requestedItemKeys` | customer | hard | 非空、`isItemKey`、⊆ 当前目录键 | provider、finance |
| `requiredItemKeys` | customer | hard | ⊆ `requestedItemKeys` | provider、finance |
| `deadline` | customer | hard | `parseIsoDate`；≥ 今天 | provider、finance |
| `preferredItemKeys` | customer | soft | ⊆ `requestedItemKeys` | provider、finance |
| `preferredDate` | customer | soft | 可选；≤ `deadline` | provider、finance |
| `notes` | 各角色 | note | ≤ 4000 | 永不 |
| `minChangeOrderCents` | provider | hard | `assertCents` | customer、finance |
| `capCents` | finance | hard | `assertCents`；激活后变更需 ≥ 已承诺 | customer、provider |
| `baselineCommittedCents` | finance | hard | `assertCents`；≤ `capCents` | customer、provider |
| `baselineSource` | finance | hard（说明性） | ≤ 200，如 "Existing SOW-2026-07 commitments" | 随 `baselineCommittedCents` |
| `headroomCents` | finance | derived | `capCents − committedCents` | customer、provider |

```ts
// packages/scenario-scope-change/src/validators.ts（Convex 侧形状；值规则见 validateBriefContent）
export const customerContentV = v.object({ kind: v.literal("scope_change.customer"),
  hard: v.object({ requestedItemKeys: v.array(v.string()), requiredItemKeys: v.array(v.string()), deadline: v.string() }),
  soft: v.object({ preferredItemKeys: v.array(v.string()), preferredDate: v.optional(v.string()) }) });
export const providerContentV = v.object({ kind: v.literal("scope_change.provider"),
  hard: v.object({ minChangeOrderCents: v.number() }), soft: v.object({}) });
export const financeContentV = v.object({ kind: v.literal("scope_change.finance"),
  hard: v.object({ capCents: v.number(), baselineCommittedCents: v.number(), baselineSource: v.string() }),
  soft: v.object({}) });
```

激活前的 `readiness`：三份简报已确认；目录已发布且 ≥ 1 项；`requestedItemKeys ⊆ 目录键`；`baselineCommittedCents ≤ capCents`。customer 的请求范围引用目录键，所以 provider 必须先发布目录，customer 才能确认简报（界面在 customer 简报页显示"Waiting for the provider's catalog"）。

## 14.3 目录与条款派生

目录形状见 03 §3.4。交付语义：

- `standard`：交付日 = 所选条目 `standardDate` 的最大值；无费用。
- `rush`：仅当目录 `rushFeeCents > 0` 且所选每个条目都有 `rushDate`；交付日 = 所选条目 `rushDate` 的最大值；加一条订单级 `rush_fee`。

```ts
export function deriveTerms(c: { itemKeys: string[]; deliveryOption: "standard" | "rush" },
                            cat: Catalog, requested: string[]) {
  const keys = [...new Set(c.itemKeys)].sort();
  const items = keys.map((k) => cat.items.find((i) => i.itemKey === k));
  if (!keys.length || items.some((i) => !i)) return { error: "UNKNOWN_ITEM" } as const;
  if (c.deliveryOption === "rush" && (cat.rushFeeCents === 0 || items.some((i) => !i!.rushDate)))
    return { error: "DELIVERY_OPTION_UNAVAILABLE" } as const;
  const deliveryDate = maxDate(items.map((i) => (c.deliveryOption === "rush" ? i!.rushDate! : i!.standardDate)));
  const lines = items.map((i) => ({ itemKey: i!.itemKey, priceCents: i!.priceCents }));
  const fees = c.deliveryOption === "rush" ? [{ code: "rush_fee" as const, priceCents: cat.rushFeeCents }] : [];
  const priceCents = sum(lines) + sum(fees);
  const deferredItemKeys = requested.filter((k) => !keys.includes(k)).sort();
  const pricingKey = `${keys.join("+")}|${c.deliveryOption}|${deliveryDate}|${priceCents}|cat${cat.version}`;
  return { kind: "scope_change.terms", itemKeys: keys, deferredItemKeys, deliveryOption: c.deliveryOption,
           deliveryDate, lines, fees, priceCents, pricingKey,
           termsKey: `${keys.join("+")}|defer:${deferredItemKeys.join("+")}|${c.deliveryOption}|${deliveryDate}|${priceCents}|cat${cat.version}` };
}
```

## 14.4 规则、理由词表与排名

求值检查（06 §6.3）：`CATALOG_STALE`、`UNKNOWN_ITEM`、`DELIVERY_OPTION_UNAVAILABLE`、`DELIVERY_IN_PAST`、`MISSING_REQUIRED_ITEM`、`ITEM_NOT_REQUESTED`、`DEFERRED_MISMATCH`、`AFTER_DEADLINE`、`BELOW_PROVIDER_MINIMUM`、`OVER_BUDGET`；可见性见 07 §7.12。

| 词表 | 取值 | 可见范围 |
| --- | --- | --- |
| 代理拒绝理由 customer | `MISSING_REQUIRED_ITEM`、`AFTER_DEADLINE`、`PREFERENCE_NOT_MET`、`PRICE_TOO_HIGH` | 本方笔记 |
| 代理拒绝理由 provider | `BELOW_PROVIDER_MINIMUM`、`CAPACITY`、`TERMS_UNACCEPTABLE` | 本方笔记 |
| 代理拒绝理由 finance | `OVER_BUDGET`、`PRICE_TOO_HIGH` | 本方笔记 |
| 人的公开拒绝理由 | `TERMS_NOT_ACCEPTABLE`、`SCOPE_INSUFFICIENT`、`NEEDS_EARLIER_DELIVERY`、`OVER_OUR_LIMIT`、`OTHER` | 房间（界面明示） |

排名（`byRanking`）：① 覆盖的请求条目数多 → ② 交付日离首选日近（视图知道首选日时）→ ③ 覆盖的偏好条目多 → ④ 价格低 → ⑤ `pricingKey` 字典序。

必需审批角色：三方。承诺金额 = `priceCents`。任务派生：每个已批准条目一个任务，标题取 `taskTitle`，指派 provider，截止日 = 交付日。

## 14.5 公共文本模板（场景部分）

| 模板 | 输入 | 渲染示例 |
| --- | --- | --- |
| 提案摘要 | 条款、作者 | "Customer agent proposed LOGIN + REPORTS (standard, 2026-11-20) for $750; deferred: EXPORT." |
| 检查结果（买方，有披露） | `OVER_BUDGET{shortfall}` | "Over budget by $100" |
| 检查结果（provider） | 粗类 | "Blocked: buyer-side constraint" |
| 预算面板（finance） | 台账、提案 | "+$750 change · $4,000 → $4,750 committed · $4,800 cap" |
| 预算面板（customer，headroom 已披露） | headroom、提案 | "+$750 change · available budget $800 → $50" |
| 预算面板（provider） | — | 不渲染预算面板 |
| 约束变更（他方） | `constraints_changed` | "Finance updated a private constraint (v1 → v2). Proposals are being re-checked." |
| 目录发布 | `catalog_published` | "Provider published quotes v2 (3 items)." |
| 变更单 | `change_order_executed` | "Change order CO-1 recorded: v4 under constraints v2, $750, 2 tasks. Internal record only." |

全部模板只读公开载荷或查看者本人可见的数据（07 §7.14）。provider 视图永不出现"执行后已承诺合计"（02 §2.6）。
