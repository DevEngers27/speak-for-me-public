# 06 确定性规则与校验 · part1：输入、检查集、reasonCode、调用点

## 1. 原则

1. **一个纯函数，处处同用**：`evaluateProposal(terms, inputs, today) → Check[]` 不读数据库、不调模型、不读时钟（today 由调用方按房间时区传入）。界面实时显示、审批守卫、执行守卫、约束变化后的复评、代理反馈都调用它（F06.1）。提案上的 `creationChecks` 只是创建时的结论快照，**执行永远重算**（PR-5）。
2. **输入只来自确认版本**：`loadRuleInputs(ctx, constraintSetId)` 读约束集与它引用的三个简报版本（BR-2），返回不可变对象。同一约束集 + 同一 today ⇒ 同一结果（CS-2 的可复现性）。
3. **检查命名如实**：每项检查说清它查了什么；不存在"Matches current constraints"这种只比版本号的检查（RA-B01）。版本一致性不是提案的属性，而是决定的属性（DE-4）。
4. **reasonCode 是规则与文本之间的唯一接口**：模板、投影、人工请求选项、错误返回都只消费 reasonCode 与带可见性标签的参数（F06.7）。

## 2. 规则输入

```ts
export type RuleInputs = {
  constraintsVersion: number;
  timeZone: string;
  customer: { versionId: Id<"briefVersions">; brief: ScCustomerBrief };
  provider: { versionId: Id<"briefVersions">; brief: ScProviderBrief };
  finance:  { versionId: Id<"briefVersions">; brief: ScFinanceBrief };
  committedCents: number;            // constraintSet.committedCents（CS-4 保证 = 外部 + 台账）
};
```

## 3. 检查集（scope_change；顺序即展示顺序）

| # | checkId | 失败 reasonCode | 约束所有者 | 判定（全部整数/字典序比较） | 参数及其可见性依赖 |
| --- | --- | --- | --- | --- | --- |
| 1 | `items.known` | `ITEM_UNKNOWN` | customer | 每行 itemKey ∈ requestedItems | itemKey（公开） |
| 2 | `items.unique` | `DUPLICATE_ITEM` | 引擎 | itemKey 不重复 | itemKey（公开） |
| 3 | `source.offered` | `LINE_NOT_OFFERED` | provider | (itemKey, variantKey) 在当前 provider 版本中存在 | lineKey（公开） |
| 4 | `source.match` | `SOURCE_MISMATCH` | provider | 行快照的 label/priceCents/earliestDeliveryDate/taskTitle 与当前版本一致 | lineKey、field（公开）——RA-B04 的修正 |
| 5 | `source.valid` | `OFFER_EXPIRED` | provider | 无 validUntil 或 today ≤ validUntil | validUntil（依赖 provider.offerLines） |
| 6 | `request.current` | `REQUEST_CHANGED` | customer | included ∪ deferred = 当前 requested 键集 | — |
| 7 | `scope.required` | `REQUIRED_ITEM_MISSING` | customer | requiredItemKeys ⊆ included（必需项被延后不算通过） | missingItemKeys（依赖 customer.requiredItemKeys） |
| 8 | `date.earliest` | `DELIVERY_BEFORE_EARLIEST` | provider | deliveryDate ≥ max(行 earliestDeliveryDate) | earliest（公开：行随提案公开） |
| 9 | `date.notPast` | `DELIVERY_IN_PAST` | 引擎 | deliveryDate ≥ today | today（公开） |
| 10 | `date.deadline` | `DELIVERY_AFTER_DEADLINE` | customer | deliveryDate ≤ deadline（含当日） | deadline、daysLate（依赖 customer.deadline） |
| 11 | `budget.cap` | `OVER_BUDGET` | finance | committedCents + amountCents ≤ budgetCapCents（等于算通过） | 见 §4 |
| 12 | `amount.sum` | `AMOUNT_MISMATCH` | 引擎 | amountCents = Σ 行价格（完整性自检，正常不可能失败） | — |
| 13 | `date.preferred` | `MISSES_PREFERRED_DATE`（info） | customer | 无 preferredDate 或 deliveryDate ≤ preferredDate | preferredDate（依赖 customer.preferredDate） |

通过的检查 `status = "pass"、reasonCode = "OK"`；第 13 项只产生 `info`，不阻断。`verdict(checks) = 任一 fail ? "blocked" : "pass"`。

