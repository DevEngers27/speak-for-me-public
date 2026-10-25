# 06 规则引擎与场景插件（事件溯源候选）

## 1. 决定

| # | 决定 | 理由 | 备选 |
| --- | --- | --- | --- |
| RE-1 | 规则是纯函数（不读库、不调模型、不读时钟），输入显式传入 `today` | 可脱离 Convex 单测；同一函数在 query、mutation、回放审计中给出相同结果 | 在 mutation 里内联判断：无法复用、无法回放 |
| RE-2 | 输出是 `checks[]` + `reasonCodes[]`，不是布尔值 | reasonCode 是规则与文本、披露、人工请求之间的唯一接口（F06.7） | 布尔 + 文本消息：文本会带出数字 |
| RE-3 | 规则在**四个调用点**运行：候选枚举、提案创建（写快照）、`rooms.view`（实时可执行性）、`approvals.decide`（执行前重算） | 快照只用于审计，执行永远重算 | 只在代理回合算一次 |
| RE-4 | 规则版本化：`scenarioVersion` 写进 room_created；规则代码按 `scenarioVersion` 分派 | 回放与审计时能用"当时的规则"解释"当时的结果"；事件溯源下这是必须的 | 规则只有最新版：旧事件的 validation 快照无法复核 |

## 2. 输入与输出

```ts
// convex/engine/rules/types.ts
type RuleInput = {
  scenarioVersion: number;
  today: string;                         // 房间时区下的 YYYY-MM-DD，由调用方算
  catalog: CatalogItemCurrent[];         // 每个 itemKey 的最新 confirmed 版本
  customer: CustomerBriefContent;        // 最新确认版本
  budget: { totalCents: number };
  committedCents: number;
  proposal: { lines: Line[]; terms: TermLine[]; amountCents: number; deliveryDate: string;
              constraintsVersion: number };
  roomConstraintsVersion: number;
};
type Check = { code: ReasonCode; ok: boolean; owner: "customer" | "finance" | "provider" | "system" };
type ValidationResult = { ok: boolean; checks: Check[]; reasonCodes: ReasonCode[];   // 失败项
  amounts: { recomputedCents: number; committedAfterCents: number; headroomAfterCents: number } };
```

## 3. 检查清单（`validateProposal`，scope_change v1）

| # | 检查 | 失败 reasonCode | owner | 说明 |
| --- | --- | --- | --- | --- |
| 1 | 每个行项目的 `(itemKey,itemVersion)` 是当前已确认目录的最新版本 | `UNKNOWN_ITEM` / `SOURCE_SUPERSEDED` | provider | 改价后旧提案报 SOURCE_SUPERSEDED（RA-B04 回归） |
| 2 | 金额重算：`Σ lines.priceCents + Σ applicable terms.deltaCents === proposal.amountCents` | `AMOUNT_MISMATCH` | system | 防御性：提案金额本来就由代码算，失配说明有 bug |
| 3 | `customer.requiredItemKeys ⊆ itemKeys` | `MISSING_REQUIRED_ITEM` | customer | 必需项不能靠"显式延后"通过（裁决开放决定 11） |
| 4 | `today ≤ deliveryDate` | `DATE_IN_PAST` | system | — |
| 5 | `deliveryDate ≥ earliestDate(lines, terms, today)` | `DATE_BEFORE_LEAD_TIME` | provider | 加急 term 存在时用 rushLeadDays |
| 6 | `deliveryDate ≤ customer.deadline` | `DATE_AFTER_DEADLINE` | customer | 硬约束；preferredDate 只影响排序，不是检查 |
| 7 | `budget.totalCents ≥ committedCents` | `BUDGET_BELOW_COMMITTED` | finance | 先于 8 判断 |
| 8 | `committedCents + amountCents ≤ budget.totalCents`（等于算通过） | `OVER_BUDGET` | finance | 在执行事务内对当前存储值重算 |
| 9 | `proposal.constraintsVersion === roomConstraintsVersion` | `CONSTRAINTS_CHANGED` | system | 标签写 "Checked against constraints v{n}"，不写 "Matches current constraints"（RA-B01） |

