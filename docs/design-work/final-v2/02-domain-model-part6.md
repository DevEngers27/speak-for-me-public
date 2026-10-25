# 02 · 领域模型（part6）：不变量清单 B（核心 4–8、生命周期、时间与值域）

> 分片清单见 `02-domain-model.md` 顶部。列同 part5。

### B1 代码负责校验（核心 4）

| ID | 不变量（简述） | 数据落点 | 唯一写者 / 守卫（失败码） |
| --- | --- | --- | --- |
| INV-37 | `terms.amountCents = Σ lines[].priceCents`，插入时与执行时各断言一次；`lines[]` 是插入时 confirmed 目录行快照；rush 是 `catalogItems(kind: 'modifier')` 一行，不是插件常量 | `proposals.terms / lines`；`catalogItems.kind` | `insertProposal` 自检；`executeIfComplete` 复算（`amount.claim_mismatch`） |
| INV-38 | `terms.itemKeys` ⊆ 当前 confirmed 目录；`lines[].revision` ≠ 当前行 → `version.stale_source`（正常路径已被 bump 处置，只在守卫层出现）；必需项不在目录不崩溃 | `catalogItems.revision / status` | `checkProposal`（`item.unknown` / `item.unconfirmed` / `item.retired` / `item.required_missing` / `item.duplicate`） |
| INV-39 | `RuleInput` 含三方全部硬字段；检查一次收集全部阻断；预算闭区间（恰等于上限通过）；新上限 < 已承诺 → 拒绝、不 bump、不写事件 | `briefs.hardFields`；`ledgerEntries` | `insertBriefVersion` / `budget.setCap` / `humanRequests.answer(raise_cap)`（`budget.below_committed`，`params.minAllowedCapCents` 只给 finance） |
| INV-40 | 先把 `usage` / `stop_reason` / `requestId` 记入 attempt，再按 `stop_reason` 分支（截断重试一次、refusal 不重试、上下文溢出不重试），失败永不当作"代理没有动作" | `attempts.usage / stopReason / stopCategory / requestId / errorCode` | `agents.runAttempt` → `turns.complete / fail` |
| INV-41 | `optionKey` 只在本回合 `candidateSnapshot` 内解析，不重新枚举；同 run 重复提出已阻断 candidateKey 被拒 | `turns.candidateSnapshot`；派生阻断集（`turns.outcome.blockedCandidateKey`、被拒提案） | `turns.complete`（`action.repeats_blocked`） |
| INV-42 | 全部模型调用经 `modelGateway` 运行时白名单（模型、effort、`max_tokens`、无 thinking / 采样参数 / prefill） | `attempts.model / effort / maxTokens / schemaVersion` | `modelGateway`（违例即编程错误，`internal`） |
| INV-43 | 值域：金额 `assertCents`、日期真实日历日 + 字典序 + 窗口、文本 NFC 按码点计长、`rationale ≤ 1,200` | 全部 `*Cents` / `IsoDate` / 人写文本字段 | 03 §3.2 校验表（`amount.out_of_range` / `date.invalid` / `date.out_of_range` / `input.invalid`） |
| INV-44 | 动作 × 角色矩阵在服务端逐函数执行，前端传来的角色不被信任 | `members.role` | `memberMutation` + `requireRole`（`auth.role_forbidden`） |
| INV-45 | 房间场景键与版本必须在注册表中且建房后固定；插件只含纯函数 | `rooms.scenarioKey / scenarioVersion` | 注册表查找（缺失 → 写操作 `internal`） |

### B2 执行幂等且原子（核心 5）

| ID | 不变量（简述） | 数据落点 | 唯一写者 / 守卫（失败码） |
| --- | --- | --- | --- |
| INV-46 | `executionKey = "exec:" + proposalId` 唯一；每提案至多一行 `executions` / `changeOrders` / `ledgerEntries(commit)`；客户端不传幂等键 | `executions.by_executionKey / by_proposal / by_room` | `executeIfComplete`：状态守卫为主，三索引查重命中即 fail closed |
| INV-47 | 最后一张 approve 与执行全部写入（executions、commit、变更单、任务、事件、提案 / run / 房间状态）同一事务，任一失败全部回滚 | — | `approvals.record` 单事务 |
| INV-48 | 执行前在同一事务重读房间、run、提案、整个审批区间、成员、台账区间、当前目录、三方硬字段并重算 | — | `executeIfComplete` |
| INV-49 | `taskKey = ${executionId}:${itemKey}:${templateIndex}` 唯一；任务来自 `proposals.plannedTasks` 快照，执行时不重算模板 | `tasks.taskKey`；`proposals.plannedTasks` | `executeIfComplete`；对账 R6 |
| INV-50 | `committedCents = Σ ledgerEntries.amountCents`，不存计数器；每房间恰一条 `baseline`（setup 期一次，可为 0） | `ledgerEntries.kind / amountCents` | `appendLedgerEntry`（`run.invalid_state`） |
| INV-51 | mutation 无外部副作用；执行事务不调度任何 action | — | 结构测试；执行模块纯度 lint |
| INV-52 | 一房一执行：`executed` 终态，拒绝一切协商 / 约束 / 审批写入；例外只有 `tasks.markDone` 与 `rooms.startFollowUp`；跨房间：后续房间只复制未交付的目录行，已交付键在后续房间 `catalog.confirm` → `item.duplicate`，任何候选快照都不含它（canon D04） | `rooms.status / executionId` | `openRoomTx({ allow })`（`run.invalid_state`；`approvals.record` 返回 `approval.already_executed`） |
| INV-53 | 执行不递增 cv；`approvalIds` 冻结，之后不再派生 stale | `executions.approvalIds / constraintsVersion` | `executeIfComplete` |

