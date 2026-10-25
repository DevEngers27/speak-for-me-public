# 06 规则引擎与场景插件接口（part1：接口与引擎级检查）

> 本设计的方法：先同时写两个插件（14 的 `software_change`、本文件 part2 的 `event_budget`），再反推引擎必须提供什么、绝不能知道什么。part2 末尾给出"边界泄露清单"。

## 1. 目标与决定

| 目标 | 决定 | 被否决的备选 |
| --- | --- | --- |
| 规则可单测、query 与执行共用 | 所有规则是纯函数，输入是一个只读 `Snapshot`，不读库、不调模型 | 在 mutation 里内联检查（不可复用）；在前端检查（Role A 缺陷 RA-R02） |
| 引擎不认识场景词 | 引擎只认 `roleKey`、`catalogEntry`、`selection`、`derived`、`ledgerImpact`、`reasonCode`、`templateKey`；任何"范围、报价、交付日、人数"都只出现在插件里 | 引擎内建 `itemKeys/amountCents/deliveryDate` 字段（第二场景无法容纳） |
| 金额不由模型发明 | 金额只能由插件 `derive(selection, snapshot)` 从已确认的目录条目与已确认简报算出；模型只输出候选键 | 让模型给金额再核对（核对需要的数据与算出来一样多，且多一个失败面） |
| 预算算术只写一次 | 账本（ledger）是引擎原语：插件只声明 `ledgerImpact`，`committed + impact <= cap` 由引擎检查并在执行事务内重算 | 每个插件各写预算检查（两场景重复，且执行事务里无法统一重算） |
| 可行解由代码判定 | 插件 `enumerate(snapshot)` 返回有界候选集；空集即"不可行"，直接生成人工请求，不调模型 | 让模型多轮试探（README 原想法），贵且不确定 |

## 2. Snapshot：规则的唯一输入

`buildSnapshot(ctx, roomId)` 是 Convex 内部 helper（只在 query/mutation 内调用，结果**永不**直接返回客户端）：

```ts
type Snapshot = {
  roomId: Id<'rooms'>;
  scenarioKey: string; scenarioVersion: number;
  constraintsVersion: number;
  today: string;                          // YYYY-MM-DD，按 rooms.timeZone 计算（待验证：Intl 时区支持，见 18）
  roles: Record<RoleKey, { userId: string | null }>;   // 席位是否有人
  briefs: Record<RoleKey, { version: number; payload: unknown } | null>; // 仅已确认版本
  catalog: Array<{ entryKey: string; revision: number; authorRole: RoleKey;
                   status: 'confirmed'; payload: unknown; simulated: boolean }>; // 只含当前 confirmed 修订
  ledger: Record<string /*accountKey*/, { capCents: number; committedCents: number; currency: string }>;
};
```

- `committedCents` = `ledgerEntries` 按账户求和（台账是唯一真相，不存累计字段）。
- 插件拿到的 `payload` 是 `unknown`，必须先用自己的 Zod schema `parse`；解析失败返回 `engine.payload_invalid`（理论上不应发生，因为写入口已校验）。

## 3. ScenarioPlugin 接口（引擎侧 TypeScript 定义）

```ts
export interface ScenarioPlugin<B = any, C = any, S = any, D = any> {
  key: string; version: number; title: string;
  roles: Array<{ roleKey: string; label: string; side: 'requesting' | 'supplying' | 'controlling' }>;
  proposerRole: string;                               // 谁的代理起草提案
  requiredApprovals: Array<{ roleKey: string; kind: 'terms' | 'commitment' }>; // 代码常量，提案插入时快照
  briefs: Record<string, {
    schema: z.ZodType<B>;                             // 该角色结构化简报
    hardKey(payload: B): string;                      // 硬约束规范化串；变化才递增 constraintsVersion
    disclosable: Array<{ field: string; label: string; mandatoryFor?: string[] }>; // 可披露字段词表
  }>;
  catalog: {
    authorRoles: string[];                            // 谁能创建/确认目录条目
    schema: z.ZodType<C>;
    visibleTo(entry: { authorRole: string; payload: C }, viewerRole: string): boolean;
  };
  ledger: { accounts: Array<{ accountKey: string; ownerRole: string; visibleTo: string[]; currency: string }> };
  selection: z.ZodType<S>;                            // 提案的选择部分（只含键与离散选项）
  refs(sel: S): string[];                             // selection 引用的 entryKey，供引擎检查存在性
  derive(sel: S, snap: Snapshot): { ok: true; derived: D; ledgerImpact: LedgerImpact[] }
                                 | { ok: false; codes: ReasonCode[] };
  checks(sel: S, derived: D, snap: Snapshot): Check[];          // 场景级检查
  canonicalize(sel: S, derived: D): string;                      // contentKey，用于审批绑定与比较
  enumerate(snap: Snapshot, limit: number): Candidate<S, D>[];   // 只返回通过全部检查的候选
  tradeoffs(snap: Snapshot): HumanRequestDraft[];                // 不可行或僵持时向谁问什么
  applyAnswer(req: HumanRequestDraft, optionKey: string, snap: Snapshot): ConstraintPatch | ProposalFromOption;
  deriveExecution(sel: S, derived: D, snap: Snapshot): ExecutionPlan;
  templates: Record<string, Template>;                           // 公共文本模板（英文）
  project: { derived(d: D, viewerRole: string): unknown; brief(role: string, b: B, viewerRole: string): unknown };
  viewValidator: Validator<any>;                                 // Convex v 校验器，约束 project 的输出形状
  agent: AgentSpec<S, D>;                                        // 见 10：角色说明、上下文白名单、异议/话题码
  fixtures: Record<string, Fixture>;                             // 至少 feasible / tradeoff / infeasible
  maxRounds: number; enumerateLimit: number;
}
```