`ok = checks.every(c => c.ok)`。预算规则原文："Budget check: committedCents + proposal.amountCents <= totalBudgetCents, evaluated inside the approval/execution mutation against current stored values. Pending proposals do not reserve budget; one current proposal per room."

**尚未检查的事项**（如实写明）：付款条件、provider 产能冲突、报价有效期（17 扩展点）。

## 4. 候选枚举 `enumerateCandidates`

```ts
function enumerateCandidates(i: Omit<RuleInput, "proposal"> & { view: "buyer" | "seller" }): Candidate[]
```

1. 子集枚举：当前已确认目录（v1 ≤ 5 项 → ≤ 31 个非空子集）× 交付方式 {standard, rush（所有条目都有 rushLeadDays 时）}。
2. 每个组合：`lines` 来自目录最新版本；`terms` = rush 时加 `RUSH`；`deliveryDate` = `today + max(leadDays)`（日历日）；`amountCents` 求和；`deferredItemKeys` = (required ∪ desired ∪ deferrable) − itemKeys。
3. 对每个组合跑 `validateProposal`（constraintsVersion 取当前，检查 9 恒过）。
4. `view: "seller"`：只过滤 owner = customer 且字段已共享的失败项（3、6）与 provider/system 项；**不按 7、8 过滤**（05 §3）。`view: "buyer"`：过滤全部失败项。
5. 排序：满足必需项 → desired 覆盖数降序 → 交付日升序 → 金额升序；取前 `MAX_CANDIDATES`。
6. 大目录（> 12 项）扩展点：固定必需项后按优先级贪心加入，上界 `MAX_ENUMERATED = 4096`（17）。

`findFeasible = enumerateCandidates({view:"buyer"}).length > 0` 是 run 开始的预检；stub 代理直接取 buyer 视角排序第一的候选（与 Role A 的 bestFeasibleOption 不同：它尊重必需项与截止日）。

## 5. reasonCode 清单与按角色投影

```ts
export const REASON_CODES = [
  "OK", "UNKNOWN_ITEM", "SOURCE_SUPERSEDED", "AMOUNT_MISMATCH", "MISSING_REQUIRED_ITEM",
  "DATE_IN_PAST", "DATE_BEFORE_LEAD_TIME", "DATE_AFTER_DEADLINE", "BUDGET_BELOW_COMMITTED",
  "OVER_BUDGET", "CONSTRAINTS_CHANGED", "NO_FEASIBLE_CANDIDATE", "NEEDS_TRADEOFF",
  "ROUNDS_EXHAUSTED", "CALL_LIMIT_REACHED", "CLARIFY_REQUIRED_ITEMS", "CLARIFY_DEADLINE",
  "CLARIFY_BUDGET_HEADROOM", "CLARIFY_LEAD_TIME",
  // 仅用于 provider 投影：
  "EXCEEDS_FINANCE_LIMIT", "CONFLICTS_WITH_CUSTOMER_CONSTRAINT",
] as const;
```

| 原始 code | buyers 看到 | provider 看到 |
| --- | --- | --- |
| OVER_BUDGET（+ shortfallCents） | OVER_BUDGET + "over by $100" | EXCEEDS_FINANCE_LIMIT（无数字） |
| BUDGET_BELOW_COMMITTED | 原样 + 数字 | EXCEEDS_FINANCE_LIMIT |
| DATE_AFTER_DEADLINE / MISSING_REQUIRED_ITEM（字段已共享） | 原样 | 原样 |
| 同上（字段未共享） | 原样 | CONFLICTS_WITH_CUSTOMER_CONSTRAINT |
| 其余 | 原样 | 原样 |

