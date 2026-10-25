# 专题深潜：场景插件接口（ScenarioPlugin）

> 分片：本文件（目标与范围、决定与理由） → scenario-plugin-part2.md（具体设计一：总览、依赖方向、目录、角色与简报、约束与版本） → scenario-plugin-part3.md（具体设计二：规则函数、reasonCode 与披露、模板、fixture/seed、UI 槽位、必需审批人、调用时序） → scenario-plugin-part4.md（两个骨架验证、反例与边界、接口无法表达的情形） → scenario-plugin-part5.md（测试、与其他专题的接口、待验证清单）。
> 代码：scenario-plugin/contract.ts（引擎侧纯类型与辅助）、scenario-plugin/plugin.ts（ScenarioPlugin 接口）、scenario-plugin/scope-change.ts、scenario-plugin/event-budget.ts（两个骨架）。
> 依据：00-brief.md 第 2、3、5 节；inputs/02 F02.1、F02.8、F05.2–F05.3、F06.1–F06.8、F07.1、F07.5、F08.2–F08.4、F09.1–F09.3、F14.1–F14.5、17 路线；inputs/03 RA-R02、RA-R12、RA-R13、RA-T01–T03、RA-F01–F04、§10.3 Q3/Q10/Q11；inputs/04 要点 5、16 与 part2 validator 一节。

## 1. 目标与范围

### 1.1 要解决的问题

任务书第 2 节要求"通用协商引擎 + 首个场景插件，引擎接口必须能容纳第二个场景"。如果没有显式接口，场景知识会散进 schema、校验、prompt、模板和页面里：第二个场景要么复制引擎，要么在引擎里写 `if (scenario === ...)`。本专题定义引擎与场景之间唯一的契约 `ScenarioPlugin`，回答五个问题：

1. 场景提供什么（目录条目形状、参与方角色、简报字段、约束、规则、文本模板、fixture、UI 片段、审批人规则）。
2. 引擎保留什么（身份与成员、版本计数、提案追加、审批绑定、预算台账、原子执行、代理调用、事件、按角色投影），场景不能碰。
3. 两者之间的数据如何流动（纯函数输入输出，场景永远不读写数据库、不调模型、不读时钟）。
4. 怎么证明接口够用（用"软件范围变更"和"活动预算"两个形状差异较大的骨架走一遍）。
5. 接口表达不了什么（列出并给出取舍）。

### 1.2 范围内

- `ScenarioPlugin<...>` 的 TypeScript 接口与每个成员的语义、调用点、纯度要求。
- 目录条目 schema：引擎通用字段 + 场景属性 `attrs`；条目确认、修订、过期。
- 角色声明：席位、阵营（买方/卖方）、代理种类、审批种类；私密简报字段与逐项披露、硬/软属性。
- 约束：`deriveConstraints` + `hardConstraintProjection`；`constraintsVersion` 的"哈希差递增"语义；`scenarioVersion` 钉住。
- 规则函数签名：`buildTerms`、`priceTerms`、`validateProposal`、引擎的 `checkBudget` 与 `evaluateProposal` 组合、`enumerateFeasible`、`buildTradeoffRequest`、`applyTradeoffAnswer`、`requiredApprovers`、`deriveExecution`。
- reasonCode 注册表与按角色的披露级别；公共文本模板。
- fixture 与 seed 的结构、变体与期望结果。
- UI 片段注册点（Next 侧，独立入口）。
- 引擎依赖方向与场景禁止事项，以及怎么强制执行。
- 插件一致性测试套件。

### 1.3 范围外（由其他专题负责，这里只给接口）

- 表结构细节（03）、状态机（04）、协议信封与动作集（05）、投影实现（07）、执行事务步骤（08）、bumpConstraints 事务（09）、模型调用（10）、页面（13）、首个场景的完整目录数字与走查（14）。本文给的数字只用于验证接口，最终数字以 14 为准。

## 2. 决定与理由

每条按"决定 / 理由 / 否决的备选 / 带来的不变量"写。编号 SP-Dn 供其他专题引用。

### SP-D1 插件是静态注册的纯 TypeScript 模块，不是运行时数据

