# 02 领域模型 · part2：不变量清单（续）

> 接 part1（§0 房间聚合写锁、§1–§4 身份、简报、约束版本、提案）。本片 §5–§10；实体与守卫矩阵见 part3。

## 5. 审批决定（DE）

| ID | 不变量 | 数据落点 | 守卫 |
| --- | --- | --- | --- |
| DE-1 | 决定只追加（撤回也是追加一条 `withdraw`） | `decisions` | db 门面 |
| DE-2 | 决定只由人经 `decisions.record` 写入：行动者为调用者的 participant；`roleKey ∈ proposal.requiredApproverRoles`；`constraintsVersion` = 写入时的房间版本。没有任何 internal 函数写 decisions | `decisions.*` | 唯一写者 `decisions.record` |
| DE-3 | approve 仅当此刻 `isExecutable` 为真；reject 仅当提案为当前且 run = pending_approval；withdraw 仅当最新决定为 approve 且尚未执行（reject 会立即结束当前 run，见 08 §3，因此没有"撤回拒绝"） | — | `decisions.record` |
| DE-4 | 计数规则：某角色"已批准" ⟺ 该角色唯一的参与方在 `(rooms.currentProposalId, rooms.constraintsVersion)` 上的**最新**决定为 approve | `by_proposalId_and_constraintsVersion_and_participantId` | `approvalState` 纯函数，执行守卫与界面共用 |
| DE-5 | 同一 `(proposalId, constraintsVersion, participantId)` 不出现两条连续相同 kind 的决定（重复点击幂等） | 同上 | `decisions.record` 读最新一条，相同则返回 `unchanged` |

## 6. 执行（EX）

| ID | 不变量 | 数据落点 | 守卫 |
| --- | --- | --- | --- |
| EX-1 | 每个提案至多执行一次；`operationKey = exec:{proposalId}:{constraintsVersion}` 唯一；executions 只追加 | `executions` + `by_proposalId`、`by_operationKey` | 唯一写者 `executeIfReady`：先查两个索引，命中即返回已有结果 |
| EX-2 | 执行发生 ⟺ 在最后一票的同一 mutation 内：全部必需角色按 DE-4 已批准 ∧ `isExecutable` 重算为真 ∧ CS-4 断言成立 | — | `executeIfReady` |
| EX-3 | execution、commitment、tasks、`bumpConstraints`、run → executed、清空指针、事件在同一事务提交 | — | `executeIfReady` 不调度任何函数、不拆分 |
| EX-4 | commitments 与 executions 一一对应；每个 task 属于唯一 execution；二者由 `scenario.deriveExecution(terms)` 确定性派生，模板版本随房间的 `scenarioVersion` 固定 | `commitments.executionId`、`tasks.executionId` | `executeIfReady` 是 commitments/tasks 的唯一插入者 |
| EX-5 | 预算全局不变量：`committed(current) ≤ cap(current)` 恒成立 | finance 版本 `budgetCapCents`、CS-4 | `executeIfReady` 的预算检查；finance 确认新版本时 `budgetCapCents ≥ committed`，否则 `BUDGET_BELOW_COMMITTED` |
| EX-6 | 执行不产生任何外部副作用 | — | 执行只在 mutation 中（平台禁止 mutation 做 fetch），且不调度 action |

## 7. 运行与回合（RN）

| ID | 不变量 | 数据落点 | 守卫 |
| --- | --- | --- | --- |
| RN-1 | 每房间至多一个非终态 run；`rooms.currentRunId` 有值 ⟺ 它指向的 run 非终态 | `rooms.currentRunId`、`runs.status` | `startRun` 先查指针；`transitionRun` 进入终态时同事务清空 |
| RN-2 | `run.status` 只经 `transitionRun` 改变，且 `(from, to) ∈ RUN_TRANSITIONS` | `runs.status` | `transitionRun` + `assertTransition` |
| RN-3 | 回合结果写入业务表的前提（持久化守卫）：`turn.status = running ∧ run = rooms.currentRunId ∧ run.status = negotiating ∧ turn ∈ run.pendingTurnIds ∧ run.constraintsVersion = rooms.constraintsVersion`；否则 turn → stale，只记用量 | `agentTurns.status`、`runs.pendingTurnIds` | `completeTurn`、`failTurn`、`turnWatchdog` 共用 `assertTurnLive` |
| RN-4 | 每个 running 回合都有一个已调度的 watchdog；回合必然进入终态 | `agentTurns.watchdogId` | `scheduleTurn` 同事务调度 `executeTurn` 与 `turnWatchdog` |
| RN-5 | `rooms.modelCallsUsed ≤ rooms.modelCallBudget`；在调度模型回合的 mutation 中先计数 | `rooms.modelCallsUsed` | `scheduleTurn` |
| RN-6 | 角色 R 的代理上下文 ⊆ R 的委托人可见的数据 ∪ 委托人本人的确认简报 | — | `buildAgentContext` 只调用 `projectFor(R)` 与 `loadOwnBrief(R)` |
| RN-7 | 代理输出不写 decisions，不产生自由文本的人工请求；clarify 只产生代码构造的 disclosure 请求 | — | `completeTurn` 的动作分派表 |

