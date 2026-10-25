# 场景插件接口 · part4：两个骨架验证、反例与边界、无法表达的情形

## 4. 用两个骨架验证接口

骨架代码：scenario-plugin/scope-change.ts、scenario-plugin/event-budget.ts。两个场景刻意选形状差异大的：前者"选条目 + 交付日 + 条件加急费"，后者"按人头计价 + 互斥组 + 固定日期 + 条件审批人"。

### 4.1 软件范围变更（scope_change）

fixture `demo`（simulated；数字取 inputs/02 F14.2 方案一，最终以 14 为准；日期为 `addDays(today, n)`）：

| 项 | 值 |
| --- | --- |
| 目录（provider 确认） | `LOGIN` $450 leadTime 10 天，rushFee $100（加急后 leadTime 5 天）；`REPORTS` $350 leadTime 5 天；`EXPORT` $500 leadTime 12 天；交付日下限 = max(各条目有效 leadTime) |
| customer 简报 | required [LOGIN]，deferrable [EXPORT]（REPORTS 是 should，未列入 deferrable 也未列入 required——见边界 B5），preferredDate = today+5（soft），deadline = today+14（hard，**未共享**） |
| provider 简报 | minNoticeDays 0；capacityNote 私密 |
| 预算 | total $5,000；baseline commitment $4,000（simulated） |

变体与期望（`expect.feasibleItemSets` 由 `enumerateFeasible` 核对）：

| 变体 | 补丁 | 期望 |
| --- | --- | --- |
| `feasible` | — | 候选首选 LOGIN+REPORTS+rush（$900，today+5 = preferredDate）；全量 LOGIN+REPORTS+EXPORT $1,300（today+12）报 `OVER_BUDGET` |
| `tradeoff` | total → $4,800（headroom $800） | 可行集合三个：LOGIN+REPORTS 标准 $800（today+10，恰好等于 headroom，`<=` 边界）、LOGIN+rush $550（today+5）、LOGIN 标准 $450（today+10，被第一个支配）。插件剔除被支配候选后向 customer 发人工请求，两个选项："要日期还是要 REPORTS" |
| `infeasible` | total → $4,400（headroom $400 < LOGIN $450） | 候选为空且 `exhaustive: true`；人工请求 finance（raise cap，minHeadroom $450）与 provider（confirm cheaper item） |
| `below_committed` | total → $3,900 | `BUDGET_BELOW_COMMITTED`，人工请求 finance |

接口映射核对：

| 需求 | 落在哪个成员 | 结论 |
| --- | --- | --- |
| 价格只来自已确认目录（F02.1） | `priceTerms` 只读 ctx.catalog；引擎 `AMOUNT_MISMATCH` | 可表达 |
| 加急费按条件收取 | `attrs.rushFee` + 草稿 `useRush` + `priceTerms` 独立行 + `validateProposal` 的 `DATE_BEFORE_LEAD_TIME` | 可表达；"是否加急"是模型可选字段，但费用由代码决定 |
| 必需条目不能静默延后（F06.2、Q11 of 02/18） | `MISSING_REQUIRED_ITEM` 与 `DEFERRED_NOT_ALLOWED` | 可表达 |
| customer 私密截止日（RA-F03） | `DATE_AFTER_DEADLINE` ownerRole customer，provider 披露级 `masked` | 可表达；provider 只见 "A Customer constraint is not met" |
| 预算对 provider 不可见（F07.1） | `budget.numbersVisibleTo` + 引擎码 `OVER_BUDGET` seller 级 summary | 可表达 |
| 三方常量审批 + terms/budget 区分（F08.2–F08.3） | `requiredApprovers` | 可表达 |
| 任务由条目派生（F02.2） | `deriveExecution` + `taskTemplates` | 可表达 |
| 降预算后"重谈还是升级"（F14.1） | 引擎在 `bumpConstraints` 后调用 `enumerateFeasible` → 非空则新 run，空则 `buildTradeoffRequests` | 可表达 |

### 4.2 活动预算（event_budget）

角色 host（买方需求）/ planner（卖方目录）/ finance（预算）。目录：`HALL_A` 场地 $3,000 容量 120（group venue）、`ROOFTOP` 场地 $4,200 容量 80（group venue）、`CATER_STD` $45/人、`CATER_PREMIUM` $70/人（group catering）、`AV_BASIC` $600、`PHOTO` $900。host：eventDate、headcount 100、mustHave [venue, catering]。finance：hostSelfApproveLimitCents $8,000；预算 $12,000、baseline $0。

