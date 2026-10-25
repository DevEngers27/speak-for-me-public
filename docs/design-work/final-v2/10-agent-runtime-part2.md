# 10 · 代理运行时（part2：生命周期时序、`turns.beginAttempt`）

> 分片清单见 `10-agent-runtime.md` 开头。

## 10.4 生命周期时序

### 10.4.1 标准路径（首个场景，首轮收敛）

| 步 | 触发者 → 函数 | 读 | 写 / 调度 | 失败与失败后状态 |
| --- | --- | --- | --- | --- |
| 1 | 成员 → `runs.start({ roomId })`（公开 mutation，完整参数归 12）；或最后一项就绪条件满足的那次写入 → `openIfReady` → `bump(room_opened)` → `react()` → `startRunTx(cause: room_opened)`；任一 bump 后 09 的 `react()` → `startRunTx(cause: constraints_changed)`（canon §1.6：`startRunTx` 是建 run 的唯一 helper） | rooms、runs（当前）、briefs、catalogItems、ledgerEntries、sharedFacts、opsFlags、events（节流计数） | 已有非终态 run → 直接返回它（`created: false`）；否则插入 run（`negotiating`、`agentMode` 快照、`maxAttempts`、`spendCapMicroUsd`、`constraintsVersionAtStart` = 函数内重读的 `room.constraintsVersion`）、`rooms.currentRunId`、事件 `run_started` → 05 `planFirstStep` → 创建回合 T1（`scheduled`）→ `beginAttemptTx(T1)` | 房间非 `open` → `run.invalid_state`；`draining`（仅公开入口）→ `run.draining`；节流 → `run.rate_limited`；以上均无写入 |
| 2 | `beginAttempt`（helper，同事务） | turn、run、room、opsFlags、spendCounters、本房间最近 7 个 run（B6a） | 插入 attempt（`running`）、turn → `running`、run `attemptCount + 1` 并预留美元、全局计数预留；`actionFnId = runAfter(0, agents.runAttempt)`、`watchdogFnId = runAfter(WATCHDOG_FIRST_MS, agents.watchdog)` | mutation 回滚则两个调度一起消失（inputs/05 B1），不会出现孤儿调度 |
| 3 | 调度器 → `agents.runAttempt`（internal action）→ `runQuery(agents.loadTurnContext)` | 07 白名单内的本方上下文 | — | 守卫不成立 → 返回 null → action 调 `turns.fail(stale_context)`，不调模型 |
| 4 | action → 驱动（live：`modelGateway`；stub：`StubDriver`） | — | — | 一切响应与异常都在 action 内分类成 outcome（§10.10、§10.15），**不抛出** |
| 5 | action → `turns.complete`（internal mutation） | attempt、turn、run、room、05 推进所需各表 | 守卫 G0–G3 → 写 usage 并结算美元 → 语义复核 → attempt `completed`、turn `completed` → 05 `applyMove`：插提案、同事务创建下一回合并 `beginAttempt`，或 `pending_approval` / `needs_input` | 守卫失败 → attempt `stale` + `runs.reconcile`；语义失败 → `invalid_output` + 自动重试 |
| 6 | 看门狗到期 | attempt | — | attempt 已终态 → 空操作 |

墙钟（待实测，spikes §8 #15）：步 1–2 数十毫秒；每个回合约 6–20 s（Opus 5.5、effort medium）；首轮串行 3 个回合约 25–50 s。界面在某回合超过该类回合 p95 后显示 "Taking longer than usual"，看门狗重登记时显示 "Retrying"。

### 10.4.2 action 丢失（部署打断 / 平台超时）

1. `runAttempt` 在模型调用中被打断，没有 catch，也没有回调。
2. `WATCHDOG_FIRST_MS` 到期，看门狗读 `_scheduled_functions`：`inProgress` → 重登记（action 还活着，它自己的 AbortSignal 保证会结束）；`failed` → `action_crashed`。
3. `action_crashed` 走 `turns.fail` 的同一处理：attempt → `error`，`decideRetry` 允许 1 次自动重试 → 新 attempt（`origin: 'auto_retry'`，延迟 2 s）。
4. 原 action 若其实还活着并在之后返回 → `turns.complete` 的 G0 不通过 → 只补记 usage（`lateUsage: true`）。

### 10.4.3 约束在回合进行中变化

