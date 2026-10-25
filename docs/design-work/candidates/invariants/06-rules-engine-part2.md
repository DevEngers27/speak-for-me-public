# 06 确定性规则与校验 · part2：可行性枚举、取舍生成、简报校验、执行派生、场景插件接口

## 8. 可行性枚举 `enumerateFeasible`

```ts
export function enumerateFeasible(inp: RuleInputs, today: string):
  { packages: Package[]; exhaustive: true };
type Package = { lines: LineRef[]; deliveryDate: string; includedItemKeys: string[]; amountCents: number };
```
算法（深度优先 + 剪枝）：
1. 每个请求项的候选 = 当前 provider 版本中该项的有效行（未过期）；可延后项另加"省略"。某必需项没有候选 → 立即返回空集。
2. 必需项在前，项内按价格升序；维护累计金额与最大 earliest。剪枝：`committed + 累计 > cap`；`max(earliest, today) > deadline`。
3. 叶子：`deliveryDate = max(maxEarliest, today)`，物化条款后**调用 `evaluateProposal` 判定**，只收 verdict = pass 的包。由此枚举器与评估器不可能分歧（16 的性质测试断言：枚举出的包全部通过评估；在规模上限内随机生成的通过评估的包都被枚举到）。
4. 排序（用于 choose_package 展示）：包含项多者优先 → 满足 preferredDate 者优先 → 金额低者优先 → lineKey 字典序（保证确定性）。

**规模保证穷举**：`validateBrief` 限制请求项 ≤ 8、每项变体 ≤ 3，叶子数 ≤ 4^8 = 65,536，加内部节点约 9 万次常数操作，在 mutation 内可完成（耗时待验证，16 有基准测试）。因为穷举有保证，"可行集为空"是一个真陈述，可以据此向人发取舍请求而不伪造结论（SIM-2）。若将来放宽上限，必须改为带 `exhaustive: false` 的结果，且在非穷举时不得声称"无可行方案"（17）。

## 9. 取舍生成 `tradeoffs`（供 `openRequests`，HR-1、HR-3）

```ts
export function tradeoffs(inp: RuleInputs, publicProposals: Proposal[], today: string): RequestDraft[];
```
1. **make_optional**（目标 customer）：对必需项的非空子集 S 按大小递增（|R| ≤ 8，至多 255 个），若把 S 改为可延后后 `enumerateFeasible` 非空，则生成选项 `make_optional{S}`；取最小的至多 3 个。customer 只得到"这样存在可行方案"这一存在位与示例包包含的项，不得到价格或预算。
2. **relax_deadline_to_fit**（目标 customer）：本房间已公开的提案中，在当前输入下唯一失败项是 `DELIVERY_AFTER_DEADLINE` 的，生成 `toDate = 该提案 deliveryDate`；取包含项最多的至多 2 个。
3. **raise_cap_to_fit**（目标 finance）：已公开提案中唯一失败项是 `OVER_BUDGET` 的，生成 `toCents = committed + amountCents`；至多 2 个。
4. **revise_offer**（目标 provider，导航型）：失败类别含 OVER_BUDGET、日期或某必需项无报价时生成，itemKeys = 涉及的项；provider 只看到 reasonCode。
5. 每个有至少一个可执行选项的目标得到一条请求（附 `decline`）；revise_offer 视为可执行选项。`groupKey = "tradeoff:{runId}:{constraintsVersion}"`。
6. 若五类都为空（例如总额不足且没有任何公开提案、也没有可延后组合），仍给 finance 与 customer 各发一条只有"去编辑约束 / decline"的请求，问题码 `NO_FEASIBLE_PACKAGE`——系统如实说明"在当前约束下找不到方案"，不编造选项。

## 10. 简报校验与规则差异

`scenario.brief.validate(role, content, ctx)` 返回 `Issue[]`（`{ path, code }`），在 `briefs.saveDraft`（提示）与 `commitBriefVersion`（强制）都调用：
- 通用：字符串长度上限；金额 `assertCents`；日期 `isoDate`；acknowledgements ⊇ 场景要求（BR-5）；disclosures 的 field 必须是该角色可披露字段，受众角色必须是场景角色。
- customer：itemKey 格式与唯一；1 ≤ 请求项 ≤ 8；`requiredItemKeys ⊆ requested`；`preferredDate ≤ deadline`（若有）。
- provider：每项变体 ≤ 3；(itemKey, variantKey) 唯一；itemKey 不在当前请求内时给出警告（允许确认，但这些行在评估中产生 ITEM_UNKNOWN）；`validUntil ≥ today`（若有）。
- finance：`externalCommittedCents ≤ budgetCapCents`；`budgetCapCents ≥ ctx.committedCents`（`BUDGET_BELOW_COMMITTED`，EX-5——审查 F06.3 建议改为进入 needs_input，本设计选择拒绝写入以保持全局不变量，见 18 ADR-11）。

