# 06 规则引擎（part2）：日期、预算函数、场景插件接口、Role A 缺陷修正、共享校验器

> 分片清单见 part1。

## 6.6 日期、"今天"与时区（GAP-24、F06.6）

- 日历日期一律 `YYYY-MM-DD`，`assertCalendarDate` 校验真实日历日后按字典序比较。截止日语义："在截止日当天或之前交付"即合规（`deliveryDate ≤ deadline`）。
- "今天" = `todayInZone(nowMs, room.timeZone)`。实现优先用 `Intl.DateTimeFormat("en-CA", { timeZone })`；Convex 默认运行时对 `timeZone` 选项的支持待验证——若不支持，退回内置的固定偏移表（只覆盖允许选择的时区列表，夏令时按规则计算），并在房间设置里只提供该列表。
- mutation 中的 `Date.now()` 是本次执行的时间；query 中依赖"今天"的派生（`date.in_past`）在跨日时不会自动刷新，下一次任何数据变化时才重新计算。这是可接受的：执行前 G-E2 在 mutation 里用当时时间重算，过期方案无法执行。界面在提案卡上显示"evaluated at {time}"。
- 事件时间显示按查看者浏览器时区；规则判断永远按房间时区（RA-X03）。

## 6.7 预算函数

```ts
type BudgetEval = { ok: boolean; reasonCode: "ok" | "budget.over_cap" | "budget.cap_below_committed";
  capCents: number; committedBeforeCents: number; committedAfterCents: number; headroomCents: number; overByCents: number };

export function checkBudget(capCents: number, committedBeforeCents: number, amountCents: number): BudgetEval {
  const after = committedBeforeCents + amountCents;
  const headroom = capCents - committedBeforeCents;
  if (capCents < committedBeforeCents)
    return { ok: false, reasonCode: "budget.cap_below_committed", capCents, committedBeforeCents,
             committedAfterCents: after, headroomCents: headroom, overByCents: after - capCents };
  const ok = after <= capCents;                           // 等于上限算通过
  return { ok, reasonCode: ok ? "ok" : "budget.over_cap", capCents, committedBeforeCents,
           committedAfterCents: after, headroomCents: headroom, overByCents: Math.max(0, after - capCents) };
}
```

规则一句话（F06.3 原文改写）："A proposal is executable only if committedCents + amountCents ≤ budgetCapCents, evaluated against the constraint snapshot of the current version and re-evaluated inside the execution mutation against a freshly summed ledger. Pending proposals do not reserve budget; there is at most one current proposal per room."

## 6.8 场景插件接口

```ts
export interface ScenarioPlugin<TFields, TTerms, TAttrs, TState> {
  key: string; version: number;
  roles: { key: string; label: string; side: "buyer" | "seller";
           ownsCatalog?: boolean; approval?: "terms" | "budget" }[];
  proposerRole: string; reviewerRoles: string[]; maxRounds: number;

  brief: {
    fieldsZod: Record<string, z.ZodType<TFields>>;        // 每角色的确认字段（范围、长度、格式）
    draftZod: Record<string, z.ZodType>;                   // 草稿（允许不完整）
    fieldDecls: Record<string, { fieldKey: string; hard: boolean;
      defaultAudience: Audience; allowedAudiences: Audience["kind"][] }[]>;
    ruleKey(roleKey: string, fields: TFields): string;    // 规则相关字段的规范串
  };
  catalog: { attributesZod: z.ZodType<TAttrs> };
  scenarioState(ledger: LedgerRow[]): TState;            // 如 committedCents

  readiness(input: RuleInput): Readiness;
  enumerateCandidates(input: RuleInput, today: string, limits: CandidateLimits): Candidate<TTerms>[];
  checks(terms: TTerms, input: RuleInput, today: string): Check[];
  termsKey(terms: TTerms): string;
  requiredApprovals(input: RuleInput): { roleKey: string; approvalKind: "terms" | "budget" }[];

  deriveExecution(proposal: ProposalDoc, input: RuleInput): ExecutionDerivation;   // 纯函数，审批界面预览也用它
  writeExecution(ctx: MutationCtx, executionId: Id<"executions">, d: ExecutionDerivation): Promise<void>;

  planHumanRequests(reason: EscalationReason, input: RuleInput, run: RunSnapshot): RequestDraft[];
  questionCatalog: Record<string, QuestionDecl>;
  reasonCodes: { reviewer: string[]; proposerReject: string[]; humanReject: string[] };
  paramAudience: Record<string, Record<string, ParamAudience>>;   // reasonCode / questionKey → 参数 → 受众规则
  budgetProjection(viewerRole: string, input: RuleInput, terms?: TTerms): BudgetView | null;

  templates: TemplatePack;   // 事件、检查、请求、提案摘要的英文模板（按受众）
  promptPack: PromptPack;    // 规则说明、角色章程、上下文渲染、问题与理由码的说明文字、PROMPT_VERSION
  stubPolicy: StubPolicy;    // 10 part6
  fixtures: Record<string, FixtureSpec>;   // 14 §14.8
}
```

