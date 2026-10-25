# 12 · 后端函数目录（part6）：代理运行时 internal 函数与事务内 helper

签名与运行时语义以 10 为准（§10.5–§10.9，重试表 §10.10、时间预算 §10.11）；本节把它们登记进函数目录，并固定读写边界。代理运行时函数带 `actorUserId: v.union(v.id("users"), v.null())`：由用户动作触发时是该用户，由重排、看门狗、cron 触发时是 `null`（系统）。四个函数都只抛 `ConvexError({ code: "internal" })`（构造器清洗），没有面向用户的失败码。

## 12.18 代理运行时（D01、D07、D09、D17）

#### `turns.beginAttempt` · sysMutation（唯一调度接缝）
- **形态**：逻辑在事务 helper `beginAttemptTx(ctx, turnId, { origin, delayMs, actorUserId, retryNote?, why? })`（10 §10.5.1、canon §1.6），由 `runs.start`、`approvals.record`（reject 开新轮）、`humanRequests.answer`、`turns.complete`（下一回合与自动重试）、`runs.reconcile` 在各自事务内直接调用；注册的 internal mutation 只作为延迟（退避、日上限、`run_cap`）、排空恢复与 reconcile 的 `runAfter` 目标。将来换 workpool 时唯一要改的函数。
- **args** `{ turnId: v.id("turns"), origin: originV, actorUserId: v.union(v.id("users"), v.null()), retryNote: v.optional(reasonCodeV) }`（`turns.fail` 的退避调度把上一 attempt 的 reasonCode 带给下一 attempt，缺了它参数校验会失败，10 §10.7.2）；`originV` 的取值以 03 §3.8 的 `attempts.origin` 为准（`turn_start` / `auto_retry` / `retry_turn`；10 已同名）。
- **returns** `BeginResult`（10 §10.5.1 为唯一定义）：`{ kind: "dispatched", attemptId }` / `{ kind: "deferred", until, reason: "spend_deferred" | "run_cap" }`（全局日美元 / 每房间 24h run 数）/ `{ kind: "parked", code: "run.draining" }` / `{ kind: "limit", cause: "call_limit" | "spend_limit" | "turn_attempts" }`（`turn_attempts` → 失败方的 `agent_failed`）/ `{ kind: "stale" }`——被调度路径从不因上限抛错（techstack X2）。
- **检查**（10 §10.5.2 的 B1–B7 加 B4a / B6a，顺序与不满足时的处置以 10 为准，下面只摘要）：turn 状态合法；G1–G3 成立（否则回合 → `stale`，返回 `stale`，调用方 `runs.reconcile`）；live 且 `opsFlags.draining` → 回合停泊（`waitingReason: "draining"`），返回 `parked`（canon D17：stub 不受排空影响）；`run.attemptCount < run.maxAttempts`（live 与 stub 都查，防死循环）与 live 的每 run 美元预留，否则回合 `failed` 并由 05 转 `needs_input` + customer 的 `rounds_exhausted` 请求（`questionKey` 带 `call_limit` / `spend_limit`，选项 `choose_candidate` + `end_run`，无 `keep_as_is`；04 R6 / U5、05 §5.8.5），返回 `limit`；live 的 `spendCounters(global, UTC 日)` 余量不足 → `deferred`：`runAfter(到次日 UTC 零点 + 抖动, internal.turns.beginAttempt, …)`，回合 `waitingReason: "spend_deferred"`（状态不变；不写事件，本方界面由 `rooms.view.run.waiting` 渲染 "Agents paused until tomorrow"）；B4a 回合链已用尽（`MAX_ATTEMPTS_PER_TURN = 2`）→ 回合 `failed`、`limit{ turn_attempts }`；B6a 系统开局 run 的首个 attempt 超出每房间 24h `run_starts` 桶 → `deferred{ reason: "run_cap" }`，`beginFnId` 登记到窗口腾出时刻（§12.2 第 7 条）。
- **写**（同一事务）`attempts`（`attemptNo = turn.currentAttemptNo + 1`、`status: "running"`、`origin`、`provenance = run.agentMode`、`model` / `effort` / `maxTokens`、`reservedMicroUsd`、`deadlineAt`、`watchdogArmCount: 0`、`actionFnId`、`watchdogFnId`）；`turns`（`currentAttemptNo`、`status: "running"`、清除等待标记）；`runs`（`attemptCount + 1`、`reservedMicroUsd`）；`spendCounters`（live 预留）；调度 `runAfter(delayMs, internal.agents.runAttempt, { attemptId, actorUserId })` 与 `runAfter(delayMs + WATCHDOG_FIRST_MS, internal.agents.watchdog, { attemptId })`；不写事件（`turn_scheduled` 只由 `createTurnTx` 在建回合时写一次，04 R4 / U1）。spike 证实"写状态 + `runAfter`"原子：事务回滚时调度一并消失。

