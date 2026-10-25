# 06 确定性规则与场景插件接口

## 1. 决定

- 规则是**纯函数**（不读库、不调模型、不读时钟——`today` 作参数传入），放在场景包里，引擎只通过接口调用。
- 同一个 `validateProposal` 在三处调用：`completeTurn`（写入快照）、`rooms.view`（实时可执行性）、`approvals.decide`（执行前重算）。快照只用于审计，执行永远重算。
- 规则输出只有 `ReasonCode[]`；它是规则与文本、投影、人工请求之间的唯一接口（F06.7）。

## 2. 首个场景的纯函数

```ts
// convex/scenarios/scopeChange/rules.ts
export type Constraints = {
  customer: CustomerBrief; provider: ProviderBrief; finance: FinanceBrief;
  executedCents: number;          // Σ changeOrders(room).commitment.amountCents
  today: string;                  // todayIn(room.timeZone)
};
export const committedCents = (c: Constraints) => c.finance.priorCommittedCents + c.executedCents;

export function computeTerms(itemKeys: string[], c: Constraints) {
  const keys = [...new Set(itemKeys)].sort();
  const lines = keys.map(k => { const it = c.provider.items.find(i => i.itemKey === k);
    if (!it) throw new RuleError("UNKNOWN_ITEM"); return { itemKey: k, title: it.title, priceCents: it.priceCents }; });
  const amountCents = lines.reduce((s, l) => s + l.priceCents, 0);           // 再 assertCents
  const deliveryDate = keys.map(k => c.provider.items.find(i => i.itemKey === k)!.earliestDeliveryDate).sort().at(-1)!;
  const deferredItemKeys = [...c.customer.requiredItemKeys, ...c.customer.wantedItemKeys].filter(k => !keys.includes(k)).sort();
  return { itemKeys: keys, lines, amountCents, deliveryDate, deferredItemKeys };
}

export function validateProposal(p: Pick<Proposal,"itemKeys"|"lines"|"amountCents"|"deliveryDate">, c: Constraints): ReasonCode[] {
  const codes: ReasonCode[] = [];
  if (p.itemKeys.length === 0) codes.push("EMPTY_SCOPE");
  let fresh; try { fresh = computeTerms(p.itemKeys, c); } catch { return [...codes, "UNKNOWN_ITEM"]; }
  if (fresh.amountCents !== p.amountCents || fresh.deliveryDate !== p.deliveryDate
      || JSON.stringify(fresh.lines) !== JSON.stringify(p.lines)) codes.push("SOURCE_MISMATCH");
  if (!c.customer.requiredItemKeys.every(k => p.itemKeys.includes(k))) codes.push("MISSING_REQUIRED_ITEM");
  if (p.deliveryDate > c.customer.deadline) codes.push("DELIVERY_AFTER_DEADLINE");
  if (p.deliveryDate < c.today) codes.push("DELIVERY_IN_PAST");
  if (committedCents(c) + p.amountCents > c.finance.totalBudgetCents) codes.push("OVER_BUDGET"); // 等于上限通过
  return codes;
}

export function enumerateFeasible(view: PartialConstraints): string[][]   // 2^n 穷举，n ≤ 8
// 只对 view 中存在的约束过滤：provider 视角只有目录 + 已披露的 customer 字段；
// 系统视角（R0′ 判定、buildRequests）用全部约束。按 (wanted 覆盖数 desc, amount asc) 排序。

export function budgetFigures(p: { amountCents: number }, c: Constraints) {   // 只进买方投影
  const committed = committedCents(c);
  return { changeCents: p.amountCents, committedCents: committed,
    committedAfterCents: committed + p.amountCents, totalBudgetCents: c.finance.totalBudgetCents,
    headroomCents: c.finance.totalBudgetCents - committed,
    shortfallCents: Math.max(0, committed + p.amountCents - c.finance.totalBudgetCents) };
}

export function deriveTasks(co: ChangeOrderDraft, c: Constraints): TaskDraft[] {
  return co.itemKeys.map(k => { const it = c.provider.items.find(i => i.itemKey === k)!;
    return { itemKey: k, title: it.taskTitle, assigneeRole: "provider", dueDate: co.deliveryDate }; });
}
```

## 3. reasonCode 词表（场景注册，单一来源）

| code | 来源 | 约束所有者 | 他方可见 | 公开模板 |
| --- | --- | --- | --- | --- |
| `UNKNOWN_ITEM` | 规则 | provider | 全员 | "References an item not in the confirmed quote" |
| `EMPTY_SCOPE` | 规则 | — | 全员 | "Proposal has no items" |
| `SOURCE_MISMATCH` | 规则 | provider | 全员 | "Quote changed since this proposal" |
| `MISSING_REQUIRED_ITEM` | 规则 | customer | 全员（条目键仅在 customer 披露 required 时显示） | "Missing an item the customer requires" |
| `DELIVERY_AFTER_DEADLINE` | 规则 | customer | 全员（日期仅在披露 deadline 时显示） | "Delivery is after the customer's deadline" |
| `DELIVERY_IN_PAST` | 规则 | — | 全员 | "Delivery date is in the past" |
| `OVER_BUDGET` | 规则 | finance | 全员（数字只给可见预算的角色） | "Exceeds the finance limit" |
| `BUDGET_BELOW_COMMITTED` | 简报校验 | finance | 仅 finance（写入被拒） | — |
| `WANTS_MORE_SCOPE` / `DATE_TOO_LATE` / `PRICE_TOO_HIGH` | 评估方代理 / 人的拒绝 | 评估方 | 全员（简报页预先声明"你的代理可能对他方说"） | "Customer agent declines: wants more scope" |
| `NO_FEASIBLE_COMBINATION` / `ROUNDS_EXHAUSTED` / `AGENT_CLARIFY` | 编排 | 系统 | 全员 | "Agents need a human decision" |

