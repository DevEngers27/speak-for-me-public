# 00 · 概览（final-v2）

> 分片：`00-overview.md`（本文件：§0.1 概览、§0.2 设计原则、§0.3 八条核心 → 设计点 → 测试编号、§0.4 与原方案的主要差异、§0.5 文档地图）→ `00-overview-part2.md`（§0.6 术语表（以引用方式逐字采用 canon §1.1–1.3，另列补充术语与 canon 未列的章节级名字）、§0.7 全篇不变量摘要、§0.8 备选与否决、§0.9 开放问题、§0.10 与 canon 的对照）。
> 底稿：`candidates2/minimal/00-overview.md`（概念最省、八条核心对照表）+ `candidates/invariants/00-overview.md`（术语表、核心 → 设计点）。命名、决定、冲突裁决一律以 `00-canon*.md` 为准；与 canon 冲突的底稿内容已改写。

## 0.1 一段话概览

Speak for Me 是一个多方 AI 协商工作台。每个参与方（首个场景：customer、provider、finance）把目标、硬约束与偏好写进**只追加版本化**的私密简报 `brief`，并逐字段决定谁能看到；每方一个隔离代理只在**代码枚举并快照**的候选（`turn.candidateSnapshot`，模型只引用位置标签 `optionKey`）之间提议、还价、澄清、建议接受、拒绝或升级；**确定性代码**（`core/engine` 的纯函数）物化金额与交付日、校验预算 / 必需范围 / 日期 / 来源；人对**不可变提案**（`proposal.terms` + `termsKey`）在**当时的约束版本**下审批（`approvals` 只追加，带 `boundConstraintsVersion` / `boundTermsKey`）；最后一个必需审批落库的**同一个 mutation** 内由 `executions.executeIfComplete` 原子、幂等地写入执行记录（`executions`、`ledgerEntries(commit)`、`changeOrders`、`tasks`、`events`），执行键 `exec:${proposalId}` 由服务端派生；任何硬约束变化只经 `constraints.bump` 一个入口递增 `rooms.constraintsVersion`，同事务 supersede 当前 run、让旧审批自然失效，并迭代到不动点：仍合规的提案原样重批，否则重新协商，无解时向**恰好一个具体的人**发出带出口的取舍请求 `humanRequest`。v1 一房一执行；后续变更经 `rooms.startFollowUp` 开新房间。

技术栈（任务书 §2 已定，版本见 canon D20）：Next.js 16.4.3 App Router + Convex 1.48.0（数据库、函数、调度、实时订阅）+ Clerk 7.9.20（只做认证）+ `@anthropic-ai/sdk` 1.1.0（服务端，`claude-opus-5-5`）。

## 0.2 设计原则

每条写"目标 → 决定 → 理由"，被否决的备选集中在 §0.8。

