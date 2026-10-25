# 00 概览：Speak for Me 重建设计（候选方案：不变量优先）

## 1. 一段话概览

Speak for Me 是多方 AI 协商工作台。每个参与方把目标、硬约束和偏好私密地交给自己的代理；provider 的代理提出条款，customer 与 finance 的代理评估、还价或提问；**代码**计算金额并校验预算、必需项、日期与报价来源；**人**对"不可变提案 + 当时的约束版本"审批；最后一票在同一事务里原子、幂等地写入变更单、预算承诺与任务。任何规则输入变化都产生新的约束版本：旧审批自动不再计数、旧方案即时被阻断，系统自动重谈，无解时向能解决问题的具体的人发出结构化取舍请求。技术栈：Next.js（App Router）+ Convex + Clerk + `@anthropic-ai/sdk`（`claude-opus-5-5`）。

## 2. 设计原则

1. **不变量优先**：先写出 56 条必须永远成立的命题（02 part1–2），每条都落到"哪张表的哪个字段 + 哪个函数的哪条守卫"，再推导实体、状态机与 API。`ops.auditRoom` 在测试与生产中复核它们。
2. **单一写入口**：每个关键字段与只追加表只有一个写者（`bumpConstraints`、`commitBriefVersion`、`insertProposal`、`decisions.record`、`executeIfReady`、`emitEvent`、`transitionRun`），写门面与 lint 规则机械地守住"只追加"。
3. **房间聚合写锁**：房间内所有业务 mutation 都 patch `rooms`，在 Convex OCC 下串行，唯一性守卫不依赖待验证的平台细节（ADR-01）。
4. **能派生的不存**：提案状态、可执行性、审批状态、共享事实、房间阶段都在读取时计算；只存不可变事实与少量指针。
5. **跨方只有结构与模板**：对他方可见的内容 = 结构化动作 + 枚举码 + 模板文本；模型自由文本只给本方委托人。
6. **派生闭包**：派生值只对能看到其全部输入的人可见（07 §3）。
7. **反对过度设计**：每个组件写明它解决的问题；两个完整方案选简单的（例如不设 budgets、sharedFacts、changeOrders 表，不引入编排组件，不存内容哈希）。

## 3. 不可动摇的核心 → 设计保证

| # | 核心 | 由哪些设计点保证 |
| --- | --- | --- |
| 1 | 私密委托 | 简报版本只经 `briefs.mine` 返回本人（BR-3）；投影是唯一出口，带 `returns` validator（07 §6）；逐字段披露 + 穷举的策略性披露 + 派生闭包（BR-4、07 §3–§4）；代理上下文复用委托人的投影函数（RN-6）；跨方无模型自由文本，clarify 变为向字段所有者本人的披露请求（ADR-08）；可行集不进代理上下文（ADR-07）；事件 payload 按受众约束（EV-3）；日志与错误纪律（07 §10）；金丝雀测试（16 §4） |
| 2 | 代理只建议 | 代理只运行在无身份的 internal action 中，无法调用公共 mutation（07 §5）；`decisions` 唯一写者是人调用的 `decisions.record`（DE-2、RN-7）；recommend_accept 只写回合与事件，界面标注"advice, not an approval"（13 §3） |
| 3 | 人批准具体版本 | 提案不可变（PR-1）；决定绑定 (proposalId, constraintsVersion)（DE-2）；只有当前版本上的最新 approve 计数（DE-4）；约束集涵盖全部规则输入，且所有规则输入变化都经唯一入口递增（CS-1、CS-3）；审批类别 terms/budget 快照（PR-6、ADR-15） |
| 4 | 代码负责校验 | 纯函数 `evaluateProposal` 在提案创建、界面、审批、执行、约束变化复评中共用（06 §1、§6）；金额由 `materializeTerms` 从确认版本复制求和，模型输出无金额字段（PR-3）；三层校验（05 part1 §5）；只读确认版本（BR-2）；身份只来自 ctx.auth（ID-1）；状态迁移表（RN-2）；来源核对 `source.*`（06 §3） |
| 5 | 执行幂等且原子 | 执行在最后一票的同一 mutation（EX-2、EX-3）；状态守卫 + `by_proposalId` + `operationKey` 三重幂等（EX-1）；台账断言（CS-4）；全局预算不变量（EX-5）；真实部署并发测试（16 §5） |
| 6 | 历史不可篡改 | 只追加表：briefVersions、constraintSets、proposals、decisions、executions、commitments、events、modelCalls（02 part3 §4）；撤回也是追加（DE-1）；约束集使任一历史评估可复现（CS-2）；生产无删除路径（15 §2） |
| 7 | 执行边界 | 执行只写内部记录，在 mutation 中且不调度 action（EX-6）；外部集成只作为 outbox 扩展点（17 §3）；变更单页面固定声明（08 §8） |
| 8 | 不伪造 | `isSimulated` 贯穿 fixture、seed、stub 及其派生记录并在界面标注（SIM-1）；无可行方案时只开人工请求、绝不制造"各方同意"（SIM-2）；可行性枚举在规模上限内穷举，"无解"是真陈述（ADR-20）；用量来自响应原始字段、成本标注估算（10 §7）；seed 不写中间状态（ADR-19） |