Q3（未披露的硬约束被违反时对他方显示什么）：显示 code，不显示值。这是可接受的最小披露，写入 07 §4 并在简报页披露说明中告知。

## 4. 枚举与"无解"判定

- 目录上限 8 项，穷举 ≤ 256 组合，纯 CPU，可放进 mutation（确定性）。
- 系统视角无可行组合 → `NO_FEASIBLE_COMBINATION`，`buildRequests` 计算"最小改动"选项：最小预算缺口 `min over combos⊇required (committed + amount − total)`；可单独移出 required 的条目；最早可行截止日。
- 更大目录（第二场景）需要插件自带剪枝枚举器；接口不变（`enumerateFeasible` 返回有序候选，允许截断到前 K 个）。

## 5. 调用点

| 函数 | 调用的规则 | 用途 |
| --- | --- | --- |
| `briefs.confirm` / `requests.answer(patch_brief)` | `validateBriefContent` | 拒绝坏输入（日期、金额、目录键、预算低于已承诺） |
| `startRun` | `enumerateFeasible(全部)` | R0 / R0′ 分流 |
| `agents.getTurnContext` | `enumerateFeasible(provider 视角)`、`validateProposal`（给评估方看结论） | 上下文 |
| `agents.completeTurn` | `computeTerms`、`validateProposal`、`buildRequests` | 插入提案与快照；推进 |
| `rooms.view` | `validateProposal`、`budgetFigures`（仅买方） | 实时 executable 与数字 |
| `approvals.decide` | `validateProposal`、`deriveTasks`、`budgetFigures` | 执行前重算；承诺快照 |

## 6. 引擎派生函数（`convex/engine/derive.ts`）

`proposalStatus`、`isExecutable`、`approvalValidity`、`currentDecisions(proposal)`、`isFullyApproved(proposal, approvals)`、`requestIsOpen`、`roomPhase`、`todayIn(timeZone)`。全部纯函数，输入是已读出的文档。

`isFullyApproved`：
```ts
const latest = new Map<Role, Approval>();
for (const a of approvalsOf(p).sort(byCreation)) latest.set(a.role, a);
return p.requiredApproverRoles.every(r => latest.get(r)?.decision === "approve");
```
不同角色必然是不同 userId（席位唯一性 I2），因此不需要额外去重；禁止 `approvals.length >= N`。

## 7. 场景插件接口

```ts
// convex/engine/scenario.ts
export interface ScenarioPlugin<B extends Record<string, unknown>> {
  key: string; version: number;
  roles: readonly string[];                 // ["customer","provider","finance"]
  proposerRole: string;                     // "provider"
  evaluatorRoles: readonly string[];        // 顺序即回合顺序 ["customer","finance"]
  approverRoles: readonly string[];         // 快照进 proposal.requiredApproverRoles
  approvalLabel: Record<string, string>;    // provider/customer: "Accept terms"; finance: "Approve budget commitment"
  tieBreakerRole: string; maxRounds: number;
  disclosure: DisclosureSpec;               // 07 §3：每角色可披露字段及其受众、强制公开字段
  rejectCodes: readonly [string, ...string[]];
  validateBriefContent(role: string, content: unknown, ctx: BriefCtx): ReasonCode[];
  briefPatchSchema: Record<string, ZodType>;
  computeTerms(itemKeys: string[], c: B & Shared): Terms;
  validateProposal(p: Terms, c: B & Shared): ReasonCode[];
  enumerateFeasible(view: Partial<B> & Shared): string[][];
  buildRequests(input: RequestInput): RequestDraft[];
  deriveTasks(co: Terms, c: B & Shared): TaskDraft[];
  buyerFigures?(p: Terms, c: B & Shared): Record<string, number>;
  templates: TemplateSet;                   // 05 §6
  prompts: { system: string; perRole: Record<string, string> };  // 固定文本，可缓存
  fixtures: Record<"feasible" | "renegotiate" | "infeasible", FixtureSpec>;
}
```
引擎从不 import 某个具体场景的类型；`registry.ts` 按 `room.scenarioKey` 取插件。第二个场景只需实现该接口并给 `briefContentV` 增加联合成员（17 号）。

## 8. 时区

`todayIn(tz)` 用 `Intl.DateTimeFormat("en-CA", { timeZone: tz })`；Convex 默认运行时对 timeZone 选项的支持待验证。不支持时退化为 UTC 并在房间页显示 "Dates evaluated in UTC"。截止日语义：含当天（`deliveryDate <= deadline`）。