辅助类型：

```ts
type ReasonCode = `engine.${string}` | `ledger.${string}` | `${string}.${string}`; // 插件码带插件前缀
type Check = { code: ReasonCode; ok: boolean; params: Record<string, string | number>; audience: Audience };
type LedgerImpact = { accountKey: string; amountCents: number };    // 0 <= amountCents <= 100_000_000
type Candidate<S, D> = { candidateKey: string; selection: S; derived: D; ledgerImpact: LedgerImpact[]; rank: number };
type ConstraintPatch =
  | { kind: 'brief'; roleKey: string; patch: Record<string, unknown> }   // 由该角色本人确认后写成新简报版本
  | { kind: 'ledger_cap'; accountKey: string; newCapCents: number }       // 只能由账户 ownerRole 回答产生
  | { kind: 'none' };
type ProposalFromOption = { kind: 'proposal'; selection: unknown };
type ExecutionPlan = {
  documents: Array<{ docKind: string; audienceRoles: string[]; templateKey: string; body: Record<string, unknown> }>;
  tasks: Array<{ taskKey: string; title: string; assigneeRole: string }>;
  // ledgerEntries 不由插件给：引擎直接把 ledgerImpact 写成 kind 'execution' 的条目
};
type Audience = { kind: 'room' } | { kind: 'roles'; roles: string[] };
type AgentSpec<S, D> = {
  scenarioBrief: string;                         // 进入可缓存 system 前缀，跨角色相同
  roleInstructions: Record<string, string>;      // 每角色指令（不含任何私密值）
  declineCodes: string[]; objectionCodes: string[]; topicCodes: string[]; // 05 输出 schema 的枚举
  stubChoose(cands: Candidate<S, D>[], roleKey: string, kind: 'propose' | 'evaluate'): unknown; // 与模型同 schema
};
```

## 4. 引擎级检查（与场景无关，每次评估都跑）

`evaluate(plugin, proposal, snap) → { executable: boolean; checks: Check[] }`，纯函数，位于 `packages/engine/src/evaluate.ts`：

| 顺序 | reasonCode | 条件 | 失败后 |
| --- | --- | --- | --- |
| 1 | `engine.selection_invalid` | `plugin.selection.safeParse(proposal.selection)` 失败 | 终止，后续不跑 |
| 2 | `engine.catalog_unknown` | selection 引用的 entryKey 不在 `snap.catalog`（插件用 `refs(sel)` 暴露引用的 entryKey） | 终止 |
| 3 | `engine.derive_failed` | `derive` 返回 `ok:false`；codes 一并输出 | 终止 |
| 4 | `engine.content_drift` | `canonicalize(sel, derive(sel, snap))` ≠ `proposal.contentKey`，即在当前约束下这份提案的条款已不是当初那份 | 不可执行，需新提案 |
| 5 | `ledger.over_cap` | 对每个 impact：`committedCents + amountCents <= capCents`（等于算通过） | 不可执行 |
| 6 | `ledger.account_unknown` | impact 的 accountKey 未在插件声明 | 不可执行 |
| 7 | 插件 `checks` | 场景级（见 14、part2） | 任一 `ok:false` 即不可执行 |

`executable = 全部 ok`。**不检查**"提案是否为当前提案"与"审批是否齐全"——那是 08 的执行守卫，不属于规则引擎（避免混用两组守卫）。

`ledger.over_cap` 的 params 只有 `{accountKey, shortfallCents, headroomCents}`，其 `audience` 固定为 `{kind:'roles', roles: account.visibleTo}`；其他角色只拿到 code（模板渲染 "Blocked: exceeds the finance limit"）。

## 5. 调用点

| 调用点 | 函数 | 用途 | 结果是否落库 |
| --- | --- | --- | --- |
| 代理回合前 | `startRunInternal` / `scheduleTurn` helper | `enumerate` 得候选；空集→人工请求 | 候选集摘要写 `turns.candidateKeys` |
| 回合提交 | `internal.turns.complete` | 对模型选中的候选重新 `derive + evaluate`（防候选在回合期间失效） | 写 `proposals.validationSnapshot`（只作审计） |
| 读房间 | `rooms.view` | 实时算 `executable` 与按角色投影的 checks | 否（派生） |
| 审批 | `decisions.decide` | approve 要求 `executable`；reject 不要求 | 否 |
| 执行 | 同上 mutation 内 | 用事务内新建的 snapshot 再算一次 | 写 `executions` |
| 约束变更 | `bumpConstraints` 之后 | 判断当前提案是否可保留（09） | 否 |

## 6. 不变量（规则侧）

- R1 金额的唯一来源是 `derive`；`proposals.derived` 只是插入时的副本，执行永远重算并比较 contentKey。
- R2 `enumerate` 返回的每个候选都必须让 `evaluate` 全部通过（插件单测断言：`enumerate(s).every(c => evaluate(c, s).executable)`）。
- R3 `enumerate` 有界：返回不超过 `enumerateLimit`（默认 12）条，按 `rank` 排序；目录 ≤ 8 个可选条目时穷举，更大时插件必须给剪枝策略（先固定必需项再加可选项）。
- R4 插件函数必须确定性（同一 snapshot 同一输出）；不得读 `Date.now()`，"今天"只来自 `snap.today`。
- R5 reasonCode 是规则、模板、投影、人工请求选项之间的唯一接口；任何面向他方的文字都从 `templates[code]` 渲染。
