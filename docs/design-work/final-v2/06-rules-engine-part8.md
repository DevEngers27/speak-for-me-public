# 06 · 确定性规则引擎与场景插件接口（part8：插件接口 16 + 2 成员与引擎边界）

> 分片总表见 `06-rules-engine.md` 顶部。本片：§12。

## 12. ScenarioPlugin

### 12.1 接口（≤ 18 个成员：1–16 必需，17–18 可选）

```ts
// core/engine/plugin.ts
export interface ScenarioPlugin<RI extends RuleInputBase = RuleInputBase> {
  /* 1  */ readonly id: { key: ScenarioKey; version: number };                    // 'scope_change' / 1；rooms.scenarioKey/scenarioVersion 钉住
  /* 2  */ readonly roles: readonly RoleDecl[];
  /* 3  */ readonly protocol: ProtocolDecl;
  /* 4  */ readonly relaxationOrder: readonly RelaxEntry[];                        // 'customer.drop_items' | 'finance.raise_cap' …
  /* 5  */ readonly fields: readonly FieldDecl[];
  /* 6  */ readonly catalog: CatalogDecl;
  /* 7  */ toRuleInput(docs: RuleDocs): View<RI>;                                 // 已确认行 → 全局输入（viewer 'system'）
  /* 8  */ hardProjection(input: View<RI>): string;                               // §5.3
  /* 9  */ readonly checks: readonly CheckDecl<RI>[];                             // 插在 E1–E6 与 B1–B2 之间
  /* 10 */ candidateSpace(view: View<RI>): { drafts: CandidateDraft[]; emptyReasons: ReasonCode[] };   // 只生成组合草稿；枚举、排序、截断、锚点、排除归引擎 enumerateCandidates（§10）
  /* 11 */ materialize(d: CandidateDraft, catalog: readonly CatalogRow[], localDate: IsoDate): Materialized | null;  // null = 求和溢出
  /* 12 */ relaxations(role: RoleKey, view: View<RI>, ctx: RelaxCtx): RequestOption[];   // 只返回放松效果；choose_candidate（引擎枚举）、pass_to_next、disclose 回退项、end_run 由 buildHumanRequests 生成
  /* 13 */ stubDecide(input: StubInput): AgentModelOutput;                        // 与模型同一 { turn } 输出 schema（D26）
  /* 14 */ readonly templates: TemplateRegistry;
  /* 15 */ readonly fixtures: Readonly<Record<string, ScenarioFixture>>;
  /* 16 */ readiness(input: View<RI>, confirmedRoles: readonly RoleKey[]): { gap: ReadinessGap; ownerRole: RoleKey }[];   // 04 §4.2.1：席位、基线与每个声明角色是否已有已确认简报（brief_unconfirmed：引擎读 briefs 行判定，不从硬字段值推断——provider 没有硬字段）由引擎判；场景只声明字段缺口（brief_field_missing、deadline_passed）与目录缺口（catalog_empty），confirmedRoles 只用于不对尚未确认的角色重复报字段缺口
  /* 17 */ rankForOwner?(role: RoleKey, view: View<RI>): (a: SnapshotItem, b: SnapshotItem) => number;   // choose_candidate 的排序（05 §5.11.2）；缺省按 (amountCents, candidateKey)
  /* 18 */ readonly humanReasonKeys?: readonly { key: string; audience: 'room' | 'buyers' }[];   // 人类拒绝理由及其可见受众（07 DX-6）；缺省 = protocol.reasonKeys 中 usableBy 含 'human' 者，audience 'room'
}
// 不是插件成员、只在场景目录内导出：`diffTerms`（13 用的条款差异）、`evalCases`（16 评测）。`fitOnlyRoles` 不是成员：由 roles 中 side === 'seller' 派生（07 §7.11）。

export type RoleDecl = { role: RoleKey; label: string; side: 'buyer' | 'seller'; approvalKind: 'terms' | 'budget'; budgetOwner?: true };
// 引擎在提案插入时快照 requiredApprovals = roles.map(r => ({ role: r.role, kind: r.approvalKind }))（D02），插件不能给出空集
export type ProtocolDecl = {
  proposerRole: RoleKey; evaluatorOrder: readonly RoleKey[]; counterRoles: readonly RoleKey[];
  maxRounds: number; maxCandidates: number; maxProposalsPerRolePerRun: number;          // 3 / 12 / 4（D08、D10、D12 ⑤）
  topics: readonly { topicKey: string; toRole: RoleKey; askableBy: readonly RoleKey[]; field: FieldKey;
                     answer: 'human' | 'code'; questionTemplateKey: TemplateKey }[];        // clarify 话题表（05 §5.9.1；v1 全部 'human'）
  reasonKeys: readonly { reasonKey: string; usableBy: readonly (RoleKey | 'human')[] }[];   // 模型与人类拒绝理由的封闭枚举（人类理由的受众见成员 18）
  tradeoffOwner: RoleKey;                                                              // needs_tradeoff 的收件人（05 §5.10；scope_change = customer）
  roleCharters: Readonly<Record<RoleKey, string>>;                                     // 静态角色说明，进可缓存前缀，不含任何私密值（10）
};
export type RelaxEntry = `${string}.${'drop_items' | 'raise_cap' | 'extend_deadline'}`;
export type FieldDecl = {
  key: FieldKey; owner: RoleKey; class: 'hard' | 'soft' | 'note' | 'derived';
  valueKind: 'cents' | 'isoDate' | 'itemKeys' | 'text';
  disclosableTo: readonly RoleKey[];                                                   // note 恒为 []
  semantic?: 'budget_cap' | 'ledger_committed' | 'ledger_headroom';                    // 引擎据此做 B1/B2 与预算披露开关
};
export type CatalogDecl = { ownerRole: RoleKey; maxItemRows: 12; maxModifierRows: 2; maxRowCents: 8_000_000_000;
  maxLeadDays: 365; titleMaxCodePoints: 80; maxTaskTemplatesPerRow: number };   // scope_change = 5（03 §3.7：item ≤ 5 条 { title, assigneeRole }）
export type CandidateDraft = { itemKeys: ItemKey[]; modifiers: ItemKey[] };          // 已排序去重
export type Materialized = { candidateKey: string; terms: Terms; lines: Line[];
  plannedTasks: { itemKey: ItemKey; templateIndex: number; title: CatalogTitle; assigneeRole: RoleKey; dueDate: IsoDate }[] };
export type RelaxCtx = { kind: HumanRequestKind; excludedCandidateKeys: readonly string[] };   // 不含全局输入：只能读 view；值为 run.chooseExcludedKeys（§11.3 第 5 条）
export type StubInput = { role: RoleKey; turnKind: 'propose' | 'evaluate'; snapshot: readonly SnapshotItem[];
  currentProposal: { version: number; candidateKey: string; itemKeys: ItemKey[]; passesInMyView: boolean } | null;
  ownSoft: Readonly<Record<string, unknown>>; sharedSoft: Readonly<Record<string, unknown>>;   // 本方软字段与他方已披露软字段
  allowedActions: readonly AgentAction[] };
```

