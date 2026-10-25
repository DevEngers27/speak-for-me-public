# 06 · 确定性规则引擎与场景插件接口（part1：目标、决定）

> 分片：`06-rules-engine.md`（§1 目标与范围、§2 决定）→ `06-rules-engine-part2.md`（§3 模块与依赖、§4 原语、§5 RuleInput / 角色视图 / hardProjection）→ `06-rules-engine-part3.md`（§6.1–6.3 reasonCode 全表、派生、参数受众）→ `06-rules-engine-part4.md`（§6.4 旧大写码 → 新码对照表）→ `06-rules-engine-part5.md`（§7 checkProposal 流水线、§8 按角色投影）→ `06-rules-engine-part6.md`（§9 isExecutable 组合与调用点总表、§10 enumerateCandidates）→ `06-rules-engine-part7.md`（§10.1 候选规则、§11 buildHumanRequests 与 relaxations）→ `06-rules-engine-part8.md`（§12 插件接口 16 + 2 成员与引擎边界）→ `06-rules-engine-part9.md`（§13 测试、§14 不变量、§15 开放问题、§16 与 canon 的对照）。
> 底稿：candidates2/plugin/06（引擎级检查 + 插件检查的组合、两场景反推的引擎边界表）与 candidates/security/06（视图输入下的同一 evaluate、reasonCode 声明 owner / requiresFields）。吸收：deepdives/rules-engine 全部分片与 `rules-engine/*.ts`（依赖传播不短路、35 个用例）及其反驳 r01–r17；deepdives/scenario-plugin 全部分片及反驳 r01–r18；spikes README §0.1/§5/§6/§7；inputs/05 C 节；inputs/07 中涉及 06 的反例。命名、状态与裁决一律以 00-canon 为准；场景专属数字见 14。

## 1. 目标与范围

### 1.1 本章解决的问题

核心 4 要求算术、硬约束、来源核对由确定性代码完成。原仓库、Role A 分支、候选与专题暴露过的缺口都落在本章：

1. 校验只在浏览器跑；"Matches current constraints" 只比版本号（RA-B01），必需范围与截止日从未检查。
2. 价格、范围、日期没有锚定到已确认来源；目录改价后旧提案照样可批（RA-B04）。
3. 跨午夜重算交付日，让已在审批中的提案永久不可执行，又没有任何路径触发 bump（inputs/07 第 19、26、42、78 条）。
4. 只改目录标题就阻断当前提案（inputs/07 第 21 条）；RUSH 费是插件常量，不来自任何确认（第 33 条）。
5. 必需项被撤下时 `findFeasibleOptions` 抛 TypeError（rules-engine-review r02）；或枚举为空却一个人工请求都不生成（inputs/07 第 17 条）。
6. 掩码检查仍带原 `checkId`、通过的私密检查"缺席"即泄露（rules-engine-review r03、scenario-plugin-review r05）；provider 的候选按预算过滤，把余量夹进区间（inputs/07 第 74 条）；人工请求选项用系统视角计算（第 53 条）。

### 1.2 范围内

| 能力 | 函数（`core/engine` 或插件成员） | 主要调用点（12 的函数名） |
| --- | --- | --- |
| 字面校验：整数分、日历日、itemKey、规范 JSON | `assertCents` / `sumCents` / `isIsoDate` / `addDays` / `canonicalJson` | 全部写入口、seed、测试 |
| 规则输入组装与按角色裁剪 | 插件 `toRuleInput`；引擎 `viewFor` | `loadRuleInput`（convex/lib，非纯） |
| 硬约束投影 | 插件 `hardProjection` | `constraints.bump` |
| 提案检查：一次收集全部问题 | `checkProposal`、`checkBudget` | `rooms.view`、`turns.complete`、`approvals.record`、`executeIfComplete`、`startRunTx` 预检（04 §4.3.3；被 `runs.start` 与 `react()` 调用）、`clock.rollLocalDate`、`humanRequests.answer` |
| 可执行性组合（语义与唯一实现归 08 §8.4.2） | `isExecutable`（= `isCurrentForApproval` ∧ `passesChecks`，**不含**审批集合）；`allApproved = evaluateApprovalSet().complete`；执行条件 `canExecuteNow = isExecutable ∧ allApproved` | `approvals.record`、`executeIfComplete`（`resolveRound` 只用 `passesChecks`） |
| 候选快照 | `enumerateCandidates` + 插件 `candidateSpace` / `materialize` | 回合创建 helper `createTurnTx`（04）、`startRunTx` 预检 |
| 人工请求选项 | `buildHumanRequests` + 插件 `relaxations` / `relaxationOrder` | `startRunTx`、`turns.complete`、`humanRequests.answer` |
| 按角色投影检查结果 | 07 §7.11 的 `projectChecks`（XP-5，全仓唯一的投影函数，被 07 的 `projectForRole` 调用）；本章只让 `CheckResult` 带齐 `ownerRole` / `inputs`（§7.1、§8） | `rooms.view`、`approvals.record` 的错误参数 |
| 写入口语义校验 | `validateCapChange` / `validateBriefFields` / `validateCatalogRow` / `validateFactValue`（`core/engine/validate.ts` 的纯函数，本章定义；12 只列它们所在的公开 mutation 与失败码，不另列函数名） | `budget.setCap`、`briefs.confirm`、`catalog.confirm`、`sharedFacts.add` |