#### `agents.loadTurnContext` · sysQuery
- **args** `{ attemptId: v.id("attempts") }`；**returns** `v.union(v.null(), v.object({ agentMode, turnSpec, input /* AgentTurnInput */, retryNote, model, effort, maxTokens, promptVersion }))`（10 §10.6.1）。全部是普通 Convex 值：不含 Zod 对象、不含 JSON Schema、无以 `$` 开头的键（D09；Zod 与 `$defs` 过不了 Convex 值校验）。
- G0–G3 任一不成立返回 `null`。`AgentTurnInput` 由 07 §7.14 的白名单组装函数产出：本方简报、披露给本方的 `sharedFacts`、`candidateSnapshot`（`O1..On`，含金额与绝对交付日）、按受众裁剪的轮次结果、他方写的目录标题（包进 `<untrusted_data>` 并转义 `<` `>` `&`）。这是唯一组装代理上下文的入口。**读** `attempts`、`turns`、`runs`、`rooms`、`briefs`（只读本角色）、`sharedFacts`、`catalogItems`、`proposals`。

#### `agents.runAttempt` · sysAction
- **args** `{ attemptId: v.id("attempts"), actorUserId: v.union(v.id("users"), v.null()) }`；**returns** `v.null()`
- **步骤**（10 §10.6.2）① `runQuery(loadTurnContext)`；`null` → `runMutation(turns.fail, { outcome: { kind: "stale_context" } })` 后结束，不调模型；② live 且 `AGENTS_ENABLED === "false"` → `error(agents_disabled)`；③ 在 action 内按 `(role, turnKind, n)` 构造 Zod schema 并经 `toStrictOutputSchema` 得到 `output_config.format`；`AgentDriver.decide`：live 经 `callModel`（`messages.stream(...).finalMessage()`、`claude-opus-5-5`、`output_config.effort: "medium"`、`max_tokens: 16000`、SDK `maxRetries: 0` 而由网关单层重试（429 / 连接错误与 `max_tokens` 截断各 ≤ 1 次，10 R11）、总截止早于 `WATCHDOG_FIRST_MS` 且到期不可重试、`MODEL_FALLBACKS` 缺省关、不传 `thinking`），stub 用确定性驱动，下游完全相同；④ 分类为 `move` 或失败 outcome（纯函数、不抛、丢弃 SDK 原消息）；⑤ 恰好一次 `runMutation`：`turns.complete` 或 `turns.fail`；提交本身抛错（缺陷）→ `turns.fail(internal)`，绝不在本 action 内再调模型。
- 不直接写表、不写 `console.*`；模型原文只随提交写入 `rawOutputs`（D16）。默认运行时；若 SDK 流式在默认运行时不可用（待验证），只把本函数移入 `"use node"` 文件（11 §11.8）。

