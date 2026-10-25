# 06 确定性规则与场景插件（part2）：插件接口与引擎职责

## 6.9 插件接口（`engine/scenario.ts`）

```ts
import type { Validator } from "convex/values";

export interface ScenarioTypes {
  key: string; roleKey: string; listKey: string;
  briefFields: Record<string, object>;   // 按 roleKey
  listItemData: Record<string, object>;  // 按 listKey
  selection: object;                     // 候选"选了什么"
  terms: TermsBase;                      // 人批准的完整条款
}
export interface ItemRef { listKey: string; itemKey: string; version: number }
export interface TermsBase { scenario: string; refs: ItemRef[] }
export type Capability = `list.author:${string}` | "ledger.manage" | "proposal.author";

export interface RoleSpec<T extends ScenarioTypes> {
  key: T["roleKey"]; label: Text;
  capabilities: Capability[];
  signoff?: { kind: string; label: Text };     // 有则为必需签核人
  joinDisclosure: Text;                        // 接受邀请时展示的披露基线
}
export interface FieldSpec {
  key: string; label: Text;
  kind: "rule" | "preference";                 // rule：确认后变化即递增约束版本
  requiredForConfirm: boolean;
  format: "cents" | "date" | "dates" | "integer" | "item_keys" | "text" | "custom"; // custom → templates.fieldValueText
  disclosure: {
    allowed: boolean; defaultAudience: "none" | "room" | string[];
    implicitInTerms?: boolean;   // 值会出现在提案条款中：引擎强制受众为 room，并在确认时警告
  };
}
export interface BriefSpec<T extends ScenarioTypes, R extends T["roleKey"]> {
  fields: FieldSpec[];
  validate(f: Partial<T["briefFields"][R]>, ctx: ValidationCtx<T>): FieldIssue[];
  notesMaxChars: number; sharedNoteMaxChars: number;
}
export interface DerivedFactSpec<T extends ScenarioTypes> {
  key: string; ownerRoleKey: T["roleKey"]; label: Text; format: FieldSpec["format"];
  disclosure: FieldSpec["disclosure"];
  compute(view: RuleView<T>): number | string;
}
export interface ListSpec<T extends ScenarioTypes, L extends T["listKey"]> {
  key: L; label: Text; authorRoleKey: T["roleKey"]; maxItems: number;
  validate(data: T["listItemData"][L], ctx: ValidationCtx<T>): FieldIssue[];
}
export interface CheckSpec<T extends ScenarioTypes> {
  id: string; inputs: FieldRef[];
  evaluate(terms: T["terms"], view: RuleView<T>):
    { status: "pass" | "fail"; reasonCode: string; params: CheckOutcome["params"] };
}
export interface ClarifyTopicSpec {
  key: string; targetRoleKey: string; askerRoleKeys: string[];
  fieldRefs: FieldRef[];                       // 回答"共享"即披露这些字段
  label: Text;
}
export type TradeoffIntent =
  | { type: "patch_brief"; patch: Record<string, unknown> }   // 由插件给出补丁
  | { type: "edit_list"; listKey: string; baseItemKey?: string }
  | { type: "decline" };
export interface TradeoffDraft {
  targetRoleKey: string; blockingReasonCodes: string[];
  options: { key: string; intent: TradeoffIntent; enables: string[] /* candidateKeys */ }[];
}
export interface TaskDraft { title: Text; itemKey?: string; assigneeRoleKey: string; dueDate: IsoDate }

export interface ScenarioPlugin<T extends ScenarioTypes> {
  key: T["key"]; version: number; label: Text; currency: "USD";
  roles: RoleSpec<T>[];
  briefs: { [R in T["roleKey"]]: BriefSpec<T, R> };
  lists: { [L in T["listKey"]]: ListSpec<T, L> };
  derivedFacts: DerivedFactSpec<T>[];
  ledger: { ownerRoleKey: T["roleKey"] } | null;   // null = 场景不涉及金额台账
  readiness(view: RuleView<T>): { ready: boolean; missing: { code: string; roleKey?: string }[] };
  candidates: {
    enumerate(view: RuleView<T> | ScopedRuleView<T>): { key: string; selection: T["selection"] }[];
    toTerms(sel: T["selection"], view: RuleView<T>): T["terms"] | { error: string };
    selectionOf(terms: T["terms"]): T["selection"];
    compare(a: T["terms"], b: T["terms"]): number;   // 全序，确定性
    maxCandidates: number;
  };
  checks: CheckSpec<T>[];
  negotiation: {
    proposerRoleKey: T["roleKey"]; reviewerRoleKeys: T["roleKey"][];
    maxRounds: number; maxRankedCandidates: number;
    clarifyTopics: ClarifyTopicSpec[];
    rejectReasonCodes: string[]; counterReasonCodes: string[];
  };
  tradeoffs(view: RuleView<T>, report: FeasibilityReport): TradeoffDraft[];
  records: {
    commitmentCents(terms: T["terms"]): number;      // 无台账场景返回 0
    tasks(terms: T["terms"], view: RuleView<T>): TaskDraft[];
    snapshotFields: FieldRef[];                      // 执行时冻结的事实，如 finance.budgetCapCents，读时按披露投影
    agreementPrefix: string;                         // "CO"
  };
  templates: ScenarioTemplates<T>;                   // 6.10
  agent: {
    systemRules: string;                             // 静态，可缓存
    roleBrief: { [R in T["roleKey"]]: string };      // 角色职责说明，静态
    describe(ctx: AgentContextData<T>): string;      // 结构化上下文 → 文本块
    stub(roleKey: T["roleKey"], ctx: AgentContextData<T>): ModelMove; // 确定性替身
  };
  validators: {                                      // Convex 存储校验器（v.*）
    briefFields: Validator<any>; listItemData: Validator<any>;
    terms: Validator<any>; selection: Validator<any>;
  };
  fixtures: FixtureSpec<T>[];
}
```