### 1.3 范围外

- 不读库、不调模型、不读时钟、不读环境变量、不生成随机数。读表由 `convex/lib/ruleInput.ts` 的 `loadRuleInput(ctx, roomId)` 完成；"今天"一律是 `rooms.localDate`（D22）。
- 不决定状态迁移（04）、不判定审批集合（08 的 `evaluateApprovalSet`）、不生成自然语言（模板归 07/13，场景模板在 14）。
- 字段 × 角色的最终披露矩阵归 07；本章给出检查所有者与参数受众的声明机制，并以测试对账。

### 1.4 成功标准（每条都有 §13 的测试编号）

1. 同一输入在 query、mutation、vitest 中得到逐字节相同的 `Evaluation`（T06-P1）。
2. 14 的主 fixture：余量 $800 时 $800 提案通过（恰等于上限）；上限 $4,799.99 时同一提案 `budget.over`、`overByCents = 1`（T06-U01/U02）。
3. 全量 $1,400 提案同时报 `date.after_deadline` 与 `budget.over`（T06-U05）。
4. 必需项被撤下：`enumerateCandidates` 返回空集与 `emptyReasons: ['item.required_missing']`，不抛错；`buildHumanRequests` 恰好产出一个给 customer 的 `drop_items` 请求（T06-U20/U32）。
5. 跨午夜不重算：插入日物化的 `deliveryDate` 在次日审批时不变，审批仍有效；只有 `date.in_past` 真的翻转才由 `clock.rollLocalDate` bump（T06-U12/U13）。
6. provider 对任何提案只得到 `fit`；非干扰性质测试通过（T06-P6）。
7. "投影相等 ⇒ 阻断集合相等"及其逆向灵敏度测试通过（T06-P4/P5）。
8. 规则包打包后零 `zod`、零 `convex/*` 引用（T06-S1）。

## 2. 决定

