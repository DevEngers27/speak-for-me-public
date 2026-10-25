# 场景插件接口 · part5：测试、与其他专题的接口、待验证清单

## 7. 测试

### 7.1 插件一致性套件 `runPluginConformance(plugin)`（engine/core 提供，每个场景在 CI 里跑）

纯函数测试，不需要 Convex。对 `plugin.fixtures` 的每个 fixture × 每个变体、`today` 取三个值（今天、+30 天、跨月末）执行：

| # | 断言 | 防的是什么 |
| --- | --- | --- |
| C1 | 每个函数两次调用结果深度相等 | SP-I2 非确定性 |
| C2 | `fixture.build(today)` 的目录与简报能通过 `attrsSchema` / `briefSchema`；`sharedFields ⊆ shareable` | SP-I12 |
| C3 | 改动每个 `hardness: 'soft' | 'info'` 字段，投影哈希不变；改动每个 `hard` 字段，哈希改变 | SP-D6 漏标或误标 |
| C4 | 同一输入仅 `today` 不同，投影哈希相同 | 边界 B3 |
| C5 | `enumerateFeasible` 的每个候选经 `evaluateProposal` 全部 ok（可靠性） | 枚举与校验两套真相 |
| C6 | 目录 ≤ 10 项时与暴力穷举比较：可行集合完全一致且 `exhaustive: true`（完备性） | 剪枝漏解导致误报"不可行" |
| C7 | `expect.feasibleItemSets`、`tradeoffTargetRoles`、`reasonCodesForInitialProposal` 与实际一致 | fixture 与规则脱节 |
| C8 | `priceTerms` 每行与总额为非负安全整数且 Σ lines = total；改约束、terms 不变时金额不变 | SP-I4、4.3 第 2 条 |
| C9 | 注册表：码无冲突、`disclosure` 覆盖全部角色、每个级别有模板、`masked` 码有 ownerRole | SP-D5 |
| C10 | 模板金丝雀：在每个角色未共享字段中放 `CANARY-<ROLE>-7731`，渲染所有码对所有非 owner 角色的文本，不得含任何 canary；`masked` 级渲染结果不含 params | 核心 1、I8 |
| C11 | `draftTermsSchema` 转 JSON Schema 后不含 `*Cents`、`*Version`、`role`、`userId`、`sourceRefs` 键；根是对象 | SP-I9 |
| C12 | `requiredApprovers` 对所有候选返回非空，且预算启用时包含预算拥有者的 budget 要求 | SP-D8 |
| C13 | `deriveExecution` 对同一输入稳定；任务 key 在一次执行内唯一 | SP-I11 |
| C14 | 静态检查：规则入口依赖图不含禁止模块（dependency-cruiser 规则）；源码中无 `Date.now`、`Math.random`、`process.env`、`console.` | SP-D2、SP-D12 |

### 7.2 场景用例（scope_change，数字全部由 fixture 推出）

- headroom 恰好 $800 时 LOGIN+REPORTS 标准交付通过（`<=`）；$900 方案报 `OVER_BUDGET`，provider 视图只见 summary。
- 编造 itemKey 被 `buildTerms` 拒绝；草稿带金额字段被 strictObject 拒绝。
- RA-B01 回归：只含 EXPORT、交付晚于截止日的组合报 `MISSING_REQUIRED_ITEM` 与 `DATE_AFTER_DEADLINE`，不可执行。
- RA-B04 回归：REPORTS 改价确认后旧提案报 `SOURCE_SUPERSEDED`、`CONSTRAINTS_STALE`。
- 私密截止日：provider 视图中该检查为 "A Customer constraint is not met"，DTO 无日期参数。
- `infeasible` 变体：无候选、`exhaustive: true`、生成 finance 与 provider 两个人工请求，问题文本来自模板。
- `below_committed`：`BUDGET_BELOW_COMMITTED` → finance 人工请求。

### 7.3 场景用例（event_budget，验证接口通用性）

- headcount 100 → 120：版本递增；旧提案报 `QUANTITY_STALE`；同一提案金额不变（terms 中 headcount 未变）。
- HALL_A + ROOFTOP 同时入选报 `EXCLUSIVE_GROUP_CONFLICT`；ROOFTOP 容量 80 < 100 报 `CAPACITY_EXCEEDED`。
- 金额超过 hostSelfApproveLimit：必需审批多出 `{finance, terms}`；finance 只给 budget 决定时执行被拒。

### 7.4 Convex 层（convex-test，见 16）

- `catalog.confirm` / `briefs.confirm` / `updateBudget` 各自在硬字段变化时恰好递增一次版本，软字段变化时不递增。
- 注册表找不到房间的 `scenarioVersion` 时写操作返回 `SCENARIO_UNAVAILABLE`。
- `seed.fromFixture` 对每个变体成功，所有记录 `simulated: true`；故意写坏的变体整体回滚。

## 8. 与其他专题的接口（任务书第 5 节文件编号）

