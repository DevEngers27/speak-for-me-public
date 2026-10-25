# 06 规则引擎（part1）：职责、输入、检查与 reasonCode、可执行性评估、候选枚举

> 分片：part1 本页；part2 日期与时区、预算函数、场景插件接口、对 Role A 缺陷的修正、共享校验器。
> 全部规则是纯函数（`convex/engine/rules.ts` + `convex/scenarios/scopeChange/rules.ts`），不读数据库、不调模型，可脱离 Convex 单测。

## 6.1 职责与调用点

规则引擎回答三个问题：①某个条款在某个约束版本、某一天是否可执行，为什么（`evaluateProposal`）；②在某个约束版本下有哪些可行方案（`enumerateCandidates`）；③没有可行方案时应该问谁、给什么选项（`planHumanRequests`，05 §5.8、14 §14.7）。同一组函数在所有调用点共用：

| 调用点 | 函数 | 用途 |
| --- | --- | --- |
| `rooms.workspace` 查询 | `evaluateProposal` | 实时显示当前提案是否可执行及按查看者投影的原因（约束一变，所有窗口同时翻转） |
| `startRunTx` | `evaluateProposal`、`enumerateCandidates`、`planHumanRequests` | 决定重新审批 / 重谈 / 问人（04 §4.2.3） |
| `insertProposal` | `evaluateProposal` | 写 `checksAtCreation` 审计快照（只存结果码） |
| `decisions.decide`（G-D6） | `evaluateProposal` | 不让人批准不可执行的版本（拒绝永远允许，RA-R06） |
| `executeIfReady`（G-E2） | `evaluateProposal`（台账重新汇总） | 执行前最后一次重算（F06.3） |
| `requests` 规划 | `planHumanRequests` | 选项的参数（例如最低上限）由同一套检查推出 |

## 6.2 规则输入

```ts
type RuleInput = {
  constraintsVersion: number;
  timeZone: string;
  briefs: { customer: CustomerFields; provider: ProviderFields; finance: FinanceFields };  // 规则只读结构化字段
  catalog: { items: CatalogItemView[]; terms: CatalogTermView[] };   // 本版本有效的条目版本（含 _id）
  scenarioState: { committedCents: number; baselineRecorded: boolean; executedItemKeys: string[] };
};
loadRuleInput(ctx, room, version = room.constraintsVersion): Promise<RuleInput>
// 读 constraintVersions[(roomId, version)] → 按 briefVersionIds、catalogItemIds 读不可变记录 → 组装
```

`loadRuleInput` 是唯一的组装函数；它读取全部角色的私密字段，因此只在服务端使用，结果从不直接返回给客户端——客户端只拿到经 07 投影后的视图。

## 6.3 检查与 reasonCode

```ts
type Check = { checkId: string; ok: boolean; reasonCode: string; params: Record<string, Param> };
// params 只在内存中存在；存储只保留 {checkId, ok, reasonCode}（03 §3.2）；渲染时由 07 的投影按查看者裁剪 params
```

| checkId | 层 | 失败 reasonCode | 规则 | params（受限者标 *） |
| --- | --- | --- | --- | --- |
| `engine.current` | 引擎 | `engine.not_current` | 提案是房间当前提案且未执行 | — |
| `engine.sources` | 引擎 | `engine.source_superseded` / `engine.source_withdrawn` | `terms.catalogItemIds` 中每个条目版本仍是该 itemKey 在本约束版本下的有效版本（RA-B04） | itemKey |
| `engine.terms` | 引擎 | `engine.terms_mismatch` | 用来源重算的金额、交付日、延后项与 terms 完全一致（纵深防御；正常流程不会失败） | — |
| `scope.items` | 场景 | `scope.unknown_item` | 每个 itemKey ∈ (请求范围 − 已执行条目) ∩ 有效目录 | itemKey |
| `scope.required` | 场景 | `scope.required_missing` | `(requiredItemKeys − executedItemKeys) ⊆ itemKeys`；必需项不得出现在 deferred（RA-B01、F06.2 第 2 条） | itemKeys*（customer 必需项披露受众） |
| `scope.deferred` | 场景 | `scope.deferred_mismatch` | `deferredItemKeys = (requested − executedItemKeys) − itemKeys`（RA-B13） | — |
| `date.rush` | 场景 | `date.rush_unavailable` | rush 模式下每个条目都有 `rushDeliveryDate` | itemKey |
| `date.deadline` | 场景 | `date.after_deadline` | `deliveryDate ≤ deadline` | deadline*（customer 截止日披露受众） |
| `date.today` | 场景 | `date.in_past` | `deliveryDate ≥ today`（房间时区） | — |
| `budget.cap` | 场景 | `budget.over_cap` / `budget.cap_below_committed` | `committedBefore + amount ≤ cap`（等于算通过）；`cap < committedBefore` 时报后者 | capCents*、committedBeforeCents*、committedAfterCents*、overByCents*、headroomCents*（finance 预算披露受众） |

