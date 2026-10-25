# 06 确定性规则与校验

> 全部是纯函数：不读数据库、不调模型、不读时钟（`today` 作为参数传入）。放 `convex/engine/rules/*.ts`，可脱离 Convex 单测；同一函数被 `rooms.view`（显示）、`completeTurn`（规则闸门）、`decisions.approve`（执行前重算）调用。

## 1. 金额与日期原语（`money.ts`、`dates.ts`）

```ts
export const MAX_CENTS = 100_000_000;               // $1,000,000
export function assertCents(n: unknown, field: string): asserts n is number {
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0 || n > MAX_CENTS)
    throw new ConvexError({ code: "AMOUNT_OUT_OF_RANGE", field });
}
export function assertPositiveCents(n: unknown, field: string) { assertCents(n, field); if (n === 0) throw new ConvexError({ code: "AMOUNT_OUT_OF_RANGE", field }); }
export function parseDollarsToCents(s: string): number   // 严格：/^\d{1,7}(\.\d{1,2})?$/，按字符串拆分，不用 parseFloat
export function addCents(a: number, b: number): number   // 结果再过 assertCents，防溢出
export function assertIsoDate(s: string): void           // 正则 + 往返校验（拒绝 2026-02-30）
export function addDays(date: string, days: number): string // UTC 日历算术
export function todayIn(timeZone: string, nowMs: number): string // Intl 可用性待验证；退路固定偏移表
```

- 前端金额输入走同一个 `parseDollarsToCents`（`src/lib` 相对导入同一模块）；服务端再校验一次。

## 2. 台账（`ledger.ts`）

```ts
export type LedgerBalance = { limitCents: number; limitRevision: number;
  committedCents: number; headroomCents: number; commitmentCount: number };
export function balanceFrom(revisions: Rev[], commitments: Cmt[]): LedgerBalance
// limit = revision 最大者；committed = Σ amount；headroom = limit - committed；
// 若 headroom < 0 抛 LedgerInvariantError（只可能来自代码缺陷，测试兜底）
export function checkBudget(b: LedgerBalance, amountCents: number):
  { ok: boolean; reasonCode: "FITS_BUDGET" | "OVER_BUDGET";
    committedAfterCents: number; headroomAfterCents: number; shortfallCents: number }
// ok ⇔ committed + amount ≤ limit（等于算通过）
```

Convex 侧包装 `ledgerBalance(ctx, budgetId)`：按 `by_budget_revision` desc first 取上限，按 `by_budget_seq` collect 承诺（每房间承诺数有界：场景配置 `maxChangeOrdersPerRoom = 50`）。

## 3. 报价与定价（`pricing.ts`）

```ts
export function currentCatalog(rows: CatalogRow[]): Map<string, CatalogRow> // 每 itemKey 最大 revision 且 active
export function priceCandidate(itemKeys: string[], delivery: "standard"|"rush",
  catalog: Map<string, CatalogRow>, today: string):
  { lines: Line[]; fees: Fee[]; amountCents: number; deliveryDate: string } | { error: ReasonCode }
```

- 标准交付日 = `addDays(today, max(leadTimeDays))`；加急 = `addDays(today, max(rushLeadTimeDays))` 且加收 rush_fee 条目价格（一次性）。
- 任一条目缺 `rushLeadTimeDays` → 该组合不可加急。

## 4. 提案校验（`validate.ts`）

```ts
export type ValidationInput = {
  proposal: { itemKeys; lines; fees; amountCents; deliveryDate; delivery };
  catalog: Map<string, CatalogRow>;
  customer: CustomerFields;              // 当前确认版本
  balance: LedgerBalance;
  today: string;
};
export function validateProposal(i: ValidationInput): { ok: boolean; reasonCodes: ReasonCode[];
  budget: ReturnType<typeof checkBudget> }
```

检查项（全部执行，收集所有失败，不短路）：

| # | 检查 | reasonCode |
| --- | --- | --- |
| 1 | itemKeys 非空、无重复、全部在当前目录 | `EMPTY_SCOPE` / `DUPLICATE_ITEM` / `UNKNOWN_ITEM` / `ITEM_RETIRED` |
| 2 | 每个 line 的 catalogItemId/revision/price 等于当前修订 | `PRICE_MISMATCH` |
| 3 | 报价未过期：`today ≤ validUntil` | `QUOTE_EXPIRED` |
| 4 | 重算 `priceCandidate` 的 amountCents、deliveryDate 与提案一致 | `AMOUNT_MISMATCH` / `DATE_MISMATCH` |
| 5 | `requiredItemKeys ⊆ itemKeys` | `MISSING_REQUIRED_ITEM` |
| 6 | `today ≤ deliveryDate` | `DATE_IN_PAST` |
| 7 | `deliveryDate ≤ deadline` | `DATE_AFTER_DEADLINE` |
| 8 | `checkBudget(balance, amountCents).ok` | `OVER_BUDGET` |