1. provider 回合在途；finance 调 `budget.setCap` → `constraints.bump`（09）同事务：run → `superseded`、其非终态回合 → `stale`、open 请求 → `superseded`，`react()` 开新 run，新 run 的首个回合被 `beginAttempt` 调度。
2. 旧 action 若尚未开始：`loadTurnContext` 返回 null → `turns.fail(stale_context)` → attempt `stale`，不调模型。
3. 旧 action 已在调用模型：返回后 `turns.complete` 的 G1（run 不是当前）不通过 → attempt `stale`、usage 照记、写 `turn_rejected_stale` 事件 → `runs.reconcile(旧 runId)` 对非 negotiating 的 run 是空操作。新 run 不受影响。

### 10.4.4 拒答 → 人决定重试

1. customer 回合 `stop_reason: refusal` → `turns.fail(refused)`：attempt `refused`，不自动重试 → turn `failed` → 05 `onTurnFailed`：run → `needs_input` + `agent_failed` 请求给 customer（`retry_turn` / `end_run`）。
2. customer 成员点 "Retry"（`runs.retryTurn` 或回答请求，二者走同一 helper）→ run → `negotiating`，为 customer 新开同 kind、同轮回合（新 `turnSeq`），`beginAttemptTx(origin: 'retry_turn')`。

### 10.4.5 全局日美元上限命中

1. `beginAttempt` 发现 `spendCounters(global, 今天)` 已无余量 → 不建 attempt：turn **状态不变**（`scheduled` 仍 `scheduled`，`running` 仍 `running`），写 `waitingReason: 'spend_deferred'`、`beginFnId = runAfter(到下一个 UTC 零点 + 抖动, turns.beginAttempt, { turnId, origin, actorUserId })`（03 §3.8、04 A1）；不写事件（`rooms.view` 由 `waitingReason` 渲染 "Agents paused until tomorrow (daily limit)"，只给本方），`opsLog('spend_deferred')`。
2. 被调度路径**不抛错**（techstack X2）；run 保持 `negotiating`，`runs.reconcile` 识别 `beginFnId` 为 pending 时视为有在途工作（04 §4.3.5）。
3. 次日 `turns.beginAttempt` 重新执行全部检查。

## 10.5 `turns.beginAttempt`（唯一调度接缝）

### 10.5.1 签名

```ts
// convex/model/agents/lifecycle.ts —— helper：只在 mutation 事务内调用（注册的 internal 函数集中在 convex/agents.ts，11 §11.3）
export type BeginOpts = {
  origin: 'turn_start' | 'auto_retry' | 'retry_turn';   // = attempts.origin（03 §3.8）
  delayMs: number;                          // auto_retry 的退避；constraints_changed 新 run 的首个 attempt 为 SYSTEM_START_DELAY_MS；其余 0
  actorUserId: Id<'users'> | null;          // 鉴权已在调度前完成；null = 系统 / cron
  retryNote?: ReasonCode;                   // 上一 attempt 的 reasonCode；写入新 attempt 的 retryNote，loadTurnContext 据此渲染 RETRY_NOTES（05 §5.6.2）
  why?: ReconcileWhy;                       // 仅 runs.reconcile 传入（04 §4.3.5），只进 opsLog 归因
};
export type BeginResult =
  | { kind: 'dispatched'; attemptId: Id<'attempts'> }
  | { kind: 'deferred'; until: number; reason: 'spend_deferred' | 'run_cap' }   // B6 全局日美元 / B6a 每房间每日 run 数
  | { kind: 'parked'; code: 'run.draining' }                // draining：不新建 attempt（canon D17）
  | { kind: 'limit'; cause: 'call_limit' | 'spend_limit' | 'turn_attempts' }   // 已由 helper 交给 05 转 needs_input（turn_attempts → 失败方的 agent_failed）
  | { kind: 'stale' };                                       // 回合已不是当前回合
export async function beginAttemptTx(ctx: RoomCtx, turnId: Id<'turns'>, o: BeginOpts): Promise<BeginResult>;   // canon §1.6 helper 名

// convex/turns.ts —— internal mutation 包装：只供延迟路径、reconcile 与排空恢复调用
export const beginAttemptMutation = internalMutation({          // 导出名 turns.beginAttempt
  args: { turnId: v.id('turns'), origin: originV, actorUserId: v.union(v.id('users'), v.null()),
          retryNote: v.optional(reasonCodeV) },            // 退避路径把上一 attempt 的 reasonCode 带给下一 attempt（§10.7.2 turns.fail 步骤 6）
  handler: async (ctx, a) => beginAttemptTx({ ...ctx, tx: await openRoomTx(ctx, await roomOfTurn(ctx, a.turnId), { allow: ['open'] }) },
    a.turnId, { origin: a.origin, delayMs: 0, actorUserId: a.actorUserId, retryNote: a.retryNote }),
});
```

