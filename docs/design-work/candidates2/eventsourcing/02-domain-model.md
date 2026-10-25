# 02 领域模型（事件溯源候选）

## 1. 核心建模决定

| # | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| DM-1 | **房间（room）是唯一的聚合与事件流**：一个房间一条按 `seq` 无间隙递增的事件流；所有业务写入都是"命令 → 事件 → 同事务投影" | 一个房间就是一个一致性边界（预算、约束版本、当前提案、审批集合必须一起判断）；Convex 单 mutation 原子 + OCC 正好给出"每流串行" | 每实体一条流（proposal 流、budget 流）：跨流不变量（审批 × 约束版本 × 预算）需要 saga，过度设计 |
| DM-2 | **事件引用领域键，不引用投影 `_id`** | 投影可删除重建，重建后 `_id` 会变；事件必须永远可解析 | 事件里存 `Id<'proposals'>`：重建即断链 |
| DM-3 | 领域键：`roomId`（流 id，= `rooms._id`，永不重建）、`seq`、`runNo`、`turnSeq`、`proposalVersion`、`requestNo`、`(itemKey,itemVersion)`、`operationId`、`taskKey`、`userId`（`users._id`，普通表） | 房间内单调计数器由 rooms 投影持有，在同一 mutation 内读+1 | — |
| DM-4 | 事件载荷**自包含**：提案事件携带当时的行项目快照与服务端算出的金额；约束事件携带新的完整值（非增量） | 回放与"某版本时的约束是什么"不依赖当时之外的数据 | 只存差量：回放要求全部历史无损，且难以审计 |
| DM-5 | 能派生的不存：提案状态、审批是否有效、可执行性、承诺总额都在读取时派生 | 存储值会过时；派生值永远与事件一致 | 存 `status:'blocked'` 等：需要回写所有旧行 |
| DM-6 | **诚实地退回普通表**：用户资料、邀请令牌、简报草稿、代理回合遥测不做事件溯源 | 它们不是业务事实（草稿、遥测）或含不应永存的秘密（令牌哈希），或生命周期是运维性的 | 全部事件化：日志膨胀、隐私面扩大、无审计收益 |

## 2. 实体与所有权

| 实体 | 存储方式 | 所有者（谁能产生变化） | 版本化 | 说明 |
| --- | --- | --- | --- | --- |
| User | 普通表 `users` | 本人（首次访问 upsert） | 否 | `tokenIdentifier` 为外部身份键 |
| Room | 投影 `rooms` + 流头 | owner 创建/关闭 | `constraintsVersion`、`proposalVersion`、`lastSeq` | 不存预算 |
| Member（席位） | 投影 `members` ← `member_joined` | 系统按邀请授予 | 否 | 每房间每角色一人；一人一角色 |
| Invite | 普通表 `invites` | owner | 否 | 只存 `tokenHash`；接受后产生 `member_joined` 事件 |
| BriefDraft | 普通表 `briefDrafts` | 本人 | 否（可变） | 私密；不是事实，不进日志 |
| BriefVersion | 投影 `briefVersions` ← `brief_confirmed` | 本人 | `version`（按角色递增） | 只追加；含硬约束、偏好、逐项披露 `shareableFacts` |
| CatalogItem | 投影 `catalogItems` ← `catalog_item_confirmed/withdrawn` | provider | `itemVersion`（按 itemKey 递增） | 已确认报价；改价 = 新版本行 |
| Budget | 投影 `budgets` ← `budget_changed` | finance | 由 constraintsVersion 覆盖 | 每房间一行；历史就是 `budget_changed` 事件 |
| Commitment | 投影 `commitments`（只追加） ← `baseline_commitment_recorded` / `execution_completed` | 系统 | 否 | 已承诺 = 汇总，不存总数 |
| Run | 投影 `runs` ← `run_*` 事件 | 系统（由命令与回合结果驱动） | `runNo` | 每房间至多一个活动 run |
| AgentTurn | 普通表 `agentTurns` | 系统 | `(runNo, turnSeq, attempt)` | 遥测与私有 rationale；终态后冻结 |
| Proposal | 投影 `proposals`（**行不可变**） ← `proposal_created` | 代理 / 规则 / 人工选项 | `proposalVersion`（房间内全局递增，永不重置） | 状态派生 |
| Decision | 投影 `decisions`（**行不可变**） ← `decision_recorded` | 必需审批人本人 | 按 `seq` 排序取最新 | approve / reject / withdraw |
| HumanRequest | 投影 `humanRequests` ← `human_request_*` | 代码开启；目标角色回答 | `requestNo` | 绑定 constraintsVersion |
| ChangeOrder | 投影 `changeOrders`（不可变） ← `execution_completed` | 系统 | `operationId` 唯一 | 核心产出物 |
| Task | 投影 `tasks` ← `execution_completed` / `task_completed` | provider（完成） | 否 | 按行项目与模板确定性派生 |
| Event | 日志 `events` | 只由 `appendEvents` 写入 | `seq` + 哈希链 | 唯一事实来源 |

## 3. 关系图（文字）

```text
users 1─* members *─1 rooms(stream) 1─* events
rooms 1─1 budgets            rooms 1─* commitments
rooms 1─* briefVersions(role,version)   rooms 1─* catalogItems(itemKey,itemVersion)
rooms 1─* runs(runNo) 1─* agentTurns(turnSeq,attempt)
runs 1─* proposals(version) 1─* decisions(seq)
proposals 0..1─1 changeOrders(operationId) 1─1 commitments(kind=change_order)
changeOrders 1─* tasks(taskKey)
runs 1─* humanRequests(requestNo)
```

## 4. 命令与事件（领域层面）