| # | 目标 | 决定 | 理由 | 被否决的备选 | 带来的不变量 |
| --- | --- | --- | --- | --- | --- |
| R-D1 纯函数位置 | 浏览器、query、mutation、测试共用一份规则 | 规则是零依赖纯 TS：通用部分在 `core/engine/`，场景部分在 `core/scenarios/scope-change/`；Zod 只在 convex 边界 | spike protocol-rules 实测 8.7 KB、0 处 zod；Convex mutation 只跑确定性代码 | 规则内联在 mutation（Role A 只有前端一份的根因）；规则做成 action（mutation 不能 fetch） | INV-R1 引擎与插件依赖图无 `convex/*`、`zod`、`@anthropic-ai/sdk`、`Date`、`Intl` |
| R-D2 输出形状 | 解释"为什么不行"且一次说全 | `checkProposal` 返回逐项 `CheckResult` 与按固定 `CHECK_ORDER` 去重的 `blocking`；所有检查都跑，只有依赖未通过的检查记 `not_evaluated`，视图缺字段的检查记 `unknown`；通过与未评估的 `code` 为 `null` | reasonCode 是规则、模板、投影、人工请求之间唯一接口（F06.7）；r17 指出 `code: 'OK'` 会被误当通过 | 布尔；抛异常；第一条失败即返回 | INV-R2 `passesChecks ⇔ blocking.length === 0` |
| R-D3 reasonCode 命名 | 一个真相源 | 小写点分、按域分组，单一来源 `core/engine/reasonCodes.ts`；Convex validator 与 Zod enum 由同一数组派生；旧大写码按 §6.4 对照表迁移 | canon §1.5、C22；spike §0.1 | 大写下划线（rules-engine D3、privacy-canary）；场景开放字符串（scenario-plugin） | INV-R3 每个码有受众声明与模板，编译期穷尽 |
| R-D4 规则输入 | 规则只看已确认的硬事实 | 唯一输入 `RuleInput`：全部角色已确认硬字段 + 当前目录行 + 台账求和 + `localDate`；视图 = 同一类型按字段裁剪（未见字段为 `undefined`） | 一个 evaluate 同时服务全局判定与角色视图（security §6.2）；未见字段的检查跳过，候选就不可能携带看不见的约束 | 每角色一套检查函数；provider 候选按预算过滤（C26） | INV-R4 视图检查集是全局检查集的子集 |
| R-D5 硬投影 | "该不该 bump"由数据决定 | `hardProjection(input)` 由插件从 `RuleInput` 派生，只在全局输入上调用；不含 `localDate`、`committedCents`、标题、任务模板、软字段 | D05；`localDate` 进投影会每天作废审批（否决 R-I）；台账在 `open` 期间不变 | 逐处手写 bump；投影不含目录（C9） | INV-R5 同 `localDate`、同台账下投影相等 ⇒ 阻断集合相等 |
| R-D6 金额 | 不发明金额、不溢出 | 一律整数分；金额只来自目录行之和；`committed + amount <= cap` 恰等于通过；`budget.below_committed` 由写入口拒绝，规则里保留同名检查只作纵深防御 | D23；spike 实测边界 | 允许低于已承诺并进入 needs_input（C32） | INV-R6 单行价 ≤ 8e9 分；在架 item ≤ 12、modifier ≤ 2，每个候选至多 1 个 modifier；求和溢出的候选被丢弃，绝不崩溃 |
| R-D7 日期 | 跨午夜不失效 | 交付日在提案插入时物化为 `addDays(localDate, effectiveLeadDays)` 的绝对日期，之后不重算；时间检查只有 `date.in_past`、`date.out_of_range`、`date.after_deadline`；翻转由 `clock.rollLocalDate` 处理 | D22；inputs/07 ≥ 8 条跨午夜死锁 | 每次按 today 重算；今天进投影 | INV-R7 引擎不读时钟；`rooms.view` 不读 `Date.now()` |
| R-D8 来源核对 | 人批准的金额不会被悄悄改 | 提案带 `lines[]` 快照；`lines[].revision` 与当前行比较得 `version.stale_source`；快照金额与 `Σ lines.priceCents` 比较得 `amount.claim_mismatch`；**旧提案永不按当前目录重新定价** | D25；scenario-plugin-review r04（重定价误报、撤下后崩溃） | 用当前目录给旧提案定价；按标题也算来源变化（C8） | INV-R8 `revision` 只在 `priceCents` / `leadDays` / `status` 变化时 +1 |
| R-D9 候选 | 模型只选、不填 | `enumerateCandidates(view)` 按角色视图枚举，≤ 12 项，按 `candidateKey` 码点序稳定排列，首轮 proposer 首位为最便宜候选（锚点由 `turnKind` / `roundNo` 派生，调用方不能覆盖），排除 `excludedCandidateKeys(run)`；必需项不在目录时返回空集与原因 | D10；r02；inputs/07 第 74 条 | 按预算过滤 provider 候选；按任何角色偏好排序；`localeCompare` | INV-R9 快照中每项在该视图下 `blocking` 为空 |
| R-D10 掩码 | 私密约束只泄露 1 bit | 掩码按**检查**判所有者：非所有者、未获显式解密时，失败的检查合并为一条 `private.constraint_unmet`（无 checkId、无参数、无计数），通过的检查省略；provider 只得 `fit: 'ok' \| 'blocked'` | D11、D12 ①；r03、scenario-plugin r05 | 按 code 判所有者；保留 checkId；provider 看原因类别（U2 备选） | INV-R10 非干扰：他方私密值变化而 1 bit 摘要不变时视图逐字节不变 |
| R-D11 人工请求 | 卡住时恰有一个具体的人被问 | `buildHumanRequests` 只用目标角色视图生成选项，恰好产出一个请求；按 `relaxationOrder = [customer.drop_items, finance.raise_cap]` 选第一个"自身视图可见冲突且有可放松选项"的角色；无人可见时向 customer 请求披露；选项键不透明 `'A'..'E'`（03 §3.9、05 §5.11.1，与模型的 `O1..On` 区分） | D15；inputs/07 第 17、53 条；fixtures-walkthrough-review r04/r05 | 系统视角生成选项；同时问多人；`close` 作选项 | INV-R11 选项中的每个数都可由 `viewFor(toRole)` 推出 |
| R-D12 插件接口 | 引擎能装第二个场景且接口可审 | `ScenarioPlugin` 恰好 16 个必需成员 + 2 个可选成员（§12.1）；引擎拥有金额算术、台账、日期窗口、来源核对、掩码；scope_change 规则只保留一份实现 | D21；scenario-plugin 过度设计表 | 6 个 UI 槽位 + `supportedVersions` + `checkTradeoffAnswer`；规则 DSL | INV-R12 `core/engine/**` 不出现场景词（lint） |
| R-D13 可执行性 | 规则与状态守卫不混在一张清单 | `isExecutable = 状态守卫 ∧ termsKey 完整 ∧ passesChecks`；审批齐不齐由 08 的 `evaluateApprovalSet` 判定（`allApproved`）；仓库里只有 08 §8.4.2 一份 `isExecutable` 实现，本章不再给出第二份代码 | D19 的 `passesChecks` / `isExecutable` 分名；r07 就绪判定三份实现 | 规则引擎内含 readiness | INV-R13 approve 前与执行事务内各调用一次，结论相同 |
