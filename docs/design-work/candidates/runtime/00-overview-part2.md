# 00 概览（part2）：术语表、与原方案的主要差异、读法

> 分片清单见 part1。全篇一个概念一个名字；标识符为英文。

## 0.5 术语表

| 术语 | 标识符 | 含义 |
| --- | --- | --- |
| 房间 | `rooms` | 一次多方协商的工作区；只有 open / closed 两种生命周期状态 |
| 参与者（席位） | `participants`、`roleKey` | 某个用户在某个房间里的角色；只经邀请授予；每角色一人、一人一角色 |
| 场景插件 | `ScenarioPlugin` | 声明角色、字段、目录、规则、候选枚举、模板、提示、执行派生的模块；首个为 `scope_change` |
| 简报草稿 / 简报版本 | `briefDrafts` / `briefVersions` | 草稿可变且不生效；确认后的版本不可变 |
| 披露决定、受众 | `disclosures`、`Audience` | 简报中逐字段的可见范围：private / roles / room |
| 委托条款 | `delegationTermsVersion` | 确认简报时接受的说明：代理如何代表你、会对他方暴露什么 |
| 目录条目 | `catalogItems` | provider 确认的报价条目或条款（加急费）；版本化；确认即对房间公开 |
| 规则相关键 | `ruleKey` | 简报中规则相关字段的规范串；变化才递增约束版本 |
| 约束版本 / 约束快照 | `constraintsVersion` / `constraintVersions` | 房间级单调计数器 / 每个版本的输入指针（简报版本、目录版本、台账汇总） |
| 规则输入 | `RuleInput` | 由快照指针组装的不可变对象，所有规则函数的唯一输入 |
| 承诺台账 | `commitments` | 基线 + 每次执行的承诺；已承诺额 = 汇总 |
| 候选 / 候选键 | `Candidate` / `candidateKey` | 代码枚举出的可行方案及其可读键，如 `LOGIN+REPORTS@standard` |
| 协商运行 | `runs` | 在一个约束版本下的一次协商；7 种状态；活跃 = running / awaiting_approval / waiting_human / failed |
| 回合 | `turns` | 某角色在某一轮的一次 propose 或 review |
| 模型尝试 | `modelCalls`（attempt） | 为某回合发起的一次模型请求或 stub 计算；同时是用量账本 |
| 租约 | `turns.currentAttemptId` | 只有当前 attempt 的结果能生效 |
| watchdog | `attemptWatchdog` | 与 attempt 同事务登记的超时判定 mutation |
| stale | `status: "stale"` / `stale_approve` | 已作废的模型结果 / 约束版本变化后失效的审批决定 |
| 提案 | `proposals` | 某个候选被选中后的不可变版本；房间内单调版本号 |
| 当前提案 | `rooms.currentProposalId` | 当前可被审批的提案；约束变化不改变它，只改变对它的评估 |
| 条款键 | `termsKey` | 提案条款的规范串；审批绑定与视图校验用 |
| 可执行 | `executable` | `evaluateProposal` 的实时结果，从不存储 |
| 审批决定 | `decisions`（approve / reject / withdraw） | 只追加；绑定 (proposalId, constraintsVersion, termsKey) |
| 必需审批 | `requiredApprovals`、`approvalKind`（terms / budget） | 提案创建时快照的（角色，审批类型）集合 |
| 执行 / 执行键 | `executions` / `operationKey` | 全部必需审批到齐那一次事务的锚点；`exec:{proposalId}:{constraintsVersion}` |
| 变更单 | `changeOrders` | 冻结条款与预算影响快照的内部记录（不是合同） |
| 人工请求 | `humanRequests` | 由代码发起、发给具体角色的人的取舍或澄清请求 |
| 升级 | `run.outcome` ∈ no_feasible / clarify / agent_declined / blocked | 代码决定的"必须问人"的四种原因 |
| 手动提案 | `proposals.proposeManually` | 提议方的人直接选择候选；代理不可用时的主路径 |
| stub 模式 / 故障计划 | `AGENT_MODE=stub` / `testFaultPlan` | 确定性的代理替身 / 非生产环境的故障注入 |
| 熔断 / 总开关 | `systemState("agents").circuit` / `AGENTS_ENABLED` | 密钥失效或额度耗尽时停止所有模型调用 / 运维一键停用 |
| 协议版本 | `PROTOCOL_VERSION` | 模型输出形状的版本；不一致的迟到结果作废 |