| 文件 | 本专题提供 / 要求 |
| --- | --- |
| 02-domain-model | 实体 catalogItems（只追加、revision）、briefs（data + sharedFields）、proposals.terms 为插件类型 `T` 的不可变快照；不变量 SP-I1–SP-I14 并入不变量清单 |
| 03-schema | `rooms.scenarioKey`、`rooms.scenarioVersion`、`rooms.constraintsHash`、`rooms.timeZone`；`catalogItems`、`briefs` 字段见 part2；`proposals.{terms: v.any(), sourceRefs, amountCents, requiredApprovers: v.array(v.object({role, kind})), contentHash, validationSnapshot}`；`approvals.kind` 必须存在（同人多 kind） |
| 04-state-machines | 开始 run 的守卫依赖 `constraints.missingBriefs` 为空；`PLUGIN_CONTRACT_VIOLATION` 的回合失败迁移 |
| 05-protocol | 动作联合中 `propose/counter` 的载荷 = `plugin.draftTermsSchema`；新增 `suggest_item`（仅 `allowAgentSuggestions`）；人工请求的问题与选项来自 `buildTradeoffRequests`，问题码文本来自模板 |
| 06-rules-engine | 本专题是 06 的"场景插件接口"一节的来源：`evaluateProposal` 组合顺序、引擎保留码表、`checkBudget`、枚举上界与 `exhaustive` 规则 |
| 07-permissions-privacy | 披露级别 `detail/summary/masked` 与 `renderCheck`；`budget.numbersVisibleTo`；他方只见 sharedFields；目录"被引用即公开"；槽位只收投影后 DTO |
| 08-approval-execution | 必需审批由 `requiredApprovers` 快照、按 `(role, kind)` 判定且不同角色不同 userId；执行同事务调用 `priceTerms`（重算）与 `deriveExecution` |
| 09-constraint-changes | "硬约束投影哈希差"递增规则与调用位置清单；`today` 与 `committedCents` 不进投影；约束变更后先 `enumerateFeasible` 再决定新 run 或人工请求 |
| 10-agent-runtime | 上下文组装调用 `agentInstructions`、`enumerateFeasible`；stub 回合用 `pickStub`（authorKind `rule`）；`completeTurn` 调 `buildTerms` |
| 11-architecture | 目录结构与依赖矩阵（part2 3.2）；`packages/**` 被 Convex 打包的可行性待验证及退路 |
| 12-api | `catalog.upsertDraft/confirm/withdraw`、`internal.catalog.expire`、`internal.seed.fromFixture`；所有写入口的哈希比较步骤 |
| 13-frontend | `ScenarioUiSlots` 六个槽位、描述符驱动的缺省表单、引擎独占的审批与阻断展示 |
| 14-scenario-scope-change | scope_change 插件的完整目录、简报字段、reasonCode 注册表与模板、四个变体；需裁决 should 项语义（边界 B5）与 rush 建模 |
| 15-operations | seed 流程与 simulated 标注；部署前对所有存量 `scenarioVersion` 跑一致性套件 |
| 16-testing | 一致性套件 C1–C14 与 7.2–7.4 用例 |
| 17-roadmap | 第二场景（event_budget 骨架）、多席位、多卖方、共享预算、动态披露、委托审批规则 |
| 18-decisions-open-questions | SP-D1–SP-D12 作为 ADR；开放问题：动态披露、should 项语义、小额委托审批、插件版本迁移策略 |

## 9. 待验证清单

1. Convex 打包器能否通过相对路径打包 `convex/` 目录之外的 `packages/**` 模块（inputs/02 18 附只说明 `@/` 别名不可靠）。退路：放到 `convex/lib/`。
2. 在 Convex 默认运行时的 query/mutation 中计算 SHA-256 的方式：`crypto.subtle.digest` 是否可用且允许在 mutation 中使用；不可用则用纯 JS 实现（无依赖、确定性）。
3. `v.any()` 字段的存储限制：嵌套深度、字段名字符限制（例如是否禁止 `$` 开头或非 ASCII 键）、单文档 1 MiB 上限的确切值——影响 `attrs`、`briefs.data`、`proposals.terms`。
4. Zod 4.6.7 在 Convex 默认运行时的打包与运行（预期可行，纯 JS），以及 `z.iso.date()` 拒绝 `2026-02-30`（inputs/03 RA-B10 已在本地实测，需在 Convex 运行时复核）。
5. SDK 1.1.0 `zodOutputFormat` 对嵌入插件 `draftTermsSchema` 后的判别联合（外包对象）是否接受；strictObject 是否转为 `additionalProperties: false`（inputs/04 要点 16 只说明 enum/const/数值约束被降级）。
6. `ctx.scheduler.runAt` 用于报价过期的触发精度与重试语义（被调度的 mutation exactly-once，inputs/04 要点 1），以及取消已存在的过期调度的方式。
7. Convex 默认运行时对 `Intl.DateTimeFormat` 的 `timeZone` 支持（决定引擎如何计算房间时区的 `today`；插件只接收结果）。
8. convex-test 能否加载 `packages/**` 下的插件模块（与第 1 条同源）。
9. dependency-cruiser / ESLint 规则能否在 monorepo 布局下准确识别"规则入口"与"UI 入口"（工具层面，预期可行）。
