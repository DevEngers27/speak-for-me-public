# 专题深潜：确定性规则引擎 · part4（§4 反例与边界、§5 测试、§6 接口、§7 待验证）

## 4. 反例与边界

| # | 输入 | 天真实现的结果 | 本设计的结果 | 依据 |
| --- | --- | --- | --- | --- |
| E1 | cap 480000，committed 400000，LOGIN+REPORTS 标准 80000 | 用 `<` 判为超预算 | `FITS_BUDGET`（`<=`） | F06.2 第 4 条、F14.2 |
| E2 | 同上，cap 479999 | — | `OVER_BUDGET`，`overByCents = 1` | 边界 −1 |
| E3 | cap 399999 < committed 400000 | 每个提案都报 `OVER_BUDGET`，原因被误导 | 只报 `BUDGET_BELOW_COMMITTED`，budget 检查 `not_evaluated`；`suggestRelaxations` 给出 `raise_cap` | F06.3 |
| E4 | 已执行提案再次请求执行 | 先算预算，报"未就绪" | `already_executed` 早于预算，幂等返回 | RA-R08 |
| E5 | `{ itemKeys: ['CHANGE3'], deferred: ['LOGIN','REPORTS'], delivery 2026-12-20 }`，$700，cap 480000 | Role A 四项全过并执行 | `MISSING_REQUIRED_ITEM + AFTER_DEADLINE + DATE_CONFLICT`，预算仍为 `FITS_BUDGET` | RA-R02 缺陷 1 |
| E6 | `deliveryDate: '2026-11-31'` / `'2026-02-30'` / `'2026-02-29'` | `Date.parse` 滚动成下月 | `INVALID_DATE`；`2028-02-29` 合法 | RA-R03 |
| E7 | `itemKeys: ['LOGIN','LOGIN']` | 求和得 90000，静默多算一份 | `DUPLICATE_ITEM`，不定价 | D8 |
| E8 | `itemKeys: ['LOGIN'], deferredItemKeys: ['LOGIN']` | 语义矛盾 | `ITEM_OVERLAP` | D8 |
| E9 | `itemKeys: []` | 0 元提案"在预算内"并可执行 | `EMPTY_SCOPE`（其余依赖检查 `not_evaluated`） | D8 |
| E10 | 交付日 = 截止日 | 用 `<` 判为超期 | 通过（截止日包含端点） | D6 |
| E11 | 交付日 = today | 判为过去 | 通过；today 之前才报 `DELIVERY_IN_PAST` | F06.2 第 3 条 |
| E12 | 交付日 2026-11-12 早于 LOGIN 加急最早日 11-13 | 按目录价通过 | `BEFORE_EARLIEST_DELIVERY`，`earliestDate = 2026-11-13` | 任务要求 |
| E13 | 提案生成后 provider 把 REPORTS 改为 36000（revision 2） | 用新价重算，人批准的金额被悄悄改变 | `SOURCE_CHANGED`，需要新提案；目录变更同时递增约束版本，旧审批 stale | D4 |
| E14 | REPORTS 报价 `validUntil` 早于 today | 照常可批 | `ITEM_EXPIRED`（注意：过期本身不递增约束版本，见 §7 Q-R3） | F06.6 |
| E15 | 必需项不在目录 | 可行集为空却说不出原因 | `REQUIRED_ITEM_NOT_OFFERED`；`findFeasibleOptions → none` 且 `blockingUnion` 含该码 | D8 |
| E16 | 同一 userId 占 customer 与 provider | 一人满足"三方均批准" | `APPROVER_IDENTITY_CONFLICT` | I7 |
| E17 | customer 先 approve 再 withdraw | 仍计为已批 | 最后一条决定生效：`withdrawn`，`APPROVAL_PENDING` | D10 |
| E18 | 约束版本 1→2 后，三条 approve 仍在 | 继续可执行 | 全部 `stale_approve`，`APPROVAL_PENDING + APPROVAL_STALE(info)` | RA-R04 |
| E19 | 台账条目和超过 `MAX_CENTS` | 浮点失真 | `CONSTRAINT_INCONSISTENT(problems: ['budget_amounts'])` | D5 |
| E20 | itemKeys 顺序不同、目录行顺序不同 | 结果随数组顺序变化（Role A 并列取决于顺序） | 输出逐字节相同（属性 P1） | D2 |
| E21 | 客户未共享截止日，提案超期 | provider 看到截止日 | provider 看到 `PRIVATE_CONSTRAINT_UNMET`，参数为空 | D12 |
| E22 | 目录 11 个非必需条目 | 2048×2 次评估或贪心近似 | `SEARCH_SPACE_TOO_LARGE`，升级给人 | D9 |
| E23 | cap 440000（余量 40000 < LOGIN 45000） | 无解但不知道问谁 | `none`；`raise_cap(minCapCents 445000)`、`defer_required([LOGIN])`、`confirm_offer` | F14.2 |