`scenario.brief.ruleDiff(role, prev, next) → string[]`：
| 角色 | 规则字段（任何深度差异即列出） | 非规则字段 |
| --- | --- | --- |
| customer | `requestedItems`（含 title、description）、`requiredItemKeys`、`deadline` | `preferredDate`、`notes`、disclosures、acknowledgements |
| provider | `offerLines` | `capacityNotes`、`notes`、disclosures |
| finance | `budgetCapCents`、`externalCommittedCents` | `paymentNotes`、`notes`、disclosures |

首次确认（无 prev）时返回全部规则字段，因此必然 bump。

## 11. 执行派生 `deriveExecution`

```ts
export function deriveExecution(terms: ScTerms, scenarioVersion: number): ExecutionDraft {
  return {
    recordKind: "change_order",
    amountCents: terms.amountCents,
    tasks: terms.lines.map(l => ({ itemKey: l.itemKey, title: l.taskTitle,
                                   assigneeRoleKey: "provider", dueDate: terms.deliveryDate })),
  };
}
```
纯函数、不调模型；`taskTitle` 来自 provider 确认的报价行并随提案快照，所以任务内容在审批时已确定，审批界面可以预览（Role A Q10：不需要哈希，"由不可变条款 + 固定模板版本确定性派生"即可）。

## 12. 场景插件接口

```ts
export interface ScenarioModule<Brief, Terms, Output, Inputs> {
  key: string; version: number;
  roles: readonly RoleSpec[];        // { key, label, requiredApprover, approvalKind, hasAgent, requiredAcks }
  fields: readonly FieldSpec[];      // { role, path, kind: "rule" | "soft" | "note", disclosable, mandatoryDisclosure? }
  turnPlan: { proposer: string; evaluators: readonly string[]; maxRounds: number };
  brief: {
    validate(role: string, content: Brief, ctx: BriefCtx): Issue[];
    ruleDiff(role: string, prev: Brief | null, next: Brief): string[];
  };
  rules: {
    loadInputs(cs: ConstraintSetDoc, versions: BriefVersionDoc[]): Inputs;
    committedFrom(versions: BriefVersionDoc[], ledgerSum: number): number;
    materialize(sel: Selection, inp: Inputs): Terms | Issue[];
    evaluate(terms: Terms, inp: Inputs, today: string): Check[];
    enumerateFeasible(inp: Inputs, today: string): { packages: Selection[]; exhaustive: boolean };
    tradeoffs(inp: Inputs, publicProposals: ProposalDoc[], today: string): RequestDraft[];
    deriveExecution(terms: Terms, scenarioVersion: number): ExecutionDraft;
  };
  protocol: {
    outputSchemaFor(ctx: SchemaCtx): ZodType<Output>;
    validateMove(role: string, step: Step, out: Output, inp: Inputs, run: RunDoc): Issue[];
    questions: Record<string, QuestionSpec>;
    stubPolicy(role: string, ctx: AgentContext): Output;
    prompt: { system: string; roleCharter: Record<string, string> };
  };
  templates: TemplateSet;            // 公开文本、请求问题、选项、检查解释（按 reasonCode）
  fixtures: Record<string, FixtureSpec>;
}
```
`RoleSpec.requiredApprover` 与 `approvalKind` 生成提案上的快照（PR-6）；`FieldSpec` 生成 07 的字段 × 角色矩阵与披露表单；`turnPlan` 驱动 05 的回合计划。引擎通过 `convex/scenarios/registry.ts` 按 `rooms.scenarioKey` + `scenarioVersion` 取模块。

**引擎与场景的分工**：引擎拥有身份、成员、简报版本化与披露机制、约束集与 bump、run/回合/请求状态机、决定计数、执行事务骨架（幂等键、台账、指针、事件）、投影框架与派生闭包。场景拥有角色与字段声明、条款形状、检查集、可行性与取舍、执行派生、提示词与 stub、模板、fixture。

**能否容纳第二个场景**：以 event-budget（17）检验——角色 organizer / venue / finance；条款是场地套餐 + 餐饮行 + 日期；预算与台账沿用引擎；`turnPlan` 由 venue 提议、organizer 与 finance 评估。需要改动的只有三处联合 validator（简报内容、条款、代理输出 / 请求选项）各加一个成员，以及注册表。