所有"开始一次模型调用"的路径（`runs.start`、`turns.complete` 推进下一回合、自动重试、`retry_turn`、`humanRequests.answer` 恢复、`onProposalRejected`、`runs.reconcile`、延迟与排空恢复）都经过它；它是将来换 workpool 时唯一要改的函数（R02）。

`delayMs` 的取值：自动重试按 §10.10；`cause = constraints_changed` 的新 run 的首个 attempt 用 `SYSTEM_START_DELAY_MS = 3_000`（保留底稿的防抖：3 s 内再次 bump 会 supersede 这个 run，届时 `loadTurnContext` 返回 null，不花一次调用）；其余为 0。

### 10.5.2 检查与写入（按顺序，读当前值）

| # | 检查 | 不满足时 |
| --- | --- | --- |
| B1 | `turn.status ∈ {scheduled, running}`；若 `running`，其当前 attempt 已是终态（保证 RT3） | 编程错误：抛 `ConvexError({ code: 'internal' })`（构造器清洗） |
| B2 | `room.currentRunId === run._id`、`run.status === 'negotiating'`、`run.activeTurnSeq === turn.turnSeq`、`turn.constraintsVersion === room.constraintsVersion` | 回合 → `stale`（若非终态），返回 `stale`；**本 helper 内不调用 reconcile**（避免 reconcile → beginAttempt → reconcile 递归），由外层调用者调用一次 `runs.reconcile`，它走 `replaceTurnTx`（04 A1 / §4.3.5） |
| B3 | live 时 `opsFlags.draining !== true`（stub 跳过） | 回合状态不变，写 `waitingReason: 'draining'`，返回 `{ kind: 'parked', code: 'run.draining' }`；`ops.setDraining(false)` 时由 `runs.reconcile` 恢复（§10.12.3） |
| B4a | `turn.currentAttemptNo < MODEL_BUDGET.maxAttemptsPerTurn`（= 2，即 04 U4 / A1 的 `MAX_ATTEMPTS_PER_TURN`：一条链 = 首发或人工重试 + 至多 1 次自动重试，§10.10.1） | 纵深防御（正常路径由 `decideRetry` 保证不会触发，例如 reconcile 在链已用尽的回合上重派）：回合 → `failed`，`run.lastFailure = { code: 'turn_attempt_limit', at }`，05 `onTurnFailed` → 失败方的 `agent_failed` 请求，返回 `{ kind: 'limit', cause: 'turn_attempts' }`，`opsLog` 告警 |
| B4 | `run.attemptCount < run.maxAttempts`（live 与 stub 都检查，防死循环） | 回合 → `failed`，`run.lastFailure = { code: 'run.call_limit', at }`（03 §3.8；turns 没有失败码字段），05 §5.8.5 → `needs_input` + customer 的 `rounds_exhausted` 请求（`questionKey` 带 `call_limit`），返回 `limit` |
| B5 | live 时 `run.spentMicroUsd + run.reservedMicroUsd + run.unknownExposureMicroUsd + RESERVE_MICRO_USD ≤ run.spendCapMicroUsd`（成本未知的暴露照计，§10.12.2） | 同上：`lastFailure.code` 仍为 `run.call_limit`（canon §1.5 没有单独的美元码），`questionKey` 带 `spend_limit` 以便文案区分 |
| B6 | live 时 `spendCounters(global, utcDay(now))` 的 `spent + reserved + unknownExposure + RESERVE_MICRO_USD ≤ GLOBAL_DAILY_SPEND_CAP_MICRO_USD` | 回合状态不变，写 `waitingReason: 'spend_deferred'` + `beginFnId`，返回 `deferred`（§10.4.5），**不抛错** |
| B6a | 本 run 的首个 attempt（`run.attemptCount === 0`）且 `run.cause !== 'manual_start'`（人工开局已在入口被 12 B7 的 `run_starts` 桶拒绝）时：房间最近 24 小时开局的 run 数（读 `runs.by_room_runNo` 倒序前 7 行按 `startedAt` 计，含本 run）≤ 12 B7 的 `run_starts` 上限（6）；live 与 stub 都检查——它约束的是 counter 信道的总量（05 §5.12），不是成本 | 回合状态不变，写 `waitingReason: 'run_cap'` + `beginFnId = runAfter(窗口内最早一个 run 的 startedAt + 24 h − now + 抖动, turns.beginAttempt, …)`，返回 `deferred`，**不抛错**；`runs.reconcile` 因 `beginFnId` pending 而 noop，恢复由这条延迟调度承担，巡检只兜底（否则巡检会立即重派而绕过上限；04 §4.3.3、12 B7、canon D12 ⑥ 同此，04 不另算桶） |
| B7 | 全部通过 | 见下 |

