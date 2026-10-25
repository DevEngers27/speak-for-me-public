# 10 · 代理运行时（part4：重试、时间预算、上限与排空、并发与部署）

> 分片清单见 `10-agent-runtime.md` 开头。常量集中在 `core/engine/runtime/budget.ts`，可被环境变量覆盖的项由 15 列出。

## 10.10 重试策略

### 10.10.1 两层，各管各的

| 错误类别 | 负责的层 | 次数 |
| --- | --- | --- |
| 429、连接错误（`APIConnectionError`） | 网关 `callModel`（SDK `maxRetries: 0`）：同一次调用内重发，退避遵从 `retry-after`，上限 `gatewayMaxBackoffMs = 8 s`，且不超过剩余总截止；剩余预算不够退避则不再重试 | 每次调用 ≤ 1 |
| `stop_reason: max_tokens`（`output.truncated`） | 网关：同一次调用内重发一次；第二次截断返回 `retryable: false` | 每次调用 ≤ 1 |
| 非截断的输出问题（`output.not_json` / `schema_violation` / `unknown_reference`、`action.*`）、action 丢失（`action_crashed`）、看门狗重登记用尽（`watchdog_timeout`） | attempt 层：新 attempt 行（`origin: 'auto_retry'`） | 每条链 ≤ 1 |
| 总截止到期（发送前、退避中、发送中，一律 `model_timeout`）、网关重试后仍失败的 429 / 连接错误、408 / 409 / 5xx / 529、第二次截断、拒答、400 / 413 / 422、401 / 403、计费、404、上下文溢出、意外 stop、`agents_disabled`、`config_invalid`、内部缺陷 | 不重试 → turn `failed` → 人决定（`agent_failed` 请求） | 0 |

两层按错误类别划分、互不重叠：网关处理过或判为不可重试的失败，attempt 层不再重试；SDK 不重试（它的重试会与网关相乘，且退避不受总截止约束）。总截止 `CALL_DEADLINE_MS`（§10.11）覆盖一次调用的首发、退避与全部重试，每次发送的超时取 `min(REQUEST_TIMEOUT_MS, 剩余预算)`；截止一旦到期，无论处在发送前、退避等待中还是发送中，调用都以不可重试的 `model_timeout` 结束，不再发起任何请求。attempt 的 `usage` 记一次调用内全部带响应发送之和（截断重试的两次响应都计费）。

"链"= 一个 `turn_start` 或 `retry_turn` attempt 加上它触发的至多一个 `auto_retry` attempt；`auto_retry` 的 attempt 不再触发自动重试。每次调用至多 1 + 1 + 1 = 3 次发送，每条链最坏 HTTP 次数 = 3 × 2 = 6（断言 I4），每 run 再被 `maxAttempts = 18` 封顶。

### 10.10.2 `decideRetry`（纯函数，`core/engine/runtime/retryPolicy.ts`）

| attempt 终态 / 码 | 自动重试 | 延迟 | 附加 |
| --- | --- | --- | --- |
| `invalid_output` / `output.not_json`、`output.schema_violation`、`output.unknown_reference`、`action.*` | 1 | 0 | 下一 attempt 带 `RETRY_NOTES[code]`（05 §5.6.2） |
| `invalid_output` / `output.truncated` | 0 | — | 网关已在同一次调用内重试过一次（§10.10.1），第二次截断 `retryable: false`；不再开新 attempt |
| `refused` / `output.refusal` | 0 | — | `stopCategory` 记录；`agent_failed` |
| `timeout` / `model_timeout`（总截止在发送前、退避中或发送中到期，`APIUserAbortError`、`APIConnectionTimeoutError`） | 0 | — | 截止到期一律不可重试 |
| `timeout` / `watchdog_timeout` | 1 | 2 s，且不早于该 attempt 的 `physicalLeaseUntil`（下限由 `turns.fail` 步骤 6 施加，§10.7.2） | 物理 action 可能仍在运行：同一回合不重叠两个物理调用（§10.8） |
| `error` / `transport`（网关重试后仍失败的 429 / 连接错误；网关不重试的 5xx / 529） | 0 | — | 429 / 连接错误只由网关重试（§10.10.1）；`retryAfterMs` 照记供诊断 |
| `error` / `action_crashed` | 1 | 2 s | — |
| `error` / `bad_request`、`auth`、`quota_exhausted`、`model_not_found`、`context_overflow`、`unexpected_stop`、`api_error`、`agents_disabled`、`config_invalid`、`internal` | 0 | — | 前七类、`config_invalid` 与 `internal` 告警 |
| `stale`（任何守卫） | — | — | `{ kind: 'replace_turn' }`：回合已被 G2/G3 置 `stale`，由 `runs.reconcile` 的 stale 分支 `replaceTurnTx` 建替代回合（不是空操作，invariants-02） |

