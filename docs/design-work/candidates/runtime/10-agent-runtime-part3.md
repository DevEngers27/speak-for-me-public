# 10 代理运行时（part3）：四个运行时函数的精确规格

> 分片清单见 part1（本章共 6 片：part3 函数规格；part4 重试/超时/预算/并发/部署；part5 模型调用规范；part6 用量、缓存、stub、抽取、可观测性）。
> 所在文件：`convex/agentRuntime.ts`（internal mutations 与 helper）、`convex/agentActions.ts`（internal action）。纯函数在 `convex/engine/`。

## 10.6.1 `scheduleAttempt(ctx, turn, opts)`（helper，只在 mutation 内调用）

```ts
type ScheduleOpts = { delayMs: number; maxTokens?: number; retryNote?: RetryNoteCode; reason: "first" | RetryClass };
```

1. 断言 `turn.status === "open"`，`turn.attemptCount < MAX_ATTEMPTS_PER_TURN`（否则抛内部错误，属于代码缺陷）。
2. `deadlineAt = now + delayMs + ATTEMPT_TIMEOUT_MS + WATCHDOG_GRACE_MS`。
3. 插入 `modelCalls`：`{ purpose: "negotiation_turn", roomId, runId, turnId, attemptNo: turn.attemptCount + 1, status: "scheduled", agentMode: run.agentMode, scheduledAt: now, deadlineAt, retryReason: opts.reason, maxTokensOverride: opts.maxTokens, retryNote: opts.retryNote }`。
4. patch turn：`currentAttemptId = attemptId`、`attemptCount += 1`、`retryCounters[opts.reason] += 1`（first 不计）。
5. `execFnId = runAfter(delayMs, internal.agentActions.executeAttempt, { attemptId })`；`watchdogFnId = runAfter(deadlineAt - now, internal.agentRuntime.attemptWatchdog, { attemptId })`；两者写回 attempt。

因为 2–5 与调用它的状态迁移在同一事务里，"turn 已进入下一次尝试"与"下一次尝试已调度"同生同灭。

## 10.6.2 `claimAttempt({ attemptId })`（internal mutation）

守卫（全部读当前值，任一不满足即中止）：

| 守卫 | 条件 | 不满足时 |
| --- | --- | --- |
| G-C1 | `attempt.status === "scheduled"` | 返回 abort（已被 watchdog 或取消处理），不写 |
| G-C2 | `turn.status === "open" && turn.currentAttemptId === attemptId` | attempt → skipped（`SUPERSEDED_ATTEMPT`），不影响 turn |
| G-C3 | `room.currentRunId === run._id && run.status === "running"` | attempt → skipped（`RUN_NOT_RUNNING`） |
| G-C4 | `room.status === "open" && run.constraintsVersion === room.constraintsVersion` | attempt → skipped（`CONSTRAINTS_CHANGED`） |
| G-C5 | live 模式下：`process.env.AGENTS_ENABLED !== "false"` 且 `systemState("agents").circuit !== "open"`（stub 模式跳过本条） | attempt → skipped，`onTurnFailed(turn, "AGENTS_DISABLED" \| "AGENTS_CIRCUIT_OPEN")` |
| G-C6 | `run.modelCallsUsed < MAX_MODEL_CALLS_PER_RUN`；房间计数 `< MAX_MODEL_CALLS_PER_ROOM`；live 模式下部署当日 8 个分片之和 `< AGENT_DAILY_CALL_LIMIT` | attempt → skipped，`onTurnFailed(turn, "CALL_BUDGET_EXCEEDED")` |
| G-C7 | 回合所需输入存在：propose 回合 `run.candidates.length > 0`；review 回合 `turn.baseProposalId` 指向 `run.currentProposalId` | 代码缺陷：attempt → failed（`INTERNAL_PRECONDITION`），`onTurnFailed` |

全部通过后，同一事务内：

1. `context = assembleAgentContext(ctx, { room, run, turn })`（07 §7.5 的唯一入口，显式白名单）。
2. `request = renderTurnRequest(context, scenario.promptPack, runtimeConfig, { maxTokensOverride, retryNote })`（纯函数，part5）。
3. patch attempt：`status: "running"`、`startedAt`、`protocolVersion: PROTOCOL_VERSION`、`model`、`effort`、`maxTokens`、`promptCacheKey`（system 段的稳定标识，便于排查缓存）。
4. patch run：`modelCallsUsed += 1`；live 模式下 `usageCounters` 的房间行与部署分片行 `modelCalls += 1`（分片号 = `attemptNo + hash(attemptId)` 取模 8，确定性）。
5. 返回 `{ kind: "proceed", request, envelope }`。`request` 只在服务端流转，永远不进入任何 public 函数的返回值。

## 10.6.3 `executeAttempt({ attemptId })`（internal action）

```ts
export const executeAttempt = internalAction({
  args: { attemptId: v.id("modelCalls") },
  handler: async (ctx, { attemptId }) => {
    const claim = await ctx.runMutation(internal.agentRuntime.claimAttempt, { attemptId });
    if (claim.kind === "abort") return;
    const t0 = Date.now();
    let outcome: AttemptOutcome;
    let meta: ResponseMeta = {};
    try {
      if (claim.request.mode === "stub") {
        ({ outcome, meta } = await runStub(claim.request, claim.envelope));   // part6
      } else {
        const res = await callClaude(claim.request);                         // part5，maxRetries: 0
        ({ outcome, meta } = classifyResponse(res, claim.request));            // 纯函数，不抛
      }
    } catch (err) {
      ({ outcome, meta } = classifyError(err));                              // 纯函数，不抛
    }
    const latencyMs = Date.now() - t0;
    try {
      await ctx.runMutation(internal.agentRuntime.recordAttemptResult,
        { attemptId, outcome: truncateOutcome(outcome), meta, latencyMs });
    } catch (recordErr) {
      // 只记录最小信息；仍失败则由 watchdog 接手（F13）
      await ctx.runMutation(internal.agentRuntime.recordAttemptFailure,
        { attemptId, code: "RECORD_FAILED", meta, latencyMs }).catch(() => {});
    }
  },
});
```