## 8. 人工请求（HR）

| ID | 不变量 | 数据落点 | 守卫 |
| --- | --- | --- | --- |
| HR-1 | humanRequests 只由引擎代码创建；问题与选项是结构化数据，文本由模板渲染 | `humanRequests.question/options` | 唯一写者 `openRequests` |
| HR-2 | 只有目标参与方能回答；仅当 `status = open ∧ request.constraintsVersion = rooms.constraintsVersion` | `humanRequests.targetParticipantId` | `requests.answer` |
| HR-3 | 选项里的数值参数满足派生闭包（只来自公开提案或目标本人的数据） | `humanRequests.options` | `scenario.tradeoffs` 的输入只含公开提案与目标本人简报；单测 |
| HR-4 | `run.status = awaiting_input` ⟺ `run.pendingTurnIds = ∅` 且存在关联该 run 的 open blocking 请求（并行回合未完成时，请求可以先 open，run 仍为 negotiating） | `humanRequests.runId/blocking`、`runs.pendingTurnIds` | 轮次结算 `settleStep` 与 `closeRequest` 同事务迁移 run |

## 9. 事件与历史（EV）

| ID | 不变量 | 数据落点 | 守卫 |
| --- | --- | --- | --- |
| EV-1 | events 只追加；`(roomId, seq)` 从 1 连续，`seq = ++rooms.eventSeq` | `events.seq`、`rooms.eventSeq` | 唯一写者 `emitEvent` |
| EV-2 | 每个状态迁移（房间、run、提案创建、决定、执行、简报确认、约束 bump、请求开关、任务）在同一事务写至少一条事件 | — | 各迁移 helper 内调用 `emitEvent`；`ops.auditRoom` 抽查 |
| EV-3 | 事件 payload 只含对其受众全体可见的值；房间受众的 payload 类型中不存在私密数值字段 | `events.audience/payload` | `EVENT_SPECS[type].audience` 与 payload validator 绑定 |
| EV-4 | 事件与任何对他方可见的文本中都没有模型自由文本；`rationale` 只存于 `agentTurns`，只给本角色 | `agentTurns.output.rationale` | 模板渲染；`turns.mine` 按角色过滤 |

## 10. 值域与不伪造（VAL、SIM）

| ID | 不变量 | 守卫 |
| --- | --- | --- |
| VAL-1 | 金额是 `Number.isSafeInteger(n) ∧ 0 ≤ n ≤ MAX_CENTS` 的整数美分 | 所有金额入口调 `assertCents` |
| VAL-2 | 日期是 `YYYY-MM-DD` 且为真实日历日；全系统一个校验器 `isoDate` | Zod 与服务端共用 `engine/values.ts` |
| VAL-3 | 房间时区建房时确定且不可改；"今天"按房间时区计算 | `rooms.timeZone` 无写入口 |
| SIM-1 | 来自 fixture、seed、stub 的记录 `isSimulated = true`，派生记录继承；界面凡见此标记必显示徽标 | 各插入 helper 计算继承；13 的渲染规则 |
| SIM-2 | 当前约束下没有满足条件的方案时，系统只创建人工请求，不创建声称各方同意的提案或执行 | `startRun` 预检与 `completeTurn` 的轮次结算 |

共 56 条（ID 7、BR 5、CS 6、PR 7、DE 5、EX 6、RN 7、HR 4、EV 4、VAL 3、SIM 2）。part3 把它们映射到实体与函数；16 为每条给出至少一个测试。