| # | 原则 | 目标 | 决定 | 理由 |
| --- | --- | --- | --- | --- |
| P1 | 不变量先行、能派生的不存 | 让核心 1–8 可机械检查 | 只存不可变事实与少量指针；可执行性 `isExecutable`、审批有效性（`effective` / `stale_approve` / `stale_reject` / `withdrawn`）、`committedCents`、`headroomCents`、房间阶段 `phase`、待办 `todos` 一律读时派生（canon §1.3） | 存储的派生状态会与源数据漂移；九份候选里"提案 / 审批存状态"是评委反例最多的来源之一 |
| P2 | 每个关键写入只有一个入口 | 唯一性与只追加不依赖平台的唯一约束（Convex 没有） | `constraints.bump`（约束版本）、`approvals.record`（审批）、`executions.executeIfComplete`（执行）、`events.append`（事件）、`invites.accept`（席位）、`turns.beginAttempt`（调度接缝）；先查后写 + OCC | spike B1：索引不唯一，`.unique()` 只是读时断言；seed / 迁移也必须走入口（canon D18） |
| P3 | 模型不碰数字与身份 | 核心 4：金额、日期、条目只来自人确认过的信息 | 模型输出根 `{ turn: AgentModelOutput }`，只能引用 `optionKey`、提案 `version`、`topicKey`、`reasonKey`、`toRole`；schema 不得出现金额 / 版本 / 身份属性名（写成测试）；服务端物化 `terms` | research：代码出价使成交率 26.7% → 88.9%；LLM 在多方协商中会算错、接受付不起的交易 |
| P4 | 对他方可见的一切走同一投影与模板 | 核心 1：不把私密字段发到浏览器再隐藏 | DTO、事件渲染参数、代理上下文都经 `projectForRole(role, dto)`；他方可见文本只由 `renderPublicText(templateKey, fields)` 渲染；派生值继承输入中最严格的披露类（canon D11、D13） | research：提示里要求保密仍有 35–50% 泄露；spike：完全被攻破的模型在"信封 + 模板 + 投影"下守住 20 条注入 |
| P5 | 一条约束变化路径 | 核心 3：条款或约束变了必须重新审批 | 递增由"硬投影比较"决定（canon D05）；同事务 supersede + 不动点反应（D06）；执行不递增 | 漏递增 = 旧审批执行新约束外的方案；多递增 = 无谓重批；执行递增 = 已执行审批显示 stale |
| P6 | 串行回合 + 单调度接缝 | 活性：run 永不停在 negotiating 却无在途回合 | 每轮 provider 1 回合 + customer、finance 各 1 评估回合，任意时刻至多一个 running attempt（D08）；守卫命中必 `runs.reconcile`（D07） | 并行评估在 5 份候选里各被构造出一例永久死锁 |
| P7 | "未达成"是一等结局 | 核心 8：不编造一致意见 | 无解、轮次用尽、代理失败都进入 `needs_input` 并恰好开一个带出口的 `humanRequest`；`ended_no_agreement` 是正常终态并在界面正面展示 | research：A2A 的中断态 / 终止态；Pactum 成交率约 64–68% |
| P8 | 反对过度设计 | 每个组件都说明它解决的问题 | 单包布局（D21）、无 workflow 组件（D01）、无哈希链（D14）、无 `modelCalls` 表（attempt 即用量账本）、无 `budgets` 表（上限是 finance 硬字段）、v1 一个场景 + 第二场景只做契约测试 | 任务书 §6："两个方案都完整时选简单的" |

## 0.3 八条核心 → 保证它的设计点 → 测试编号

测试编号与 16 章一致：反例电池用 `00-invariants-part7…11`（canon 对齐重写版）的 CE-001…CE-170，16 §16.11 的用例矩阵从这里取编号并新增 CE-171…CE-175（此后新增从 CE-176 起，由 16 登记）；16 早稿 §16.11.2 列出的 8 条修订期望已由 canon 包并入电池本身（canon C43），各处只引用电池编号。下表"核心 → CE"的分组取自 `00-invariants-part11` §3 覆盖矩阵（只列编号，谓词与操作序列以电池原文为准）。用例用 16 §16.6–§16.7 的 TC-AUTH / VER / EXE / RUN / RULE / OPS / PRIV / INJ 族；R1–R11 为 08 / 16 §16.5 的对账检查器（每个 convex-test 场景 afterEach 断言）。不变量编号取 `00-invariants*.md` 重写版的 INV-01…79 与 INV-M1（房间写锁，INV-79 / INV-M1 为跨章核对阶段补录，00-invariants-part6 §1.11；决定记录 18 ADR-X01）。