- 决定：每个场景是一个代码包 `scenarios/<scenarioKey>/`，导出一个 `ScenarioPlugin` 对象；引擎侧有一张静态注册表 `SCENARIOS: Record<ScenarioKey, ScenarioPlugin>`，由 Convex 层与 Next 层分别 import。房间创建时选择 `scenarioKey`，并钉住 `scenarioVersion`。
- 理由：规则必须是确定性代码（核心 4），可单测、可审查；运行时可配置的"规则 DSL"会把校验变成数据解释器，测试面成倍增加，属于过度设计（任务书第 6 节）。目录条目本身是运行时数据（F06.8：现场可增改），但"条目长什么样、怎么校验"是代码。
- 否决：(a) 规则存数据库、用 JSON 规则引擎解释——难测、难审查、易注入；(b) 每个场景一套 Convex 函数——第二个场景要复制审批与执行，违反"引擎接口能容纳第二个场景"。
- 不变量：SP-I1 每个房间恰好对应一个已注册插件与一个受支持的 `scenarioVersion`；注册表里找不到时，所有写操作拒绝（`ConvexError({ code: 'SCENARIO_UNAVAILABLE' })`），读操作只返回引擎级字段。

### SP-D2 插件只做纯函数：不读写库、不调模型、不读时钟与环境

- 决定：插件的所有成员都是"输入 → 输出"的同步纯函数或静态数据。`today`（房间时区的 `YYYY-MM-DD`）、当前约束、目录快照、预算视图全部由引擎作为参数传入。插件不得 import `convex/*`、`_generated`、`@anthropic-ai/sdk`、`react`（UI 入口除外），不得使用 `Date.now()`、`new Date()`（无参）、`Math.random()`、`process.env`、`fetch`、`console.*`。
- 理由：F06.1 要求同一校验函数既在 `rooms.view`（实时显示可执行性）又在执行 mutation（落库前重算）里调用；Convex mutation/query 内只能跑确定性代码；纯函数也让插件一致性测试可以离线跑。
- 否决：让插件拿到 `ctx` 自己查表——就是 F07.5 警告的"按 roomId 整表 collect 再过滤"泄露点，也让引擎无法保证"只在单一写入口改约束"。
- 不变量：SP-I2 同样输入两次调用，输出深度相等（一致性套件逐函数断言）；SP-I3 插件代码路径上不存在 I/O。

### SP-D3 引擎拥有"钱"的算术与台账，插件拥有"钱从哪来"

- 决定：金额只有一个来源——插件的 `priceTerms(terms, catalog)`，它只能读已确认目录条目上的 `unitPriceCents` 与插件声明的已确认附加条款；引擎对结果做 I9 断言（非负安全整数、逐行加总等于总额）。预算台账（`budgets` + `commitments`）、`checkBudget`、执行时写 commitment 属于引擎，插件只声明"哪个角色拥有预算、哪些角色可见数字"。
- 理由：核心 4"模型不得发明金额"与 I5"执行事务内重算"都要求金额与预算检查在引擎可控的路径上；而"按人头计价""加急费按条件收取"是场景知识。
- 否决：(a) 预算也做成插件私有概念——每个场景都要重写原子执行里的预算不变式，容易漏；(b) 引擎写死"金额 = Σ 条目价格"——活动场景的按人头计价、范围场景的条件加急费都表达不了。
- 不变量：SP-I4 `proposal.amountCents === priceTerms(proposal.terms, catalogAt(proposal.sourceRefs)).totalCents`，在插入提案时与执行时各断言一次；SP-I5 插件返回的任何金额若不是安全整数或为负，引擎拒绝并记 `PLUGIN_CONTRACT_VIOLATION`（这是代码缺陷，不是业务失败）。

### SP-D4 检查集 = 引擎检查 + 插件检查，由引擎的 `evaluateProposal` 组合

- 决定：引擎检查固定在前：提案为当前、约束版本一致（标签"Checked against constraints v{n}"）、来源可解析且全部 confirmed 未过期未被取代、金额重算一致、必需审批人非空、预算（若场景启用预算）。插件 `validateProposal` 只返回场景硬约束检查（必需条目、日期、容量、人数等）。输出统一为 `Check { checkId, ok, reasonCode, params, ownerRole? }[]`。
- 理由：RA-R02 指出 Role A 的四项检查名不副实；把"版本、来源、金额、预算"这些与场景无关的检查放在引擎，第二个场景不可能忘记做；场景只负责它真正知道的约束。
- 否决：插件返回整个检查集——插件作者可能漏掉来源核对（RA-B04 正是这种缺陷）。
- 不变量：SP-I6 `isExecutable = evaluateProposal(...).every(c => c.ok)`，永远实时计算（I10）；插件无法屏蔽引擎检查。