```ts
export function decideRetry(a: { origin: AttemptOrigin; status: AttemptStatus; reasonCode?: ReasonCode;
    errorCode?: AttemptErrorCode }, rand: () => number):
  | { kind: 'retry'; delayMs: number; retryNote?: ReasonCode }
  | { kind: 'replace_turn' }
  | { kind: 'fail'; failureCode: ReasonCode | AttemptErrorCode } {
  if (a.status === 'stale') return { kind: 'replace_turn' };
  const c = classifyForRetry(a);                                   // 上表
  if (!c.retryable || a.origin === 'auto_retry') return { kind: 'fail', failureCode: c.code };
  return { kind: 'retry', delayMs: Math.round(c.delayMs * (0.8 + 0.4 * rand())),   // mutation 内 Math.random 可用且可重放
           retryNote: a.status === 'invalid_output' ? a.reasonCode : undefined };
}
```

自动重试是**同一回合**上的新 attempt（回合保持 `running`，退避期间 `waitingReason: 'backoff'` + `beginFnId`，`currentAttemptNo + 1`）；人工 `retry_turn` 则开**新回合**（新 `turnSeq`、`retryOfTurnId`，因为 `failed` 是回合终态）。退避只在本节定义一次：04 §4.5.1 引用这里的延迟表。

## 10.11 时间预算与不等式（`core/engine/runtime/budget.ts`）

```ts
export const MODEL_BUDGET = {
  maxTokens: 16_000,               // canon D09
  assumedMinOutputTps: 80,         // 每秒输出 token 下限（含 thinking），待实测（spikes §8 #15）后回填
  ttftBudgetMs: 20_000,            // 首 token 前的排队与思考余量，待实测
  sdkMaxRetries: 0,                // canon D09：SDK 不重试，传输层拒绝非零值（I6）
  gatewayTransportRetries: 1,      // 网关唯一重试层：只对 429 与连接错误，每次调用至多 1 次
  gatewayTruncationRetries: 1,     // max_tokens 截断在同一次调用内重发 1 次；第二次截断 retryable: false
  gatewayMaxBackoffMs: 8_000,      // 网关退避上限：遵从 retry-after 但不超过它，也不超过剩余总截止
  deadlineMarginMs: 2_000,         // 总截止在"一次耗满的发送 + 一次退避"之上的余量
  loadMarginMs: 10_000,            // loadTurnContext
  persistMarginMs: 30_000,         // turns.complete / fail（含 OCC 重试）
  watchdogSlackMs: 15_000,
  assumedActionLimitMs: 600_000,   // Convex action 墙钟上限，待验证（spikes §8 #4）
  watchdogMaxRearms: 3,
  maxAttemptsPerTurn: 2,           // 04 U4 / A1 的 MAX_ATTEMPTS_PER_TURN：一条链 = turn_start 或 retry_turn + 至多 1 次 auto_retry（beginAttempt B4a）
} as const;
const B = MODEL_BUDGET;
/** 单次发送的超时上限：由 max_tokens 推导；实际每次发送取 min(REQUEST_TIMEOUT_MS, 总截止剩余)。 */
export const REQUEST_TIMEOUT_MS = Math.ceil(B.ttftBudgetMs + (B.maxTokens * 1000) / B.assumedMinOutputTps); // 220_000
/** 总截止（AbortSignal）：覆盖一次调用的首发 + 退避 + 全部网关重试，是单次调用墙钟的真正上界；重试只能共享剩余预算。 */
export const CALL_DEADLINE_MS = REQUEST_TIMEOUT_MS + B.gatewayMaxBackoffMs + B.deadlineMarginMs;           // 230_000
export const ACTION_WALL_MAX_MS = B.loadMarginMs + CALL_DEADLINE_MS + B.persistMarginMs;                    // 270_000
export const WATCHDOG_FIRST_MS = B.loadMarginMs + REQUEST_TIMEOUT_MS + B.persistMarginMs + B.watchdogSlackMs; // 275_000
export const WATCHDOG_REARM_MS = REQUEST_TIMEOUT_MS;                                                        // 220_000
const WATCHDOG_FINAL_MS = WATCHDOG_FIRST_MS + B.watchdogMaxRearms * WATCHDOG_REARM_MS;                     // 935_000

// 模块加载即断言：改坏常量会让部署失败，而不是静默超时或双付费
assert(ACTION_WALL_MAX_MS < B.assumedActionLimitMs,                          'I1 加载余量 + 总截止 + 落库余量 < action 上限');
assert(WATCHDOG_FINAL_MS > B.assumedActionLimitMs + B.watchdogSlackMs,       'I2 无调度积压时，看门狗最终判定晚于 action 必然结束（积压时由 §10.8 的租约兜底）');
assert(B.loadMarginMs + CALL_DEADLINE_MS < WATCHDOG_FIRST_MS,                'I3 总截止早于看门狗首次判定');
assert((1 + B.gatewayTransportRetries + B.gatewayTruncationRetries) * B.maxAttemptsPerTurn <= 6, 'I4 每条链最坏 HTTP 次数 ≤ 6');
assert(B.maxTokens <= MODEL_CONFIG[NEGOTIATION_MODEL].maxOutputTokens,     'I5 max_tokens 不超过模型输出上限（取自 15 的模型配置，待验证）');
assert(B.sdkMaxRetries === 0,                                                'I6 SDK 不重试：网关是传输错误的唯一重试层');
```

