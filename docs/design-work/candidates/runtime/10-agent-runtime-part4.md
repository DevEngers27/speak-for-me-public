# 10 代理运行时（part4）：重试、超时、预算、熔断、并发、部署

> 分片清单见 part1。常量集中在 `convex/engine/runtimeConfig.ts`，可被 Convex 环境变量覆盖的项在 15 §15.2 列出。

## 10.7 重试预算：只有一层

**原则**：SDK 构造时 `maxRetries: 0`，传输层不重试；所有重试由 attempt 层负责（R5）。理由：①每次 HTTP 请求都有一行 `modelCalls`，用量与失败原因精确可查（SDK 内部重试对应用不可见，失败尝试是否计费待验证）；②重试能跨越 action 的生命周期（action 死掉后由 watchdog 接手）；③退避可以读取 429 的 `retry-after`；④不会出现"应用重试 × SDK 重试"的乘法（F15）。

### 10.7.1 outcome → 重试类别

| outcome | 类别 | 类别内最多重试 | 延迟（第 1 次 / 第 2 次） | 附加处理 |
| --- | --- | --- | --- | --- |
| `transport_timeout`、`transport_error` | transport | 2 | 2 s / 8 s | — |
| `api_error` 429 | rate_limit | 2 | `retry-after-ms` 或 `retry-after`，缺省 10 s / 30 s，上限 60 s | — |
| `api_error` 408 / 409 / 5xx / `overloaded_error` | server | 2 | 4 s / 15 s | — |
| `invalid_output{code}` | invalid_output | 1 | 0 | 下一次请求末尾追加中途 system 消息 `RETRY_NOTE(code)`（part5 §10.16） |
| `refused` | refusal | 1 | 1 s | 请求不变 |
| `truncated` | truncation | 1 | 0 | `maxTokens = min(ceil(prev × 1.5), 16000)` |
| watchdog 超时（`timeout`） | timeout | 1 | 2 s | — |
| `internal_error`（action 内我们自己的代码异常） | internal | 1 | 2 s | 写 ops 告警 |
| `api_error` 400 / 422 | 致命 | 0 | — | `MODEL_BAD_REQUEST`，ops 告警（请求形状错误是代码缺陷） |
| `api_error` 401 / 403 | 致命 + 熔断 | 0 | — | `MODEL_AUTH`，打开熔断 |
| `api_error` 且 `type === "billing_error"` | 致命 + 熔断 | 0 | — | `MODEL_QUOTA`，打开熔断 |
| `api_error` 404 | 致命 + 熔断 | 0 | — | `MODEL_NOT_FOUND`（模型 ID 配置错误影响全部房间） |
| `unexpected_stop`（`pause_turn`、`tool_use`、`stop_sequence`、`model_context_window_exceeded`） | 致命 | 0 | — | `UNEXPECTED_STOP` |

所有延迟乘以确定性抖动因子 `0.8 + 0.4 × Math.random()`（Convex mutation 内的 `Math.random` 可用且可重放）。

### 10.7.2 `decideRetry`（纯函数，`convex/engine/retryPolicy.ts`）

```ts
export type RetryDecision =
  | { kind: "retry"; cls: RetryClass; delayMs: number; maxTokens?: number; retryNote?: RetryNoteCode }
  | { kind: "fail"; failureCode: TurnFailureCode; tripCircuit: boolean };

export function decideRetry(turn: TurnRetryState, outcome: AttemptOutcomeOrTimeout,
                            budget: { runCallsLeft: number }, rand: () => number): RetryDecision {
  const c = classifyForRetry(outcome);                 // 上表
  if (c.fatal) return { kind: "fail", failureCode: c.code, tripCircuit: c.trip };
  if (turn.attemptCount >= MAX_ATTEMPTS_PER_TURN) return fail(exhaustedCode(c.cls));
  const used = turn.retryCounters[c.cls] ?? 0;
  if (used >= RETRY_LIMITS[c.cls]) return fail(exhaustedCode(c.cls));
  if (budget.runCallsLeft <= 0) return fail("CALL_BUDGET_EXCEEDED");
  const base = c.retryAfterMs ?? BACKOFF_MS[c.cls][used];
  return { kind: "retry", cls: c.cls, delayMs: Math.round(base * (0.8 + 0.4 * rand())),
           maxTokens: c.cls === "truncation" ? Math.min(Math.ceil(turn.lastMaxTokens * 1.5), 16000) : undefined,
           retryNote: c.cls === "invalid_output" ? c.noteCode : undefined };
}
// exhaustedCode: refusal → MODEL_REFUSED，invalid_output → INVALID_OUTPUT，truncation → TRUNCATED，其余 → RETRY_EXHAUSTED
```

`MAX_ATTEMPTS_PER_TURN = 3`（首次 + 至多 2 次重试，不论类别）。类别上限与总上限同时生效，先到先停。

## 10.8 超时与延迟预算

| 常量 | 默认值 | 含义与调参规则 |
| --- | --- | --- |
| `ATTEMPT_TIMEOUT_MS` | 60,000 | SDK 单次请求超时（`timeout` 选项）。上线前用最终模型与 effort 实测 ≥ 10 次，取 `max(30 s, 2 × 成功 attempt 的 p95)`；之后每月用 `modelCalls.latencyMs` 复核 |
| `WATCHDOG_GRACE_MS` | 30,000 | 超时之后给分类与 record 留的余量；watchdog 在 `delay + 60 s + 30 s` 触发 |
| `RUN_AUTO_START_DEBOUNCE_MS` | 3,000 | 系统自动触发（约束变化、拒绝、请求回答）的 run，第一个 attempt 延迟 3 s 开始；期间再次变化会让它在 claim 前被跳过，不花钱 |
| Convex action 最长运行时间 | 待验证（文档通常 10 分钟） | 必须 ≫ `ATTEMPT_TIMEOUT_MS`；单个 action 只发一次请求，所以 90 s 的上界有充足余量 |

