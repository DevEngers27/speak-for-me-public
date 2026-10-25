# 02 领域模型（part2）：引擎与场景边界、金额口径、不变量、与原方案映射

> 分片清单见 part1。

## 2.4 引擎与场景的边界

引擎提供"容器与流程"，场景提供"类型与规则"。判断标准：换成第二个场景（例如活动预算，17）时是否需要改动——需要改的归场景。

| 关注点 | 引擎（`convex/engine/`、`convex/lib/`、引擎表） | 场景插件（`convex/scenarios/<key>/`、场景表） |
| --- | --- | --- |
| 角色 | 只认 `roleKey: string`；按场景声明校验 | 声明角色、标签、所属方（buyer / seller）、是否必需审批及审批类型、谁拥有目录、谁是提议方 |
| 简报 | 草稿 / 版本容器、确认流程、披露投影、ruleKey 比较 | 每角色字段 schema、字段默认披露与可选受众、`briefRuleKey` |
| 目录 | 版本化容器、确认 / 撤回流程 | 条目属性 schema（item / term） |
| 约束 | `bumpConstraints`、快照、`loadRuleInput` | `scenarioState`（如 committedCents）、就绪条件 |
| 协商 | run / turn / attempt 状态机、协议动作集、apply、轮次、重试、预算 | 候选枚举与排序、问题目录、理由码词表、提示包（规则与角色章程）、stub 策略 |
| 校验 | 引擎检查（当前性、来源存在且有效、条款与来源一致） | 场景检查（预算、必需范围、日期） |
| 审批与执行 | 决定追加、集合判定、operationKey、执行事务骨架 | 执行派生（变更单、承诺、任务）与场景表写入 |
| 升级 | humanRequest 容器、状态机、断言 | `planHumanRequests` 规划器、选项效果 |
| 文本 | 事件目录骨架、受众断言、渲染器 | 场景事件类型、检查与请求的文案模板、按受众的参数声明 |

插件接口（TypeScript 类型）见 06 §6.8；schema 由引擎表 + 场景导出的表与 validator 组合而成（03）。

## 2.5 金额口径（GAP-03、F14.3）

| 名称 | 定义 | 首个场景示例 | 谁可见 |
| --- | --- | --- | --- |
| 变更金额 `changeAmountCents` | `proposal.terms.amountCents`，目录价格之和（含加急费） | +$900 | 全体（来自已披露的目录） |
| 执行前已承诺 `committedBeforeCents` | 约束快照中的 `scenarioState.committedCents`（基线 + 已执行承诺之和） | $4,000 | finance 预算字段披露受众（默认 finance + customer） |
| 执行后已承诺 `committedAfterCents` | before + change | $4,900 | 同上 |
| 上限 `capCents` | finance 最新确认简报的 `budgetCapCents` | $5,000 → $4,800 | 同上 |
| 余量 `headroomCents` | cap − before（可为负） | $1,000 → $800 | 同上 |
| 超出 `overByCents` | max(0, after − cap) | $0 → $100 | 同上 |

provider 永远只看到变更金额和"在 / 超出 finance 限额"的结论；界面与事件都不得出现 $4,900 这样的合计，因为 provider 已知 $900，能反推已承诺额（F07.1 文案陷阱）。

## 2.6 不变量清单