注册表 `convex/scenarios/index.ts` 导出 `SCENARIOS: Record<string, ScenarioPlugin>`；引擎只通过 `getScenario(room.scenarioKey, room.scenarioVersion)` 取用。第二个场景如何落入这个接口见 17 §17.2。

`requiredApprovals` 首个场景固定返回 `[{customer, terms}, {provider, terms}, {finance, budget}]`（F08.2、F08.3）；它在提案创建时快照，之后场景代码变化不影响已存在的提案。

## 6.9 对 Role A 规则缺陷的修正

| 缺陷 | 本设计的修正 | 回归用例（16） |
| --- | --- | --- |
| RA-B01 "Matches current constraints" 只比版本号 | `scope.required` 与 `date.deadline` 两项检查；检查集标题改为 "Checked against constraints v{n}" | RG-01 |
| RA-B02 改简报不递增约束版本 | ruleKey 变化即 `bumpConstraints`（09 §9.3） | RG-02 |
| RA-B04 不核对来源，改价后旧提案仍可执行 | `engine.sources`：引用的条目版本必须仍有效；改价 = 新版本 = 约束版本 +1 | RG-03 |
| RA-B10 两套日期校验不一致 | 单一 `assertCalendarDate`，Convex 入口与 Zod 都调用它 | RG-08 |
| RA-B11 没有日期语义 | `date.deadline`、`date.today`、`date.rush` | RG-09 |
| RA-B12 "条目数最多"的固定规则可能选中只含可延后项的报价 | 候选必须包含全部必需项；排序只用于展示与 stub，选择交给代理或人 | RG-01 |
| RA-B13 deferred 用报价并集计算 | `deferred = (requested − executedItemKeys) − itemKeys`，并由 `scope.deferred` 校验 | RG-16 |
| RA-R11 约束变化后复制 revalidated 提案 | 同一提案在新版本下重新评估，可执行则进入重新审批（04 T2） | RG-06 |

## 6.10 共享校验器（单一来源）

`convex/engine/validate.ts` 导出 `assertCents`、`assertCalendarDate`、`assertItemKey`（`/^[A-Z][A-Z0-9_]{1,23}$/`）、`assertShortText(s, max)`、`assertTimeZone`（允许列表）。规则：

- 每个 public mutation 的金额、日期、键、文本参数都经这些函数校验；场景 Zod schema 用 `.superRefine` 调用同一组函数，所以表单校验、种子数据、模型输出映射、mutation 入口共享同一套判断（RA-R03）。
- 浏览器端可以导入这些纯函数做即时反馈，但服务端总会再校验一次。
- 金额输入：UI 接受 `$1,234.50` 这类文本，`parseDollarsToCents`（严格：`^\$?\d{1,7}(,\d{3})*(\.\d{1,2})?$` 去逗号后计算整数美分，不经浮点乘法）；服务端只接受整数美分参数。
