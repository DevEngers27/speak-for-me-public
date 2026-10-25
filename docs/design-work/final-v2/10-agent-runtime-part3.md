# 10 · 代理运行时（part3：action、提交 mutation、看门狗、reconcile）

> 分片清单见 `10-agent-runtime.md` 开头。文件（11 §11.3 / 12 Q15）：注册函数集中在 `convex/agents.ts`（`runAttempt` internal action、`loadTurnContext` internal query、`watchdog` internal mutation）、`convex/turns.ts`（`beginAttempt` / `complete` / `fail`）、`convex/runs.ts`（`reconcile`）；实现放在 `convex/model/agents/`（`lifecycle.ts`、`context.ts`、`modelGateway.ts`、`drivers.ts`、`outputSchema.ts`）。纯函数在 `core/engine/runtime/`（`retryPolicy.ts`、`budget.ts`、`classify.ts`）。

## 10.6 `agents.runAttempt` 与 `agents.loadTurnContext`

### 10.6.1 `agents.loadTurnContext({ attemptId })`（internal query）

- 守卫：与 G0–G3 相同（attempt `running` 且是当前 attempt；run 当前且 `negotiating`；`activeTurnSeq` 相等；回合 cv 快照等于房间 cv）。任一不符返回 `null`。
- 返回（全部是 Convex 值）：`{ agentMode, turnSpec, input: AgentTurnInput, retryNote, model, effort, maxTokens, promptVersion }`。`AgentTurnInput` 由 07 §7.14 的白名单组装函数产出（本方简报、披露给本方的 shared facts、候选快照、`<room_state>` 所需的按受众裁剪的轮次结果、`clarifyAnswers`），**不含 Zod 对象、不含 JSON Schema**（R13）。
- 只读，不写；action 与提交 mutation 之间的状态变化由提交时的守卫兜底。

### 10.6.2 `agents.runAttempt({ attemptId, actorUserId })`（internal action，默认运行时；SDK 不可打包时只把本文件移入 `"use node"`，待验证 V2）

```ts
export const runAttempt = internalAction({
  args: { attemptId: v.id('attempts'), actorUserId: v.union(v.id('users'), v.null()) },
  returns: v.null(),
  handler: async (ctx, { attemptId, actorUserId }) => {
    const c = await ctx.runQuery(internal.agents.loadTurnContext, { attemptId });
    if (c === null) {                                    // 回合已不是当前：不调模型，立即终结 attempt 并触发 reconcile
      await ctx.runMutation(internal.turns.fail, { attemptId, actorUserId, outcome: { kind: 'stale_context' }, latencyMs: 0 });
      return null;
    }
    const t0 = Date.now();
    let outcome: AttemptOutcome;
    const spec = c.turnSpec;
    try {
      if (c.agentMode === 'live' && process.env.AGENTS_ENABLED === 'false') {
        outcome = { kind: 'error', errorCode: 'agents_disabled', response: null };
      } else {
        const schema = selectOutputSchema(buildTurnZod(spec, true), spec);       // 05 §5.4.3 / §5.4.5，只在 action 内构造
        const driver = driverFor(c.agentMode);                                   // live | stub；replay / scripted 只在测试注入
        const res = await driver.decide({ input: c.input, schema, spec, retryNote: c.retryNote });
        outcome = classifyResponse(res, spec, c.input);                          // 05 §5.6.1 步骤 2–9；纯函数，不抛
      }
    } catch (err) {
      outcome = classifyError(err);                                              // §10.15；纯函数，不抛，丢弃原消息
    }
    const latencyMs = Date.now() - t0;
    const schemaVersion = turnSpecKey(spec);
    try {
      if (outcome.kind === 'move') {
        await ctx.runMutation(internal.turns.complete,
          { attemptId, actorUserId, move: outcome.move, response: outcome.response, schemaVersion, latencyMs });
      } else {
        await ctx.runMutation(internal.turns.fail, { attemptId, actorUserId, outcome, schemaVersion, latencyMs });
      }
    } catch (commitErr) {                                // 提交 mutation 自身抛错 = 缺陷；绝不在本 action 内再调模型
      opsLog('turn_commit_threw', { attemptId, errorClass: errorClassOf(commitErr), ...usageLogFields(outcome) });
      await ctx.runMutation(internal.turns.fail, { attemptId, actorUserId, schemaVersion, latencyMs,
        outcome: { kind: 'error', errorCode: 'internal', response: responseOf(outcome) } }).catch(() => {});
      // 仍失败：看门狗读到 success 而 attempt 仍 running → internal；usage 只保留在 opsLog 字段里
    }
    return null;
  },
});
```