```ts
export type Param = { name: string; value: number | string; requires: FieldRef[] }; // [] = 公开
export type FieldRef = { role: "customer" | "provider" | "finance"; field: string };
export type Check = { checkId: string; status: "pass" | "fail" | "info"; reasonCode: string;
                      ownerRole?: string; params: Param[] };
```

## 4. 预算检查的结构化结果（F06.3）

```ts
export function checkBudget(i: { capCents: number; committedCents: number; amountCents: number }) {
  const committedAfterCents = i.committedCents + i.amountCents;
  return {
    ok: committedAfterCents <= i.capCents,
    reasonCode: committedAfterCents <= i.capCents ? "OK" : "OVER_BUDGET",
    params: [
      { name: "amountCents",         value: i.amountCents,         requires: [] },
      { name: "committedAfterCents", value: committedAfterCents,   requires: [F("finance", "externalCommittedCents")] },
      { name: "capCents",            value: i.capCents,            requires: [F("finance", "budgetCapCents")] },
      { name: "headroomCents",       value: i.capCents - i.committedCents,
        requires: [F("finance", "budgetCapCents"), F("finance", "externalCommittedCents")] },
      { name: "overByCents",         value: Math.max(0, committedAfterCents - i.capCents),
        requires: [F("finance", "budgetCapCents"), F("finance", "externalCommittedCents")] },
    ],
  };
}
```
台账部分（Σ commitments）是本房间已执行提案金额之和，这些金额已在执行事件中公开，所以 `committedAfterCents` 只依赖 finance 的外部已承诺金额。"Pending proposals do not reserve budget; one active proposal per room"：待批提案不预占预算，PR-4 保证同一时刻只有一个当前提案（F06.3）。

## 5. 日期语义（GAP-24）

- 所有日期是房间时区下的日历日 `YYYY-MM-DD`；比较用字典序（格式校验后与日期序一致）。
- `todayIn(timeZone)` 用 `Intl.DateTimeFormat("en-CA", { timeZone })` 在 mutation/query 中按 `Date.now()` 计算。Convex 默认运行时对 Intl 时区的支持**待验证**；若不支持，退化为"受支持时区白名单 + 固定偏移表（不处理夏令时）"，并在建房时限制可选时区，限制写入 18。
- 截止日含当日（`deliveryDate ≤ deadline` 通过）；报价有效期含当日；交付日不得早于今天。
- "今天"的推移不 bump 约束版本：它不是规则输入的变化，而是评估参数。审批仍绑定原约束版本，但执行守卫用执行时刻的 today 重算，跨日后可能变为不可执行（04 part2 §7）。

## 6. 调用点

| 调用者 | 目的 | 输入 | 失败时 |
| --- | --- | --- | --- |
| `completeTurn` → `insertProposal` | creationChecks / creationVerdict | 当前约束集 | 提案以 blocked 入库，进入轮次结算 |
| `rooms.workspace` | 实时可执行性与阻断解释 | 当前约束集、today | 投影后显示 |
| `decisions.record`（approve） | DE-3 | 同上 | `ConvexError({ code: "NOT_EXECUTABLE", reasonCodes })` |
| `executeIfReady` | EX-2 最终守卫 + CS-4 断言 | 同上 + 台账重算 | 不执行；返回 `blocked` |
| `onConstraintsChanged` | R-10 的复评 | 新约束集 | run superseded |
| `requests.answer`（choose_package） | R-5 | 当前约束集 | `ConvexError({ code: "OPTION_NO_LONGER_FEASIBLE" })` |
| `startRun`、`settleStep` | 预检、用尽处理（`enumerateFeasible`） | 当前约束集 | 走 tradeoff |
| `buildAgentContext` | 给代理的投影检查结论 | 当前约束集 | — |

## 7. 面向客户端的错误纪律

公共 mutation 抛 `ConvexError({ code, reasonCodes?, params? })`：`params` 只含调用者可见的值（按 §3 的 requires 过滤），消息文本由客户端模板渲染。例：provider 尝试批准一个超预算提案，收到 `{ code: "NOT_EXECUTABLE", reasonCodes: ["OVER_BUDGET"] }`，没有任何金额。非 ConvexError 异常在生产部署中隐藏消息（F07.8），日志纪律见 07 §8。