### B3 历史不可篡改（核心 6）

| ID | 不变量（简述） | 数据落点 | 唯一写者 / 守卫（失败码） |
| --- | --- | --- | --- |
| INV-54 | 只追加：`briefs`、`sharedFacts`、`catalogItems`、`ledgerEntries`、`constraintRevisions`、`approvals`、`executions`、`changeOrders`、`events`；`proposals` 只有 `status`；`tasks` 只有完成字段 | 03 §3.3.2 `APPEND_ONLY` / `MUTABLE_FIELDS` | 写门面 + ESLint；例外只有 `privacy.redact`（`REDACTABLE_FIELDS`）与 dev / preview 的 `seed.reset` |
| INV-55 | `termsKey = canonicalJson(terms)`，插入后不变；`version` 房间内单调，不因新 run 或 bump 重置 | `proposals.termsKey / version`；`rooms.nextProposalVersion` | `insertProposal` |
| INV-56 | `events.append` 是唯一写事件入口，`(roomId, commitTs, seq)` 唯一；每个状态迁移同事务至少一条事件 | `events` | `appendEvents` |
| INV-57 | 每个 cv 恰一行 `constraintRevisions { cause, actorUserId, sourceRefs }`，不存约束值，可由 `sourceRefs` 折叠重放 | `constraintRevisions` | `constraints.bump`；09 `replayRuleInput` |
| INV-58 | 执行后历史不再变化；follow-up 新房间 cv 从 0 起、账本独立、只以 `followsExecutionId` 引用旧执行；每个 execution 至多一个后续房间（重复调用返回既有房间） | `rooms.followsExecutionId`（索引 `by_followsExecutionId`） | `rooms.startFollowUp`（先查后插 + 旧房间 `openRoomTx({ allow: ['executed'] })` 写锁串行） |
| INV-M1 | **房间写锁**（本章首提，已并入 00-invariants-part6 §1.11）：每个改变房间业务状态的事务都把 `rooms.writeSeq + 1`；房间作用域表只能经 `RoomTx` 写 | `rooms.writeSeq` | `openRoomTx`；`RoomTx` 类型强制（03 §3.3.2） |

### B4 执行边界（核心 7）与不伪造（核心 8）

| ID | 不变量（简述） | 数据落点 | 唯一写者 / 守卫（失败码） |
| --- | --- | --- | --- |
| INV-59 | 代码库对外部 ERP / 支付 / 电子签署 / 邮件 SDK 零依赖；领域中不存在任何外部系统实体或字段；`core/engine` 纯度 | `package.json` 依赖白名单；schema | 依赖白名单 lint（CE-147）；`no-restricted-imports`；03 SC-T6 |
| INV-60 | 执行只写内部表（executions、ledgerEntries、changeOrders、tasks、events 与状态字段）；执行路径无 action、`fetch`、`runAfter` | 同左 | 执行模块纯度 lint（CE-148） |
| INV-61 | 变更单 DTO 与打印视图固定渲染免责声明模板（"Internal record only…"），场景不可覆盖；带 provenance 徽章 | `changeOrders.provenance` | 模板 `change_order_disclaimer` |
| INV-62 | 业务记录带 `provenance ∈ live / seeded / stub`，派生记录按 `seeded > stub > live` 继承；界面对 seeded / stub 统一徽章 | `*.provenance` | `inheritProvenance`（03 §3.3.3） |
| INV-63 | seed 只走生产写入口、只写输入链：缺省时第三份确认按生产路径同事务开首个 run（stub 推进），`stopBeforeRole` 留一方不确认、停在 `setup`；seed 自身永不写提案 / 审批 / 执行（canon D18） | — | `seed.fromFixture`；禁止 `t.run` 直插 |
| INV-64 | 无可行方案时只开人工请求，不制造一致提案或执行；`needs_input ⇔` 恰一个属于该 run 的 open 请求 | `humanRequests` | `openHumanRequestTx`；`startRunTx` R3 |
| INV-65 | open 请求 7 天过期 → run `ended_no_agreement`；`keep_as_is` 每 run 至多延长一次；审批不过期 | `humanRequests.expiresAt`；`runs.roundsExtended` | `humanRequests.expireDue`（cron） |
| INV-66 | stub 与 live 共用 `AgentDriver.decide` 与全部下游；stub 产物 `provenance: 'stub'`；stub 不受 `opsFlags.draining` 与 `AGENTS_ENABLED` 影响（canon D17） | `runs.agentMode`；`attempts.provenance` | `turns.complete` 同一路径 |