`materialize` 的契约（插件实现、引擎断言）：只读传入的目录行与 `localDate`；`terms.amountCents === Σ lines.priceCents`；`terms.deliveryDate = addDays(localDate, effectiveLeadDays)`，`effectiveLeadDays` 只由行的 `leadDays` 决定（modifier 的语义由插件定义，14：缩短天数）；`lines` 与 `plannedTasks` 是插入时的快照（D25），之后不再由目录重算；`lines[]` 与 03 §3.4 的 `lineV` 同形（含 `kind`，canon D25），缺字段的物化结果在 `insertProposal` 写入时被 `lineV` 拒绝（`internal`），不会成为提案。

Convex 侧只经 `convex/scenarios/registry.ts` 访问插件：`scenarioOf(room)` 按房间钉住的 `scenarioKey@scenarioVersion` 返回插件（未注册 → `run.invalid_state{ guard: 'scenario_version' }`），`latestScenarioVersion(scenarioKey)` 只供 `rooms.create` 钉住版本（11 §11.3、canon §1.6）；引擎与插件代码不 import 注册表。

### 12.2 注册表加载时校验（启动即失败；同一套断言作为 `runPluginConformance` 进 CI）

1. 必需成员 1–16 齐全，可选成员 17–18 若存在则类型正确；`id` 唯一；恰有一个 `budgetOwner`（若存在 `semantic: 'budget_cap'` 字段），且只有它的 `approvalKind` 是 `budget`。
2. 每个 `FieldDecl.owner ∈ roles`；`disclosableTo ⊆ roles − {owner}`；`note` 不可披露；带预算 `semantic` 的字段不得披露给 `side: 'seller'`（D12 ④）。
3. 检查：id 唯一且不与 E1–E6、B1–B2 重名；`ownerRole ∈ roles ∪ {null}`；`inputs` 中的字段已声明；`dependsOn` 只指向排在前面的检查。
4. `relaxationOrder` 的角色已声明，效果与角色匹配（`raise_cap` 只属于预算拥有者）。
5. `protocol`：`proposerRole ∈ roles`；`evaluatorOrder` = 其余角色；`counterRoles ⊆ evaluatorOrder`；`maxCandidates ≤ 12`；**任何角色**都不能声明"候选是否满足约束"类话题（D12 ③ 修订：对 customer 是预算探针，对 finance 是 customer 私密值探针）。
6. 模板：每个 `reads` 声明与 Proxy 读取测试对账；每个受众变体的参数类型不含自由 `string`（D13）。
7. fixture：通过 foundation fixture-types 的 `loadFixture`（结构、交叉引用、期望金额自检）；canary fixture 另过 `lintCanaries`。
8. 一切会落库的插件输出（`params`、`shown`、`plannedTasks`）键名匹配 `^[A-Za-z][A-Za-z0-9_]*$`（Convex 字段名限制，scenario-plugin r16）。