接口压力点与结论：

| 压力点 | 处理 | 结论 |
| --- | --- | --- |
| 按人头计价：金额依赖约束（headcount） | `buildTerms` 把 headcount **拷进 terms**；`priceTerms` 只读 terms | 可表达，并保持"审批绑定不可变内容"：headcount 改动 → 硬约束哈希变 → 版本递增 → 旧提案报 `QUANTITY_STALE` |
| 互斥组（一个场地） | `attrs.exclusiveGroup` + `EXCLUSIVE_GROUP_CONFLICT` + `enumerateWithGroups` | 可表达；枚举规模 = Π(组大小+1) × 2^可选数，仍在上界内 |
| 没有可协商的日期 | `Terms` 不含 deliveryDate；日期来自约束 | 可表达：引擎从不假设存在日期维度 |
| 容量约束跨条目（场地容量 vs 人数） | `CAPACITY_EXCEEDED` | 可表达 |
| 条件审批人（超过 finance 设的额度） | `requiredApprovers` 在金额 > limit 时追加 `{finance, terms}` | 可表达；同一 finance 用户对同一提案分别给出 terms 与 budget 两条决定（approvals 按 `kind` 区分，08 需支持同人两 kind） |
| 想要"低于额度时免 finance" | 引擎守卫 3 禁止：启用预算且金额 > 0 时必须有 `{finance, budget}` | **刻意不可表达**：核心 3 + F08.2，预算承诺必须有预算拥有者的人工批准；若产品要"小额免审"，应在 17 路线里以引擎级"委托规则"设计，而不是让插件绕过 |
| 取舍：降低人数 | option effect `{target: 'brief', role: 'host', patch: {headcount}}` | 可表达；`answerRequest` 只允许 host 本人，走 `briefs.confirmCore` 并触发哈希比较 |

### 4.3 验证中发现并已修正的接口问题

1. **B3 时间派生值进入投影**：scope_change 初稿把 `earliestStart = today + minNoticeDays` 放进 `C` 并投影，导致每过一天哈希就变、版本就递增、所有审批失效。修正：规则 "C 只保存原始硬值，凡依赖 today 的推导放在 `validateProposal`"；一致性测试增加"同一输入、today 不同，投影哈希必须相同"。
2. **数量来源**：活动场景若在 `priceTerms` 里读 `ctx.constraints.headcount`，同一提案的金额会随约束变化，破坏 SP-I4。修正：契约写明 `priceTerms` 只能读 `terms` 与 `ctx.catalog`；类型上无法完全阻止读 `ctx.constraints`，靠一致性测试（改约束、terms 不变时金额不得变化）。
3. **同人多 kind 审批**：条件审批人暴露 08 的完成判定需按 `(role, kind)` 计，而不是按 role 计。已写进 3.10 与 part5 的接口清单。

## 5. 反例与边界

