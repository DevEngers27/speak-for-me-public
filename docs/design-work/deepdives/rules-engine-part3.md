# 专题深潜：确定性规则引擎 · part3（§3.4–§3.8 签名、validator、调用点、定价、today）

### 3.4 核心签名（完整实现见 rules-engine/*.ts）

```ts
// scenarios/scope-change/types.ts
type CatalogItem = { itemKey: string; revision: number; priceCents: Cents;
  standardDeliveryDate: IsoDate; rushDeliveryDate?: IsoDate;
  status: 'confirmed' | 'unconfirmed'; validUntil?: IsoDate; simulated: boolean };
type Catalog = { items: readonly CatalogItem[]; rushFee?: { chargeKey: string; amountCents: Cents } };
type CustomerConstraints = { requiredItemKeys: readonly string[]; deferrableItemKeys: readonly string[];
  deadline: IsoDate; preferredDate?: IsoDate };
type BudgetInput = { capCents: Cents; commitments: readonly { amountCents: Cents }[] };
type ScopeChangeTerms = { itemKeys: readonly string[]; deferredItemKeys: readonly string[]; deliveryDate: IsoDate };
type ScopeChangeInput = { today: IsoDate; catalog: Catalog; customer: CustomerConstraints | null;
  budget: BudgetInput | null; terms: ScopeChangeTerms; pricingSnapshot: Pricing | null };

evaluateScopeChange(i: ScopeChangeInput): Evaluation;           // executable, blocking, info, checks, pricing, amounts
priceTerms(t: ScopeChangeTerms, c: Catalog): PriceResult;        // lines + charges + additionalCostCents
canonicalTermsKey(t: ScopeChangeTerms): string;
diffTerms(prev, next, prevCost, nextCost): TermsDiff[];
findFeasibleOptions(base: Omit<ScopeChangeInput, 'terms' | 'pricingSnapshot'>): Feasibility;
suggestRelaxations(base): Relaxation[] | { kind: 'too_large' };
evaluateExecutionReadiness(i: ReadinessInput): Readiness;        // engine.ts, scenario-agnostic
projectEvaluation(e: Evaluation, viewer: ViewerRole, d: Disclosure): ProjectedEvaluation;
```

场景插件接口（引擎对场景的要求，供 06/11/17 定稿）：

```ts
export interface ScenarioRules<Terms, Base> {
  scenarioKey: string;                                   // 'scope_change'
  reasonCodes: readonly ReasonCode[];                    // subset of REASON_CODES this scenario can emit
  evaluate(input: Base & { terms: Terms; pricingSnapshot: unknown | null }): EvaluationLike;
  canonicalTermsKey(terms: Terms): string;
  diffTerms(prev: Terms, next: Terms, prevCost: number, nextCost: number): unknown[];
  findFeasibleOptions(base: Base): FeasibilityLike;      // must reuse evaluate()
  suggestRelaxations(base: Base): unknown[];             // each option maps to one role's concrete action
  projection: Partial<Record<ReasonCode, { owner: string; sharedBy?: string }>>;
}
```

### 3.5 从同一常量派生 Convex validator 与 Zod schema

```ts
// convex/lib/validators.ts
import { v } from 'convex/values';
import { REASON_CODES } from '../../engine/rules/codes';
export const vReasonCode = v.union(...REASON_CODES.map((c) => v.literal(c)));   // 待验证：v.union 展开字面量数组的类型推断
export const vCheckResult = v.object({
  checkId: v.string(), status: v.union(v.literal('pass'), v.literal('fail'), v.literal('not_evaluated')),
  severity: v.union(v.literal('block'), v.literal('info')), code: vReasonCode,
  params: v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.array(v.string()))),
});
export const vScopeChangeTerms = v.object({
  itemKeys: v.array(v.string()), deferredItemKeys: v.array(v.string()), deliveryDate: v.string(),
});   // shape only; isIsoDate / isNonEmptyKey run in code (inputs/04 要点 5)

// engine boundary for model output (10): shape via Zod, meaning via evaluate()
import { z } from 'zod';
export const zReasonCode = z.enum(REASON_CODES);
export const zIsoDate = z.string().refine(isIsoDate, { message: 'INVALID_DATE' });
export const zCents = z.number().refine(isCents, { message: 'AMOUNT_OUT_OF_RANGE' });
```

规则：Zod 的 `.refine` 与 Convex validator 都只做形状与谓词，**语义**（是否在目录、是否超预算）只在 `evaluateScopeChange` 里判断一次。模型输出 schema 里的 `deliveryDate` 用 `z.string()` 而不是 `z.iso.date()`，日历日由 `isIsoDate` 判定，避免两套日期真相（RA-R03）；SDK 会把格式约束降级为描述文字（inputs/04 要点 16），所以无论如何都要代码复核。

### 3.6 调用点与时序

加载器（convex 层，非纯）：

```ts
// convex/lib/evaluationInput.ts
export async function loadScopeChangeInput(ctx: QueryCtx | MutationCtx, room: Doc<'rooms'>, proposal: Doc<'proposals'> | null,
  nowMs: number): Promise<{ base: BaseInput; input: ScopeChangeInput | null }> {
  // 1. catalogItems  .withIndex('by_room', q => q.eq('roomId', room._id))           -> Catalog
  // 2. customer brief .withIndex('by_room_role', ...).filter(status === 'confirmed') -> CustomerConstraints | null
  // 3. budgets       .withIndex('by_room')                                           -> capCents
  // 4. commitments   .withIndex('by_room')  (baseline + change_order)                -> commitments[]
  // 5. today = todayInTimeZone(nowMs, room.timeZone, room.fallbackUtcOffsetMinutes)
  // explicit whitelist object; never spread whole documents (F07.5)
}
```