### 12.3 引擎与插件的边界（由 scope_change 与第二场景契约测试 `procurement_rfq`（U6）反推）

| # | 两个场景的差异 | 引擎必须提供 | 引擎不能知道 |
| --- | --- | --- | --- |
| B1 | 角色名、谁起草、谁评估 | `roles` / `protocol` 声明驱动 run 与审批快照 | 任何角色名 |
| B2 | 目录内容（范围项 vs 报价行）与 modifier 含义 | `catalogItems` 通用字段 `(itemKey, kind, revision, status, priceCents, leadDays, title, taskTemplates)`；E2–E4 来源核对 | 条目代表什么、modifier 怎么影响交付 |
| B3 | 金额如何由行组成 | E5 断言 `amountCents = Σ lines.priceCents`；整数分、溢出检查 | 计价逻辑（在 `materialize`） |
| B4 | 交付日规则 | E6 日期窗口与 `date.in_past`；`localDate` 推进与 clock bump | 交付日如何从行推出 |
| B5 | 哪些字段是硬约束 | `hardProjection` 比较决定 bump；`viewFor` 按 `fields` 裁剪 | 字段的业务含义 |
| B6 | 预算 | 台账、`semantic` 字段、B1/B2、`checkBudget`、三个预算披露开关 | 预算拥有者叫什么 |
| B7 | 场景约束检查 | `checks` 的组合、依赖传播、不短路、按检查掩码 | 检查的业务含义 |
| B8 | 卡住时问谁、给什么选项 | `buildHumanRequests` 的收件人算法、恰好一个、选项投影断言 | 放松方式（在 `relaxations`） |
| B9 | 对他方的措辞 | `renderPublicText`、受众变体、`reads` 对账 | 句子内容（在 `templates`） |
| B10 | stub 怎样选 | `AgentDriver.decide` 接缝、输出 schema 校验 | 选择策略（在 `stubDecide`） |

引擎独占、插件无法覆盖：E1–E6、B1–B2、掩码与参数受众、候选枚举（`enumerateCandidates`）及其排序 / 上限 / 锚点 / 排除、请求恰好一个、`requiredApprovals` 由 `roles` 派生。`procurement_rfq` 只写成测试插件（`core/scenarios/procurement-rfq/`，不进生产注册表），要求在**不改引擎代码**的前提下实现 16 个必需成员（可选成员 17–18 按需）并通过 `runPluginConformance`；它暴露的"同角色多席位、多份报价并排"放进 17。

### 12.4 相对候选与专题删掉的成员

| 删掉的成员 | 来源 | 理由 / 去向 |
| --- | --- | --- |
| 6 个 UI 槽位、描述符驱动表单 | scenario-plugin SP-D11 | v1 只有 Next 侧 `proposalTermsCard` 一个槽位，不是插件成员（D21） |
| `supportedVersions` | scenario-plugin | v1 无存量房间；只钉 `id.version`，不符即拒绝写入 |
| `draftTermsSchema` / `buildTerms` | scenario-plugin SP-D7 | 模型只选 `optionKey`（D10），条款只有候选快照一条来源（review r01） |
| `checkTradeoffAnswer` | scenario-plugin | 由 bump 置请求 superseded + 回答时 `checkProposal` 复核替代 |
| `deriveExecution` / `deriveTasks` | plugin、security 候选 | 任务在提案插入时快照为 `plannedTasks`（D25）；变更单金额链由 08 派生 |
| `project.derived` / `viewValidator` / `ScenarioRules.projection` | plugin 候选、rules-engine | 投影归 07 §7.11 的 `projectChecks`；本章 §8 只让 `CheckResult` 带齐 `ownerRole` / `inputs`（r14） |
| `requiredApprovers()` 函数 | plugin、scenario-plugin | 由 `roles[].approvalKind` 派生；同人多 kind 否决（scenario-plugin review r02） |
| `ledger.accounts`、`ledgerImpact` | plugin 候选 | 一房一账本，执行金额 = 提案 `amountCents`（08） |

scope_change 的规则只保留一份实现：spike protocol-rules 的 `rules.ts`、deepdives/rules-engine 的 `*.ts`、deepdives/scenario-plugin 的 `scope-change.ts` 三份草案合并为 `core/engine/*` + `core/scenarios/scope-change/*`；三份草案的表驱动用例（92 + 35 + 一致性 C1–C14）按 §13 的编号迁入，不保留第二份可执行实现。
