# 06 确定性规则与场景插件接口

## 6.1 原则
- 规则是纯函数：不调模型、不读数据库、不读时钟（`today` 作为参数传入）。同一函数在四处调用：回合提交（`completeTurn`）、读模型（`rooms.view` 实时可执行性）、执行事务（`decisions.submit`）、离线评测。
- 返回结构化 `reasonCode[]`，从不返回自由文本；文本由模板按查看者角色渲染。
- 检查项命名如实：UI 显示 "Checked against constraints v{n}"，并列出全部检查项（修正 Role A RA-R02 "Matches current constraints" 名不副实）。

## 6.2 输入快照

```ts
// engine/rules/types.ts
export type SystemView = {          // 只在代码中存在，永不进入任何代理上下文
  today: IsoDate; timeZone: string; constraintsVersion: number; catalogRevision: number;
  catalog: CatalogEntry[];          // 当前 confirmed 修订
  briefs: Record<string, unknown>;  // 各角色 confirmed brief.content（场景 Zod 已解析）
  budget: { totalCents: Cents; softHeadroomCents?: Cents };
  committedCents: Cents;            // Σ commitments
  preferences: Record<string, string>; // humanRequests 的 set_preference 答案（当前约束版本）
};
export type CatalogEntry = { id: string; itemKey: string; revision: number; kind: "scope" | "fee";
  priceCents: Cents; standardLeadDays?: number; rushLeadDays?: number; feeRule?: "rush_delivery"; title: string };
```

## 6.3 核心函数

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `materializeTerms` | `(candidateKey, sys) → ProposalTerms | {error: "UNKNOWN_ITEM" | "RUSH_UNAVAILABLE"}` | 解析键 → 条目；价格 = Σ scope 条目 + （rush 时）fee；日期 = today + max(各条目 lead days)；deferred = customer.requestedItemKeys − itemKeys；sourceRefs 来自目录 |
| `validateProposal` | `(terms, sys) → ReasonCode[]`（空 = OK） | 全部检查，见 6.4 |
| `checkBudget` | `(priceCents, sys) → {ok, code, headroomCents, shortfallCents}` | `committed + price ≤ total`（等于算通过） |
| `enumerateCandidates` | `(roleView) → Candidate[]` | 场景实现；输入是 RoleView（05 §5.3） |
| `analyzeFeasibility` | `(sys) → FeasibilityReport` | 05 §5.5 |
| `projectReasonCodes` | `(codes, viewerRole) → VisibleCode[]` | 按 07 §2 映射，provider 看不到数字型原因 |
| `deriveTasks` | `(terms, catalog, assignee) → TaskDraft[]` | 每个 scope 条目一个任务，dueDate = deliveryDate |
| `contentHash` | `(terms) → string` | 规范化 JSON（键排序、数组已排序）的 sha256（纯 JS 实现，避免 mutation 中 `crypto.subtle` 的可用性问题，待验证后可替换） |

## 6.4 `validateProposal` 检查清单（首个场景）

| 顺序 | 检查 | reasonCode | 数据来源 |
| --- | --- | --- | --- |
| 1 | 每个 itemKey 在当前 confirmed 目录中 | `UNKNOWN_ITEM` / `ITEM_NOT_CONFIRMED` | catalog |
| 2 | `terms.catalogRevision === sys.catalogRevision` 且 sourceRefs 修订号与当前一致 | `STALE_CATALOG` | catalog |
| 3 | 重新物化后的价格与日期等于 terms 中的值（防止任何外部篡改） | `STALE_CATALOG` | materializeTerms |
| 4 | `requiredItemKeys ⊆ itemKeys` | `MISSING_REQUIRED_ITEM` | customer brief |
| 5 | rush 时每个条目有 `rushLeadDays` 且 provider `rushAvailable` | `RUSH_UNAVAILABLE` | catalog + provider brief |
| 6 | `today ≤ deliveryDate ≤ hardDeadline` | `DATE_IN_PAST` / `DATE_AFTER_DEADLINE` | customer brief |
| 7 | `total ≥ committed` | `BUDGET_BELOW_COMMITTED` | budget + commitments |
| 8 | `committed + price ≤ total` | `OVER_BUDGET` | 同上 |
| 9 | 调用方提供的 `proposal.constraintsVersion === sys.constraintsVersion` | `STALE_CONSTRAINTS` | room |