### SP-D5 reasonCode 是规则与文本之间的唯一接口，带按角色的披露级别

- 决定：每个 reasonCode 在注册表里声明 `ownerRole`（哪一方的约束）、`paramsSchema`（Zod）、`disclosure: Record<RoleKey, 'detail' | 'summary' | 'masked'>`，并为每个用到的级别提供模板。`masked` 由引擎统一渲染为 "A {ownerRoleLabel} constraint is not met"。引擎 reasonCode 与插件 reasonCode 共享一个命名空间，注册表加载时检查无冲突、无缺模板。
- 理由：F06.7 要求 reasonCode 同时服务模板、角色投影、人工请求选项；Q3（私密硬约束不满足时对他方显示什么）需要逐码决定，而不是全局一刀切。
- 否决：(a) 只存渲染好的文本——RA-T02 已否决；(b) 每个场景各自一套枚举互不相通——人工请求与投影代码要按场景分支。
- 不变量：SP-I7 对他方可见的文本只由模板从 `params` 生成（I8）；`masked` 受众拿到的 DTO 里不含该检查的 `params`（投影在 Convex query 内完成，F07.2）。

### SP-D6 约束版本采用"硬约束投影哈希差"递增，单一入口不变

- 决定：插件提供 `deriveConstraints(input) → C` 与 `hardConstraintProjection(c) → JsonValue`。引擎的每个可能改变约束的写入口（确认简报、确认/修订/撤下目录条目、改预算、回答人工请求、改席位或审批要求）在同一 mutation 里计算写入前后的 `stableHash(projection)`；不同才调用 `bumpConstraints(ctx, roomId, reason)`（I3 的唯一入口不变）。引擎在投影外层再拼上自己负责的部分（预算总额、必需审批规则输入、`scenarioVersion`）。软约束（偏好）不进投影，改动不递增、不使审批失效（F09.1【改写】）。
- 理由：F09.1 指出最容易犯的错是"改了约束忘了递增"；哈希差让"该不该递增"由数据决定，而不是由每个 mutation 作者记住；插件只需诚实地声明哪些字段是硬约束。
- 否决：(a) 每个 mutation 手写 `bumpConstraints`——Role A 的 `saveBrief` 就漏了；(b) 每次写简报都递增——软偏好改动也会让三方重新审批，噪音过大。
- 不变量：SP-I8 `constraintsVersion` 递增 ⇔ 硬约束投影哈希变化；房间存 `constraintsHash`，读时可核对。

### SP-D7 模型只填插件声明的"条款草稿"，引擎包外层动作联合

- 决定：插件提供 `draftTermsSchema`（Zod 对象，只含选择性字段：itemKeys、deferredItemKeys、deliveryDate、termIds 等），引擎把它嵌进 05 的判别联合 `propose | counter`，再外包 `{ message }`。itemKeys 一律 `z.string()`，不按目录动态生成 `z.enum`；成员检查在 `buildTerms` 里做。插件的 `buildTerms(draft, ctx)` 把草稿规范化为不可变的 `T`（排序、去重、补全派生字段），失败返回 reasonCode。
- 理由：F05.2 要求模型不给身份、版本、金额；inputs/04 要点 16：SDK 1.1.0 的 `zodOutputFormat` 会把 enum 降级为描述，动态 enum 不受解码约束，反而让 schema 每次变化、失去缓存，所以不做。
- 否决：插件自定义整个模型输出——动作集与信封是协议（05）的职责，场景不应能新增"approve"类动作。
- 不变量：SP-I9 模型输出里不存在金额、版本、身份字段；`draftTermsSchema` 经一致性测试断言不含名为 `*Cents`、`*Version`、`role`、`userId` 的键。

### SP-D8 必需审批人由插件规则计算、引擎守护并快照

- 决定：`requiredApprovers(terms, constraints) → ApproverRequirement[]`（`{ role, kind: 'terms' | 'budget' }`），在插入提案时调用并快照进 proposal（F08.2）。引擎守卫：结果非空；每个 role 已声明且有席位；若场景启用预算，至少一条 `kind: 'budget'` 且其 role 为预算拥有者；完成判定按集合且要求不同 userId（I7）。
- 理由：v1 范围变更是常量三方（F06.8），但活动场景需要"超过阈值才要 finance"这类条件规则（17 路线"审批阈值触发升级"）；把规则做成函数比做成可改字段安全（F08.2 否决了可改的 `approvalRequired`）。
- 否决：引擎写死 `REQUIRED_APPROVER_ROLES`——第二个场景角色名不同即失效；插件可以把审批人设为空——违反核心 3。
- 不变量：SP-I10 每个提案的必需审批集合在插入时确定且不可变；改变它的输入（金额阈值等）属于硬约束，变化会递增 constraintsVersion。

