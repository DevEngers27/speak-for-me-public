# 02 领域模型（极简完整版）

> 视角：每个实体都要回答"不要它行不行"。最终引擎只有 **10 张表**，其余候选概念要么派生、要么并入别的实体。名字全篇统一，03/04/05/07/12 使用同一套名字。

## 1. 决定摘要

| 目标 | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| 用最少概念覆盖核心 1–8 | 10 张表：`rooms` `seats` `briefs` `runs` `agentTurns` `proposals` `approvals` `humanRequests` `changeOrders` `tasks` | 每张表都有一个"别处承担不了"的职责（见 §3） | 审查汇总的 17 张表（多出 users、roomInvites、budgets、budgetChanges、offerItems、commitments、events） |
| 约束只有一个来源 | **所有硬约束都是某个角色的已确认简报版本**（customer 的范围/截止日、provider 的报价目录、finance 的预算与已有承诺） | 约束变更 = 追加一个简报版本，天然只追加、带作者与原因；`constraintsVersion` 只有一个写入口 | 预算单独成表 + budgetChanges；目录单独成表 + unconfirmed 状态 |
| 提案彻底不可变 | `proposals` **没有 status 字段**；"当前/被取代/已执行"全部派生 | 只追加的最强形式：一行写入后永不 patch | `status: active/superseded/executed`（需要回写，容易与事实不一致） |
| 时间线不另存 | **不设 events 表**；时间线由各只追加表按引用拼出（派生视图） | 事件表是第二份真相，且是公共文本泄露的主要载体；所有事实已在源表里 | events 表 + visibility 字段 |
| 审批只追加 | `approvals` 每次决定追加一行，当前决定 = 该席位对该提案的最新一行 | 历史完整（拒绝→再批准三条都在），不需要唯一性守卫 | upsert 最新决定（丢历史，违反核心 6） |

## 2. 实体与关系

```text
rooms 1──* seats            (每个场景角色恰好一个席位；席位兼任邀请)
rooms 1──* briefs           (按 role 追加版本；最新已确认版本 = 当前约束)
rooms 1──* runs ──* agentTurns
                └─* proposals ──* approvals
                └─* humanRequests
proposals 1──0..1 changeOrders 1──* tasks
```

| 实体 | 是什么 | 所有者（谁能写） | 可变性 |
| --- | --- | --- | --- |
| Room `rooms` | 一次多方协商的容器：场景、标题、共同目标、约束版本计数、当前 run 指针 | 系统（创建者经 `rooms.create`） | 只有计数器与指针可变 |
| Seat `seats` | 房间里的一个角色席位；未认领时持有邀请令牌哈希，认领后绑定一个 Clerk 用户 | 系统（创建时）；认领者（一次性认领） | 认领一次后不可变 |
| Brief version `briefs` | 某角色的一份**已确认**私密简报（结构化约束 + 私密备注 + 披露选择） | 该席位用户 | **不可变**，修改 = 追加新版本 |
| Run `runs` | 一次协商运行：从某个约束版本开始，到执行/被取代/等待人为止 | 系统（状态机） | status/round/指针可变 |
| Agent turn `agentTurns` | 一个角色代理的一次模型调用尝试（含私有 rationale、用量） | 系统 | 从 running 到终态写一次 |
| Proposal `proposals` | 一份不可变的条款：itemKeys、按目录算出的金额与日期、来源版本、校验快照 | 系统（由代理选择 + 代码计算） | **不可变** |
| Approval `approvals` | 一个人对一个提案的一次决定（approve/reject） | 席位用户 | **不可变**（只追加） |
| Human request `humanRequests` | 代码生成、指向具体角色的取舍/澄清问题与选项 | 系统生成；目标角色回答一次 | 只有 `answer` 写一次 |
| Change order `changeOrders` | 执行产物：被批准条款快照 + 内嵌预算承诺快照 | 系统（最后一票的同一事务） | **不可变** |
| Task `tasks` | 由变更单确定性派生的工作项 | 系统创建；指派角色可标记完成 | 仅 `doneAt/doneBy` 可变 |

