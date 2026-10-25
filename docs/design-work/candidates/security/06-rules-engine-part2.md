# 06 确定性规则与校验（part2：候选、全局可行性、放宽选项、场景插件接口、Role A 缺陷修正）

## 6.7 候选枚举与全局可行性

```ts
// packages/scenario-scope-change/src/candidates.ts
export function allCombos(cat: Catalog): Array<{ itemKeys: string[]; deliveryOption: "standard" | "rush" }> {
  // 非空子集 × {standard, rush}；rush 仅当所选每个条目都有 rushDate 且 rushFeeCents > 0
}
export function enumerateCandidates(input: ScopeInput, prefs: RankingPrefs, today: string,
                                    exclude: Set<string>, limit = 12): Candidate[] {
  return allCombos(input.catalog)
    .map((c) => ({ c, t: deriveTerms(c, input.catalog, input.requestedItemKeys ?? c.itemKeys) }))
    .filter(({ t }) => !("error" in t) && !exclude.has(t.pricingKey))
    .filter(({ c, t }) => evaluate(asProposalLike(c, t, input), input, today).ok)  // 只用本视图已知字段
    .sort(byRanking(prefs))
    .slice(0, limit)
    .map(({ c }, i) => ({ candidateId: `C${i + 1}`, ...c }));
}
export function globalFeasible(full: Required<ScopeInput>, today: string): Candidate[] {
  return enumerateCandidates(full, NO_PREFS, today, new Set(), Number.MAX_SAFE_INTEGER);
}
```

- 本角色视图输入下调用 `enumerateCandidates`，得到"满足本方约束与已披露约束"的候选——它不可能依赖本角色看不见的字段（未知字段对应的检查被跳过，§6.2）。这就是"代码先枚举可行组合，模型只在候选里挑"（F05.5）与"候选集不泄露他方约束"（07 T-04）同时成立的方式。
- 排名 `byRanking(prefs)`：① 覆盖的请求条目数多者优先；② 若本视图知道首选日，交付日与首选日相差天数少者优先；③ 覆盖的偏好条目数多者优先；④ 价格低者优先；⑤ `pricingKey` 字典序（保证完全确定）。prefs 来自本方软偏好或已披露给本方的 customer 软偏好。
- 复杂度：目录 n 项时组合数 ≤ 2ⁿ × 2。场景限制目录 ≤ 10 项（≤ 2,048 个组合，求值是纯算术，毫秒级）。更大目录的扩展点：先固定必需条目、再按偏好贪心加入可选条目，并设枚举上限（17）。
- `exclude`：本 run 中已出现、且在当前 cv 下对该角色显示为阻断的提案的 `pricingKey`（05 §5.5）。

## 6.8 放宽选项（人工请求）

`relaxations(roleKey, viewInput, publicReason)` 只读目标角色的视图输入（05 §5.7）：

| 目标 | 生成规则 | 选项 |
| --- | --- | --- |
| finance | 在 finance 视图下，忽略预算检查后仍满足其余已知检查的组合中，价格最低者 `pMin`；若 `committed + pMin > cap` | `amend_brief{ capCents: committed + pMin }`（标注 "+$X"）；`decline` |
| customer | (a) 对必需条目做最小删减（先试删 1 项）使视图内存在可行组合；(b) 视图内满足其余检查的组合的最早交付日晚于截止日时，给出"截止日延到该日"；(c) 若 customer 视图内本来就有候选（阻断来自其看不见的约束），给出这些候选的 `adopt_candidate`（前 3） | 至多 3 个 `amend_brief` 或 `adopt_candidate`；`decline` |
| provider | 若 provider 视图下候选为空是因为本方最低接单额：给出"把最低额降到 X"；总是给出 `revise_catalog` | `amend_brief{minChangeOrderCents}`（可选）、`revise_catalog`、`decline` |
| ROUNDS_EXHAUSTED 的目标 | 视图内候选前 3 名 | `adopt_candidate` × ≤3、`decline` |

放宽选项被选中后不直接生效于规则：它产生一个新的简报版本（09 的统一流程），下一次预检用完整输入重新判定。

## 6.9 场景插件接口