- **I1 的数值含义**：`10 + (20 + 16000 / tps) + 8 + 2 + 30 < 600`（秒）⇔ `tps > 30.2`。重试共享同一总截止，不再按 HTTP 次数放大；实测下限低于 80 tokens/s 时按实测值重算 `REQUEST_TIMEOUT_MS`，总截止与看门狗随之推导（`WATCHDOG_FIRST_MS − 加载余量 − CALL_DEADLINE_MS = persistMarginMs + watchdogSlackMs − gatewayMaxBackoffMs − deadlineMarginMs = 35 s > 0`，I3 与 tps 无关）；低于 30.2 才需调整 `maxTokens`（需改 canon D09）。代价：首发耗时接近 `REQUEST_TIMEOUT_MS` 时剩余预算不够重试——429 不再退避、以 `transport` 结束，截断重发撞到总截止、以 `model_timeout` 结束——两者都不可重试，由人决定是否重试回合。
- **看门狗分两段**：第一次在 `WATCHDOG_FIRST_MS`（晚于加载 + 总截止 + 落库的正常上界 `ACTION_WALL_MAX_MS`）就能发现已崩溃的 action（`failed`），不必等到 action 上限；仍 `pending` / `inProgress`（调度积压）时重登记，最终判定在 `WATCHDOG_FINAL_MS`。
- `abortAfter(ms)`：优先 `AbortSignal.timeout(ms)`；Convex 默认运行时不提供时退回 `AbortController + setTimeout`（待验证 V4）。总截止信号同时约束发送与退避等待；它在任何阶段触发都映射为不可重试的 `timeout / model_timeout`（§10.10.1、§10.15）。
- 延迟目标（待实测后定稿）：provider 回合 p95 ≤ 20 s、评估回合 p95 ≤ 15 s、首轮收敛 p95 ≤ 50 s、预算下调到新提案出现 p95 ≤ 45 s。

## 10.12 上限四层、排空与紧急开关

### 10.12.1 上限落点（canon D17 + D12 ⑥）

