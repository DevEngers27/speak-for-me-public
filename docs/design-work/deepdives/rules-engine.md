# 专题深潜：确定性规则引擎（rules engine）

> 作者：规则引擎专题代理。依据：00-brief.md 第 3 节核心 4/5/6/8，inputs/02 F06.1–F06.8、F02.1/F02.3/F02.9、F05.2/F05.3/F05.6、F07.1、F14.2；inputs/03 §5–§6（RA-R01…RA-R14）。
> 分片：本文件（§1 目标与范围、§2 决定与理由）→ rules-engine-part2.md（D8–D12、§3.1–3.3 模块、reasonCode 全表、依赖图）→ rules-engine-part3.md（§3.4–3.8 签名、validator、调用点、定价、today）→ rules-engine-part4.md（§4 反例与边界、§5 测试、§6 接口、§7 待验证）。
> 可运行草案：deepdives/rules-engine/*.ts（零依赖 TypeScript，Node 24 直接 `node --test` 运行，见 §5）。

## 1. 目标与范围

### 1.1 这个组件解决什么问题

核心 4 要求"权限、算术、硬约束、状态迁移、来源核对由确定性代码完成，不信任模型声明"。原仓库与 Role A 分支在这里有三个具体缺口：

1. 没有任何服务端代码独立核对提案（F06.1）；Role A 的 `rules.ts` 只在浏览器跑。
2. Role A 的"Matches current constraints"只比较版本号，必需范围与截止日从未检查；`bestFeasibleOption` 选中了只含可延后项、晚于截止日的报价，四项检查全部 Pass（F06.4、RA-R02 缺陷 1）。
3. 价格、范围、日期没有锚定到已确认来源（F02.1，技术 blocker 之一）；`Date.parse` 与 `z.iso.date()` 对日历日判断不一致（RA-R03）。

规则引擎是这三个缺口的唯一落点：**一组纯函数**，给定一份完整的输入快照，输出可执行性、逐项检查结果（reasonCode）、由目录推导出的金额与来源，以及可行组合与取舍建议。

### 1.2 范围内

| 能力 | 函数（§3 详述） | 调用点 |
| --- | --- | --- |
| 字面校验：金额是安全整数分、日期是真实日历日、键非空 | `isCents`、`isIsoDate`、`addCents` | 所有入口的参数校验、brief/目录保存 |
| 定价：按目录与交付日求和，含条件费用（加急费） | `ScenarioRules.price` | 提案入库、评估、可行组合枚举 |
| 提案评估：结构、来源、必需范围、日期、预算 | `evaluateProposal` | `rooms.view`、`completeTurn`、`approvals.decide`、`executeIfReady`、约束变更后续 |
| 审批就绪：必需审批人、当前决定、不同 userId、已执行 | `evaluateExecutionReadiness` | `approvals.decide`（最后一票即执行）、`executeIfReady`、`rooms.view` |
| 可行组合：穷举 + 帕累托前沿 + 分类 | `findFeasibleOptions`、`classifyFeasibility` | 协商前限定候选、约束变更后决定"重谈 vs 请求取舍"、stub 代理 |
| 取舍建议：最小放宽量（提高上限、延后必需项、放宽截止日、确认新报价） | `suggestRelaxations` | 生成 humanRequests 的选项 |
| 条款规范化与差异 | `canonicalTermsKey`、`diffTerms` | 审批绑定、"与上一版相比"的展示、代理上下文 |
| 按角色投影检查结果 | `projectEvaluation` | `rooms.view` 返回前（矩阵本身归 07） |

### 1.3 范围外（明确不做）

- 不读数据库、不调模型、不读时钟、不读环境变量、不生成随机数、不做 I/O。读表由每个 Convex 入口里的**加载器** `loadEvaluationInput(ctx, roomId, proposalId)` 完成（属于 convex 层，不属于引擎）。
- 不决定状态迁移本身（04 的迁移表决定），只提供守卫所需的布尔与 reasonCode。
- 不生成自然语言。对他方可见的文本由 05/07 的模板从 reasonCode 与参数渲染（F05.3、F06.7）。
- 不决定"谁能看到哪个 reasonCode 的哪个参数"——给出一张建议表，以 07 的披露矩阵为准。
- 不做多房间共享预算（F02.4 已列为已知限制）。

### 1.4 成功标准

1. 同一份输入在浏览器、query、mutation、node:test 中得到逐字节相同的 `Evaluation`（相同的 reasonCode 顺序、相同的参数）。
2. RA-R02 缺陷复现用例（cap $4,800、只含可延后项、晚于截止日的 $700 选项）被判为不可执行，且同时报出 `MISSING_REQUIRED_ITEM` 与 `AFTER_DEADLINE`。
3. F14.2 的 $800 = 余量 用例判为 `FITS_BUDGET`（`<=`），$801 判为 `OVER_BUDGET`。
4. 执行 mutation 在事务内重新加载并调用同一函数；重复请求返回已存在的执行（`ALREADY_EXECUTED` 先于预算检查）。

## 2. 决定与理由

### D1 引擎是零依赖的纯 TypeScript 模块，放在 `engine/rules/`，scenario 规则放在 `scenarios/scope-change/rules.ts`

- **目标**：同一函数在 Convex query、Convex mutation、Next 客户端（只做即时反馈）、node:test 中共用（F06.1）。
- **决定**：引擎不 import `convex/*`、`zod`、`@anthropic-ai/sdk`；只用 ES2022 标准库中确定性的部分（不用 `Date`、`Intl`、`Math.random`）。Zod schema 与 Convex validator 在边界层由同一份常量数组生成（D6）。
- **理由**：Convex 默认运行时与 Node 都能直接执行；Node 24 能直接运行 `.ts`（只用可擦除语法：不用 `enum`、`namespace`、参数属性），单测不需要构建步骤；纯函数便于做属性测试。
- **否决**：① 把校验写进 mutation 内联代码——无法在 query 与 mutation 间共享，Role A 正是因此只有前端一份；② 规则引擎做成 action 调用外部服务——mutation 不能 `fetch`（inputs/04 §1）。
- **不变量**：`engine/rules` 的依赖图里没有 `convex/server`；CI 用 import 检查保证（16）。

### D2 输出是"逐项检查结果 + 有序 reasonCode"，而不是布尔或单个错误

- **决定**：`evaluateProposal` 返回 `Evaluation { executable, checks: CheckResult[], blocking: ReasonCode[], info: ReasonCode[], pricing, amounts }`。每个 `CheckResult = { checkId, status: 'pass'|'fail'|'not_evaluated', severity: 'block'|'info', code, params }`。所有检查都跑（不短路），只有依赖失败的检查标 `not_evaluated`（例如有未知条目时无法定价，预算检查不评估）。
- **理由**：
  - reasonCode 是规则与文本之间唯一的接口（F06.7），三处消费者（模板、投影、人工请求选项）都需要完整列表而不是第一个错误；
  - 审查复现的 $700 用例要同时报出两个原因，UI 才能解释"为什么不行"；
  - Role A 的检查清单形状（每项 Pass/Fail + detail）值得保留（RA-R02 保留部分），只是 detail 改为参数，文本由模板生成。
- **否决**：`checkBudget → boolean`（无法解释）；抛异常（第一个错误掩盖其他错误，且 query 中不该抛）。
- **不变量**：`blocking` 与 `info` 按固定的 `CHECK_ORDER` 排序、去重；`executable === (blocking.length === 0)`。

### D3 reasonCode 是一个封闭的大写枚举，引擎与场景共用一份常量数组

- **决定**：`REASON_CODES` 是 `as const` 数组（§3.2 全表），命名统一为 SCREAMING_SNAKE_CASE，吸收 F06.7 的 `FITS_BUDGET / OVER_BUDGET / BUDGET_BELOW_COMMITTED / MISSING_REQUIRED_ITEM / DATE_CONFLICT / UNKNOWN_ITEM / NEEDS_TRADEOFF` 与任务书要求的 `BEFORE_EARLIEST_DELIVERY`；否决 Role A 的 `budget.within` 点分写法。场景特有的码也进这一个数组（v1 只有 scope_change），新增场景时追加。
- **理由**：Convex `v.union(v.literal…)`、Zod `z.enum`、`ConvexError({ code })`、模板表都能从同一数组派生，杜绝"两套真相源"（RA-R03）。封闭枚举让模板表与披露表能做穷尽性检查（TypeScript `satisfies Record<ReasonCode, …>`）。
- **否决**：按场景命名空间的开放字符串（`scope_change.over_budget`）——第二个场景出现前没有收益，且失去穷尽性检查。
- **开放**：第二个场景引入大量专有码时是否拆分为 `EngineReasonCode | ScenarioReasonCode`（17 路线）。

### D4 金额由引擎从目录推导；提案只存引用，评估时与当前目录比对

- **决定**：提案条款 `ScopeChangeTerms = { itemKeys, deferredItemKeys, deliveryDate }` 是唯一的输入；`price()` 按目录求出 `lines`（itemKey、revision、priceCents）、`charges`（如 RUSH）与 `additionalCostCents`。提案入库时把定价结果作为 `pricingSnapshot` 一起存（只追加）。评估时重新定价并逐行比对 `revision` 与 `priceCents`，不一致报 `SOURCE_CHANGED`（阻断，需要新提案而不是重新审批）。
- **理由**：核心 4"模型不得发明金额"；F05.2 要求 `additionalCostCents` 由代码求和、`sourceRefs` 由代码推出；RA-R02 缺陷 2（报价改价后旧提案照样可批）由 revision 比对关闭。
- **否决**：评估时只用当前目录价格而不比对快照——人批准的金额会在审批后悄悄变化，违反核心 3。
- **不变量**：`pricingSnapshot.additionalCostCents === Σ lines.priceCents + Σ charges.amountCents`；目录条目任何影响价格/日期的修改都使 `revision += 1` 并递增 `constraintsVersion`（09）。

### D5 金额一律是安全整数美分，用 `v.number()` 存储，代码校验

- **决定**：`isCents(n) = Number.isSafeInteger(n) && n >= 0 && n <= MAX_CENTS`，`MAX_CENTS = 100_000_000_000`（十亿美元）。所有加法走 `addCents(a, b)`，结果越界返回 `AMOUNT_OUT_OF_RANGE` 而不是静默溢出。比较全部是整数比较，不出现浮点除法；百分比类规则（v1 没有）将来用"分子 × 100 <= 分母 × 阈值"形式。
- **理由**：`v.*` 只表达形状不表达范围（inputs/04 要点 5）；整数分避免 0.1 + 0.2 问题；上界防止恶意大数让 Σ 失去精度。
- **否决**：`v.int64()` / `bigint`——JSON 与前端处理成本高，十亿美元以下 float64 安全整数足够。
- **不变量**：I9（F02.9）"金额是 0 ≤ n ≤ 上限的安全整数美分"由 `isCents` 在入口与引擎内各检查一次。

### D6 日期是 `YYYY-MM-DD` 日历日字符串；"今天"由调用方传入；比较用字符串序

- **决定**：
  - `isIsoDate(s)`：正则 `^\d{4}-\d{2}-\d{2}$` + 月份 1–12 + 按闰年规则的当月天数；`2026-02-30`、`2026-11-31`、`2026-02-29` 拒绝（RA-R03 复现用例）。不使用 `Date.parse`。
  - 合法日期字符串的字典序等于时间序，比较直接用 `<` / `<=`，不构造 `Date`。
  - 引擎输入里有 `today: IsoDate`。调用方用 `todayInTimeZone(nowMs, room.timeZone)` 计算（convex 层适配器，见 §3.8），引擎本身不读时钟。
  - 所有日期按**房间时区**解释：截止日 `deadline` 当天交付算按时（`deliveryDate <= deadline`），今天交付算有效（`today <= deliveryDate`）。
- **理由**：F06.6 要求 today 按房间时区计算；把时钟挡在引擎外，测试可以用固定 today，mutation 重放也确定。
- **否决**：存毫秒时间戳（截止日"当天结束"的时区换算会在每个比较点重复出现）；固定 UTC-7（黑客松简化，F06.6 已改写）。
- **待验证**：Convex 默认运行时 `Intl.DateTimeFormat` 的 `timeZone` 支持；query 中 `Date.now()` 的缓存语义（§7）。

### D7 预算检查用 `committed + additional <= cap`，在执行事务内按台账重算

- **决定**：`committedCents = Σ commitments.amountCents`（含 kind=`baseline` 的 simulated 基线，F02.3），由引擎从加载器给的台账条目求和（不信任任何存量计数字段）。三态：`FITS_BUDGET`（pass）、`OVER_BUDGET`（block，参数 `overByCents`）、`BUDGET_BELOW_COMMITTED`（block，`cap < committed`，与提案无关，任何提案都不可执行，需要 finance）。`headroomCents = cap - committed`，可为负（只在 BUDGET_BELOW_COMMITTED 时）。
- **理由**：F06.3 的一句话规则原样采纳；恰等于上限通过（F14.2 的 $800 用例）；OCC 保证执行事务读到的台账与写入的承诺一致（I5）。
- **否决**：待批提案预占预算——"Pending proposals do not reserve budget; one active proposal per room"（F06.3）。
