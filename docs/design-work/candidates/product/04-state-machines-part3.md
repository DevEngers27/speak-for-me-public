# 04 状态机（part3）：协商运行 run 与回合 turn

## 4.7 run

状态由 `status`（running / stalled / finished）+ `phase`（proposing / reviewing）+ `round` + `proposerAttempt` 共同描述；`outcome` 只在 finished 时出现。

> 说明：G-PERSIST 中 run 状态条件是 `run.status ∈ {"running","stalled"}`（4.1）。并行审阅时一个回合 stalled，另一个回合仍可正常落库；阶段决议要等 `openTurnIds` 中没有 running 回合且 `stalledTurnId` 为空。

| # | 从 | 到 | 触发函数 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| R1 | — | running / proposing / r1 / a1 | `startRun`（helper，被 `afterConstraintChange`、`afterRejection`、`requests.answer`、`negotiation.requestRun` 调用） | G-OPEN；`activeRunId` 为空（公共入口抛 `RUN_ACTIVE`，内部入口静默返回）；`plugin.readiness` 通过（`NOT_READY`）；`negotiationOpen`；代理可用（`AGENT_MODE=stub` 或 `AGENTS_ENABLED=true`，否则 `AGENTS_DISABLED`）；房间当日调用额度未用尽（`CALL_BUDGET_EXHAUSTED`）；预检有可执行候选（否则不建 run，改为 `openTradeoffRequests`） | 插入 run（`constraintsVersion = room.constraintsVersion`、`excludedCandidateKeys`、`agentMode`）；`room.activeRunId`、`runSeq`；`scheduleTurn(propose)`；事件 `run_started` |
| R2 | running / proposing | running / reviewing | `runtime.completeTurn`（propose 回合） | G-PERSIST；动作为 `propose` 且排序中有可执行候选（→ 新提案），或第 1 轮动作为 `recommend_accept` 且存在未被排除的当前提案（沿用） | 为每个审阅角色 `scheduleTurn(review)`（并行）；`openTurnIds` = 这些回合 |
| R3 | running / proposing / a1 | running / proposing / a2 | 同上 | 动作为 `propose` 但排序中的候选全部未通过检查 | 回合记录 `selection.blocked`（原因码）；`scheduleTurn(propose)`，上下文附带被阻断原因（按提出方投影） |
| R4 | running / proposing | finished / `needs_input` | 同上 | 动作为 `clarify` 或 `reject`；或 a2 仍全部被阻断 | `openAgentRequests`（disclosure / preference，05 第 5.8 节）；`finishRun` |
| R5 | running / proposing（round ≥ 2） | finished / `proposal_ready`（consensus false） | 同上 | 动作为 `recommend_accept`（坚持当前提案），或提出的候选与当前提案相同 | `finishRun` |
| R6 | running / reviewing | running / reviewing | `runtime.completeTurn`（review 回合） | G-PERSIST；`openTurnIds` 中仍有 running 回合 | 记录立场；事件 `agent_stance` |
| R7 | running / reviewing | finished / `needs_input` | 同上（最后一个审阅完成） | 任一审阅为 `clarify` 或 `reject` | 为每个 clarify/reject 建请求；`finishRun` |
| R8 | running / reviewing | finished / `proposal_ready`（consensus true） | 同上 | 全部审阅为 `recommend_accept` | `finishRun` |
| R9 | running / reviewing | running / proposing / round+1 / a1 | 同上 | 存在 `counter`，且 `round < maxRounds` | `scheduleTurn(propose)`，上下文含各审阅方立场（候选键 + 原因码） |
| R10 | running / reviewing | finished / `proposal_ready`（consensus false） | 同上 | 存在 `counter`，且 `round === maxRounds` | `finishRun`；界面对各方显示"本方代理不建议接受"（仅本方可见理由） |
| R11 | running | stalled | `runtime.failTurn` / `runtime.completeTurn`（invalid）/ `runtime.turnWatchdog` | 该回合自动重试已用尽，或错误不可重试 | `stalledTurnId`、`endedReasonCode`；事件 `run_stalled` |
| R12 | stalled | running | `negotiation.retryRun` | G-AUTH（任一成员）；G-OPEN；run 为 active 且 stalled；代理可用；调用额度；该 seq 总尝试数 < 6 | 为 `stalledTurnId` 的 seq 新建 attempt，替换 `openTurnIds` 中的旧 id；清空 `stalledTurnId`；事件 `run_resumed` |
| R13 | running / stalled | finished / `superseded` | `bumpConstraints` | — | `finishRun`；迟到结果将被 G-PERSIST 拒收 |
| R14 | running / stalled | finished / `cancelled` | `negotiation.cancelRun`（任一成员）、`rooms.close`、`proposals.proposeCandidate` | — | `finishRun`；本 run 产生的 open preference/disclosure 请求 → `cancelled` |