## 3. 被删掉的候选概念：为什么不需要、职责由谁承担

| 候选 | 删除理由 | 职责转移到 |
| --- | --- | --- |
| `users` | 唯一需要的用户属性是显示名，且按房间快照即可 | `seats.userId`（= `identity.tokenIdentifier`）、`seats.displayName` |
| `roomInvites` | 首个场景每角色一人，邀请与席位一一对应 | 未认领的 `seats` 行持有 `inviteHash` / `inviteExpiresAt`；`(roomId, role)` 唯一性在创建时一次性保证 |
| `budgets` + `budgetChanges` | 预算是 finance 的硬约束，历史就是 finance 简报的版本链 | `briefs`（role = finance，content 含 `totalBudgetCents`、`priorCommittedCents`，版本带 `reason`） |
| `offerItems` / 目录 + `unconfirmed` 状态 | 目录是 provider 的硬约束；只存在于已确认简报里的条目天然"已确认" | `briefs`（role = provider，content.items）；要新选项 = provider 确认新版本 |
| `commitments` 台账 | 房间内的承诺只有两类：执行前已有的（基线）和本房间变更单产生的 | 基线 = finance 简报的 `priorCommittedCents`（seed 时标 simulated）；变更单承诺 = `changeOrders.commitment` 内嵌快照。`committedCents = priorCommittedCents + Σ changeOrders.commitment.amountCents` |
| `events` | 与源表重复；所有事实都在只追加的源表中且彼此引用 | 派生时间线 `rooms.timeline`（07 §8 的按角色渲染） |
| `proposals.status` / `approvals.status` / `humanRequests.status` | 都能由版本号和指针实时推出 | 派生函数 `proposalStatus`、`approvalValidity`、`requestIsOpen`（06 §6） |
| `rooms.status` | v1 没有"关闭房间"的业务需要；阶段可派生 | 派生 `roomPhase`（04 §1） |
| `operationId` 字符串 | 一个提案至多执行一次，`proposalId` 本身就是幂等键 | `changeOrders.by_proposal` 索引 + 唯一写入口 |
| `approvals.kind (terms/budget)` | 由角色决定，不是独立数据 | 场景声明 `approverRoles` 与每个角色的审批文案（08 §2） |
| 代理 `counter` 动作 | 与 propose 形状完全相同 | `propose`；本 run 已有提案时派生标为"还价"（05 §3） |
| 草稿简报存库 | 草稿是表单状态；存库会多一个私密数据面 | 浏览器表单 + 预填最新已确认版本；不保存粘贴原文 |

## 4. 版本化对象

| 计数/版本 | 存在哪 | 何时递增 | 唯一写入口 |
| --- | --- | --- | --- |
| `rooms.constraintsVersion` | rooms | 任何简报版本被确认（含人工请求答案改简报） | helper `applyBriefVersion()`（被 `briefs.confirm`、`requests.answer` 调用） |
| `briefs.version` | briefs（按 role） | 该角色确认新版本 | 同上 |
| `rooms.proposalSeq` / `proposals.version` | rooms / proposals | 代理产出一个提案 | `agents.completeTurn` |
| `rooms.runSeq` / `runs.seq` | rooms / runs | 新 run 开始 | helper `startRun()` |
| `agentTurns.attempt` | agentTurns | 同一回合重试 | `completeTurn/failTurn/runs.retryTurn` |

**提案版本不因约束变化而递增**（F04.7）：约束变化只让旧提案不可执行；新提案只来自代理的新回合，作者如实为 provider 代理。

## 5. 不变量清单（每条写明落点）