`ModelMove`、`AgentContextData` 的定义见 05 与 10；`FieldRef`、`RuleView`、`CheckOutcome`、`FeasibilityReport` 见 part1。

## 6.10 模板接口

```ts
export interface ViewerCtx { roleKey: string; seatId: string; locale: "en"; visible: (f: FieldRef) => boolean }
export interface ScenarioTemplates<T extends ScenarioTypes> {
  candidateLabel(sel: T["selection"], v: ViewerCtx): string;          // "LOGIN + REPORTS · standard"
  termsSummary(terms: T["terms"], v: ViewerCtx): string;              // 公共一句话
  termsLines(terms: T["terms"], view: ProjectedFacts, v: ViewerCtx): Line[]; // 角色化明细（买方预算行等）
  checkText(c: ProjectedCheck, v: ViewerCtx): string;                 // full 与 verdict_only 两套措辞
  diffText(d: TermsDiff, v: ViewerCtx): string[];                     // 结构化差异 → 文本
  tradeoffText(d: TradeoffDraft, opt: string | null, v: ViewerCtx): string;
  clarifyText(topicKey: string, v: ViewerCtx): string;
  reasonText(code: string, v: ViewerCtx): string;                     // 立场与约束变化的公开原因
  fieldValueText(roleKey: string, fieldKey: string, value: unknown, v: ViewerCtx): string; // 披露预览与共享事实
}
```

所有模板的输入只能是结构化字段、规范化金额与日期、原因码；模板在 query 中按查看者渲染，不存渲染后的文本（07 第 7.7 节）。`ProjectedFacts` 是已按查看者投影过的派生事实（例如买方才有 `headroomCents`），模板无法拿到未投影的值。

## 6.11 UI 片段接口（`scenarios/<key>/ui`，仅客户端）

```ts
export interface ScenarioUi {
  BriefFieldsForm: React.FC<{ roleKey: string; value: Partial<object>; onChange(v: Partial<object>): void;
                              lists: ListItemDTO[]; issues: FieldIssue[] }>;
  ListEditors: Record<string, React.FC<{ items: ListItemDTO[]; canEdit: boolean;
                                          onSaveDraft(itemKey: string, data: object): void }>>;
  TermsView: React.FC<{ terms: object; lines: Line[] }>;
  RolePanels?: Record<string, React.FC<{ workspace: WorkspaceDTO }>>;  // 如 finance 的 BudgetPanel
}
```

