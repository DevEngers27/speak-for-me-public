# 专题深潜：run / turn 生命周期与调度（part 2/3）：具体设计

## 3. 表

完整 validator 见 `run-lifecycle/schema.ts`。要点：

| 表 | 一行是什么 | 关键字段 | 索引 | 唯一性由谁守 |
| --- | --- | --- | --- | --- |
| `runs` | 一次协商运行 | `status`、`trigger`、`agentMode`（快照）、`constraintsVersionAtStart`、`round/maxRounds`、`nextTurnSeq`、`callCount/maxCalls`、`previousRunId/supersededByRunId`、`endedReason`、`updatedAt` | `by_room_and_startedAt`、`by_status_and_updatedAt` | "每房间至多一个活跃 run"：只有 `startRunInternal` 插入 runs；它的两个调用者 `startRun`（先查 `room.currentRunId` 是否活跃）与 09 的 bumpConstraints（同事务先 `supersedeRun`）都读写 `rooms` 文档，OCC 串行化 |
| `agentTurns` | 一个 slot 的一次 attempt | `turnSeq`（step）、`role`、`attempt`、`stepKind`、`origin`、`status`、`agentMode`、`constraintsVersion`、`baseProposalId/Version`、`output`、`resultProposalId`、`errorCode`、`dispatchRef`、`deadlineAt` | `by_run_and_turnSeq_and_role_and_attempt`、`by_room_and_mode_and_createdAt`、`by_status_and_deadlineAt` | `(runId, turnSeq, role, attempt)`：只有 `createAttempt` 插入；它的调用者（beginStep、handleTurnFailure、retryTurn）都先 patch 同一 run 文档（`reserveCall` 写 `callCount`），OCC 串行化；attempt 号取自上一 attempt + 1 |
| `modelCalls` | 一次逻辑模型调用的用量（只追加） | 见 §3.1 | `by_turn`、`by_day`、`by_room_and_day` | 不需要唯一：同一 attempt 至多一个提交 mutation 成功（G0），失败/迟到分支各插一行，均由 action 的单次 runMutation 触发 |
| `usageCounters` | 每 UTC 日一个全局计数 | `key`、`calls` | `by_key` | 只有 `reserveCall` 写 |

`rooms` 上本专题依赖：`status`、`currentRunId`（最新 run，任何状态）、`constraintsVersion`、`currentProposalId`（由 05/08 维护）。

### 3.1 用量记录字段（`modelCalls`）

| 字段 | 来源 | 用途 |
| --- | --- | --- |
| `mode`、`modelRequested`、`modelActual` | 配置；`msg.model` | 区分 stub；回退开启时实际模型可能不同 |
| `effort`、`maxTokens` | 请求参数 | 成本与延迟归因 |
| `stopReason` | `msg.stop_reason` | 拒答、截断统计 |
| `requestId`、`messageId` | `msg._request_id`（不可枚举）、`msg.id` | 与 Anthropic 控制台对账 |
| `inputTokens`、`cacheCreationInputTokens`、`cacheReadInputTokens`、`outputTokens`、`thinkingTokens` | `usage.*`、`usage.output_tokens_details.thinking_tokens` | 成本换算；缓存命中断言（第二次同前缀请求 `cacheReadInputTokens > 0`） |
| `fallbackIterations` | `usage.iterations.length` | 若开启服务端回退 |
| `latencyMs` | action 内墙钟（含 SDK 内部重试） | p50/p95 |
| `outcome`、`errorCode`、`httpStatus` | 分类结果 | 失败率、迟到率 |
| `attempt`、`role`、`turnId`、`runId`、`roomId`、`day` | turn 快照 | 聚合 |

SDK 内部 HTTP 重试次数对应用不可见（04 §4.6），不存；单次 SDK 超时导致的重试只体现在 `latencyMs` 上。

## 4. 状态机

### 4.1 run 迁移表（代码表见 `run-lifecycle/state.ts`）