命令（意图，可被拒绝）→ 事件（已发生的事实，不可拒绝、不可修改）。一个命令可产生 0..n 个事件，全部在同一 mutation 中追加并投影。

| 命令 | 发起者 | 可能产生的事件 |
| --- | --- | --- |
| CreateRoom | 允许名单内用户 | `room_created` |
| AcceptInvite | 持令牌的登录用户 | `member_joined` |
| ConfirmBrief | 本角色 | `brief_confirmed`（+ 反应：`run_superseded`、`human_request_cancelled`、`run_started`…） |
| ConfirmCatalogItem / WithdrawCatalogItem | provider | `catalog_item_confirmed` / `catalog_item_withdrawn`（+ 同上反应） |
| UpdateBudget | finance | `budget_changed`（+ 同上反应） |
| StartRun / RetryTurn | 任一成员 | `run_started` / `run_resumed` |
| CompleteTurn（内部） | 系统 | `proposal_created`、`turn_completed`、`run_ready_for_approval`、`run_needs_input`、`human_request_opened`、`turn_rejected_stale` |
| FailTurn（内部） | 系统 | `turn_failed`、`run_failed` |
| Decide | 必需审批人 | `decision_recorded`（+ `execution_completed` 或 `run_resumed` / `run_needs_input`） |
| AnswerRequest | 目标角色 | `human_request_answered`（+ 约束事件或 `proposal_created`） |
| CompleteTask | provider | `task_completed` |
| CloseRoom | owner | `room_closed`、`run_superseded` |
| Seed（内部） | system | 与真实命令相同的事件，`simulated: true` |

"反应（reactor）"是命令处理器在追加主事件后、同一事务内调用的确定性策略函数，它可以追加后续事件并调度 action。没有异步投影器，因此没有最终一致窗口。

## 5. 不变量清单与落点

| id | 不变量 | 保证方式（落点） |
| --- | --- | --- |
| I1 | 事件只追加：`events` 行从不 patch/delete | 唯一写入口 `appendEvents`；CI 静态检查禁止 `db.patch/replace/delete("events"`；哈希链使篡改可检测（03、15） |
| I2 | 房间事件 `seq` 连续无间隙 | `appendEvents` 读 `rooms.lastSeq` 后 +1，同事务写回；OCC 串行化 |
| I3 | 投影 = 回放(事件) | 投影只由 `applyEvent` 写；`audit.verifyRoom` 回放比对（16 中每个测试后自动执行） |
| I4 | 提案条款不可变 | `proposals` 只 insert；状态派生；领域键 `(roomId, version)` 唯一 |
| I5 | `proposalVersion` 房间内单调、永不重置 | `rooms.proposalVersion` 在 `proposal_created` 的 apply 中 +1 |
| I6 | `constraintsVersion` 只因约束事件改变 | 只有 4 类事件携带 `constraintsVersionAfter`，apply 只从这里写 |
| I7 | 审批绑定 `(proposalVersion, constraintsVersion)`；同人同提案以最新 `seq` 为准 | `decisions` 不可变行 + 读取时归约 |
| I8 | 必需审批集合在提案创建时快照；不同角色必须是不同 userId | `proposal.requiredApprovals`；成员唯一性（I11） |
| I9 | 每个提案至多执行一次；执行与承诺/任务同事务 | 状态守卫 + `operationId` 唯一（`changeOrders.by_operation`）+ 单事件 `execution_completed` 投影三张表 |
| I10 | `committed + amount ≤ total` 在执行事务内对当前存储值重算 | `approvals.decide` 内调用 `validateProposal` |
| I11 | `(roomId, role)` 与 `(roomId, userId)` 成员唯一 | `invites.accept` 单一写入口先查后写 |
| I12 | 每房间至多一个活动 run | `rooms.currentRunNo` 指针；只有 `run_started` 的 apply 设置它，plan 要求为空或旧 run 已终结 |
| I13 | 迟到回合结果被拒收 | `completeTurn` 持久化守卫（04 §3） |
| I14 | 对他方可见文本只由模板从结构化字段生成 | 事件不存渲染文本；读取时 `renderEvent(viewer)`（07） |
| I15 | 金额为 `0 ≤ n ≤ 100_000_000` 的安全整数美分 | `assertCents` 于所有金额入口 |
| I16 | 可执行性永远实时计算 | `rooms.view` 与 `approvals.decide` 共用纯函数 |
| I17 | 模拟数据可识别 | 事件信封 `simulated` 字段；投影行继承；UI 徽章 |

## 6. 派生量（不入库）

| 派生量 | 公式 |
| --- | --- |
| proposal 状态 | `executed` 若存在 `changeOrders(roomId, proposalVersion)`；否则 `current` 若 `rooms.currentProposalVersion === v`；否则 `superseded` |
| 可执行性 | `proposal.constraintsVersion === room.constraintsVersion && validateProposal(...).ok && run.status === 'pending_approval'` |
| 决定有效性 | 最新 decision 的 `constraintsVersion === room.constraintsVersion` 且提案仍为 current → `effective`；否则 `stale`（approve）/ `stale_reject` |
| committedCents | `sum(commitments.amountCents where roomId)` |
| headroomCents | `budgets.totalCents - committedCents` |
| 某约束版本 n 的完整约束 | 折叠 `seq ≤ seqOf(constraintsVersionAfter = n)` 的约束事件（09 §5） |
| 回合调用次数 | `count(agentTurns by_run)` |

## 7. 与原方案的差异要点

- 原 README 的 `rooms.committedCents`、`members.approvalRequired`、自由文本 `scope/sourceRefs` 被移除（见 18 ADR-03/05）。
- Role A 的 `revalidated` 复制提案被否决；approve 删除旧拒绝被否决（决定只追加）。
- 新增：事件信封、哈希链、领域键、投影重建。