已知不处理（写明限制）：多房间共享预算（F02.4）；组合放宽（同时延后一项并提高上限）只给单步放宽；付款条件、产能、不可接受条款没有规则（GAP-14，留给 14/17）。

## 5. 测试

已在 `deepdives/rules-engine/` 实现并通过（Node 24.21，`node --test rules.test.ts rules.property.test.ts` → 35/35；`tsc --strict --noUncheckedIndexedAccess --erasableSyntaxOnly` 零错误）。

### 5.1 表驱动（rules.test.ts，28 例）

| 组 | 用例 |
| --- | --- |
| 预算 | 一期加急 90000 在 5000 美元内；全量 140000 超；降到 480000 后一期超；80000 恰等于余量通过；cap −1 超；cap < committed |
| 结构 | 空范围；重复；交叠；未知键；`2026-11-31`；缺简报；必需项被延后 |
| 日期 | 早于加急最早日；晚于截止；截止日当天；today 之后交付日变成过去 |
| 来源 | 改价后 `SOURCE_CHANGED`；过期 `ITEM_EXPIRED`；未确认 `UNCONFIRMED_ITEM` |
| 回归 | RA-R02 的 $700 用例（E5） |
| 可行性 | 降到 480000 后前沿 = `LOGIN@11-20=45000, LOGIN@11-13=55000, LOGIN+REPORTS@11-20=80000`（`NEEDS_TRADEOFF`）；440000 时 `none` + 三个放宽选项 |
| diff | 全量 → 一期：`items_deferred`、`delivery_date`、`additional_cost` |
| 就绪 | 全部当前批准 → ready；约束 bump → stale；approve 后 withdraw；同一 userId 两个角色；已执行短路 |

### 5.2 属性测试（rules.property.test.ts，种子 PRNG，无依赖）

| 编号 | 性质 |
| --- | --- |
| P1 | 确定性与顺序无关：打乱 itemKeys 与目录行，`Evaluation` 深相等；`canonicalTermsKey` 对排列不变 |
| P2 | `executable ⇔ blocking.length === 0`；`committedAfter = committed + additional`；`overBy = max(0, after − cap)` |
| P3 | 预算对 cap 单调：cap = after 与 after+1 为 FITS，after−1 为 OVER |
| P4 | 可行集里每项重新评估都可执行；前沿互不支配；每个可行项在前沿内或被前沿支配 |
| P5 | `isIsoDate` 与 `Date.UTC` 往返参考实现在 5000 个随机 y/m/d 上一致，外加固定坏样本 |
| P6 | `addCents` 返回 null 当且仅当和超过 `MAX_CENTS`；非整数、负数返回 null |
| P7 | provider 投影里 `amounts === null`，不出现截止日字符串、`overByCents`、`belowByCents`、`MISSES_PREFERRED_DATE` |

### 5.3 还要在 16 里补的（引擎之外）

- convex-test：`approvals.decide` 最后一票即执行、`executions.retry` 幂等、`completeTurn` 拒收结构类阻断（convex-test 不模拟并发，inputs/04 要点 3）。
- 真实 dev 部署并发脚本：并发两张最后一票 → 只有一条 execution、一条 commitment。
- 依赖检查：`engine/` 与 `scenarios/` 不得 import `convex/*`、`zod`、`@anthropic-ai/sdk`（可用 dependency-cruiser 或一个 grep 脚本）。
- 隐私金丝雀：provider 的 `rooms.view` 返回 JSON 与 provider 代理上下文中不含 finance 的 canary 与预算数字（F07.5）。
- 模板穷尽性：`satisfies Record<ReasonCode, Template>` 编译期保证每个码都有模板。

## 6. 与其他专题的接口（任务书第 5 节编号）

