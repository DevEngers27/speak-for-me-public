# 02 领域模型（part1）：分区、实体、所有权与版本化

> 分片：part1 领域分区、实体总表、关键概念；part2 引擎与场景的边界、金额口径、不变量清单、与原方案数据模型的映射。

## 2.1 领域分区

```text
身份与成员          委托                      供给                约束                       协商                          决定与执行                 升级        审计
users ──< participants ─< briefDrafts         catalogItems        constraintVersions          runs ─< turns ─< modelCalls   decisions                  humanRequests events
   │           │        └< briefVersions      (版本化, 不可变)     (每次递增一行快照)            │                            executions ─ changeOrders              usageCounters
   └──< invites│                                                  commitments (台账)           └─< proposals (不可变)              ├ commitments                        systemState
           rooms ─────────────────────────────────────────────────────────────────────────────────────────────────────────    └ tasks
```

每个分区回答一个问题：谁在房间里（身份与成员）；每个人授权了什么（委托）；能买到什么（供给）；判断可行性的输入在某个版本下是什么（约束）；代理怎么谈（协商）；人批准了什么、系统写了什么（决定与执行）；什么时候必须问人（升级）；发生过什么、花了多少（审计）。

## 2.2 实体总表

| 实体（表） | 所有者（唯一写入方） | 可变性 | 版本化方式 | 关键关系 | 解决的问题 |
| --- | --- | --- | --- | --- | --- |
| 用户 `users` | 系统（首次登录时） | 仅 displayName 可改 | — | 1:N participants | 外部身份 → 内部主键 |
| 房间 `rooms` | 创建者（元数据）；系统（指针与计数） | 指针与计数可变 | `constraintsVersion`、`proposalSeq`、`runSeq` 计数 | 1:N 其余全部 | 协商工作区与"当前"指针 |
| 参与者 `participants` | 系统（建房、接受邀请） | 不可变（v1） | — | room × role × user | 房间内的角色席位，与 Clerk 用户分离 |
| 邀请 `invites` | 房间创建者 | status 可变 | — | → participant | 角色由邀请授予，不能自选 |
| 简报草稿 `briefDrafts` | 参与者本人 | 可变 | — | 1:1 participant | 自动保存，不生效 |
| 简报版本 `briefVersions` | 参与者本人（确认动作） | **不可变** | 每参与者 1, 2, 3… | → participant；被 constraintVersions 引用 | 私密委托的生效内容 + 逐字段披露决定 |
| 目录条目 `catalogItems` | 目录所有者角色（provider） | **不可变** | 每 itemKey 1, 2, 3… | 被 proposals.terms 与 constraintVersions 引用 | 价格、交付日期的唯一来源（F02.1） |
| 约束快照 `constraintVersions` | 系统（`bumpConstraints`） | **不可变** | 每房间 0, 1, 2… | 指向简报版本、目录版本、台账汇总 | 让"在约束 vN 下"可复现（F09.1） |
| 承诺台账 `commitments` | finance（基线）；系统（执行） | **不可变** | — | → execution | 已承诺额的唯一真相源（F02.3） |
| 协商运行 `runs` | 系统 | 状态可变 | 每房间 seq | 1:N turns、proposals、humanRequests | 一个约束版本下的一次协商 |
| 回合 `turns` | 系统 | 状态可变 | — | 1:N modelCalls | 协议单位 |
| 模型尝试 `modelCalls` | 系统 | 状态可变（终态后只补记用量） | attemptNo | → turn / extractionJob | 重试、超时、迟到拒收、用量账本 |
| 提案 `proposals` | 系统（代理回合）/ 提议方的人（手动） | **不可变** | 每房间 version | → run、turn、catalogItems | 人可以批准的具体版本 |
| 审批决定 `decisions` | 参与者本人 | **只追加** | — | → proposal、participant | 绑定 (proposalId, constraintsVersion, termsKey) 的人类决定 |
| 执行 `executions` | 系统（最后一票的事务） | **不可变** | operationKey 唯一 | 1:1 changeOrder；1:N commitments、tasks | 原子幂等执行的锚点 |
| 变更单 `changeOrders` | 系统 | **不可变** | — | → execution | 冻结的条款与预算影响快照 |
| 任务 `tasks` | 系统创建；被指派角色更新状态 | 仅 status 可变 | — | → changeOrder | 内部工作记录（核心 7） |
| 人工请求 `humanRequests` | 系统创建；目标角色回答 | 状态可变 | — | → run | 向具体的人请求取舍或澄清（F02.7） |
| 事件 `events` | 系统 | **只追加** | commitTs 全序 | refs → 各实体 | 可追溯的时间线 |
| 用量计数 `usageCounters` | 系统 | 计数可变 | — | — | 预算检查与报表聚合 |
| 系统状态 `systemState` | 系统 / 运维 | 可变 | — | — | 熔断 |
| 抽取任务 `extractionJobs` | 参与者本人发起；系统完成 | 状态可变 | — | → modelCalls | 粘贴文本 → 待确认草稿 |

## 2.3 关键概念

- **约束版本（constraintsVersion）**：房间级单调整数。任何改变"规则输入"（`RuleInput`）的写入都让它 +1，并插入一行 `constraintVersions` 快照。规则输入 = 各角色最新确认简报中的规则相关字段 + 目录中有效条目版本 + 台账汇总 + 房间时区。软偏好、私密备注、披露变化不改变规则输入（09 §9.3 列出全部递增点）。
- **规则输入（RuleInput）**：`loadRuleInput(ctx, room, version)` 按快照指针读取的不可变对象；`evaluateProposal`、`enumerateCandidates`、`planHumanRequests` 的唯一输入（另加"今天"）。
- **候选（Candidate）**：`enumerateCandidates(RuleInput)` 产出的一个可行组合 `{ candidateKey, rank, terms }`，terms 的金额、日期、来源全部由代码从目录计算。候选键是可读的规范串，如 `LOGIN+REPORTS@standard`。
- **提案（Proposal）**：被某个作者（代理、人、规则、种子）选中的候选的不可变副本，带房间内版本号与 `termsKey`（terms 的规范串）。提案在被创建时一定可执行；之后是否可执行随约束版本与日期变化，实时派生。
- **当前提案**：`rooms.currentProposalId`。约束变化不改变当前提案，只改变对它的评估结果。
- **活跃 run**：`rooms.currentRunId` 指向且状态 ∈ running / awaiting_approval / waiting_human / failed 的 run；每房间至多一个。
- **审批绑定**：一条 approve 决定只对 (proposalId, 决定时的 constraintsVersion, termsKey) 有效。约束版本变化后旧决定派生为 stale，记录保留。
- **披露决定**：简报版本中逐字段的 `audience`（private / roles / room）。对他方可见的简报内容只来自这里；投影函数 `projectBriefFor(viewerRole, briefVersion)` 同时服务界面查询与代理上下文，是唯一的披露判断点（07）。
- **委托条款（delegation terms）**：确认简报时展示并记录版本的固定说明——代理代表你在候选间表达偏好（以固定理由码对他方可见），永远不批准任何东西，不透露你的数值与备注；代码会按你的硬约束过滤方案，他方只会知道哪些方案可行、不会知道你的数值。
- **执行**：所有必需审批到齐的那一次 mutation 中，原子写入 execution、变更单、执行承诺、任务，并递增约束版本（台账变了）。