| # | 情形 | 期望行为 | 落点 |
| --- | --- | --- | --- |
| B1 | 模型给出目录外 itemKey `"FREE_SUPPORT"` | `buildTerms` 返回 `UNKNOWN_ITEM`，不插入提案；`allowAgentSuggestions` 为真时代理应改用 `suggest_item` | plugin + 05 |
| B2 | 模型草稿夹带 `additionalCostCents` | strictObject 拒绝；有界重试 | `draftTermsSchema` |
| B3 | 硬约束投影包含依赖 today 的值 | 一致性测试失败（见 4.3） | conformance |
| B4 | provider 把 REPORTS 从 $350 改为 $300 并确认 | 新 revision；哈希变 → 版本 +1；旧提案报 `SOURCE_SUPERSEDED` 与 `CONSTRAINTS_STALE`，旧审批 stale | 引擎 resolveSources + 09 |
| B5 | 条目既不在 required 也不在 deferrable（"should"，如 REPORTS） | 可以不选，不报错；但若出现在 `deferredItemKeys` 中则报 `DEFERRED_NOT_ALLOWED`——"不选"与"显式延后"语义不同，14 需决定 should 项是否必须列入 deferrable；优先级只影响 `enumerateFeasible` 排序、支配剔除与 `pickStub` | plugin + 14 |
| B6 | `priceTerms` 产出 0.5 美分或负数 | 引擎抛 `PluginContractError('BAD_CENTS')`，回合 failed，错误码不含数值 | 引擎 assertBreakdown |
| B7 | 插件返回 `checkId: 'engine.budget'` 试图覆盖 | `RESERVED_CHECK_ID` 契约错误 | evaluateProposal |
| B8 | 目录 13 项（> maxItems 12） | `catalog.confirm` 拒绝 `CATALOG_FULL` | 引擎写入口 |
| B9 | 大目录剪枝后 `exhaustive: false` 且无候选 | 不得显示"不可行"，改 `SEARCH_INCOMPLETE` 人工请求 | 引擎规则 3.6 |
| B10 | 房间 `scenarioVersion: 1`，部署后插件 `version: 2, supportedVersions: [2]` | 读返回引擎级字段 + `SCENARIO_UNAVAILABLE`；写全部拒绝；部署前一致性测试必须对所有存量版本跑 | registry |
| B11 | customer 已共享 deadline，`DATE_AFTER_DEADLINE` 仍声明为 provider masked | 仍 masked（披露静态）；模板不改；开放问题 | 3.7 |
| B12 | 答复取舍时约束已变 | 引擎先因 open 请求已被 `bumpConstraints` 取消而拒绝；`checkTradeoffAnswer` 是第二道 | 引擎 + plugin |
| B13 | 同一 finance 用户需要 terms 与 budget 两条决定 | 两条独立 approvals，各自绑定版本 | 08 |
| B14 | 目录条目 title 中含 `=SUM(...)` | 模板原样输出为文本；CSV 导出时由导出器转义（F07.10 第 7 条） | 13/15 |
| B15 | fixture 的 briefPatches 写出 schema 不允许的值 | seed mutation 整体回滚 | seed.fromFixture |

## 6. 接口无法表达的情形与取舍

| 情形 | 为什么表达不了 | 取舍 / 退路 |
| --- | --- | --- |
| 一个角色多席位（两名 finance、多家供应商各自签核） | `seats: 1`；完成判定按 (role, kind) 取一人 | v1 不做（Q13）；扩展为 `seats: n` + `quorum` 需要改 08 判定与 07 投影，属于引擎变更 |
| 多卖方竞价（同一需求向三家供应商询价） | 目录只有一个 `ownerRole`，run 只有一个提案链 | 每家一个房间，或在 17 路线设计"多目录 + 选标"引擎能力 |
| 跨房间共享预算 | 预算台账按房间 | 已知限制（F02.4）；执行事务内重算兜底单房间；共享需房间之上的预算实体 |
| 非货币型协商（纯排期、无金额） | 引擎假设存在金额与 `checkBudget` | `budget.enabled: false` 且 `priceTerms` 返回 0 可运行，但 UI 仍显示金额列——可接受的笨拙 |
| 多币种 | `currency: 'USD'` 单一 | 后续把 currency 下放到房间与 commitment；跨币种汇率永远不在 v1 |
| 自由文本条款（保修条款措辞、付款条件的文字版） | 条款必须结构化，公共文本只来自模板 | 付款条件可作为结构化第四维度（17 路线）；自由措辞不支持，这是核心 4/I8 的直接代价 |
| 运行时由用户定义新场景（无代码） | SP-D1 插件是代码 | 刻意不做；规则 DSL 的测试与安全成本过高 |
| 动态披露（共享后自动从 masked 升为 detail） | 披露级别是注册表静态值 | 简单优先；列入 18 开放问题 |
| 时间驱动的约束变化（报价过期）精确到秒 | 约束写入口是 mutation；过期依赖调度 | `scheduler.runAt` 触发 `catalog.expire`，读时 `ITEM_EXPIRED` 兜底，调度精度待验证 |
| 渐进式/多阶段执行（先执行一期，后续自动接二期） | `deriveExecution` 一次产出 | 延后项执行后是否生成占位（Q9）留给 17；可在 `changeOrder.summaryParams.deferred` 中记录，供下一个 run 引用 |
| 小额免预算审批 | 引擎守卫 3 | 刻意不可表达（见 4.2） |