| 层 | 机制 | 真相源 | 拒绝时 |
| --- | --- | --- | --- |
| 1 每用户每房间每小时 | 约束变更类写入（`briefs.confirm`、`catalog.confirm`、`catalog.retire`、`budget.setCap`、`runs.start`、`runs.requestRenegotiation`、`runs.retryTurn`、`humanRequests.answer`）≤ 6 次；计数方法以 03 §3.11.3 `assertWithinRate` 为准（按命令类事件类型过滤、按 distinct `commitTs` 计数——一次 `setCap` 产生的多条事件只算一次），零依赖；另有 07 §7.13 的 `price_writes` 桶与每房间每日 run 数上限（12 B7 `run_starts`：人工开局在入口拒绝，`react()` 自动开局的 run 由 `beginAttempt` B6a 延期首回合） | `events` / `runs` | 公开 mutation 抛 `run.rate_limited`（12） |
| 2 每 run attempt | `maxAttempts = maxRounds × 3 × 2 = 18`（live 与 stub 都计） | `runs.attemptCount` | `beginAttempt` B4 → `needs_input` + `rounds_exhausted`（cause `call_limit`） |
| 3 每 run 美元 | 调度前预留 `RESERVE_MICRO_USD`，提交时按实际 usage 结算 | `runs.reservedMicroUsd / spentMicroUsd / unknownExposureMicroUsd / spendCapMicroUsd` | B5 → 同上（cause `spend_limit`） |
| 4 全局日美元 | 每 UTC 日一行 | `spendCounters(global, day)` | B6 → `deferred` + `runAfter` 到次日，**不抛错** |
| 5 账户兜底 | Anthropic Console workspace 月度上限（dev $100 / prod $300，U5） | Anthropic | 计费错误 → `quota_exhausted`，不重试 |

删除项（canon D17 修正草稿）：每房间累计 `modelCallBudget`、`usageCounters` 分片、每房间每日计数。stub 只受第 2 层约束（防死循环），不预留美元、不计全局日额度。

### 10.12.2 结算细节

- 结算发生在 `turns.complete` / `turns.fail` / 看门狗处理的第 4 步，一律经唯一的 `settleAttemptOnce(ctx, attempt, usage | null | 'not_sent')`，读 attempt 的 `reservedMicroUsd` 与 `reservedDay`，跨日也回到原日期行。
- 每个 live attempt 的成本状态（`attempts.costState`，03 落地）只走 `reserved → known` 或 `reserved → unknown → known`：
  - 带 `usage`：`reserved → known`；run 与 `spendCounters(reservedDay)` 的 `reservedMicroUsd −= 预留`、`spentMicroUsd += costMicroUsd`。
  - 未发出任何请求（传 `'not_sent'`：`stale_context`、`agents_disabled`、`config_invalid` 与发送前的网关断言失败——`GatewayConfigError` 只在 `callModel` 首次发送之前抛出（缺密钥、非法 `AGENT_MODE`、SDK `maxRetries` 非零、首发请求体未过 `assertWhitelisted`），首发之后的断言失败（截断重发的重建体）按 `internal` 抛出、不属此类）：`reserved → known`，`costMicroUsd = 0`、`usage` 保持 null；run 与 `spendCounters(reservedDay)` 的 `reservedMicroUsd −= 预留`，预留释放、`spentMicroUsd` 不变。
  - 没有响应（超时、传输错误、action 崩溃，以及 G1–G3 拒收的已发送之后的无 usage 失败）：`reserved → unknown`。`usage` / `costMicroUsd` 保持 null，不编造金额（核心 8）；预留**原额转入** `unknownExposureMicroUsd`（run 与 `spendCounters(reservedDay)` 各一份），`reservedMicroUsd −= 预留`、`unknownCostAttempts + 1`。这笔暴露不释放，继续计入 B5 / B6 的准入（§10.5.2）——物理调用可能仍在计费（§10.8）。
  - 迟到结果带回 `usage`（G0 补记，`lateUsage: true`）：`unknown → known`，只调差额：`unknownExposureMicroUsd −= 预留`、`spentMicroUsd += costMicroUsd`、`unknownCostAttempts − 1`，同样回到 `reservedDay` 行。
  - 迟到的未发请求证明（看门狗已判 `unknown` 之后才到的 `stale_context` / `agents_disabled` / `config_invalid`，G0 处理）：`unknown → known`，`costMicroUsd = 0`、`unknownExposureMicroUsd −= 预留`、`unknownCostAttempts − 1`，同样回到 `reservedDay` 行。每个 attempt 只有一个物理 action（`actionFnId`），它报告自己没有发出请求，这笔暴露就确定为零。
  - 其余组合（已 `known` 再结算、`unknown` 再报无响应）是空操作：重复提交、看门狗与迟到提交的任意先后都不会重复记账。