| # | 不变量 | 落点 |
| --- | --- | --- |
| I1 | `briefs`、`proposals`、`approvals`、`changeOrders` 写入后不被 patch/delete | 代码中这四张表只有 `insert`；16 号测试用 grep 守卫 |
| I2 | 每房间每角色恰好一个席位；一个用户在一个房间至多一个席位 | `rooms.create` 一次插入全部席位；`seats.claim` 按 `by_room_user` 先查后写 |
| I3 | `constraintsVersion` 只经 `applyBriefVersion` 改变，每次 +1 | 唯一 helper；其他代码不写该字段 |
| I4 | 每房间至多一个"活动"run：`rooms.currentRunId` 指向的 run 处于非终态，其他 run 全部终态 | `startRun` 先把旧 run 置 superseded 再插新 run（同一事务） |
| I5 | 提案金额 = 目录价格之和；交付日 = 所选条目最早可交付日的最大值；模型不提供任何金额或日期 | `computeTerms()`（06），在 completeTurn 与审批事务中各算一次 |
| I6 | 审批只对"当前 run 的当前提案、且提案约束版本 = 房间约束版本、且实时校验通过"才可写 approve | `approvals.decide` 守卫 |
| I7 | 完成判定按集合：`proposal.requiredApproverRoles` 中每个角色的最新决定都是 approve | `isFullyApproved()`；席位保证不同角色是不同 userId（I2） |
| I8 | 每个提案至多一张变更单；变更单、承诺快照、任务在同一事务写入 | `approvals.decide` 内按 `by_proposal` 先查后写 |
| I9 | `priorCommittedCents + Σ commitment + 新金额 ≤ totalBudgetCents` 在执行事务内用当前存储值重算 | `validateProposal()` 在 `approvals.decide` 中调用 |
| I10 | 迟到/过期的代理结果不改变任何业务状态 | `completeTurn` 守卫：`room.currentRunId === run._id && run.activeTurnId === turn._id && turn.status === 'running'` |
| I11 | 对他方可见的文本只由模板从结构化字段 + reasonCode 渲染 | `renderPublic()`；模型自由文本只存 `agentTurns.output.rationale` |
| I12 | 私密字段只出现在本人可调用的 query 返回值或本人代理的上下文中 | 投影函数 `projectFor(viewerRole)` 与 `buildAgentContext(role)`（07） |
| I13 | 金额是 `0 ≤ n ≤ 100_000_000` 的安全整数美分 | `assertCents()` 在所有金额入口 |
| I14 | 可执行性、提案状态、审批有效性、请求是否打开永远读取时派生，不入库 | 派生函数（06 §6）；schema 中不存在这些字段 |
| I15 | 模拟数据（seed、stub 代理产物）带 `simulated: true` 并在界面标注 | `briefs/proposals/agentTurns/changeOrders.simulated` |

## 6. 派生量（不存储）

| 派生量 | 定义 |
| --- | --- |
| `currentBrief(role)` | `briefs` 按 `by_room_role_version` 取该角色最大版本 |
| `committedCents` | `finance.priorCommittedCents + Σ changeOrders(room).commitment.amountCents` |
| `proposalStatus(p)` | 有变更单 → `executed`；`p._id === run.currentProposalId && run === room.currentRun` → `current`；否则 `superseded` |
| `executable(p)` | `proposalStatus = current && run.status = pending_approval && p.constraintsVersion = room.constraintsVersion && validateProposal(...) = []` |
| `approvalValidity(a)` | `a.constraintsVersion = room.constraintsVersion && proposalStatus(a.proposal) ∈ {current, executed}` → `valid`，否则 `invalidated` |
| `requestIsOpen(r)` | `!r.answer && r.runId = room.currentRunId && run.status = needs_input && r.constraintsVersion = room.constraintsVersion` |
| `roomPhase` | 见 04 §1 |

## 7. 开放问题

- 一个房间共享项目级预算（多房间）时，内嵌承诺快照不够，需要房间之上的 `budgetAccounts` + `commitments`（17 号路线，ADR-04）。
- 一个角色多名用户（两名 finance）：v1 不支持；扩展为"席位 1..n 用户 + 审批策略"（18 号 Q）。