- 必需条目不能被"显式延后"后仍算合法：缺必需条目就是 `MISSING_REQUIRED_ITEM`，只能通过 customer 回答 `defer_item`（产生新简报版本）解决。
- `isExecutable(room, proposal, input) = proposal._id === room.currentProposalId && proposal.status === "active" && validateProposal(input).ok`。

## 5. 候选枚举（`candidates.ts`）

```ts
export function enumerateCandidates(catalog, today, filter: CandidateFilter): Candidate[]
type CandidateFilter = { requiredItemKeys?: string[]; deadline?: string;
  balance?: LedgerBalance; amountBelowCents?: number };
```

- scope 条目 ≤ 12（场景上限）→ 最多 4096 子集 × 2，穷举可接受；超过上限时插件必须提供剪枝枚举器（17）。
- 排序（确定性）：先必需条目覆盖，再 `wantedItemKeys` 按优先级覆盖数，再交付日早，再金额低，最后 itemKeys 字典序；按序编号 `c1..cN`。
- "无可行方案"判定 = 带完整 filter 的枚举为空。
- `remedies(catalog, customer, balance, today)`：对空集情形计算 §05-5 的选项（最小抬高额、可延后条目、可放宽日期），全部由代码算出。

## 6. 规范化内容键（`contentKey.ts`）

```ts
export function contentKey(p): string {
  const lines = p.lines.map(l => `${l.itemKey}@${l.revision}:${l.priceCents}`).sort().join(",");
  const fees = p.fees.map(f => `${f.kind}@${f.revision}:${f.amountCents}`).sort().join(",");
  return `v1|items=${lines}|fees=${fees}|total=${p.amountCents}|date=${p.deliveryDate}` +
         `|deferred=${[...p.deferredItemKeys].sort().join(",")}|brief=${p.customerBriefVersionId}`;
}
```

纯字符串，不依赖 `crypto.subtle`。执行时重算并与提案、签字三方比对（08）。

## 7. 签字完整性（`signatures.ts`）

```ts
export function signatureStatus(required: {role; kind}[], latestByUser: Decision[], cv: number):
  { complete: boolean; missing: {role; kind}[]; authorizing: Id<"decisions">[] }
```

- 只看每个用户在该提案上的**最新**分录；只计 `decision === "approve" && constraintsVersion === cv`。
- 每个必需 (role, kind) 必须由持有该 role 的不同 userId 满足；禁止计数判定。

## 8. 任务派生（`tasks.ts`）

`deriveTasks(changeOrder, catalog) → {itemKey, title, assigneeRole: "provider"}[]`：每个 scope line 一条，title 来自该修订的 `taskTitle`；rush_fee 不产生任务。纳入 contentKey 的是条目修订，因此任务模板随修订固定（Q10 的回答）。

## 9. reasonCode 与按角色投影（`reasonCodes.ts`）

| 内部码 | finance | customer | provider |
| --- | --- | --- | --- |
| OVER_BUDGET | OVER_BUDGET + 数字 | OVER_BUDGET + 数字 | FINANCE_LIMIT |
| MISSING_REQUIRED_ITEM | 同左 | 同左 | 共享了 requiredItemKeys 则原码，否则 CUSTOMER_CONSTRAINT |
| DATE_AFTER_DEADLINE | 同左 | 同左 | 共享了 deadline 则原码，否则 CUSTOMER_CONSTRAINT |
| 其他（目录、日期、金额一致性） | 原码 | 原码 | 原码 |

面向客户端的错误：`ConvexError({ code })`，消息不带数值。

## 10. 场景插件接口（`convex/engine/scenario.ts`）

```ts
export interface ScenarioPlugin<Fields> {
  key: string;
  roles: readonly Role[];
  requiredSignatures: { role: Role; kind: "terms" | "budget" }[];
  budgetVisibleToRoles: Role[];          // 首个场景 ["finance","customer"]
  briefFields: { validate(role, fields): void; hardKey(role, fields): string;
                 shareable: readonly string[] };
  catalog: { validateItem(item): void; maxItems: number };
  enumerateCandidates: typeof enumerateCandidates;
  validateProposal: typeof validateProposal;
  remedies: typeof remedies;
  deriveTasks: typeof deriveTasks;
  templates: TemplateSet;                 // 公共文本、请求问题、事件
  config: { maxRounds: number; maxModelCalls: number; maxChangeOrdersPerRoom: number };
  fixtures: Record<string, Fixture>;      // 可行 / 需取舍 / 不可行 / 低于已承诺
}
```

引擎只认 `ScenarioPlugin`；预算台账、签字、执行、约束版本属于引擎，场景只提供"金额如何从条目算出"和"什么算可行"。