## 0.6 与原方案（README 与 Role A 分支）的主要差异

| # | 原方案 | 本设计 | 记录 |
| --- | --- | --- | --- |
| 1 | 模型提交 scope、金额、来源引用 | 代码枚举可行候选，模型只选候选键；金额与日期来自已确认目录 | ADR-05 |
| 2 | 预算放在全员可见的 rooms 上；committedCents 计数器 | 上限是 finance 简报的硬约束字段，默认只对 customer 披露，provider 永不可见；已承诺额来自台账 | ADR-11、ADR-12 |
| 3 | 单一 room.status 承载全部流程 | 房间 / run / turn / attempt / 请求分别存储状态；提案与审批状态派生 | 04 |
| 4 | runId 只是字符串，无重试与超时机制 | run / turn / attempt 三层 + watchdog + 两阶段写回 + 单层重试 + 四级预算 + 熔断 | ADR-01…ADR-04、ADR-18 |
| 5 | 审批只存两个版本号；可改的 approvalRequired | 只追加的决定，绑定提案 id + 约束版本 + 条款键；必需审批快照；区分条款与预算承诺 | ADR-13、ADR-14 |
| 6 | constraintsVersion 何时递增未定义（Role A 只在改上限时递增） | 单一入口 `bumpConstraints` + ruleKey 自动判定 + 每版本快照；软约束不递增 | ADR-23、09 |
| 7 | 约束变化后复制 revalidated 提案（Role A） | 同一提案在新版本下重新评估；可执行则零回合 run 重新审批 | ADR-06、ADR-07 |
| 8 | publicSummary 是模型自由文本 | 对他方可见文本只由模板生成；模型理由只给本方 | 05 §5.4、07 §7.7 |
| 9 | clarify 对象不明；升级无结构 | clarify 只交给人；升级由代码触发，结构化请求并行发给能解除阻断的人 | ADR-09、ADR-15 |
| 10 | events 二元可见性、写入时渲染、客户端过滤 | 受众判别联合、payload 受众安全、服务端读时渲染、commitTs 全序 | ADR-19 |
| 11 | 变更单没有表；任务挂在承诺上 | executions + 变更单 + 承诺台账 + 任务，同一事务确定性派生，审批前可预览 | 08 |
| 12 | 拒绝是死路（Role A） | 带理由码的拒绝触发新 run（排除被拒候选）或人工请求；循环有上限 | 08 §8.9 |
| 13 | "same shapes" 把全量状态发到浏览器（Role A） | 按查看者投影的读模型，一个聚合查询 | 07、12 §12.4 |
| 14 | 模型客户端 `maxRetries: 1, timeout: 30 s`，单一 `ANTHROPIC_MODEL` | `maxRetries: 0`、60 s（实测后调）、模型白名单、按调用点设 effort、`messages.create` + 自行校验、手写 JSON Schema 保留枚举 | ADR-03、ADR-17、10 part5 |
| 15 | 修订已确认协议要新建房间（Role A） | 同一房间开新 run | ADR-25 |
| 16 | 演示 fixture：items 1、2 都必需 | REPORTS 改为软偏好以产生真实取舍；原设定保留为变体 D | ADR-24 |

## 0.7 读法

先读 01（产品）与 10 part1–part2（运行时生命周期与失败模式），再读 04（状态机）、03（schema）、05（协议）。02 汇总实体与不变量，06–09 分别给出规则、隐私、审批执行、约束变更，14 用首个场景把以上全部走一遍，12 是函数目录，11、13、15–17 较短，18 是全部取舍与待决问题。