纪律：action 内禁止 `console.*` 输出请求、上下文、模型原文；日志只走 `opsLog` 白名单字段（§10.20）。`outcome.response.rawText` 只随提交 mutation 写入 `rawOutputs`（≤ 64 KiB，超出截断并记 `truncated`，03 §3.8）。

## 10.7 `turns.complete` / `turns.fail`（internal mutation）

### 10.7.1 参数

```ts
import { usageV, agentMoveV, reasonCodeV } from '../../lib/validators';   // 03 §3.4：usageV 是五个整数字段（thinkingTokens 缺失记 0），没有 serviceTier
const modelResponseV = v.object({ usage: v.union(usageV, v.null()), stopReason: v.union(v.string(), v.null()),
  stopCategory: v.union(v.string(), v.null()), requestId: v.union(v.string(), v.null()),
  messageId: v.union(v.string(), v.null()), responseModel: v.union(v.string(), v.null()),
  rawText: v.union(v.string(), v.null()), rationaleTruncated: v.boolean() });
const failOutcomeV = v.union(
  v.object({ kind: v.literal('invalid_output'), reasonCode: reasonCodeV, response: modelResponseV }),   // output.* / action.*
  v.object({ kind: v.literal('refused'), response: modelResponseV }),
  v.object({ kind: v.literal('timeout'), errorCode: attemptErrorCodeV, response: v.union(modelResponseV, v.null()) }),
  v.object({ kind: v.literal('error'), errorCode: attemptErrorCodeV, httpStatus: v.optional(v.number()),
             retryAfterMs: v.optional(v.number()), response: v.union(modelResponseV, v.null()) }),
  v.object({ kind: v.literal('stale_context') }),
);
// turns.complete: { attemptId, actorUserId, move: agentMoveV, response: modelResponseV, schemaVersion: v.string(), latencyMs: v.number() }
// turns.fail:     { attemptId, actorUserId, outcome: failOutcomeV, schemaVersion: v.optional(v.string()), latencyMs: v.number() }
```

### 10.7.2 步骤（两者共用前四步）

| # | 步骤 | 读 | 写 | 不满足时 |
| --- | --- | --- | --- | --- |
| 1 | 读 attempt、turn、run、room；要写时取写锁：房间 `open` → `openRoomTx(allow: ['open'])`，`executed` / `closed` → 只许记账写的结算变体 `settleAttemptTx`（§10.8） | attempts、turns、runs、rooms | `rooms.writeSeq` | 行不存在 → `internal` |
| 2 | **G0**：`attempt.status === 'running'` 且 `turn.currentAttemptNo === attempt.attemptNo` | — | 若 attempt 尚无 usage 而本次带有 → 补写 usage、`lateUsage: true`，经 `settleAttemptOnce` 结算（`unknown → known` 只调差额，§10.12.2）；若本次是未发请求的结果（`stale_context`、`agents_disabled`、`config_invalid`）且 `costState === 'unknown'` → `settleAttemptOnce(…, 'not_sent')`，推进为 `known`、`costMicroUsd = 0`（§10.12.2） | 返回；不写事件；调用 `runs.reconcile`（廉价、幂等） |
| 2b | 仅 `turns.complete`：`rollLocalDateTx(room)`（09 §9.6.7 同一 helper；跳过非 `open` 房间）——`todayInTimeZone(now, room.timeZone) > room.localDate` 时推进 `localDate`。negotiating 期间没有 `pending_approval` 提案或 open 请求，翻转判定通常不成立，只推进不 bump；万一 bump，D06 在同事务 supersede 本 run，下一步 G1 不成立 | rooms、bump 所需各表 | `rooms.localDate`；极少数情况下 bump | — |
| 3 | **G1** `room.currentRunId === run._id && run.status === 'negotiating'`；**G2** `run.activeTurnSeq === turn.turnSeq`；**G3** `turn.constraintsVersion === room.constraintsVersion` | — | attempt → `stale`（`errorCode` 不写，`staleGuard: 'G1' \| 'G2' \| 'G3'`）、usage 照记、结算；**G2 / G3 失败且回合非终态 → 同事务 `setStatus(turn, scheduled \| running → stale)`**（否则 running 回合带着 stale attempt 永久停留，invariants-02）；事件 `turn_rejected_stale { runNo, turnSeq, guard }`（03 §3.11.1）；之后调用一次 `runs.reconcile(run._id)`（走 stale 回合分支 `replaceTurnTx`；run 已终态时为空操作） | — |
| 4 | 写 usage、`responseModel`、`stopReason`、`stopCategory`、`requestId`、`messageId`、`latencyMs`、`schemaVersion`、`rawOutputRef`（插 `rawOutputs`）；按 §10.16 计算 `costMicroUsd`，经 `settleAttemptOnce` 结算（§10.12.2：带 usage → `reserved → known`；未发请求 → `reserved → known`、`costMicroUsd = 0`、释放预留；无响应 → `reserved → unknown`，暴露不释放） | spendCounters | attempts、rawOutputs、runs、spendCounters | — |