| 核心 | 保证它的设计点（章节） | 测试编号 |
| --- | --- | --- |
| 1 私密委托 | `briefs` 按 `(roomId, role, version)` 只追加、逐字段 `disclosures`（02/03）；`projectForRole` 唯一投影出口，DTO / 事件 / 代理上下文同源（07）；掩码检查对非所有者只给 `private.constraint_unmet`（06）；provider 对任何提案只见 `fit: ok \| blocked`（D12 ①，07/13）；删除 `deferredItemKeys`（D11）；`humanRequest.options` 只用目标角色自身视图计算并 `assertOptionsProjected`（D11/D15）；他方可见文本只来自模板（D13）；事件无 `visibility` 字段 + `restrictedRef` 读时连接（D14）；目录标题 `<untrusted_data>` 定界、`sharedFacts.add` 披露闸门、日期窗口语义校验（D12 ⑧）；浏览器只收 `ConvexError({code, params})` 且 params 同样投影，公共函数禁 `console.*`（D16）；约束变更类写入每用户每房间每小时 ≤ 6 次（D12 ⑥） | CE-001…035、CE-165、CE-166、CE-171…175；隐私金丝雀三身份双向扫描 + 派生数值针脚 + `lintCanaries`；Proxy 读取测试；非干扰性质测试（改他方私密值，本角色视图逐字节不变）；spike 注入语料 INJ-01…20；16：TC-PRIV、TC-INJ、TC-AUTH；INV-01…19 |
| 2 代理只建议 | 动作枚举无 `approve` / `accept`（canon §1.4，05）；`recommend_accept` 只推进 run 状态，永不写 `approvals`（04/05）；`approvals` 唯一写入口是需要身份的 `approvals.record`（08/12）；被调度函数无身份、显式传 `actorUserId`（10/12）；界面虚线 agent-box "Suggestion only, never counted as approval"（13） | CE-036…041、CE-094；spike 80 组注入零 approvals；"schema 无金额 / 版本 / 身份属性名"测试；16：TC-RUN（代理产物零 approvals）、TC-INJ；INV-20…23 |
| 3 人批准具体版本 | 提案写后不改、`termsKey = canonicalJson(terms)`（D25）；审批只追加并绑定 `boundConstraintsVersion` / `boundTermsKey`，入参必带 `expectedConstraintsVersion` / `expectedTermsKey`（D02）；`evaluateApprovalSet` 按当前成员、`userId` 两两不同判齐（08）；`constraints.bump` 唯一递增入口 + 硬投影（D05）；约束变化后新 run 预检、同一 `proposalId` 重批（D06）；按钮文案绑定版本（13） | CE-042…072、CE-110、CE-111、CE-122；"投影相等 ⇒ 阻断集合相等"性质测试；R1–R11；16：TC-VER；INV-24…36 |
| 4 代码负责校验 | `core/engine` 零依赖纯函数 `checkBudget` / `checkProposal` / `isExecutable` / `enumerateCandidates`（06）；模型只选 `optionKey`，服务端在 `candidateSnapshot` 内解析并物化 `terms`（D10）；`amount.claim_mismatch`、`version.stale_source`、恰等于上限通过、一次收集全部问题（06）；整数分 `assertCents`、`IsoDate` 字典序比较、绝对交付日不重算（D22）；`approve` 前同事务重跑 `isExecutable`（D02） | CE-073…094、CE-121…146；protocol-rules 迁入的 92 个表驱动用例；边界减一分（$4,799.99 → `budget.over`）用例；16：TC-RULE、TC-RUN（`stop_reason` 分支）；INV-37…45、INV-67…79 |
| 5 执行幂等且原子 | 最后一个必需审批的同一 mutation 内 `executeIfComplete`（D03）；`executionKey = exec:${proposalId}`、`by_executionKey` 先查后插；客户端不传任何幂等键；任务来自 `proposal.plannedTasks` 快照、`taskKey` 三段（08）；房间写锁 M-ROOM 使同房间写事务确定串行，审批区间读冲突为第二道（03，18 ADR-X01） | CE-095…120、CE-169（RD：CE-096、097、099、100、101、119、120，见 `00-invariants-part11` §3.2）；R1–R11；spikes §8 #1 真实部署并发探针（`maxOverlap ≥ 2` 证据）；16：TC-EXE + L2 并发探针；INV-46…53、INV-M1 |
| 6 历史不可篡改 | `briefs` / `catalogItems(itemKey, revision)` / `proposals` / `approvals` / `ledgerEntries` / `events` / `attempts` 只追加（03）；撤回也是追加 `withdraw`（D02）；`executions.approvalIds` 冻结快照（D04）；每个 cv 一行 `constraintRevisions {cause, actorUserId, sourceRefs}`（09，18 ADR-X03）；目录 `(itemKey, revision, editNo)` 只追加（18 ADR-X02）；只追加表唯一允许的覆写是 `privacy.redact`（18 ADR-X04）；`events.append` 唯一写入口、`(roomId, commitTs, seq)` 排序（D14） | CE-049、050、057、089、108、109、113、116、131、145、168；只追加表 lint 探针；执行后 bump 不改已执行记录显示；16：TC-VER-08、静态只追加检查；INV-54…58 |
| 7 执行边界 | 执行只写 `executions` / `ledgerEntries` / `changeOrders` / `tasks` / `events`，mutation 内无外部副作用（08）；外部集成只经 outbox 扩展点（17）；变更单固定声明 "Internal record only"（13）；v1 一房一执行（D04） | CE-147…151（CE-147：依赖白名单，代码库无 ERP / 支付 / 签署 / 邮件 SDK）、CE-112；执行后终态 CE-118、CE-130；后续变更 E2E CE-168；16：TC-OPS-05；INV-59…61、INV-52 |
| 8 不伪造 | `provenance: live \| seeded \| stub` 贯穿 rooms / proposals / executions / ledgerEntries / changeOrders / tasks / attempts（canon §1.2）；`SimulatedBadge`（13）；seed 走生产写入口且不预置提案 / 审批 / 执行（D18）；无解只开请求、不调模型（D06/D15）；用量只来自真实响应并永远记入 `attempts`（10） | CE-152…157、CE-128 / CE-167（无解时零模型调用）、CE-138、CE-139；防假绿 CE-158…164（含 stub 脚本队列耗尽断言）；16：TC-OPS-02；INV-62…66 |