#### `turns.complete` / `turns.fail` · sysMutation
- **args**（10 §10.7.1）`turns.complete`: `{ attemptId, actorUserId, move: agentMoveV, response: modelResponseV, schemaVersion: v.string(), latencyMs: v.number() }`；`turns.fail`: `{ attemptId, actorUserId, outcome: failOutcomeV, schemaVersion: v.optional(v.string()), latencyMs: v.number() }`。`agentMoveV` 是 05 Zod `AgentModelOutput` 规范化后的存储镜像（03 §3.4，CI 双向可赋值断言）；`modelResponseV` 含 `usage`、`stopReason`、`stopCategory`（与 03 §3.8 `attempts.stopCategory`、10 同名）、`requestId`、`messageId`、`responseModel`、`rawText`；`failOutcomeV` ∈ `invalid_output` / `refused` / `timeout` / `error` / `stale_context`。
- **returns** `v.null()`
- **共用前四步**：① 读 attempt / turn / run / room；② **G0**（`attempt.status === "running"` 且 `turn.currentAttemptNo === attempt.attemptNo`）不成立 → attempt 尚无 usage 而本次带有时补写用量（`lateUsage: true`）并结算；本次是未发请求的结果（`stale_context`、`agents_disabled`、`config_invalid`）且 attempt 的 `costState` 为 `unknown` 时结算为 `known`、`costMicroUsd = 0`（10 §10.12.2）；然后 `runs.reconcile`，不写事件；③ **G1–G3** 不成立 → attempt `stale`，用量照记、结算，事件 `turn_rejected_stale{ guard }`，`runs.reconcile`；④ 写用量、`stopReason`、`requestId`、`schemaVersion`、`rawOutputRef`（插 `rawOutputs`），按 15 的价目表估算 `costMicroUsd` / `priceTableAsOf` 并结算（run 与 `spendCounters`：预留 → 实际）。
- **`turns.complete` 后续**：⑤ 以存储的 turn 再跑语义校验（`optionKey` 只在 `candidateSnapshot` 内解析、动作在 `allowedActions` 内、不重复本 run 已阻断的 `candidateKey`、引用的版本存在）→ 失败则 attempt `invalid_output`，按 10 §10.10 自动重试（`beginAttemptTx(origin: auto_retry)`）或回合 `failed` → 05 `onTurnFailed`（`agent_failed` 请求）；⑥ attempt / turn → `completed`，`turn.result` / `outcome`；⑦ 05 `applyMove`：`propose` / `counter` 由服务端从快照物化 `terms`（`amountCents = Σ lines`、交付日按 `room.localDate` 物化为绝对日期），全量 `checkProposal` 通过才 `insertProposal`，provider 候选被阻断只记 `blockedCandidateKey`、不花评估调用（D08）；`resolveRound` 决定下一回合、`pending_approval` 或 `needs_input`（恰好开一个请求）。
- **`turns.fail` 后续**：attempt 状态按 outcome，按 10 §10.10 决定重试或回合 `failed`（`refused` 不重试 → `agent_failed`，选项 `retry_turn` / `end_run`）；配置类错误（`bad_request`、`auth`、`quota_exhausted` 等）`opsLog` 告警。
- **幂等**：业务身份 `(runId, turnSeq, attemptNo)`；同一 attempt 的第二次提交必然命中 G0，用量只写一次（03：用量字段写一次）。
- **写** `attempts`、`rawOutputs`、`turns`、`runs`、`spendCounters`、`proposals`、`humanRequests`、`rooms`（`nextProposalVersion`）、`events`（`turn_completed` / `turn_failed` / `proposal_created` / `run_awaiting_approval` / `run_needs_input` 等，按 03 §3.11.1）。`rationale` 只在 turn 上、只给本方，永不进事件。

#### `agents.watchdog` · sysMutation
- **args** `{ attemptId: v.id("attempts") }`（D07）；**returns** `v.null()`
- attempt 不是 `running` → 空操作（新 attempt 不取消旧看门狗，G0 使其无害）；否则读 `_scheduled_functions` 中 `actionFnId` 的状态（`normalizeId`）：`pending` / `inProgress` 且重登记 < 3 次 → 重新登记并更新 `deadlineAt`；`failed` → `error(action_crashed)`；`success` 而 attempt 仍 `running` → `error(internal)`；重登记用尽 → `timeout(watchdog_timeout)`；随后与 `turns.fail` 同一实现（含 G1–G3 → stale + reconcile）。从不调用 `scheduler.cancel`。