| from | to | 触发者 / 函数 | 守卫 |
| --- | --- | --- | --- |
| — | negotiating | 成员 `startRun`；系统 `startRunInternal`（09 约束变更、05 回答改变约束） | room open；无活跃 run（startRun 有则直接返回它）；`assertRoomReadyForRun`；live 时 `AGENTS_ENABLED` |
| negotiating | pending_approval | 系统 `maybeAdvance` → `applyDecision(await_approval)` | step 内每个 slot 的最新 attempt 都 succeeded；05 判定存在可审批提案 |
| negotiating | needs_input | 系统 `applyDecision(needs_input)` | 05/06 判定无可行组合或轮次用尽；同事务创建 humanRequest |
| negotiating | failed | 系统 `failRun` | 某 slot 失败且不可自动重试/自动重试已用；或调用上限 |
| negotiating / pending_approval / needs_input / failed | superseded | 09 `bumpConstraints` → `supersedeRun` | 同事务递增 `room.constraintsVersion` 并启动替代 run |
| 同上 | cancelled | 成员 `cancelRun` | 成员身份 |
| pending_approval | confirmed | 08 最后一次审批的执行 mutation | 审批/执行守卫（不是本专题的 G0–G3） |
| pending_approval | negotiating | 08 拒绝 → `resumeRun(rejected)` | `round + 1 < maxRounds` |
| pending_approval | needs_input | 08 拒绝 → `resumeRun(rejected)` | 轮次用尽 |
| needs_input | negotiating | 05 `answerRequest`（不改变约束）→ `resumeRun(request_answered)` | 回答者是目标角色（05/07） |
| failed | negotiating | 成员 `retryTurn` | run 是当前 run；当前 step 有 failed/invalid_output 的 slot；上限未超 |

终态：superseded、cancelled、confirmed。修订已确认的协议 = 新 run（P1，trigger 届时新增）。

### 4.2 turn 迁移表

| from | to | 函数 | 条件 |
| --- | --- | --- | --- |
| — | running | `createAttempt` | `reserveCall` 通过 |
| running | succeeded | `completeTurn` | G0–G3 通过；06 `validateAgentOutput` 通过 |
| running | invalid_output | `completeTurn`（规则拒绝）/ `failTurn`（schema_invalid、max_tokens） | G0–G3 通过 |
| running | failed | `failTurn` / `turnWatchdog` | G0–G3 通过 |
| running | stale | `completeTurn` / `failTurn` / `turnWatchdog`（G1–G3 不通过）；`supersedeRun` / `cancelRun`（批量） | — |

invalid_output 与 failed 是 attempt 的终态；"重试"永远是新的一行（attempt + 1），旧行不改——满足"历史不可篡改"，也让每次计费调用都有自己的行。

### 4.3 守卫 × 函数矩阵

| 函数 | G0 turn running | G1 current run & accepting | G2 step 未推进 | G3 约束版本 | 其他 |
| --- | --- | --- | --- | --- | --- |
| `loadTurnContext`（query，早退） | 是 | 是 | 是 | 是 | 不通过返回 null，action 不调模型 |
| `completeTurn` | 是 | 是 | 是 | 是 | + 06 业务校验 |
| `failTurn` | 是 | 是 | 是 | 是 | 不通过 → stale，只记用量 |
| `turnWatchdog` | 是（不通过则空操作） | 是 | 是 | 是 | 读 `_scheduled_functions` 区分 timeout / action_crashed |
| `retryTurn` | — | room.currentRunId 且 status = failed | 针对 `nextTurnSeq` 的 slot | — | 成员身份；上限 |
| `startRun` | — | — | — | — | 成员；无活跃 run |
| `cancelRun` | — | run 活跃 | — | — | 成员 |
| 08 approve / execute | — | — | — | — | 审批/执行守卫（另一组） |

## 5. 函数职责

| 函数 | 类型 | 职责 | 读 | 写 | 调度 |
| --- | --- | --- | --- | --- | --- |
| `startRun` | public mutation | 幂等创建 run 并开始首个 step | rooms、runs、briefs（经 06） | runs、rooms.currentRunId、agentTurns、usageCounters、events | runTurn ×N、watchdog ×N |
| `startRunInternal` | helper | 同上，供 09/05 在其事务内调用 | 同上 | 同上 | 同上 |
| `beginStep` | helper | 为 step 的每个角色 `createAttempt` | runs | agentTurns、runs.callCount | 同上 |
| `scheduleAttempt` | helper | **唯一调度点**：`runAfter(delay, runTurn)` + `runAfter(delay + WATCHDOG_DELAY_MS, turnWatchdog)` | — | agentTurns.dispatchRef | 2 个 |
| `runTurn` | internal action | 早退检查 → stub 或 live 调用 → 分类 → 一次 runMutation | 经 query | 经 mutation | — |
| `loadTurnContext` | internal query | G0–G3 + 07 组装本方上下文 | rooms、runs、agentTurns、briefs、proposals、facts | — | — |
| `completeTurn` | internal mutation | 守卫 → 06 校验 → 05 持久化（可能追加提案）→ 记用量 → `maybeAdvance` | 全部相关 | agentTurns、proposals、events、modelCalls、runs | 下一 step 或无 |
| `failTurn` | internal mutation | 守卫 → `handleTurnFailure`（自动重试或 failRun） | 同上 | agentTurns、modelCalls、runs、events | 重试 attempt 或无 |
| `turnWatchdog` | internal mutation | 回合仍 running 则按 timeout/action_crashed 失败 | agentTurns、`_scheduled_functions` | 同 failTurn | 同 failTurn |
| `retryTurn` | public mutation | failed → negotiating，为当前 step 的失败 slot 建新 attempt | runs、agentTurns | 同上 | runTurn、watchdog |
| `cancelRun` | public mutation | → cancelled，running 回合标 stale | runs、agentTurns | runs、agentTurns、events、humanRequests（经 05） | 无（D7） |
| `supersedeRun` | helper（09 调） | → superseded，running 回合标 stale | 同上 | 同上 | 无 |
| `resumeRun` | helper（08/05 调） | 同一 run 回到 negotiating 并开始新 step | runs | runs、agentTurns | runTurn、watchdog |