| # | 不变量 | 保证方式（落点见 03 §3.15、04、08、09、10） |
| --- | --- | --- |
| I1 | 提案、决定、简报版本、目录版本、约束快照、执行、变更单、承诺、事件只追加、不修改 | 写入只经各自的插入 helper；静态扫描 IM-* |
| I2 | 提案版本在房间内单调且唯一，永不因新 run 重置 | `insertProposal` 读写 `rooms.proposalSeq` |
| I3 | `rooms.constraintsVersion` 只经 `bumpConstraints` 改变，且每个版本都有快照行 | 单一函数 + 代码审查 |
| I4 | approve 只对 (proposalId, 当时的 constraintsVersion, termsKey) 有效；参与者的当前决定 = 其最新一行 | `decisions` 字段 + G-D5 + 派生规则 04 §4.7 |
| I5 | 每个提案至多执行一次；执行时 `committedBefore + change ≤ cap` 在同一事务内按重新汇总的台账成立 | operationKey + G-E2 / G-E3 |
| I6 | 每房间至多一个活跃 run | `startRunTx` 唯一入口 |
| I7 | 必需审批集合在提案创建时快照；由互不相同的 userId 满足 | `requiredApprovals` + G-E1 |
| I8 | 对他方可见的文本只由模板从结构化字段生成；模型自由文本只给本方 | 渲染器 + `turns.privateRationale` 投影 |
| I9 | 金额是 0…100,000,000 的安全整数美分 | `assertCents` |
| I10 | 可执行性实时计算，从不存储 | 提案无 status；`evaluateProposal` |
| I11 | 模型结果只在 G-A 守卫全部通过时生效 | `applyAttemptResult` |
| I12 | 每次模型请求恰好一行 `modelCalls`，用量无论成败与过期都记录 | SDK `maxRetries: 0`；record 先于 apply |
| I13 | run 的约束版本创建后不变；活跃 run 的约束版本等于房间当前版本 | `bumpConstraints` 同事务 supersede |
| I14 | 每个提案的 terms 是其所属 run 候选集合中某个候选 terms 的精确副本（种子提案除外，且标 simulated） | `insertProposal` 只接受 candidateKey |
| I15 | 角色 X 的代理上下文只含：X 的简报、他方对 X 披露的字段、公开目录、候选、公开回合结果、已回答请求中的公开答案 | `assembleAgentContext` 唯一入口（07 §7.5） |
| I16 | 每 (房间, 角色) 一个参与者；每用户在一个房间至多一个角色 | `rooms.create`、`invites.accept` |
| I17 | 每次执行之后，台账汇总 ≤ 执行时的上限（上限之后可以被下调到汇总以下，此时不再有提案可执行） | G-E2 |
| I18 | open 的人工请求一定属于活跃 run 且绑定当前约束版本 | `bumpConstraints` 与 `supersedeRunTx` 取消请求 |
| I19 | 每个非终态 attempt 都有一个同事务登记的 watchdog | `scheduleAttempt` |
| I20 | 多角色可读的文档中不存放只对部分角色可见的数值 | 03 §3.1 第 7 条 + 隐私金丝雀 PV-* |

## 2.7 与原方案数据模型的映射

| 原集合（README / schema.ts） | 新设计 | 主要变化 |
| --- | --- | --- |
| rooms | `rooms` | 移走预算与已承诺（→ finance 简报 + `commitments`）；单一 status 拆成房间 / run / 提案（派生）；加当前指针、场景、时区、agentMode |
| members | `participants` + `invites` + `users` | 角色由邀请授予；去掉 `approvalRequired`（场景声明 + 提案快照） |
| privateBriefs | `briefDrafts` + `briefVersions` | 草稿 / 确认分离；结构化字段由场景定义；逐字段披露替代 `shareableFacts`；确认版本不可变 |
| proposals | `proposals` | 不可变；terms 来自候选；加 `termsKey`、作者类型、必需审批快照；`sourceRefs` 改为 `catalogItemIds`（代码推出）；`publicSummary` 改为读时模板渲染 |
| approvals | `decisions` | 只追加；绑定 proposalId + constraintsVersion + termsKey；支持 reject / withdraw 与理由；区分 terms / budget 审批 |
| commitments | `commitments`（台账）+ `executions` + `changeOrders` | 基线作为一条台账；operationKey 挂在 executions；新增变更单表（GAP-02） |
| tasks | `tasks` | 挂在变更单下；由已批准条目确定性派生 |
| events | `events` | 类型枚举、结构化 payload、受众判别联合、commitTs 全序、读时渲染 |
| （无） | `catalogItems`、`constraintVersions`、`runs`、`turns`、`modelCalls`、`humanRequests`、`usageCounters`、`systemState`、`extractionJobs` | 补上原方案缺失的来源、约束历史、运行时、升级与用量实体（DM-10…DM-15、GAP-07、GAP-11） |