必需条目被"延后"永远不算通过（与审查整理者建议一致）：只能经 humanRequest `make_deferrable`（硬约束变更 → bump）。

## 6.5 "今天"与时区
- `today = calendarDate(now, room.timeZone)`，在 mutation 中取 `Date.now()`（Convex mutation 中时间对单次执行确定，待验证其语义），作为参数传给纯函数。
- `Intl.DateTimeFormat` 的 timeZone 支持待验证；不支持时退化为房间配置的固定 UTC 偏移，并在房间设置页写明。
- 跨日造成的结果变化（例如今天过了截止日）属于"时间推移"，不 bump 约束；可执行性读时派生会自然翻转，`decisions.submit` 内重算兜底。

## 6.6 调用点

| 调用点 | 调用的函数 | 失败后果 |
| --- | --- | --- |
| `startRunInternal` | analyzeFeasibility | infeasible → R2 请求 |
| `scheduleTurns` | buildRoleView → enumerateCandidates | 候选为空 → 该角色 turn 的 allowedActions 只剩 reject/clarify |
| `completeTurn`（propose / counter） | materializeTerms → validateProposal | 硬违规 → `blocked_by_rules`，不插入 proposal |
| `rooms.view` | validateProposal（当前提案）→ projectReasonCodes | 显示 Blocked 与按角色的原因 |
| `decisions.submit(approve)` | validateProposal + checkBudget | 拒绝批准不可执行的版本（`NOT_EXECUTABLE`）；拒绝永远允许 |
| 执行 | checkBudget（重算）+ deriveTasks | 超预算 → 不执行，返回 `{executed:false, code}` |
| `budgets.update` | `total ≥ committed` | 否 → `ConvexError({code:"BUDGET_BELOW_COMMITTED"})`（ADR-12） |

## 6.7 场景插件接口

```ts
// engine/scenario.ts
export interface ScenarioPlugin<Briefs extends Record<string, unknown>> {
  key: string; version: number;
  roles: RoleSpec[];                       // roleKey、label、approvalKind、isProposer
  requiredApprovals: { roleKey: string; kind: "terms" | "budget" }[];
  proposerRole: string; tieBreakerRole: string; counterPriority: string[];
  limits: { maxRounds: number; modelCallLimit: number; maxCandidatesInPrompt: number };
  briefSchemas: { [R in keyof Briefs]: z.ZodType<Briefs[R]> };
  hardFields: { [R in keyof Briefs]?: (keyof Briefs[R])[] };
  disclosableFields: { [R in keyof Briefs]?: (keyof Briefs[R])[] };
  catalogRules: { itemKeyPattern: RegExp; maxItems: number; feeRules: string[] };
  materializeTerms(candidateKey: string, sys: SystemView): ProposalTerms | { error: ReasonCode };
  validate(terms: ProposalTerms, sys: SystemView): ReasonCode[];
  enumerateCandidates(view: RoleView): Candidate[];
  analyzeFeasibility(sys: SystemView): FeasibilityReport;
  clarifyTopics: ClarifyTopic[];
  deriveTasks(terms: ProposalTerms, sys: SystemView): TaskDraft[];
  templates: TemplateSet;                  // 事件、提案摘要、请求问题与选项、阻断原因（按查看者角色）
  promptCards: { charter: string; roleCards: Record<string, string>; rules: string }; // 10 §4
  fixtures: Record<string, ScenarioFixture>;
  evalCases: EvalCase[];                   // 16
}
```

为什么不做规则 DSL：两个场景之前无法知道共性；TypeScript 函数 + 固定接口足够，且可直接单测。第二场景到来时再抽象（17）。