## 0.4 与原方案的主要差异

"原方案"= 原仓库 README 与 Role A 分支（inputs/01、inputs/03）。

| # | 原方案 | final-v2 | 依据 |
| --- | --- | --- | --- |
| 1 | 客户端 / 演示流程提交 operationId 防重 | **执行唯一键由服务端派生**：`executionKey = exec:${proposalId}`，不含 cv、不哈希，客户端不传任何幂等键，`requestId` 只做去重与追溯 | spike convex-test 实测两次点击两条 execution；canon D03 |
| 2 | approvals 每 (proposal, user) 一行，可覆盖 | **审批只追加**：一行一决定，当前决定 = `seq` 最大行；撤回追加 `withdraw`；相同决定不插行（`unchanged`） | spike：upsert 违反核心 6；canon D02 |
| 3 | `publicSummary` 必填自由文本、事件预渲染英文 | **对他方可见的文本只来自模板** `renderPublicText`，参数类型不含自由 `string`；`rationale`、人写备注只给本方 | spike privacy-canary；canon D13 |
| 4 | 一个 `status` 混合房间 / run / 提案 / 审批 | 分层状态机（canon §1.3），提案状态只有 `active / superseded / rejected / stale / executed`，审批有效性派生 | GAP-05；04 |
| 5 | 预算放在全员可见的 `rooms.totalBudgetCents / committedCents` | 上限是 finance 简报硬字段 `capCents`；已承诺 = `ledgerEntries` 求和；customer 默认看不到（U1），provider 永远看不到 | GAP-01；D11/D12/D23 |
| 6 | 约束版本递增点未定义 | `constraints.bump` 唯一入口 + 递增矩阵（含目录价格 / 工期 / 增删、clock 结论翻转；不含标题、软字段、执行） | AX-15；D05/D22 |
| 7 | 消息 schema 混合服务端信封与模型输出 | 信封由服务端填写；模型输出只引用快照内位置标签与小整数版本 | GAP-04；D09/D10 |
| 8 | 自由字符串的范围、来源、硬约束 | 结构化：`catalogItem(itemKey, revision, kind)`、`requiredItemKeys`、`deadline: IsoDate`、`lines[]` 快照 | GAP-07/08；D25 |
| 9 | 最多 3 轮后转人、clarify 由谁回答未定 | 串行回合、`maxRounds = 3`、轮次用尽 / 无解 / 失败各有确定的收件人与出口；clarify 话题化、可代答每角色每 run ≤ 1 | GAP-10/11/12；D08/D15 |
| 10 | Role A 的 "revalidated" 复制提案、`bestFeasibleOption` 充当协商结果、"Preview as" 角色切换 | 约束变化后对同一 `proposalId` 重批；首发候选由代码给出但仍需代理与人；身份只来自 Clerk | RA-R11/R12/U13；D06/D10/D19 |
| 11 | 修改已确认协议"开新流程" | v1 一房一执行，后续变更 `rooms.startFollowUp` 新房间 | GAP-13；D04 |
| 12 | 种子数据直接写中间状态 | seed 走与用户相同的 mutation 链，全部 `provenance: 'seeded'` | AC-08；D18 |