### SP-D9 执行派生由插件给"内容"，引擎给"事务"

- 决定：`deriveExecution(terms, ctx) → { changeOrder: ChangeOrderSpec; tasks: TaskSpec[] }` 是纯函数；引擎在 08 的执行 mutation 里调用，并在同一事务里写 changeOrder、commitment（金额来自 SP-I4 重算）、tasks。任务模板属于被批准内容：`TaskSpec` 由 `terms` 与已确认目录条目的 `taskTemplates` 派生，目录条目修订会改 `sourceRefs.revision` 从而改 `contentHash`（回答 Q10：纳入）。
- 理由：核心 5 原子幂等只能由引擎保证；任务怎么拆是场景知识（F02.2）。
- 否决：插件返回 Convex 写操作或回调——破坏 SP-D2，并让幂等守卫失效。
- 不变量：SP-I11 同一 (proposalId, constraintsVersion) 两次调用 `deriveExecution` 结果深度相等；执行重试不会产生不同任务集。

### SP-D10 fixture 是插件的一部分，走生产写入路径，只描述"输入"不描述"中间状态"

- 决定：插件导出 `fixtures: Record<FixtureKey, ScenarioFixture>`，内容只有房间配置、角色席位、目录条目、简报（含共享选择）、预算与基线承诺、相对日期偏移，以及给测试用的 `expectations`（期望可行集合、期望 reasonCode）。每个场景至少四个变体：`feasible`、`tradeoff`、`infeasible`、`below_committed`。引擎的 `seed.fromFixture` internalMutation 逐条调用与生产相同的校验与写入函数，全部记录标 `simulated: true`。fixture 不包含提案、审批、执行（回答 Q11：不预置中间状态；演练快照只能来自真实运行存档，属于 15 的职责）。
- 理由：F14.2"数字只定义一次，测试从 fixture 推出"；核心 8 不伪造；RA-F03 修正三。
- 否决：fixture 直接拼数据库文档——绕过校验，能写出生产里不可能出现的状态。
- 不变量：SP-I12 任何 fixture 都能通过与生产相同的 schema 与规则；`expectations` 由一致性测试对照 `enumerateFeasible` 与 `evaluateProposal` 的实际结果。

### SP-D11 UI 片段是 Next 侧的独立入口，只接收已投影的 DTO

- 决定：插件的 UI 放在 `scenarios/<key>/ui.tsx`（`"use client"`），导出 `ScenarioUiSlots` 的部分实现；Next 侧有 `UI_SLOTS` 注册表。槽位固定：`catalogItemRow`、`briefFieldsForm`、`proposalTermsCard`、`tradeoffOption`、`changeOrderBody`、`sharedFactValue`。缺省时引擎用由描述符驱动的通用渲染。槽位组件的 props 只能是引擎 DTO 类型（已按角色投影），不能拿到 Convex client 或发起查询。
- 理由：Convex 打包与 React 无关，UI 不能混进规则入口（inputs/04 part1：默认运行时用 esbuild `platform: "browser"` 打包函数入口）；只给投影后的 DTO 让"把私密字段发到浏览器再隐藏"（核心 1）在结构上不可能。
- 否决：插件页面整页替换——会绕开引擎的审批、阻断展示与诚实标注。
- 不变量：SP-I13 规则入口 `scenarios/<key>/index.ts` 的依赖图中不含 `react`、`next`；UI 入口不 import 规则以外的服务端代码。

### SP-D12 引擎依赖方向单向，用工具强制

- 决定：`engine/contract`（纯类型与辅助：金额、日期、哈希、Check、reasonCode 注册）← `scenarios/*` ← `convex/*` 与 `src/*`（app）。`engine/core`（evaluateProposal、checkBudget、approvals 判定等纯逻辑）依赖 `engine/contract` 与插件接口类型，不依赖任何具体场景。用 ESLint `no-restricted-imports` + dependency-cruiser 规则在 CI 中强制，外加一致性测试。
- 理由：F11.1 的分层；防止引擎里出现 `if (scenarioKey === 'scope_change')`。
- 不变量：SP-I14 `engine/**` 不 import `scenarios/**`；`scenarios/**` 不 import `convex/**`、`src/**`、其他场景。