| 调用点（12 的函数名） | 类型 | 调用 | 用结果做什么 | 失败后状态 |
| --- | --- | --- | --- | --- |
| `rooms.view` | query | load → `evaluateScopeChange` → `evaluateExecutionReadiness` → `projectEvaluation(viewerRole)` | 实时显示可执行性与阻断原因 | 只读，无状态变化 |
| `runs.completeTurn`（provider 提议） | internalMutation | 解析模型输出 → 构造 terms → `evaluateScopeChange(pricingSnapshot: null)` | 结构类阻断（`UNKNOWN_ITEM / DUPLICATE_ITEM / ITEM_OVERLAP / INVALID_DATE / EMPTY_SCOPE / UNCONFIRMED_ITEM / BEFORE_EARLIEST_DELIVERY`）→ 拒收本回合并有界重试；其余阻断允许入库（提案可以"不可执行"，由人看到原因），入库时写 `pricingSnapshot`、`termsKey`、`evaluationSnapshot` | turn 记为 rejected_output，run 不推进（10） |
| `approvals.decide`（approve） | mutation | 事务内重新 load → `evaluateExecutionReadiness`（含新决定后的 decisions） | approve 前要求 `evaluation.executable`（不能批准不可执行的版本，RA-R06）；写决定后若 `ready` → 同事务调用 `executeInternal` | 抛 `ConvexError({ code })`，不写任何东西 |
| `approvals.decide`（reject / withdraw） | mutation | 不要求 executable | 永远可以说不 | — |
| `executions.retry` / `executeInternal` | mutation / 内部函数 | 重新 load → readiness | `already_executed` → 返回已有执行（不报错、不写房间事件）；`ready` → 插入 changeOrder、commitment（amount = `pricingSnapshot.additionalCostCents`）、tasks；同事务断言插入后 `Σcommitments <= cap` | 抛错回滚 |
| `budgets.update` 后续 / `constraints.bump` 后续 | mutation | `evaluateScopeChange(current)`；不可执行时 `findFeasibleOptions` → `single/tradeoff` 调度重谈，`none` → `suggestRelaxations` 生成 humanRequests | 09 的统一约束变化流程 | 约束变更与后续调度在同一事务（inputs/04 要点 2） |
| stub 代理 | internalAction 或 mutation | `findFeasibleOptions` → 取前沿第一个（按成本、键、日期的稳定序） | 产出 `authorKind: 'rule'` 的提案并如实标注 | — |
| Next 客户端表单 | 浏览器 | 只用 `isIsoDate`、`isCents` 做即时反馈 | 不做可执行性判断（浏览器拿不到私密输入） | — |

关键顺序：执行入口里**先查执行记录、再算预算**（D10）；mutation 内的所有读取都在同一事务快照上，与写入共同受 OCC 保护，并发的最后两票只会有一个执行成功（inputs/04 §1，I5）。

`evaluationSnapshot` 只是历史快照（"提案生成时的评估"），任何守卫都不读它；可执行性永远实时计算（I10）。

### 3.7 scope_change 定价规则（`priceTerms`）

设所选条目集合 S，`std = max(S.standardDeliveryDate)`，`rushMin = max(S.rushDeliveryDate ?? standardDeliveryDate)`，交付日 d：

| 条件 | 结果 |
| --- | --- |
| `d >= std` | 标准交付，无加急费 |
| `rushFee` 存在且 `rushMin <= d < std` | 加急，整单加一次 `rushFee.amountCents`（F14.2 的 R） |
| 否则 | `BEFORE_EARLIEST_DELIVERY`，参数 `earliestDate = rushFee ? rushMin : std` |

`additionalCostCents = Σ lines.priceCents + Σ charges.amountCents`，逐步 `addCents`。条目的 `rushDeliveryDate >= standardDeliveryDate` 视同没有加急（防御性），目录保存入口应拒绝这种数据。

用 fixture 核对（全部来自 `fixture.ts`，与 F14.2 目录 1 一致）：

| 条款 | 交付日 | 金额 | cap 500000 | cap 480000 |
| --- | --- | --- | --- | --- |
| LOGIN+REPORTS（加急） | 2026-11-13 | 90000 | FITS（490000） | OVER（over 10000） |
| LOGIN+REPORTS（标准） | 2026-11-20 | 80000 | FITS | **FITS（恰等于 480000）** |
| LOGIN（加急） | 2026-11-13 | 55000 | FITS | FITS |
| LOGIN+REPORTS+EXPORT（加急） | 2026-11-20 | 140000 | OVER | OVER |

### 3.8 "今天"与时区

- 房间存 `timeZone`（IANA 名，如 `America/Los_Angeles`）与 `fallbackUtcOffsetMinutes`。`todayInTimeZone(nowMs, timeZone, fallback)` 先用 `Intl.DateTimeFormat(..., { timeZone }).formatToParts`，失败时退回固定偏移（不处理夏令时，文档写明限制）。
- `nowMs` 在 mutation 里取 `Date.now()`；测试与 fixture 直接传 `today`。
- query 里的 today：可执行性显示可能在跨午夜后到下一次数据变化前保持旧值（待验证 Convex query 缓存对 `Date.now()` 的处理）；权威判断永远在 mutation 里重算，所以最坏结果是界面晚一点显示"已过期"，不会错误执行。
- 截止日、首选日、交付日、报价有效期全部是房间时区里的日历日，包含端点：`today <= deliveryDate <= deadline`，`today <= validUntil`。