```ts
// packages/engine/src/scenario.ts
export interface ScenarioPlugin<Input, Terms, Cand> {
  key: string; version: number; rulesVersion: string; templateVersion: string;
  roles: Array<{ roleKey: string; label: string; capabilities: Capability[];
                 requiredApprover: boolean; approveLabel: string }>;
  fields: FieldDecl[];                 // fieldKey、ownerRoleKey、class（hard/soft/note/derived）、disclosable、read()
  protocol: { firstProposerRoleKey: string; counterPriority: string[]; tradeoffOwners: string[];
              maxRounds: number; maxCalls: number; maxCandidates: number };
  validateBriefContent(roleKey: string, content: unknown): Issue[];
  validateCatalog?(content: unknown): Issue[];
  changeGuards(roleKey: string, prev: unknown, next: unknown, ledger: Ledger): Issue[];
  readiness(docs: SnapshotDocs): string[];
  toFullInput(docs: SnapshotDocs, committedCents: number): Input;
  toViewInput(view: RoleView<unknown, unknown>): Input;
  rankingPrefs(view: RoleView<unknown, unknown>): RankingPrefs;
  enumerateCandidates(input: Input, prefs: RankingPrefs, today: string, exclude: Set<string>, limit: number): Cand[];
  deriveTerms(c: Cand, catalog: unknown, requested: string[]): (Terms & { termsKey: string; priceCents: number }) | { error: string };
  evaluate(p: ProposalLike<Terms>, input: Input, today: string): Evaluation;
  reasonCodes: ReasonCodeDecl[];
  agentRejectReasons: Record<string, string[]>;
  humanRejectReasons: string[];
  relaxations(roleKey: string, input: Input, reason: string): RequestOption[];
  requiredApprovers(terms: Terms): string[];
  commitmentAmount(terms: Terms & { priceCents: number }): number;
  deriveTasks(terms: Terms, catalog: unknown): Array<{ itemKey: string; title: string; assigneeRoleKey: string; dueDate: string }>;
  templates: TemplateSet;              // 场景事件、提案摘要、请求问题、预算面板文案
  prompts: { scenarioRules: string; roleCharter: Record<string, string> };
  fixtures: Record<string, Fixture>;
}
```

接口约束：
1. 全部方法是纯函数；引擎负责读写数据库、调用模型、鉴权与状态机。
2. 场景不能声明引擎没有的能力（`Capability` 是引擎枚举）；引擎在启动时校验声明一致性（每个可披露字段的受众是已声明角色、每个 reasonCode 的 `requiresFields` 都存在、`tradeoffOwners` ⊆ roles 等），不一致则拒绝加载。
3. 第二个场景（17：活动预算）需要的东西都能放进这个接口：不同角色集、不同目录、不同条款、不同规则；引擎表不变，只向校验器联合追加成员。

## 6.10 必需审批角色与任务派生（首场景）

- `requiredApprovers(terms)` 返回全部 `requiredApprover: true` 的角色（首场景三方）。插入提案时快照到 `requiredApproverRoleKeys`（I-14）。审批阈值（如超过某额度需额外角色）是扩展点：届时由 `requiredApprovers` 按金额返回不同集合，快照机制无需改变。
- `deriveTasks`：每个已批准条目一个任务，标题取目录条目的 `taskTitle`，指派 provider 席位，截止日 = 交付日。任务派生是"由模板确定性派生"，模板版本记在变更单 `templateVersion` 上；审批界面在批准前展示"Approval will create: change order CO-?, commitment +$750, 2 tasks"（RA-B19）。任务内容不进入 `termsKey`：它是条款的确定性函数，模板版本已被记录（RA Q10）。

## 6.11 对 Role A 规则缺陷的修正

| 缺陷 | 修正 | 测试 |
| --- | --- | --- |
| RA-B01 "Matches current constraints" 只比版本号 | 检查集包含必需条目、截止日、请求范围、预算、最低接单额、来源；版本一致性属于状态守卫，文案改为 "Checked against constraints vN" | TC-RULE-02 |
| RA-B04 无来源核对 | `CATALOG_STALE` 与逐项重算（§6.3 ①） | TC-RULE-03 |
| RA-B10 两套日期校验不一致 | `parseIsoDate` 单一实现 | TC-RULE-11 |
| RA-B11 无日期语义 | `DELIVERY_IN_PAST`、`AFTER_DEADLINE` | TC-RULE-04 |
| RA-B12 按条目数选最优 | 可行性由完整检查决定；排名只在可行集合内进行，且有确定的平局规则 | TC-RULE-06 |
| RA-B13 deferred 口径错 | `deferredItemKeys = requestedItemKeys − itemKeys`，由 `deriveTerms` 计算并进入 `termsKey` 的条款 | TC-RULE-07 |
| RA-R11 复制 revalidated 版本 | 不复制；约束变化后旧决定自动 stale，条款未变时同一提案重新审批（09） | TC-VER-02 |