UI 片段只渲染服务端已投影的 DTO；它拿不到 RuleView。服务端插件入口（`scenarios/<key>/index.ts`）不得导入 `ui/`，否则 Convex 打包会引入 React（11）。

## 6.12 引擎提供什么

| 能力 | 引擎实现位置 | 场景只需提供 |
| --- | --- | --- |
| 用户、房间、席位、邀请、一人一席 | `convex/engine/rooms.ts`、`invites.ts` | `roles` |
| 简报草稿与不可变版本、逐字段披露、规则字段差异检测 | `convex/engine/briefs.ts`、`engine/disclosure.ts` | `briefs`、`derivedFacts`、`validators.briefFields` |
| 共享清单的草稿/确认/取代/撤回与版本 | `convex/engine/lists.ts` | `lists`、`validators.listItemData` |
| 金额台账（基线、执行承诺、作废） | `convex/engine/ledger.ts` | `ledger.ownerRoleKey`、`records.commitmentCents` |
| 约束版本与修订快照（唯一入口 `bumpConstraints`） | `convex/engine/constraints.ts` | 无 |
| 规则视图组装、作用域视图、检查投影、引擎检查 | `convex/engine/ruleView.ts`、`engine/projection.ts` | `checks`、`inputs` 声明 |
| 候选按角色过滤、提出方排序选择、可行性分析 | `engine/feasibility.ts` | `candidates`、`compare` |
| 协商协议、run/回合编排、重试、看门狗、过期拒收、用量 | `convex/engine/negotiation.ts`、`convex/runtime/*` | `negotiation`、`agent` |
| 模型调用、结构化输出 schema 生成、解析、stub 运行器 | `convex/runtime/model.ts`、`engine/protocol.ts` | `agent.describe`、`agent.stub` |
| 提案（不可变、termsKey、必需签核快照）与签核、完成判定 | `convex/engine/proposals.ts`、`decisions.ts` | `roles[].signoff` |
| 原子幂等执行、执行记录、承诺、任务 | `convex/engine/execution.ts` | `records` |
| 人工请求生命周期（取舍、偏好、披露） | `convex/engine/requests.ts` | `tradeoffs`、`clarifyTopics` |
| 事件、受众、读时渲染分发 | `convex/engine/events.ts`、`engine/render.ts` | `templates` |
| 权限（由 `capabilities` 生成动作×角色矩阵） | `convex/engine/authz.ts` | `capabilities` |
| seed 运行器（按 fixture 步骤调用引擎写入路径） | `convex/ops/seed.ts` | `fixtures` |

## 6.13 场景不得做的事

1. 不得访问数据库、`ctx`、身份、环境变量、时间、随机数、网络或模型。
2. 不得输出未经 `assertCents` 的金额；不得让模板接触未投影的私密值。
3. 不得定义状态迁移或绕过 `bumpConstraints`；不得自定义签核完成规则（只声明谁签、签什么类型）。
4. 不得在 `agent.describe` 中放入他方私密字段：`describe` 的输入 `AgentContextData` 由引擎按作用域视图组装，插件只负责排版。

## 6.14 注册（应用组合层，不属于引擎）

```ts
// scenarios/registry.ts
import { scopeChange } from "./scope-change";
export const scenarios = { scope_change: scopeChange } as const;
export type ScenarioKey = keyof typeof scenarios;

// convex/schema.ts
import { defineSchema } from "convex/server";
import { v } from "convex/values";
import { engineTables } from "./engine/tables";
import { scopeChange } from "../scenarios/scope-change";
export default defineSchema(engineTables({
  scenarioKey: v.literal("scope_change"),               // 第二场景：v.union(v.literal("scope_change"), v.literal("event_budget"))
  briefFields: scopeChange.validators.briefFields,     // 第二场景：v.union(a, b)
  listItemData: scopeChange.validators.listItemData,
  terms: scopeChange.validators.terms,
  selection: scopeChange.validators.selection,
}));
```

为保留字面量类型，联合在这里显式手写，不用 `.map` 生成（F03.13）。加一个场景 = 新增 `scenarios/<key>/` + 上述两处各加一项 + UI 注册表加一项；`engine/` 与 `convex/engine/` 不改。