## 0.5 文档地图（19 章）

分片为本章写作截止时目录 `ls` 的结果（`-partN` 表示 `NN-slug-partN.md`，part1 即无后缀文件）；各章仍可能追加分片，以目录为准。

| 章 | 主题 | 深度 | 分片 |
| --- | --- | --- | --- |
| 00 | 概览、原则、术语、差异 | 简 | `00-overview.md`、`-part2`；配套 `00-canon.md` + `-part2…7`（法律）、`00-invariants.md` + `-part2…11`（不变量与反例电池）、`00-product-decisions.md` + `-part2`（产品决策草稿） |
| 01 | 产品：用户、角色、做 / 不做、旅程、derivePhase 表 | 简 | `01-product.md`、`-part2…4` |
| 02 | 领域模型、实体、不变量 | 核心 | `02-domain-model.md`、`-part2…7` |
| 03 | Convex schema v1、索引、唯一性落点 | 核心 | `03-schema.md`、`-part2…12` |
| 04 | 房间 / run / turn / attempt / 提案 / 审批 / 请求状态机 | 核心 | `04-state-machines.md`、`-part2…5` |
| 05 | 协商协议、动作集、回合、取舍请求结构 | 核心 | `05-protocol.md`、`-part2…7` |
| 06 | 规则引擎、reasonCode、场景插件接口 | 核心 | `06-rules-engine.md`、`-part2…9` |
| 07 | 权限与隐私、披露矩阵、威胁模型 | 核心 | `07-permissions-privacy.md`、`-part2…9` |
| 08 | 审批与执行、AIA G701 金额链、对账 R1–R11 | 核心 | `08-approval-execution.md`、`-part2…11` |
| 09 | 约束变更、递增矩阵、$4,800 走查 | 核心 | `09-constraint-changes.md`、`-part2…5` |
| 10 | 代理运行时、调度链、看门狗、模型网关 | 核心 | `10-agent-runtime.md`、`-part2…7` |
| 11 | 架构、单包布局、依赖方向 | 简 | `11-architecture.md`、`-part2…4` |
| 12 | 后端函数目录 | 简 | `12-api.md`、`-part2…8` |
| 13 | 前端信息架构、视图模型 | 简 | `13-frontend.md`、`-part2…6` |
| 14 | 首个场景 scope_change、fixture 与走查 | 核心 | `14-scenario-scope-change.md`、`-part2…7` |
| 15 | 运维、环境、成本、排空 | 简 | `15-operations.md`、`-part2…5` |
| 16 | 测试策略、反例电池、真实部署验证 | 简 | `16-testing.md`、`-part2…9` |
| 17 | 演进路线与扩展点 | 简 | `17-roadmap.md`、`-part2` |
| 18 | 决策记录 ADR-D01…D27（canon）与 ADR-X01…X04（章节级）、开放问题、待验证清单 | 简 | `18-decisions-open-questions.md`、`-part2…10` |

读法：先读 canon（命名与裁决）→ 00/01 → 02–10 核心 → 14 走查 → 其余。优先级：任务书 > canon > inputs/05 > inputs/04 > 专题 > 候选 > techstack / spike 原文。
