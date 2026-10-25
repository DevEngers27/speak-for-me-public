# 02 领域模型（part1：实体、关系、所有权、版本化对象）

> 本章分 2 个文件：part1（本文件）实体与关系；part2 派生量、金额口径与不变量清单。
> 推导顺序：先按 07 的受众把数据切开（谁能看），再按核心 3/6 决定哪些对象不可变（谁能改），最后才定字段（03）。

## 2.1 设计原则

1. **一个实体一个受众**：一条记录要么全房间可见，要么只属于一个参与方，要么只属于系统（07 §7.11）。需要跨受众展示时走五条受控投影之一。
2. **影响他人判断的对象不可变**：简报版本、目录版本、约束快照、提案、决定、变更单、承诺、事件只插入。可变的只有工作流指针（`rooms.currentRunId` 等）、草稿、run/回合/人工请求的状态。
3. **能派生的不存**：提案是否可执行、是否被取代、某人的决定是否过期、已承诺总额，全部读时计算。所有输入都不可变，所以任何历史时刻的结论都能重算（可追溯性来自"不可变 + 确定性"，不来自快照堆积）。唯一的例外是执行：变更单与承诺冻结执行当时的条款与预算快照，防止规则代码升级改变历史解释。
4. **引擎不认识业务字段**：引擎只认 roleKey、fieldKey、reasonCode、Capability；简报、目录、条款的具体形状由场景插件提供（06 §6.6）。

## 2.2 实体目录

| 实体（表） | 含义 | 所有者 | 写入者 | 受众 | 可变性 |
| --- | --- | --- | --- | --- | --- |
| User（`users`） | 一个 Clerk 身份在本系统的映射，主键语义是 `tokenIdentifier` | 本人 | `users.ensureMe` | 系统（本人可读自己） | 显示名可改 |
| Room（`rooms`） | 一次需要多方同意的事务的容器；绑定场景、时区、生命周期、版本计数器与当前指针 | 房主（创建者） | 引擎 mutation | 房间 | 指针与计数器可变 |
| Seat（`participants`） | 房间中的一个角色席位，绑定至多一个用户 | 房间 | `rooms.create`、`invites.accept` | 房间 | 一次性绑定 |
| Invite（`roomInvites`） | 绑定席位的一次性令牌（只存哈希） | 房主 | 邀请函数 | 房主 | 状态可变 |
| BriefDraft（`briefDrafts`） | 参与方正在编辑的私密简报草稿；可自动保存；可由抽取预填 | 参与方 | 本人 | 本人 | 可变 |
| BriefVersion（`briefVersions`） | 参与方确认的私密简报版本：硬约束、软偏好、自由备注、披露决定 | 参与方 | `briefs.confirm`、`budget.update`、`requests.answer` | 本人（经 X1 投影部分字段给他方） | 不可变 |
| CatalogVersion（`catalogVersions`） | 有发布能力的角色（首场景为 provider）发布的公开报价集 | provider | `catalog.publish` | 房间 | 不可变 |
| ConstraintSnapshot（`constraintSnapshots`） | 约束版本 cv 到"当时生效的简报版本与目录版本"的映射 | 系统 | `activateRoom`、`bumpConstraints` | 系统 | 不可变 |
| Run（`runs`） | 在固定约束版本下的一次协商尝试；含轮次与预算 | 房间 | 运行时 mutation | 房间 | 状态可变 |
| AgentTurn（`agentTurns`） | 一次代理调用的一次尝试（attempt）；工作流与运维字段 | 系统 | 运行时 mutation | 系统（X3 投影进度） | 状态可变 |
| AgentNote（`agentNotes`） | 代理写给本方委托人的 rationale 与所选候选 | 参与方 | `completeTurn` | 本人 | 不可变 |
| ModelCall（`modelCalls`） | 一次 HTTP 级模型请求的用量与结果码 | 系统 | 运行时 | 运维 | 不可变 |
| Proposal（`proposals`） | 一组不可变条款：条目、延后项、交付方式与日期、价格明细，绑定目录版本与必需审批角色快照 | 房间 | `insertProposal`（唯一构造器） | 房间 | 不可变 |
| Evaluation（不入库） | `evaluate(proposal, constraintInput(cv), today)` 的结果：检查项与 reasonCode | — | 纯函数 | 经 X5 按查看者粗化 | 派生 |
| Decision（`decisions`） | 人对 (提案, 约束版本) 的批准、拒绝或撤回 | 参与方 | `decisions.decide` | 房间 | 只追加 |
| HumanRequest（`humanRequests`） | 代码生成、发给具体某人的取舍或披露请求，含可执行选项 | 目标参与方 | 运行时、`requests.answer` | 目标人（X4 投影存在性） | 状态可变 |
| ChangeOrder（`changeOrders`） | 执行记录本身：冻结的条款、所用决定、规则版本、`operationKey` | 房间 | `decisions.decide`（最后一票） | 房间 | 不可变 |
| Commitment（`commitments`） | 预算台账条目，含执行时的预算快照 | finance | 同上 | finance（X2 投影给 customer） | 不可变 |
| Task（`tasks`） | 由变更单按场景模板确定性派生的工作项 | 房间 | 同上；状态由被指派人更新 | 房间 | 只有 status 可变 |
| Event（`events`） | 公开时间线；载荷只含公开值，读时渲染 | 房间 | 各写入 mutation 同事务追加 | 房间 | 只追加 |
| Counter（`counters`） | 限流与运维计数 | 系统 | 各入口 | 系统 | 可变 |

