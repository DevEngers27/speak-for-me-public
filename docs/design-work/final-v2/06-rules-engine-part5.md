# 06 · 确定性规则引擎与场景插件接口（part5：checkProposal 流水线与按角色投影）

> 分片总表见 `06-rules-engine.md` 顶部。本片：§7 checkProposal、§8 按角色投影（07 的 `projectChecks`）。

## 7. checkProposal：一次收集全部问题

### 7.1 类型（`core/engine/checks.ts`）

```ts
export type CheckStatus = 'pass' | 'fail' | 'not_evaluated' | 'unknown';
export type CheckOutcome = { ok: true; params?: Params } | { ok: false; code: ReasonCode; params?: Params } | { unknown: true };
export type CheckDecl<RI> = {
  checkId: string;                              // 引擎保留 E*/B* 的 id；插件 id 重复 → 注册表加载失败（internal）
  ownerRole: RoleKey | null;                    // 掩码依据（§8，字段名与 07 §7.11 一致）；null = 公开检查（目录、条款、localDate）
  inputs: readonly FieldKey[];                  // 检查读到的字段（合取）：全部对查看者可见（派生字段按 07 §7.8.5）即精确可见
  dependsOn: readonly string[];
  run(ctx: CheckCtx<RI>): CheckOutcome;         // 纯函数；所需字段在视图里为 undefined 时返回 { unknown: true }
};
export type CheckResult = { checkId: string; ownerRole: RoleKey | null; inputs: readonly FieldKey[]; status: CheckStatus; code: ReasonCode | null; params: Params };   // 07 §7.11 projectChecks 的输入：ownerRole / inputs 由 CheckDecl 原样带出
export type Terms = { itemKeys: ItemKey[]; modifiers: ItemKey[]; deliveryDate: IsoDate; amountCents: Cents };   // D25
export type Line = { itemKey: ItemKey; kind: 'item' | 'modifier'; revision: number; title: CatalogTitle; priceCents: Cents; leadDays: number };   // 与 03 §3.4 lineV、canon D25 同形
export type ProposalLike = { terms: Terms; lines: readonly Line[] };
export type Evaluation = {
  checks: CheckResult[];                        // 按 CHECK_ORDER
  blocking: ReasonCode[];                       // status = fail 的码，按 CHECK_ORDER 去重
  passesChecks: boolean;                        // blocking.length === 0
  amounts: { amountCents: Cents; capCents?: Cents; committedCents?: Cents; committedAfterCents?: Cents; headroomCents?: number; overByCents?: Cents };
  provenance: { seededCatalog: boolean; seededLedger: boolean };   // 来源含 seeded 行时界面加徽章（r16，核心 8）
};
export function checkProposal<RI extends RuleInputBase>(p: ScenarioPlugin<RI>, input: View<RI>, x: ProposalLike): Evaluation;
```

`runChecks` 规则（沿用 rules-engine `engine.ts`，修 r17）：按序执行；依赖中有 `fail` / `not_evaluated` → 本检查 `not_evaluated`；依赖中有 `unknown` → 本检查 `unknown`；否则调用 `run`。`unknown` 与 `not_evaluated` 都不进入 `blocking`。全局输入（`viewer: 'system'`）下不会出现 `unknown`：缺简报时 run 根本不会开始。插件检查抛错 → `checkProposal` 抛 `PluginContractError`：query 包装器返回 `{ evaluation: 'unavailable' }`（界面显示 "Checks unavailable"，不让整个房间页崩溃），mutation 一律 fail-closed 为 `internal`。

### 7.2 检查顺序与定义

`CHECK_ORDER = [E1…E6, ...plugin.checks, B1, B2]`。E、B 是引擎级检查（场景中立，任何场景都跑，插件无法屏蔽），S 是 scope_change 插件检查（定义在 14 §7）。