### B5 运行生命周期与活性、时间与值域

| ID | 不变量（简述） | 数据落点 | 唯一写者 / 守卫（失败码） |
| --- | --- | --- | --- |
| INV-67 | 每房间至多一个非终态 run，且它就是 `rooms.currentRunId`（指针指向最新 run，任何状态；见 2.14 Q2） | `rooms.currentRunId`；`runs.status` | `startRunTx`（人工路径幂等返回现有 run；系统路径先取代） |
| INV-68 | 串行回合：每 run 至多一个非终态 turn（`activeTurnSeq`）与一个 `running` attempt；无屏障计数器 | `runs.activeTurnSeq`；`turns.status`；`attempts.status` | `createTurnTx`；`turns.beginAttempt` |
| INV-69 | 持久化守卫 G0–G3（attempt 当前、run 当前且 negotiating、turnSeq 未推进、回合 cv 快照 = 房间 cv）；任一失败 → stale、用量照记、`runs.reconcile` | `attempts.status`；`turns.currentAttemptNo / constraintsVersion`；`runs.activeTurnSeq` | `turns.complete / fail`、`agents.watchdog` |
| INV-70 | 活性：`negotiating` ⇒ 当前 turn 有 running attempt、或已登记的 `beginAttempt` 调度、或仍成立的等待原因（`draining` / `spend_deferred` / `run_cap`，后两者带已登记的 `beginFnId`） | `turns.waitingReason / beginFnId`；`attempts` | `runs.reconcile`（每个不满足情形都给出迁移） |
| INV-71 | 看门狗以 `attemptId` 登记、每 attempt 自有；读 `_scheduled_functions` 决定重登记（≤ 3）/ 超时 / 崩溃 | `attempts.watchdogFnId / watchdogArmCount / deadlineAt` | `agents.watchdog` |
| INV-72 | 上限四层 + 排空：用户节流、`runs.maxAttempts`、每 run 美元预留、全局日美元；`opsFlags.draining`（只拦新建 live attempt，`ops.activeAttemptCount` 只数 live） | `events.by_room_actor`；`runs.attemptCount / maxAttempts / reservedMicroUsd / spentMicroUsd`；`spendCounters`；`opsFlags` | `assertWithinRate`；`turns.beginAttempt`（`run.draining` / `deferred`，被调度路径不 throw） |
| INV-73 | `needs_input` 的每个选项效果都有迁移（约束效果 → bump；`choose_candidate` → `pending_approval` 或重新生成；`disclose` → `negotiating`（clarify：发问方同轮新回合）或同事务重跑预检（infeasible 回退请求：仍无解则留在 `needs_input` 并恰开一个新请求，04 R20）；`retry_turn` / `keep_as_is` → `negotiating`；`pass_to_next` → 留在 `needs_input`、旧请求 `answered`、给下一角色恰开一个按其自身视图生成的 `infeasible` 请求、不 bump（04 R21）；`end_run` → `ended_no_agreement`）；无选项映射到关房 | `humanRequests.options` | `humanRequests.answer` |
| INV-74 | `resolveRound` 优先级固定（clarify 需人 → escalate 通过 → 全部 recommend_accept 且可执行 → counter → 下一轮 / 轮次用尽） | `turns.result / outcome` | `advanceRun` |
| INV-75 | 开房（`setup → open`，即第三份确认等最后一个就绪条件满足时）同事务 bump 到 v1 并开首个 run（`cause: 'room_opened'`） | `runs.cause` | `openIfReady` → `bump` → `react` → `startRunTx` |
| INV-76 | run 终态（`executed` / `superseded` / `ended_no_agreement` / `canceled`）互斥且无出边 | `runs.status / endedReason` | `setStatus` + `assertTransition`（`state.illegal_transition` → `internal`） |
| INV-77 | `rooms.timeZone` 建房后固定；`rooms.localDate` 只由 `rooms.create` 与 `clock.rollLocalDate` / `rollLocalDateTx` 写（后者由 `turns.complete` 在守卫前、`humanRequests.answer(choose_candidate)` 在物化前同事务调用，09 §9.6.7） | `rooms.timeZone / localDate` | 写门面字段白名单；`clock.rollLocalDate`、`rollLocalDateTx` |
| INV-78 | 日期一律 `IsoDate` 字典序、金额一律整数分，在任何边界用同一组函数比较 | — | `core/engine/values.ts` |