通过的检查 `reasonCode = "ok"`。界面对检查集的标题如实写成 "Checked against constraints v{n}"，不写 "Matches current constraints"（F06.4）。

每个 reasonCode 与问题键在场景里声明"参数—受众"（`paramAudience`），07 的渲染器据此决定某个查看者看到带数值的句子、只看到结论、还是只看到"与某方约束冲突"。例如对 provider：`budget.over_cap` → "Blocked: exceeds the finance limit"；`date.after_deadline`（customer 截止日未对 provider 披露时）→ "Blocked: conflicts with a customer constraint"（Q3：只披露结论与冲突方，不披露数值）。

## 6.4 `evaluateProposal(terms, input, today, opts)`

```ts
function evaluateProposal(terms: Terms, input: RuleInput, today: string,
                          opts: { isCurrent: boolean; executed: boolean }): { executable: boolean; checks: Check[] } {
  const checks = [
    checkCurrent(opts),                    // engine.current
    checkSources(terms, input.catalog),    // engine.sources
    checkTermsConsistency(terms, input),   // engine.terms
    ...scenario.checks(terms, input, today),
  ];
  return { executable: checks.every(c => c.ok), checks };
}
```

- 全部检查都会运行并全部报出（不短路），所以 14 的 fixture v1 会同时报 `budget.over_cap` 与 `date.after_deadline`（RA-F03 修正）。
- 不信任任何外部给出的总额：金额永远由目录重算（`engine.terms`），模型或客户端都没有提交金额的入口。

## 6.5 候选枚举 `enumerateCandidates(input, today)`

场景接口：`enumerateCandidates(input, today, limits) → Candidate[]`，要求确定性、只返回全部检查通过的组合，并按**只用公开信息**的排序函数排名（候选顺序对所有代理可见，排序若用了 customer 的私密偏好就等于泄露）。

首个场景实现：

```text
open     = 请求范围 − executedItemKeys        （已在本房间执行过的条目不再重复承诺；修订 = 谈剩下的部分）
items    = open ∩ 有效目录中的 item 条目
required = customer.requiredItemKeys − executedItemKeys   （若 required ⊄ items → 返回 []；就绪检查本应先拦下）
optional = items − required                    （v1 限制 |请求范围| ≤ 12，枚举 ≤ 2^12 × 2 = 8,192 次，纯计算）
for S ⊆ optional, mode ∈ {standard, rush}:
    keys = sort(required ∪ S)
    if mode = rush 且某条目无 rushDeliveryDate: continue
    date   = max(条目在该模式下的交付日)
    amount = Σ priceCents + (mode = rush ? RUSH.feeCents : 0)
    terms  = { itemKeys: keys, deferredItemKeys: sort(open − keys), deliveryMode: mode, deliveryDate: date,
               termKeys: mode = rush ? ["RUSH"] : [], amountCents: amount, catalogItemIds: 对应条目版本 }
    if evaluate(terms) 全部通过（isCurrent 视为 true）: 收集 { candidateKey: keys.join("+") + "@" + mode, terms }
rank = 按 (条目数 desc, amount asc, date asc, candidateKey asc) 排序后的序号
返回前 32 个（run 快照上限）；提示中展示前 12 个（CANDIDATE_LIMIT_FOR_PROMPT）
```

用途：①协商前把代理的选择空间限制在可行集合内（核心 4 的结构性保证）；②约束变化后判断"重谈"还是"问人"（候选为空 → 问人，不调模型，F06.5）；③stub 代理的选择范围（10 part6）。

**泄露分析**：候选集合会让每个代理知道"哪些组合满足所有人的硬约束"，从而推断他方约束的大致范围（例如 provider 看到所有 > $800 的组合都不在列表中）。这与"每个角色都会看到当前提案是否被阻断"属于同一级别的最小披露；它在委托条款中明示（02 §2.3），并列入 07 威胁模型 T-08。数值本身（上限、截止日）不进入任何他方上下文。