`maybeAdvance` 的推进规则：只有当 `nextTurnSeq` 这一 step 的**每个角色的最新 attempt 都是 succeeded** 时才调用 05 的 `planAfterStep`，并在同一事务里 `nextTurnSeq += 1`。之后要么开始下一 step，要么转 pending_approval / needs_input。因此 `nextTurnSeq` 在 step 关闭时递增一次，`resumeRun` 不再改它。

## 6. 时序

### 6.1 正常路径（首场景一轮）

1. 成员调用 `startRun` → 插入 run（negotiating，`nextTurnSeq = 0`，`agentMode` 快照）→ 05 `planFirstStep` 返回 `{ roles: [provider], stepKind: propose }` → `createAttempt`：`reserveCall`（callCount + 1；live 时房间日计数、全局计数）→ 插入 turn（running）→ `scheduleAttempt`。事务提交后两个调度生效（`scheduler.d.ts:64-65,74-76`："after this mutation commits"）。
2. `runTurn(provider#1)`：`loadTurnContext` 通过 → 调模型 → `stop_reason = end_turn` → safeParse 通过 → `completeTurn`。
3. `completeTurn`：G0–G3 通过 → 06 校验（itemKeys 在目录内、日期合法、金额由目录求和）→ 05 追加提案 v1 → turn succeeded → modelCalls(accepted) → `maybeAdvance`：step 0 全部 succeeded → `planAfterStep` 返回 `{ roles: [customer, finance], stepKind: evaluate }` → `nextTurnSeq = 1` → 两个 `createAttempt`。
4. 两个 `runTurn` 并行。两个 `completeTurn` 都 patch `runs.updatedAt` 并读对方的 turn 行，OCC 让后提交者重试；重试时它看到对方已 succeeded，于是只有它调用 `planAfterStep`（例如 `await_approval`）→ `nextTurnSeq = 2`，run → pending_approval。
5. watchdog 到期时回合都已终态 → 空操作。

### 6.2 action 丢失（部署打断 / 平台超时）

1. `runTurn(customer#1)` 在模型调用中被打断；没有 catch，也没有回调（`scheduler.d.ts:20-21`）。
2. `deadlineAt` 到，`turnWatchdog` 运行（scheduled mutation exactly once，`scheduler.d.ts:18-19`）：turn 仍 running → 读 `_scheduled_functions`：`failed` → `action_crashed`，否则 `timeout` → `handleTurnFailure`：origin 是 step_start → 自动重试：`createAttempt(customer#2, origin auto_retry, delay appRetryDelayMs)`。
3. 若原 action 其实还活着并在之后返回：`completeTurn(customer#1)` 的 G0 不通过 → 只插 modelCalls(discarded_stale)。

### 6.3 约束变更发生在回合进行中

1. provider#1 在途；finance 调用 09 的 `updateBudget` → `bumpConstraints`：`room.constraintsVersion += 1` → `supersedeRun`（run → superseded，provider#1 → stale/run_superseded）→ `startRunInternal(trigger: constraint_change, previousRunId)` → 新 run 的首 step 被调度。同一事务。
2. provider#1 的 action 返回 → `completeTurn` G0 不通过 → modelCalls(discarded_stale)。若 provider#1 还没开始，`loadTurnContext` 返回 null，action 不调模型。

### 6.4 并行 step 中一个失败

1. customer#1 返回 refusal → `failTurn(refusal)` → 不可自动重试 → `failRun`（run → failed，事件 turn_failed）。
2. finance#1 随后成功 → G1 允许 failed → 持久化 succeeded；`maybeAdvance` 发现 customer 最新 attempt 是 failed → 不推进。
3. 成员点 Retry → `retryTurn`：run → negotiating，只为 customer 建 attempt #2（origin user_retry）。成功后 `maybeAdvance` 推进。