## 4. 术语表

| 术语 | 含义 | 代码名 |
| --- | --- | --- |
| 房间 | 一次协商事务的容器与聚合根 | `rooms` |
| 参与方 / 席位 | 某用户在某房间的唯一角色 | `participants` |
| 简报草稿 / 简报版本 | 可变的草稿；确认后不可变的版本 | `briefDrafts` / `briefVersions` |
| 规则字段 / 软字段 / 备注 | 被规则读取、改动会 bump；只影响 info 检查；只进本方代理 | `FieldSpec.kind` |
| 披露 | 所有者对某字段选择的受众 | `briefVersions.disclosures` |
| 策略性披露 | 07 §3 穷举的、以 acknowledgement 记录的必要披露 | `acknowledgements` |
| 派生闭包 | 派生值仅对能看到其全部输入的人可见 | `Param.requires` |
| 约束集 / 约束版本 | 各角色确认版本指针 + 已承诺快照；其 version 即约束版本 | `constraintSets` / `constraintsVersion` |
| bump | 产生新约束集 | `bumpConstraints` |
| 协商运行（run） | 一组约束下的一次协商尝试 | `runs` |
| 回合（turn） | 一次代理调用尝试 | `agentTurns` |
| 轮（round） | provider 提议 + 评估方并行评估 | `runs.round` |
| 提案 | 不可变条款 | `proposals` |
| 当前提案 | 处于审批中的提案 | `rooms.currentProposalId` |
| 检查 / reasonCode | 规则判定结果与其枚举码 | `Check` |
| 决定 | approve / reject / withdraw | `decisions` |
| 人工请求 | tradeoff / disclosure / choose_package | `humanRequests` |
| 执行 / 变更单 | 原子执行的主记录，渲染为 Change order | `executions` |
| 承诺 / 台账 | 本系统执行产生的金额记录 | `commitments` |
| 外部已承诺 | finance 声明的系统外已承诺金额 | `externalCommittedCents` |
| 存在位 | 通过/失败、可行与否这类一位信息 | — |

## 5. 与原方案（README 与 Role A 分支）的主要差异

1. 单一 `rooms.status` 拆为分层状态机，提案与审批无存储状态（04、ADR-06）。
2. 预算从房间移到 finance 简报规则字段；已承诺 = 外部已承诺 + 系统台账（ADR-02、ADR-04）。
3. 约束版本成为实体，递增点穷举且只有一个入口，执行也递增（ADR-03）。
4. 自由字符串的范围、来源、硬约束改为结构化：请求项词表、报价行、必需项、截止日（03 §9）。
5. 消息拆为服务端信封与模型输出；模型不提供金额、身份、版本（05 part1 §2）。
6. 公开文本全部模板化；clarify 改为向字段所有者的披露请求（ADR-08）。
7. 新增约束集、run、回合、人工请求、执行（变更单）、模型调用等实体（02 part3 §1）。
8. 审批只追加、按集合计数、分 terms/budget 类别；拒绝立即重启协商（ADR-09、ADR-15）。
9. 否决 Role A 的"same shapes"全量读模型、revalidated 复制提案、bestFeasibleOption 充当协商结果、"Matches current constraints"只比版本号（07 §6、ADR-10、05 part2 §2、06 §1）。
10. 可行集只用于预检与用尽处理，不交给代理（ADR-07）。
11. 补齐原数字没有的结局：fixture 两个变体覆盖重谈成功与取舍请求（14）。

## 6. 文档地图

00 概览 · 01 产品 · 02 领域模型（part1–2 不变量，part3 实体与守卫矩阵）· 03 schema（part1–3）· 04 状态机（part1–2）· 05 协议（part1–2）· 06 规则引擎（part1–2）· 07 权限与隐私（part1–2）· 08 审批与执行（part1–2）· 09 约束变更（part1–2）· 10 代理运行时（part1–2）· 11 架构 · 12 API（part1–2）· 13 前端 · 14 首个场景（part1–2）· 15 运维 · 16 测试 · 17 路线 · 18 决策与开放问题（part1–2）。