投影函数 `projectReasonCodes(codes, viewerRole, sharedFields)` 在 `rooms.view`、`renderEvent`、`buildAgentContext` 三处共用。

面向客户端的命令错误另有一组：`NOT_AUTHENTICATED`、`NOT_MEMBER`、`FORBIDDEN_ROLE`、`ROOM_CLOSED`、`INVALID_INPUT`、`INVALID_STATE`、`STALE_PROPOSAL`、`ALREADY_EXECUTED`、`BRIEFS_INCOMPLETE`、`INVITE_INVALID`、`ROLE_TAKEN`、`ALREADY_MEMBER`、`AGENTS_DISABLED`、`RUN_ACTIVE`。统一 `throw new ConvexError({ code })`（query 未认证返回 null），消息不含数值。

## 6. "今天"与时区

- `room_created.timeZone`（IANA，如 `America/Los_Angeles`）。`today = toLocalDate(event.at 或 Date.now(), timeZone)`。
- 实现：`Intl.DateTimeFormat("en-CA", { timeZone })`；Convex 默认运行时对 timeZone 选项的支持**待验证**，不支持时退回场景配置的固定 UTC 偏移，并在 UI 标注。
- 回放审计用事件的 `at` 计算当时的 today，因此 validation 快照可复核。

## 7. 场景插件接口

```ts
// convex/engine/scenario.ts
export interface ScenarioPlugin {
  key: "scope_change"; version: number;
  roles: readonly { role: Role; side: "buyer" | "seller"; label: string }[];
  requiredApprovals: readonly { role: Role; kind: "terms" | "budget" }[];   // 快照进提案
  maxRounds: number;
  brief: Record<Role, { zodForForm: ZodType; hardFields: readonly string[]; shareableFields: readonly string[];
                        defaultShared: readonly string[] }>;
  catalog: { validateItem(input: unknown): CatalogItemInput; termKinds: readonly "rush_fee"[] };
  validate(i: RuleInput): ValidationResult;
  enumerateCandidates(i: CandidateInput): Candidate[];
  buildHumanRequest(s: RuleState, reason: ReasonCode): HumanRequestDraft | null;
  deriveTasks(lines: Line[], catalog: CatalogItemCurrent[], operationId: string): TaskDraft[];
  templates: TemplateSet;                       // 每个事件类型 × 角色的英文模板
  agentBriefing: { protocolText: string; scenarioRules: string };  // 稳定前缀（可缓存）
  fixtures: Record<string, FixtureDef>;         // 14 §6
}
```

- 引擎只认 `Role`、`ReasonCode`、事件与候选；简报内容、目录字段、模板属于插件。
- v1 的 `Role` 是三值字面量，schema 中简报内容是按 scenario 判别的联合；第二个场景加入时扩展联合与 Role（17 §1 说明对引擎接口的要求）。
- 任务派生：每个批准的行项目按目录 `taskTemplates` 生成任务，`taskKey = ${operationId}:${itemKey}:${n}`，assignee 为 provider，不调模型。

## 8. 调用点汇总

| 调用点 | 函数 | 用途 | 失败时 |
| --- | --- | --- | --- |
| `run_started` 反应器 | enumerateCandidates(buyer) | 预检 | needs_input + 人工请求 |
| `scheduleTurn` | enumerateCandidates(按回合角色视角) | 生成 candidateIds 与上下文 | — |
| `completeTurn`（propose） | validate | 写 `proposal_created.validation` 快照 | 仍创建提案（事实：代理提议了它），快照 ok=false |
| `rooms.view` | validate | 实时可执行性与阻断原因 | 显示 blocked |
| `approvals.decide` | validate | approve 前置检查 + 执行前重算 | approve 被拒 `INVALID_STATE`；执行不发生 |
| `audit.verifyRoom` | validate（按 scenarioVersion） | 复核快照 | 报告差异 |