`turns.complete` 的后续：

5. 以存储的 turn 为准再跑 `validateMoveSemantics`（05 §5.6.2）。有问题 → attempt `invalid_output`（`reasonCode` = 第一个码）→ `decideRetry`（§10.10）：`retry` → `beginAttemptTx(turn, { origin: 'auto_retry', delayMs: 0, retryNote })`；`fail` → turn `failed` → 05 `onTurnFailed`（`agent_failed` 请求）。
6. attempt → `completed`；turn → `completed`，`result = move`（恰为 `agentMoveV`，含 rationale，本方可见）；服务端处置（所选候选、`proposalId`、`blockedCandidateKey`、`counterForwarded` 等）只写 `turn.outcome`（03 §3.8、05 §5.8.4）。
7. 05 `applyMove(ctx, { run, turn, move, actorUserId })`：可能插入提案、同事务创建下一回合并 `beginAttempt`、`resolveRound`、run 迁移、开请求、写事件（全部在本事务，任一步抛错整体回滚 → action 走 §10.6.2 的 catch 分支）。

`turns.fail` 的后续：

5. `stale_context` → attempt `stale`（无 usage；按未发请求结算，`costMicroUsd = 0`、释放预留，§10.12.2），`runs.reconcile`。
6. 其余 → attempt 状态按 outcome（`invalid_output` / `refused` / `timeout` / `error`），写 `errorCode`（reasonCode 或 `AttemptErrorCode`）、`httpStatus`、`retryAfterMs`；`decideRetry` → `retry` 则取 `delayMs = max(decision.delayMs, (attempt.physicalLeaseUntil ?? now) − now)`（租约内不开同回合 `auto_retry`：`decideRetry` 是纯函数、拿不到租约，下限在这里施加，§10.8；看门狗经 `handleFailure` 走同一步），写 `turn.waitingReason: 'backoff'`、`beginFnId = runAfter(delayMs, turns.beginAttempt, { turnId, origin: 'auto_retry', actorUserId, retryNote })`（退避期间回合保持 `running`，04 §4.4）；`fail` 则 turn `failed`、`run.lastFailure = { code, at }` → 05 `onTurnFailed`（`agent_failed` 请求；run 上限则 customer 的 `rounds_exhausted`）。
7. `errorCode ∈ {bad_request, auth, quota_exhausted, model_not_found, context_overflow, unexpected_stop, internal}` → `opsLog` 告警（§10.20）。

**幂等**：业务身份是 `(runId, turnSeq, attemptNo)`；同一 attempt 的第二次提交必然命中 G0，且不会重复记 usage（G0 只在 usage 为空时补写）。两者都是 internal mutation，只抛 `ConvexError({ code: 'internal' })`（构造器清洗），没有面向用户的失败码。