| 文件 | 本专题提供 | 本专题需要 |
| --- | --- | --- |
| 02-domain-model | 不变量 I9（金额）、I10（实时可执行性）、"延后 vs 移除"语义 | 目录条目 `revision`、提案只追加 |
| 03-schema | `pricingSnapshot`、`termsKey`、`evaluationSnapshot`（历史）字段形状；`vReasonCode`、`vCheckResult` | `catalogItems.revision/status/validUntil/standardDeliveryDate/rushDeliveryDate`、`catalog.rushFee`、`rooms.timeZone/fallbackUtcOffsetMinutes`、`commitments(kind: baseline/change_order)`、`decisions.seq` |
| 04-state-machines | 守卫所需布尔与码：approve 需 `executable`、执行需 `ready` | 迁移表引用这些码作为守卫失败原因 |
| 05-protocol | 结构类阻断清单（拒收模型输出）；`findFeasibleOptions` 候选供代理挑选；`NEEDS_TRADEOFF` 判定 | 模型输出只含 `itemKeys / deferredItemKeys / deliveryDate / rationale`（F05.2） |
| 07-permissions-privacy | `projectEvaluation` 与默认 `OWNED` 表 | 最终的字段×角色披露矩阵、`Disclosure` 来源（客户逐项共享决定） |
| 08-approval-execution | `evaluateExecutionReadiness`、`decisionStates`、`ALREADY_EXECUTED` 顺序 | `requiredApprovers` 快照、`executions` 按 `(proposalId, constraintsVersion)` 唯一 |
| 09-constraint-changes | 约束变化后的"重谈 vs 请求取舍"判定、`suggestRelaxations` | 哪些写入递增 `constraintsVersion`（目录 revision 变化必须递增） |
| 10-agent-runtime | stub 代理 = 前沿第一项；有界重试的触发码 | 回合拒收与重试计数 |
| 12-api | 每个入口的调用点（§3.6） | 函数名定稿 |
| 13-frontend | 投影后的 `checks` 列表（每项 pass/fail/not_evaluated）与模板 | — |
| 14-scenario-scope-change | fixture 与定价规则（§3.7），三条路径：重谈（480000）、取舍（前沿 3 项）、无解（440000） | 最终目录选择（本专题用 F14.2 目录 1） |
| 16-testing | §5 全部用例 | 并发与 convex-test 部分 |
| 18-decisions | D1–D12 可直接转 ADR；§7 开放问题 | — |

## 7. 待验证清单与开放问题

### 7.1 待验证（平台事实）

| # | 事项 | 影响 | 验证方法 |
| --- | --- | --- | --- |
| V1 | Convex 默认运行时 `Intl.DateTimeFormat` 是否支持 `timeZone` 选项与 `formatToParts` | 不支持则只能用固定偏移，夏令时房间会在切换日前后错一天 | 部署一个返回 `todayInTimeZone(Date.now(), 'America/Los_Angeles', -420)` 的 query 对比 |
| V2 | Convex query 中 `Date.now()` 的缓存/重算语义（跨午夜是否刷新） | 界面可能晚刷新"已过期/已过去" | 文档 + 实验；不影响 mutation 的权威判断 |
| V3 | `v.union(...REASON_CODES.map(v.literal))` 的类型推断与参数个数上限 | 不行则手写字面量列表并加编译期一致性断言 | 在 Convex 1.48 项目里 `tsc` |
| V4 | `v.record(v.string(), v.union(...))` 作为 `params` 的可用性 | 不行则把 params 改成判别联合或 JSON 字符串 | 同上 |
| V5 | 单个 mutation 内约 8k 次纯函数评估（`suggestRelaxations` 上限 2^12×2）的 CPU 时间是否远低于 mutation 限额 | 超限则降低 `MAX_RELAXATION_ITEMS` | dev 部署计时 |
| V6 | Node ≥ 23.6 直接运行 `.ts` 的类型剥离（本机 24.21 已实测通过）；CI 的 Node 版本 | CI 版本低则需 `--experimental-strip-types` 或 tsx | CI 配置 |
| V7 | Zod 4 `z.enum(readonlyTupleOfStrings)` 接受 `as const` 数组 | — | 本地 tsc |

### 7.2 开放问题（交 18）

- Q-R1：前沿 ≥ 2（`NEEDS_TRADEOFF`）时，先让代理在前沿里挑选并给出理由，还是直接向客户发取舍请求？建议：先代理，轮次用尽再请客户（05）。
- Q-R2：上调预算后当前提案仍可执行，是否主动寻找更优前沿（Role A Q7）？引擎已能回答"是否存在支配当前提案的选项"，是否触发由 09 决定。
- Q-R3：报价过期是否应由定时任务递增约束版本？当前设计只在评估时阻断（`ITEM_EXPIRED`），旧审批不会自动 stale，但执行会被阻断。
- Q-R4：组合放宽（两步以上）是否需要；v1 只给单步。
- Q-R5：加急费是"整单一次"还是"按条目"；本专题按 F14.2 取整单一次。
- Q-R6：第二场景出现大量专有码时是否拆分 `EngineReasonCode | ScenarioReasonCode`。