## 2.3 关系

```text
User 1 ──< Seat >── 1 Room ──< Invite
                   │
   Seat 1 ──1 BriefDraft
   Seat 1 ──< BriefVersion            (version 1,2,3… 不可变)
   provider Seat 1 ──< CatalogVersion (version 1,2,… 不可变)
   Room 1 ──< ConstraintSnapshot(cv)  ── 引用 ──> {每角色 1 个 BriefVersion, 1 个 CatalogVersion}
   Room 1 ──< Run(seq)  ── run.constraintsVersion = cv（固定）
        Run 1 ──< AgentTurn(round, turnSeq, attempt) ──1 ModelCall*
        AgentTurn 1 ──0..1 AgentNote ──> Seat
        Run 1 ──< Proposal(version, 全房间递增)
   Proposal ──> CatalogVersion（定价来源）
   Proposal 1 ──< Decision(cv, seat, kind)
   Proposal × cv 1 ──0..1 ChangeOrder ──1 Commitment
                                      └──< Task
   Run 1 ──< HumanRequest ──> 目标 Seat
   Room 1 ──< Event
```

指针：`rooms.currentRunId` 指向唯一的非终态 run（或最近一次终态 run，见 04）；`rooms.currentProposalId` 指向当前待审或最近执行的提案；`rooms.constraintsVersion` 是当前 cv；`rooms.proposalSeq` 是已分配的最大提案版本号。

## 2.4 版本化对象与"约束版本"的精确定义

| 对象 | 版本号 | 递增时机 | 是否影响审批 |
| --- | --- | --- | --- |
| BriefVersion.version | 每参与方独立 | 本人每次确认（含只改备注或披露） | 只有其中**硬约束部分**变化时才影响（经 cv） |
| CatalogVersion.version | 每房间独立 | provider 每次发布 | 是（经 cv） |
| Room.constraintsVersion（cv） | 每房间 | 激活时置 1；之后任何**硬约束**变化 +1，每次执行也 +1（已承诺额是规则输入）；09 列出全部入口 | 是：决定绑定 cv |
| Proposal.version | 每房间，永不重置 | 每插入一个提案 +1 | 决定绑定 proposalId |
| Run.seq | 每房间 | 每次创建 run | 否 |

"硬约束"由场景字段声明 `class: "hard"` 界定。软偏好与备注、披露设置的变化只产生新的简报版本，不递增 cv，不使任何审批失效，但会影响之后回合的代理上下文（09 §9.2）。cv 的语义因此是"规则求值的全部输入的版本"：给定 (proposal, cv, today)，求值结果唯一确定。

`today` 也是规则输入（`DELIVERY_IN_PAST`）。它不进入 cv：日期跨越导致的结论变化通过执行时重算处理，不通过版本失效处理（06 §6.3）。

## 2.5 引擎与场景的分工

| 归属 | 内容 |
| --- | --- |
| 引擎 | 用户、席位、邀请、简报的生命周期与披露机制、约束版本与快照、run/回合/人工请求的状态机、提案的存储与版本分配、决定、执行事务骨架、事件与渲染框架、权限能力表框架、日志与限流 |
| 场景插件 | 角色声明与能力、字段声明（硬/软/备注、可披露受众、派生字段）、简报/目录/条款的校验器、`deriveTerms`、`evaluate` 与 reasonCode 声明、候选枚举、放宽选项生成（人工请求）、必需审批角色策略、承诺金额、任务派生模板、事件与文案模板、fixture |

引擎通过 `ScenarioPlugin` 接口调用场景（06 §6.6）；场景代码是纯函数，不访问数据库，不调用模型。