- 网关重试前失败的 HTTP 尝试（429 / 连接错误）是否计费待验证（V8，spikes §8 #16）。
- 美元计算一律整数微美元；`costMicroUsd` 是估算，界面标 "Estimated" 与价目表版本。

### 10.12.3 排空：`opsFlags.draining`

1. 运维调用 `ops.setDraining({ draining: true, reason })`（internal mutation，`npx convex run`；参数与返回见 12 §12.20）。
2. 之后 live 的 `beginAttempt` 停泊回合（B3，`waitingReason: 'draining'`，回合状态不变，不建 attempt）；公开 `runs.start` 返回 `run.draining`；09 `react()` 经 `startRunTx` 开新 run 时**照常建 run**，只是首个回合停泊——拒绝建 run 会回滚约束变更本身（07 评委："约束记录被运行限额绑死"）。
3. 在途 attempt 照常跑完并提交；`ops.activeAttemptCount()`（`attempts.by_status_deadline` 中 `running` 且 `provenance = 'live'` 的计数，加上 `physicalLeaseUntil > now` 且 `actionFnId` 在 `_scheduled_functions` 中仍 `pending` / `inProgress` 的终态 live attempt——看门狗已逻辑终结、物理 action 尚未结束，§10.8；stub 不受排空约束，canon D17）归零后部署。
4. `ops.setDraining({ draining: false, reason })` 立即 `runAfter(0, ops.livenessSweep)`：它分页遍历 `runs.by_status` 中的 `negotiating` run，对每个调度 `runs.reconcile`，停泊的回合由此恢复（12 §12.20）；之后每 5 分钟的定时巡检是兜底。

### 10.12.4 `AGENTS_ENABLED`（紧急止血）

值为 `"false"` 时，action 在调用模型前把 attempt 记为 `error(agents_disabled)`（不重试）→ 回合 `failed` → 各 run 进入 `needs_input` + `agent_failed`。它会打断多步 run，所以只用于成本事故或供应商故障，排空一律用 `draining`。stub 不受影响。

## 10.13 并发与部署

1. **单活跃 run（RT1）**：`runs.start` 与系统路径都经 `startRunTx` 读写 rooms 文档；两个并发调用由 OCC 串行化，后到者看到前者的 run 并返回它（`created: false`）。真实部署并发验证见 16（spikes §8 #1）。
2. **串行回合**：每 run 至多一个在途 action，不存在两个提交互相等待的屏障；跨 run 的并发受部署档位的被调度函数并发数约束（Free / Starter 档约 8，techstack），积压时 attempt 处于 `pending`，看门狗重登记而非误判。
3. **热点**：按 03 的房间写锁 M-ROOM，`turns.complete` / `turns.fail` / `agents.watchdog` / `turns.beginAttempt` 与全部人类写入都经房间写锁写 `rooms.writeSeq`：`open` 房间一律 `openRoomTx`；`turns.complete` / `turns.fail` / 看门狗在 `executed` / `closed` 房间改用只许记账写的结算变体 `settleAttemptTx`（同样 `writeSeq + 1`，§10.8），看门狗读到 attempt 已终态时只读返回、不加锁。同房间写入串行，冲突面是 `rooms.writeSeq`（一次代理提交与一次人类写入相撞时后者 OCC 重试）；跨房间的热点只剩 `spendCounters` 当日行。v1 规模下由自动重试吸收；观测到冲突率上升再按 `hash(roomId) % 8` 分片（接口不变）。
4. **部署**：协议、提示或输出 schema 的改动一律"排空 → 部署 → 解除排空"。attempt 记录 `protocolVersion` / `promptVersion` / `schemaVersion` 供事后比对；不另设版本守卫——万一在途 attempt 跨越了不兼容部署，提交 mutation 的参数校验失败会走 §10.6.2 的 catch 分支（`internal`，人决定重试），不会写入错形数据。
5. **升级触发**（R02）：并发 run > 50 或 Anthropic 429 成为常态 → workpool；看门狗是否可删取决于 workpool `onComplete` 是否覆盖平台中断（待验证）。