**最坏情况（全部计入）**：单 attempt ≤ 90 s；单 turn ≤ 3 × 90 s + 60 s + 30 s（两次最长退避）≈ 6 分钟；一个 run 的串行深度 = 2 × maxRounds = 6 层 turn，理论最坏约 36 分钟，但 run 调用预算（24 次）会更早截断。真实故障大多是致命类（立即失败）或一次重试即恢复。

**目标（待用最终模型实测后定稿）**：提议回合 p95 ≤ 15 s，评审回合 p95 ≤ 10 s；首轮收敛的 run p95 ≤ 30 s；用满 3 轮 p95 ≤ 75 s；预算下调到新提案出现 p95 ≤ 35 s（含 3 s 防抖）。界面在某回合超过该类回合 p95 后显示"比平时慢"，超过 `deadlineAt` 显示"正在重试"。

## 10.9 调用预算、总开关与熔断

| 级别 | 上限 | 计数位置 | 超限后 |
| --- | --- | --- | --- |
| 每 turn | 3 次 attempt | `turns.attemptCount` | turn failed |
| 每 run | `MAX_MODEL_CALLS_PER_RUN = 24` | `runs.modelCallsUsed`（claim 时 +1） | claim abort，turn failed `CALL_BUDGET_EXCEEDED` |
| 每房间（全生命周期） | `MAX_MODEL_CALLS_PER_ROOM = 150`（房间可由运维调高） | `usageCounters{scope:"room", scopeKey: roomId, day:"total"}` | 同上；界面提示联系管理员 |
| 每部署每日（UTC） | `AGENT_DAILY_CALL_LIMIT`（环境变量，默认 2,000） | `usageCounters{scope:"deployment", day, shard 0–7}` | 同上 |
| 供应商侧 | workspace 花费上限（控制台设置） | Anthropic | 返回 billing_error → 熔断 |

stub 模式的调用只计 run 级与房间级（防止死循环），不计部署每日额度。

**总开关**：Convex 环境变量 `AGENTS_ENABLED`，值为 `"false"` 时所有 live attempt 在 claim 处中止。用于成本事故或供应商故障时一键停用；不影响 stub 与手动路径。

**熔断**：`systemState` 表中 `key: "agents"` 的单行 `{ circuit: "closed" | "open", reasonCode?, openedAt?, openedByAttemptId? }`。只由 apply / watchdog 在 `MODEL_AUTH`、`MODEL_QUOTA`、`MODEL_NOT_FOUND` 时打开；只由运维 `npx convex run ops:resetAgentCircuit` 关闭。不做自动半开：这三类错误不会自愈，自动探测只会浪费调用、制造噪音。熔断打开时，所有房间的提议回合在 claim 处失败 → run failed → 界面横幅"AI agents are unavailable. You can still choose an option manually."（R9）。

## 10.10 并发控制

1. **单活跃 run（R1）**：`startRunTx` 是创建 run 的唯一入口（04 §4.2）。它读取 `rooms.currentRunId` 指向的 run；手动启动时若已有活跃 run 就返回它；系统触发时先把它置 superseded 再创建新的。两个并发调用都读写 rooms 文档，OCC 让后提交者重试并看到前者结果（F11）。
2. **并行评审**：同一轮两个评审 attempt 并行。claim 都 patch run 文档（`modelCallsUsed`），apply 都 patch run 并读取本轮全部 turn。OCC 保证可串行化：若 T1 完成评审 A 时读到 B 仍 open，而 T2 在 T1 之前提交了 B 的完成，则 T1 的读集失效、被重试，重试时看到 B 已完成并执行 `concludeRound`。因此"两个都以为对方未完成、谁都不收尾"不会发生（依赖 inputs/04 §1.3 的 OCC 语义；并发行为在真实部署上用 RT-25 验证）。
3. **热点分离**：被几乎所有 mutation 读取做守卫的 `rooms` 文档，只在约束变化、run 创建、提案创建时被写；高频计数放在 `usageCounters`（部署级 8 分片）与 `runs` 上。审批 mutation 不写 rooms（执行时除外，执行本身是低频事件）。
4. **人与运行时的竞争**：约束变化与 apply 并发时，后提交者看到前者结果——apply 后到则因 G-A3 / G-A4 判 stale；bump 后到则把刚产生的提案纳入"当前提案是否仍可执行"的判断（09 §9.4）。审批在 run 为 awaiting_approval 时才允许，此时没有在飞的 attempt。

## 10.11 部署与版本

- **在飞期间部署是安全的**，不依赖"有活跃 run 时不部署"的纪律：被打断的 action 由 watchdog 收尾（F02），状态全在表里。运维只需在部署前查看 `ops.liveAttemptCount`，避免不必要的付费重试。
- `PROTOCOL_VERSION`（整数）：模型输出 schema 或其语义变化时 +1。claim 把它写进 attempt，apply 比对（G-A6），不一致即 stale 并重试一次（F24）。
- `PROMPT_VERSION`（字符串，如 `scope_change.v1.3`）：提示词内容变化时更新，写进 attempt，供离线对比质量与成本；不影响守卫。
- `rooms.scenarioVersion`：房间创建时固定。场景插件必须能处理所有仍有活跃房间的版本，或提供迁移（17）。
- schema 演进按 inputs/04：新增字段先 `v.optional`，回填后再收紧；开发部署可清表重新 seed。