## 10.8 `agents.watchdog({ attemptId })`（internal mutation，被调度 → 恰好执行一次）

```ts
export const watchdog = internalMutation({
  args: { attemptId: v.id('attempts') },
  handler: async (ctx, { attemptId }) => {
    const a = await ctx.db.get(attemptId);
    if (!a || a.status !== 'running') return;                      // 正常情况：已终态（含被新 attempt 取代后的旧看门狗）；只读返回、不加写锁
    const id = ctx.db.system.normalizeId('_scheduled_functions', a.actionFnId);
    const sf = id ? await ctx.db.system.get(id) : null;
    const kind = sf?.state.kind;                                    // pending | inProgress | success | failed | canceled
    const room = (await ctx.db.get(a.roomId))!;                     // 确定要写才加写锁；两种写锁都 rooms.writeSeq + 1（INV-M1）
    const tx = room.status === 'open' ? await openRoomTx(ctx, a.roomId, { allow: ['open'] })
                                      : await settleAttemptTx(ctx, a.roomId);   // executed / closed：只许记账写的结算变体（03 §3.3.2）
    const rctx: RoomCtx = { ...ctx, tx };
    const now = Date.now();
    const physicalOpen = kind === 'pending' || kind === 'inProgress';
    const seenAt = kind === 'inProgress' ? (a.inProgressSeenAt ?? now) : a.inProgressSeenAt;   // 实际开始不晚于首次看到 inProgress
    if (physicalOpen && a.watchdogArmCount < MODEL_BUDGET.watchdogMaxRearms && await passesG1toG3(rctx, a)) {   // 代次仍当前才重登记
      const fnId = await ctx.scheduler.runAfter(WATCHDOG_REARM_MS, internal.agents.watchdog, { attemptId });
      await rctx.tx.patch('attempts', attemptId, { watchdogFnId: fnId, watchdogArmCount: a.watchdogArmCount + 1,
                                                  deadlineAt: now + WATCHDOG_REARM_MS, inProgressSeenAt: seenAt });
      return;
    }
    if (physicalOpen)                                               // 逻辑终结 ≠ 物理结束：记下物理租约
      await rctx.tx.patch('attempts', attemptId, { inProgressSeenAt: seenAt,
        physicalLeaseUntil: (seenAt ?? now) + MODEL_BUDGET.assumedActionLimitMs + MODEL_BUDGET.watchdogSlackMs });
    const outcome: FailOutcome =
      kind === 'failed'  ? { kind: 'error', errorCode: 'action_crashed', response: null } :
      kind === 'success' ? { kind: 'error', errorCode: 'internal', response: null } :          // action 结束却没有提交
      kind === 'canceled' || sf === null ? { kind: 'error', errorCode: 'internal', response: null } :
                           { kind: 'timeout', errorCode: 'watchdog_timeout', response: null }; // 重登记用尽仍在排队或运行
    await handleFailure(rctx, attemptId, outcome, null);            // 与 turns.fail 步骤 1–7 同一实现（含 G1–G3 → stale + reconcile；无 usage → reserved → unknown，§10.12.2）
  },
});
```