| # | checkId | 归属 | ownerRole | inputs | dependsOn | 通过条件（全部整数 / 码点字符串比较） | 失败码与参数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | `terms_shape` | 引擎 | null | — | — | `itemKeys` 非空；`itemKeys`、`modifiers` 各自已排序且无重复；`isIsoDate(deliveryDate)`；`isCents(amountCents)` | 依次 `item.unknown {itemKeys: []}` / `item.duplicate {itemKeys}` / `date.invalid {field}` / `amount.out_of_range {field}`（单检查只报第一条） |
| E2 | `items_known` | 引擎 | null | — | E1 | 每个键在 `catalog` 中且 kind 匹配（`itemKeys` 为 item、`modifiers` 为 modifier） | `item.unknown {itemKeys}` |
| E3 | `items_live` | 引擎 | null | — | E2 | 当前行 `status === 'confirmed'` | `item.retired {itemKeys}` |
| E4 | `source_current` | 引擎 | null | — | E3 | 每条 `lines[].revision` 等于当前行 revision | `version.stale_source {itemKeys}` |
| E5 | `amount_consistent` | 引擎 | null | — | E1 | `lines` 的键集合 = `itemKeys ∪ modifiers` 且 `sumCents(lines.priceCents) === amountCents` | `amount.claim_mismatch`；求和 `null` → `amount.out_of_range` |
| E6 | `date_window` | 引擎 | null | — | E1 | `localDate ≤ deliveryDate ≤ addDays(localDate, 365)` | `date.in_past {localDate}` / `date.out_of_range {field, min, max}` |
| S1 | `required_offered` | 插件 | customer | `[requiredItemKeys]` | — | 每个必需键在目录中有 `confirmed` 的 item 行 | `item.required_missing {itemKeys, reason: 'not_offered'}` |
| S2 | `required_included` | 插件 | customer | `[requiredItemKeys]` | E1 | `requiredItemKeys ⊆ itemKeys` | `item.required_missing {itemKeys, reason: 'not_included'}` |
| S3 | `by_deadline` | 插件 | customer | `[deadline]` | E1 | `deliveryDate ≤ deadline`（当天交付算按时） | `date.after_deadline {deadline, daysLate}` |
| B1 | `budget_state` | 引擎 | 预算拥有者（finance） | `[headroomCents]`（派生；按 07 §7.8.5，共享 `headroomCents` 或同时共享 `capCents` 与 `committedCents` 即可见） | — | `committedCents ≤ capCents`（只知 headroom 时 `headroom ≥ 0`） | `budget.below_committed {belowByCents}`（纵深防御） |
| B2 | `budget_fit` | 引擎 | 同上 | 同上 | B1、E5 | `checkBudget`：`committed + amount ≤ cap`，**恰等于通过** | `budget.over {overByCents, headroomCents}` |

```ts
// core/engine/budget.ts（来源 spike protocol-rules checkBudget，命名改为 canon）
export function checkBudget(x: { amountCents: Cents } & ({ capCents: Cents; committedCents: Cents } | { headroomCents: number })):
  | { ok: true; committedAfterCents: Cents | null; headroomCents: number }
  | { ok: false; code: 'budget.over' | 'budget.below_committed' | 'amount.out_of_range'; params: Params } {
  // 1. committed > cap → below_committed（不连带 over，依赖传播保证）；2. after = addCents(committed, amount)，null → out_of_range；
  // 3. after <= cap → ok；否则 over，overByCents = after − cap，headroomCents = cap − committed
}
```

关键点：

- **一次收集**：所有检查都跑，失败不短路；只有依赖未通过时 `not_evaluated`。因此全量 $1,400 提案同时报 `date.after_deadline` 与 `budget.over`；预算低于已承诺只报 `budget.below_committed`，不连带 `budget.over`。
- **旧提案永不重新定价**：E2→E3→E4 的依赖链保证条目被撤下时只报 `item.retired`，`source_current` 记 `not_evaluated`，不会对 `undefined` 取 `.revision`（r04 的崩溃）；金额一致性 E5 只比较快照内部（快照金额 vs 快照行），不读当前价格。
- **日期不重算**：没有任何检查用 `localDate + leadDays` 重新物化交付日；E6 只判 `in_past` 与窗口上界。
- **规则不判"是否当前提案"**：版本、当前性、审批属于状态守卫（§9 `isExecutable`，04/08），不进入 `Evaluation`，避免 RA-B01 的"版本号相等即 Matches"。

### 7.3 用 14 主 fixture 核对（`localDate` 2026-11-02，截止 2026-11-20，必需 `audit_log_export` + `sso_login`，已承诺 400000）

| 提案（条目 / modifier） | amountCents | deliveryDate | cap | blocking |
| --- | --- | --- | --- | --- |
| 全量 5 项 | 140000 | 2026-12-04 | 500000 | `date.after_deadline`、`budget.over`（overBy 40000） |
| v1：必需 + `usage_dashboard` | 90000 | 2026-11-18 | 500000 | 无（490000 ≤ 500000） |
| v1，上限降到 480000 后 | 90000 | 2026-11-18 | 480000 | `budget.over`（overBy 10000） |
| 只含必需项 | 80000 | 2026-11-16 | 480000 | 无（480000 = 480000，恰等于通过） |
| 只含必需项 | 80000 | 2026-11-16 | 479999 | `budget.over`（overBy 1） |
| 只含必需项 | 80000 | 2026-11-16 | 470000 | `budget.over`（overBy 10000） |
| v1，provider 撤下 `audit_log_export` 后 | 90000 | 2026-11-18 | 500000 | `item.retired`、`item.required_missing`（not_offered）；E4 `not_evaluated` |
| v1，到 2026-11-19 时 | 90000 | 2026-11-18 | 500000 | `date.in_past` |