**`finishRun(run, outcome)`**（helper）：写 `status: finished`、`outcome`、`finishedAt`；清空 `room.activeRunId`；对 `openTurnIds` 中仍 running 的回合，尽力 `ctx.scheduler.cancel(actionFnId)`（先读 `_scheduled_functions` 状态，只取消 `pending` 的，`try/catch`，04 平台约束 1.5）；写 `run_finished`。真正的保证来自 G-PERSIST，而不是取消。

**为什么约束变化时开新 run 而不是让旧 run 回到 negotiating**（F04.1 整理者注要求二选一）：run 记录"在哪个约束版本下谈的"，持久化守卫只需比较 `run.constraintsVersion`；复用旧 run 要么重写它的版本（破坏追溯），要么引入 run 内多版本，复杂度更高。

## 4.8 回合 turn（每次 attempt 一行）

| # | 从 | 到 | 触发函数 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| T1 | — | running | `scheduleTurn`（helper，mutation 内） | run active；`runtime.reserveCall` 成功（run.modelCallCount +1、房间当日额度） | 计算并存 `allowedActions`、`allowedCandidateKeys`、`allowedTopicKeys`（基于作用域视图）；`runAfter(0, internal.runtime.runTurn, {turnId})`；`runAfter(TURN_DEADLINE_MS, internal.runtime.turnWatchdog, {turnId})`；存两个函数 id |
| T2 | running | succeeded | `runtime.completeTurn` | G-PERSIST；05 的四步校验通过；提出方的选择逻辑完成 | 写 `move`、`selection`、`usage`、`resultProposalId`/`requestIds`；按 4.7 推进 run；取消看门狗（尽力） |
| T3 | running | invalid_output | `runtime.completeTurn` | G-PERSIST；校验失败（schema、语义、`stop_reason ≠ end_turn`） | 记 `errorCode`（`AGENT_OUTPUT_INVALID` / `AGENT_TRUNCATED` / `AGENT_REFUSED`）与用量；若本轮自动尝试 < 2 且错误可重试 → `scheduleTurn` 同 seq、attempt+1；否则 run → stalled（R11） |
| T4 | running | failed | `runtime.failTurn` | G-PERSIST | 记 `errorCode`；可重试（超时、5xx、429、连接错误）且自动尝试 < 2 → `runAfter(2_000 × attempt)` 重新调度；不可重试（400、401/403、配置错误）→ stalled |
| T5 | running | timed_out | `runtime.turnWatchdog` | G-PERSIST；回合仍为 running | 视为可重试失败（同 T4）；之后到达的结果因回合已非 running 被拒 |
| T6 | running | stale | `completeTurn` / `failTurn` / `turnWatchdog` | G-PERSIST 失败（run 已 superseded/cancelled，或约束已变） | 只记录用量与 `errorCode: "STALE_RESULT"`；事件 `turn_stale`（仅当模型确实返回了结果时） |

除 running 外全部是终态。自动重试只在应用层做 1 次（传输层由 SDK 再负责，10 第 10.5 节），避免重试层层相乘。