B7 的写入（同一事务）：

1. `attemptNo = turn.currentAttemptNo + 1`；插入 attempt：`{ status: 'running', origin, attemptNo, role: turn.role, provenance: run.agentMode, protocolVersion: String(PROTOCOL_VERSION), promptVersion: PROMPT_VERSION, model, effort, maxTokens, reservedMicroUsd: live ? RESERVE_MICRO_USD : 0, reservedDay, costState: 'reserved', deadlineAt: now + delayMs + WATCHDOG_FIRST_MS, watchdogArmCount: 0, lateUsage: false, retryNote, startedAt: now }`。`schemaVersion`（= `turnSpecKey(spec)`）由 action 在构造 schema 后随提交写入。
2. turn：`status: 'running'`（已是 `running` 则不变）、`currentAttemptNo = attemptNo`、清除 `waitingReason` / `beginFnId`。
3. run：`attemptCount + 1`、`reservedMicroUsd += reserve`；live 时全局计数行 `reservedMicroUsd += reserve`、`attempts + 1`（行不存在则插入）。
4. `actionFnId = await ctx.scheduler.runAfter(o.delayMs, internal.agents.runAttempt, { attemptId, actorUserId: o.actorUserId })`；`watchdogFnId = await ctx.scheduler.runAfter(o.delayMs + WATCHDOG_FIRST_MS, internal.agents.watchdog, { attemptId })`；两者写回 attempt。
5. **不写事件**：`turn_scheduled { runNo, turnSeq, roundNo, role, kind }` 只由 `createTurnTx` 在建回合时写一次（04 R4 / U1、03 §3.11.1），界面据此显示 "Provider agent drafting…"；attempt 的创建与重试不产生事件。

`RESERVE_MICRO_USD = estimateCostMicroUsd({ inputTokens: INPUT_TOKENS_RESERVE × MAX_BILLED_RESPONSES_PER_CALL, outputTokens: MODEL_BUDGET.maxTokens × MAX_BILLED_RESPONSES_PER_CALL }, model, PRICE_TABLE)`，`INPUT_TOKENS_RESERVE = 12_000`，`MAX_BILLED_RESPONSES_PER_CALL = 1 + MODEL_BUDGET.gatewayTruncationRetries = 2`（一次调用至多两次带响应的发送：首发与 `max_tokens` 截断后的调用内重试，§10.10.1；429 / 连接错误没有响应，是否计费待验证 V8）；价目表与 `asOf` 归 15。按 Opus 5.5 每百万 token 输入 $4 / 输出 $20 的示意价，单次预留约 $0.74（输入 24,000 + 输出 32,000 token）。默认 `spendCapMicroUsd = 3_000_000`（$3 / run）；`GLOBAL_DAILY_SPEND_CAP_MICRO_USD` 按环境配置（dev $5、prod $15，与 U5 的月度 $100 / $300 和 Console 兜底配套，15 定稿）。

### 10.5.3 为什么检查放在 beginAttempt 而不是 action 里

- 上限与排空在**创建 attempt 之前**判定：被拒的调用不产生 attempt 行、不预留美元、不调度 action，也不需要看门狗收尾。
- 唯一的例外是 `AGENTS_ENABLED`：它在 action 调模型前检查（canon D17：关闭即 attempt `error(agents_disabled)`），让紧急止血对已调度但尚未开始的 attempt 立即生效。
- 节流（D12 ⑥）不在这里：它属于公开 mutation 的入口（12），被调度路径从不因节流失败。