纪律：action 不 `console.log` 请求、上下文、模型原文；只允许记录 `attemptId`、`turnId`、outcome.kind、HTTP 状态、token 数、耗时（07 §7.9）。`truncateOutcome` 把 `rationale` 截到 1,200 字符、错误消息截到 200 字符并去掉 URL 查询串。

## 10.6.4 `recordAttemptResult` / `recordAttemptFailure`（internal mutation）

`recordAttemptResult({ attemptId, outcome, meta, latencyMs })`：

| 当前 attempt.status | 动作 |
| --- | --- |
| running | → received；写 `outcome`、`usage`、`requestId`、`messageId`、`responseModel`、`stopReason`、`latencyMs`、`finishedAt`；`usageCounters` 累加 token；`applyFnId = runAfter(0, internal.agentRuntime.applyAttemptResult, { attemptId })` |
| timed_out | 只补写 usage / meta，`lateResult: true`；不调度 apply（结果作废，但钱已花，账要记） |
| 其他 | 只补写 usage（如有），记 `lateResult: true` |

`recordAttemptFailure` 只写 `usage`（若 meta 带有）与 `failureNote`，状态不变，留给 watchdog 判定。两者都极小，几乎不会因业务逻辑失败。

## 10.6.5 `applyAttemptResult({ attemptId })`（internal mutation，被调度，exactly once）

守卫（在任何协议写入之前）：

| 守卫 | 条件 | 不满足 → attempt 状态 |
| --- | --- | --- |
| G-A1 | `attempt.status === "received"`（幂等：被重新驱动时已处理过则直接返回） | 不变，返回 |
| G-A2 | `turn.status === "open" && turn.currentAttemptId === attemptId` | stale（`SUPERSEDED_ATTEMPT`） |
| G-A3 | `room.currentRunId === run._id && run.status === "running"` | stale（`RUN_NOT_RUNNING`） |
| G-A4 | `run.constraintsVersion === room.constraintsVersion` | stale（`CONSTRAINTS_CHANGED`） |
| G-A5 | `turn.round === run.currentRound` | stale（`ROUND_ADVANCED`） |
| G-A6 | `attempt.protocolVersion === PROTOCOL_VERSION` | stale（`PROTOCOL_CHANGED`），并按 timeout 类重试一次（F24） |

stale 不写事件（避免刷屏），但 `runs.timeline` 查询会把它列在该 turn 的 attempt 历史里（AC-G7 的"过期回复被拒"可追溯）。

守卫通过后按 `attempt.outcome.kind` 分支：

- **`output`**：`applyTurnOutput(ctx, run, turn, output)`（05 §5.5）。它在本事务内：写 `turn.result`（公开动作 + 候选 + 理由码）与 `turn.privateRationale`；propose 且候选与当前提案不同 → 插入 `proposals` 新版本并 patch `rooms.currentProposalId`、`runs.currentProposalId`；写事件；调用 `advanceProtocol`（安排评审回合或 `concludeRound`）。turn → completed，attempt → accepted。
- **其他 outcome**：`decision = decideRetry(turn, attempt.outcome, budgets)`（part4 §10.7）。`retry` → attempt → failed，`scheduleAttempt(turn, decision)`；`fail` → attempt → failed，`onTurnFailed(ctx, run, turn, decision.failureCode)`；若 `decision.tripCircuit` → patch `systemState("agents")` 为 open（F09）。

`onTurnFailed(ctx, run, turn, code)`：turn → failed、`failureCode = code`。review 回合：本轮记为 `no_recommendation` 并调用 `concludeRound`（F20，fail-open）；propose 回合：run → failed（`failure = { turnId, code }`），写 `run_failed` 事件（F21，fail-closed）。

## 10.6.6 `attemptWatchdog({ attemptId })`（internal mutation，被调度，exactly once）

| attempt.status | 动作 |
| --- | --- |
| accepted / stale / failed / skipped / timed_out | no-op（F18） |
| scheduled / running | → timed_out；若 G-A2…G-A4 仍成立：`decideRetry(turn, { kind: "timeout" })` → 重试或 `onTurnFailed`；不成立：只标 timed_out |
| received | 查 `_scheduled_functions` 中的 `applyFnId`：pending / inProgress → 再登记一次 watchdog（+30 s，最多 1 次，`watchdogRearmed: true`）；failed / canceled / 已二次登记 → attempt → failed（`APPLY_FAILED`），`onTurnFailed(turn, "APPLY_FAILED")`（F14） |

watchdog 是 R6 的实现：它与 attempt 同事务登记，作为被调度的 mutation 恰好执行一次，所以任何 attempt 最晚在 `deadlineAt` 之后得到终态。另有每 5 分钟一次的 `ops.sweepStuckRuns` 巡检（15 §15.3），只做告警与兜底，不是主机制。