- 计时从 attempt 创建（调度）开始；调度积压时 `pending` 让它重登记而不是误判超时（run-lifecycle-review r07），重登记上限 3 次（canon D07）。§10.11 的 I2 只在调度没有积压时保证"最终判定晚于 action 必然结束"：积压超过 `WATCHDOG_FINAL_MS − assumedActionLimitMs − watchdogSlackMs`（约 320 s）时，action 可能在最终判定时仍在排队或运行。所以 `timeout` 只是**逻辑**终结——attempt 进入终态、回合按失败路径继续——物理 action 的结束由租约 `physicalLeaseUntil = (inProgressSeenAt ?? 判定时刻) + assumedActionLimitMs + watchdogSlackMs` 表达：判定后才开始的 action 在 `loadTurnContext` 因 G0 返回 null、不调模型；判定前一刻才开始的也在租约内结束。租约内该 attempt 的美元暴露以 `unknown` 继续计入准入（§10.12.2），同一回合的 `auto_retry` 不早于租约到期（§10.10.2），排空计数把租约未到期且调度仍 `pending` / `inProgress` 的终态 attempt 算作在途（§10.12.3）。
- **写锁与终态房间**：重登记、租约与终结都经 `ctx.tx` 写，从不直接 `ctx.db.patch`（03 §3.3.2 写门面）。写锁的选法与 `turns.complete` / `turns.fail` 相同：房间 `open` → `openRoomTx(…, { allow: ['open'] })`；房间 `executed` / `closed` → 结算变体 `settleAttemptTx`（同样 `rooms.writeSeq + 1`，只许写 attempt 的终态 / 用量 / 成本状态 / 看门狗与租约字段、run 与 `spendCounters` 的美元字段和 `turn_rejected_stale` 事件，不调度任何函数）。终态房间里 run 已终态、G1 必然不成立，所以这条路径只记账，`runs.reconcile` 随即 noop，迟到结果在关房后照样入账。重登记前先跑 G1–G3：房间 / run / 回合已不是当前 → 不再重登记，直接走失败路径（attempt `stale`），物理暴露照上条保留。
- 从不调用 `scheduler.cancel`；新 attempt 不取消旧看门狗，旧看门狗因 G0 成为空操作。
- `actionFnId` 存为字符串，读取时用 `normalizeId` 校验并取得带类型的 Id（`v.id('_scheduled_functions')` 作应用表字段待验证，V3）。

## 10.9 `runs.reconcile({ runId })`（internal mutation；helper `reconcileRun(ctx, runId, why)`）

实现就是 04 §4.3.5 的 `reconcileRun`（04 是所有者，本节不另写代码，只解释运行时含义）：先用**只读**的 `decideReconcile(room, run, turn)` 判定分支，`noop` 直接返回、不加写锁；确定要写时才 `openRoomTx`，被 `turns.complete` / `turns.fail` / `agents.watchdog` 内联调用时复用调用方已持有的 `RoomTx`（`RoomCtx`，03 §3.3.2）。分支（首个命中即返回）：

| 判定 | 动作 | 运行时含义 |
| --- | --- | --- |
| `run.constraintsVersionAtStart ≠ room.constraintsVersion` | `opsLog(ctx, 'constraints_drift', …)` → `disposeCurrentRun(…, 'constraints_changed')` → `react(…, { depth: 0, runCause: 'constraints_changed' })` | 纵深防御：某条写路径递增了 cv 却没 supersede（D06 被破坏），告警 |
| 无当前回合或回合 `completed` | `advanceRun` | 推进被遗漏（05 `applyMove` 的推进部分，幂等） |
| 回合 `stale`；或回合 `running` 但当前 attempt 已 `stale` | `replaceTurnTx` | 同 role / kind / round 新回合，按当前状态重算快照 |
| 回合 `failed` | 转 `needs_input` + 失败方 `agent_failed`（已有 open 请求则不再开） | R6 |
| 有 running attempt；或 `beginFnId` 指向 pending 调度（`backoff` / `spend_deferred` / `run_cap`）；或 `waitingReason: draining` 且仍在排空 | `noop` | 看门狗 / 已登记的延迟调度 / 解除排空负责 |
| 其余 | `beginAttemptTx(…, { origin: currentAttemptNo === 0 ? 'turn_start' : 'auto_retry', delayMs: 0, actorUserId: null, why })` | 下一 attempt；上限 → R6（B4 / B4a / B5） |

- 调用者：守卫命中的全部路径（`turns.complete` / `turns.fail` / 看门狗 / `stale_context`）、`ops.setDraining(false)`（经一次立即的 `ops.livenessSweep`，12 §12.20）、每 5 分钟的 `ops.livenessSweep`（`runs.by_status` 中全部 `negotiating` 的 run 逐个扇出 `runs.reconcile`；真实修复写 `opsLog('stuck_run')` 并计入告警，15 §15.8）。
- reconcile 新开的回合与 attempt 同样受 `beginAttempt` 的全部上限约束，所以它不可能制造无限调用。