#### `runs.reconcile` · sysMutation
- **args** `{ runId: v.id("runs"), why: v.optional(v.string()) }`；**returns** `v.union(v.literal("noop"), v.literal("repaired"), v.literal("redispatched"), v.literal("replaced"), v.literal("needs_input"), v.literal("advanced"))`（04 §4.3.5 / 10 §10.9 同一实现）
- 逻辑在 helper `reconcileRun`（守卫命中时内联调用）；注册版本供 `ops.livenessSweep` 与 `ops.setDraining(false)` 扇出调用。保证 D07 的活性：run 不会停在 `negotiating` 却既无在途 attempt、也无停泊 / 延迟中的回合；`cv` 漂移（某写路径递增了 cv 却没 supersede）时按 04/09 同一 helper 取代并重启，并 `opsLog("constraints_drift")`。reconcile 新建的 attempt 同样受 `beginAttempt` 全部上限约束，不可能制造无限调用。

## 12.19 事务内 helper（不注册为 Convex 函数；名字取自所属章）

| helper（所属章） | 职责与写入 |
| --- | --- |
| `executions.executeIfComplete`（08 §8.6） | `(tx, { proposalId, actorUserId }) → { status: "not_complete", missingRoles } \| { status: "executed", executionId, alreadyExecuted }`。只经 `approvals.record` 同事务到达（调用图静态测试）：重读 room / run / proposal / 审批区间 / members / 台账 → `evaluateApprovalSet`（当前成员、当前决定 approve、`boundConstraintsVersion === room.constraintsVersion`、`boundTermsKey === termsKey`、被选中 userId 两两不同，否则 `approval.self_conflict`）→ `executionKey = "exec:" + proposalId` 与 `by_room` 先查（命中 fail closed）→ 重算 `isExecutable`（不通过 `approval.not_executable`）→ 写 `executions`（`approvalIds` 冻结）、`ledgerEntries(commit)`、`changeOrders`（G701 金额链）、`tasks`（来自 `plannedTasks` 快照，`taskKey = ${executionId}:${itemKey}:${templateIndex}`）；提案 / run / 房间 → `executed`；事件 `room_executed`；**不**递增 cv |
| `withConstraintChange` / `constraints.bump` / `openIfReady` / `react`（09 §9.4） | 约束写入的唯一递增路径：硬投影前后比较、`setup` 不递增、打开时 cv 1、D06 处置、不动点深度 ≤ 4；`bump` 只被这三处与 `clock.rollLocalDate` / `rollLocalDateTx` 调用 |
| `openRoomTx`、`addMember`、`insertBriefVersion`、`materializeDisclosures`、`appendSharedFact`、`appendCatalogRow`、`appendLedgerEntry`、`insertProposal`、`appendEvents`（03 §3.13） | 数据层唯一写入口；`appendEvents` 即 canon 的 `events.append`：同事务事件分配 `seq` 0..n−1、写 `commitTs`、`actorUserId`、白名单 `payload`、`restrictedRef` |
| `startRunTx`、`createTurnTx`、`openHumanRequestTx`、`setStatus`（04） | run / turn / 请求的插入与状态迁移（`assertTransition` 读 04 的迁移表） |
| `beginAttemptTx`、`reconcileRun`（10 / 04 §4.3.5） | 见上 |
| `scenarioOf(room)`、`latestScenarioVersion(scenarioKey)`（11 §11.3 `convex/scenarios/registry.ts`） | 按房间钉住的 `scenarioKey@scenarioVersion` 取插件（未注册 → `run.invalid_state{ guard: "scenario_version" }`）；后者只供 `rooms.create` 钉住版本 |
| `rollLocalDateTx`（09 §9.6.7） | `clock.rollLocalDate` 单房间分支的事务内形态；`turns.complete` 在 G1–G3 前、`humanRequests.answer(choose_candidate)` 在物化前调用 |
| `applyMove`、`resolveRound`、`onTurnFailed`、`onProposalRejected`、`applyHumanAnswer`、`buildHumanRequests`（05 / 04） | 协议推进、请求生成与回答效果；`applyHumanAnswer` 同时服务 `humanRequests.answer` 与 `runs.retryTurn` |
| `loadRuleInput`（06） | `checkProposal` 与 `hardProjection` 读同一份输入（D05） |
| `assertWithinRate`（03 §3.11.3） | 节流计数（§12.2 第 7 条） |