## 8. 按角色投影：掩码按检查判所有者

全仓只有一个按角色投影规则结论的函数：07 §7.11 的 `projectChecks(viewer, evaluation)`（XP-5，`core/engine/privacy/projectChecks.ts`，语义与实现归 07）。本章不再定义第二个投影函数、第二种 `CheckResult` 或第二种返回形状；本章的职责是让 `checkProposal` 产出的每条 `CheckResult` 带齐它要读的 `ownerRole` 与 `inputs`（§7.1、§7.2），并提供参数受众表 `PARAM_AUDIENCE`（§6.2）。

```ts
// 形状以 07 §7.11 为准，此处只复述
type ChecksView =
  | { kind: 'fit'; fit: 'ok' | 'blocked' }                                        // fitOnlyRoles：由 roles[].side === 'seller' 派生（§12.1）
  | { kind: 'checks'; fit: 'ok' | 'blocked'; items: { code: ReasonCode; params: PublicParams }[] };
```

规则（复述 07 §7.11，按顺序）：

1. 查看者角色 ∈ `fitOnlyRoles`（provider）→ 只返回 `{ kind: 'fit', fit: ev.passesChecks ? 'ok' : 'blocked' }`，并且只对 `run.currentProposalId` 计算；历史提案对 provider 只显示存储状态（`stale` 映射为 `superseded`，D12 ①）。
2. 其他查看者 V，逐条**失败**检查 c：`exact = c.ownerRole === null || c.ownerRole === V || c.inputs.every(f => f 对 V 可见)`（`inputs` 是合取；派生字段的可见性按 07 §7.8.5，例如 `headroomCents` 对 customer 可见 ⇔ 共享了 `headroomCents`，或同时共享了 `capCents` 与 `committedCents`）。
   - `exact` → `{ code, params }`，参数按 §6.3 / `PARAM_AUDIENCE` 裁剪，未声明的丢弃。**检查所有者本人的失败检查永不掩码**：`c.ownerRole === V` 即精确可见，不以 `inputs` 的可见性为前提。
   - 非 `exact` → 记 `maskedFail = true`，条目本身**不出现**（不带 checkId）。
3. `maskedFail` → `items` 中至多一条 `{ code: 'private.constraint_unmet' }`：无论几条私密检查失败都只有一条，不带计数。通过、`not_evaluated`、`unknown` 的检查一律不列出（"通过时出现、失败时缺席"的反向信道被堵住，r03）。
4. `Evaluation.amounts` 不经 `projectChecks`：`rooms.view` 按 07 §7.8.5 的派生值受众逐字段裁剪——`amountCents` 总在；`capCents` 随 `capCents` 可见；`committedCents`、`committedAfterCents` 随 `committedCents` 可见；`headroomCents`、`overByCents` 随 `headroomCents` 可见。

显式解密只有一条路径：所有者在简报确认时把检查的**全部** `inputs` 披露给该查看者（07 的解密清单据此列出）；"可行性 1 bit"（provider 的 `fit`、买方的 `fit` 与是否含掩码项）是被接受的残余披露，上界由 D12 的提案频率与写入节流限定。

非干扰性质（T06-P6）：对任意全局输入 a、b，若只在 V 既不拥有也未获披露的字段上不同，且 `(fit, 是否含掩码项)` 相同，则 `projectChecks(V, checkProposal(a))` 与 `projectChecks(V, checkProposal(b))` 逐字节相等；provider 在 `passesChecks` 相同时 `fit` 相同。同一性质对 `enumerateCandidates(viewFor(V))` 与 `buildHumanRequests` 给 V 的选项成立（§10、§11）。

`rooms.view` 的使用：`fit` 与 `checks` **只对 `run.currentProposalId`** 计算；已 `stale` 的提案不做实时重算，只显示公开检查 `version.stale_constraints { checkedAgainst }`（"This version no longer applies (constraints v{n})"），不显示掩码检查与预算检查——否则 bump 后无新提案时，finance 反复改上限会让 customer 看到旧提案在通过 / 不通过之间翻转，得到针对该金额的阈值 bit（privacy-09；07 §7.9.3、12 `proposals.get`）。`approval.not_executable` 的 `params.reasonCodes` 也经同一投影（§6.3 `projectedCodes`；provider 收到空参数）；它只会在当前提案上出现，因为 `approvals.record` 先做当前性守卫（12 §12.15 ⑤），对 stale 提案返回 `approval.not_current` 而不跑规则，所以 approve 调用不会成为绕过上一句的同一阈值信道。`timeline.page` 只渲染事件，不做实时重算。
