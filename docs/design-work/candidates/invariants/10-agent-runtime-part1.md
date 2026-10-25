# 10 代理运行时 · part1：编排选型、run 生命周期、调度与并发、持久化守卫、重试与超时、用量与上限

## 1. 编排选型：自建 scheduler 链（ADR-05）

- 选项：①mutation + `ctx.scheduler` + 回合表 + watchdog（自建）；②`@convex-dev/workflow`；③`@convex-dev/agent`。
- 决定：①。理由（全部来自 inputs/04 §2）：
  - 一次协商是"少量有界回合 + 长时间等人"。等人只是状态行，不需要挂起的工作流；有界回合用 run/回合两张表就能表达。
  - workflow 要求 handler 确定性，改代码会让在途实例失败；本项目的规则与协议会持续迭代，这是实际成本。
  - agent 组件要求改用 Vercel AI SDK，与已定的 `@anthropic-ai/sdk` 冲突，且其线程模型默认跨线程带入消息，与私密委托相悖。
  - 无论选哪条路，"迟到结果拒收、每房间单活动 run、私密上下文组装、用量统计"都要自建；组件只覆盖调度与重试的一半。
- 后果：需要自己写 watchdog、重试与取消；换来零新依赖、全部状态在自有表中可查询与测试。若将来需要跨多日的多步骤自动化，再评估 workflow（17）。

## 2. 生命周期与函数

```text
public mutation  runs.start / onConstraintsChanged / decisions.record(reject) / requests.answer …
   └─ startRun ── scheduleTurn(provider, propose) ──┬─ runAfter(0)      internal.agents.executeTurn  (action)
                                                    └─ runAfter(DEADLINE) internal.agents.turnWatchdog (mutation)
executeTurn (action):  context.build (query) → 模型调用 / stub → completeTurn 或 failTurn (mutation)
completeTurn (mutation): assertTurnLive → 记用量 → 三层校验 L3 → 分派（05 part1 §5）→ settleStep → 可能 scheduleTurn …
turnWatchdog (mutation): 回合仍 running 且已到 deadlineAt → 视为 TIMEOUT，按 failTurn 逻辑处理
```

| 函数 | 类型 | 职责 | 不做什么 |
| --- | --- | --- | --- |
| `startRun` | helper（在 mutation 内） | RN-1 守卫、预检可行集、插入 run、调度首回合或开请求 | 不调模型 |
| `scheduleTurn` | helper | RN-5 计数、插入回合、同事务调度 action 与 watchdog（RN-4） | — |
| `agents.context.build` | internalQuery | 回合仍 running 时返回 07 §7 的 AgentContext；否则返回 null | 不返回原始文档 |
| `agents.executeTurn` | internalAction | 读上下文 → 调 Claude 或 stub → L2 校验 → 一次 runMutation 提交 | 不写业务表、不 console 内容 |
| `agents.commit.completeTurn` | internalMutation | 活性守卫、写 modelCall、L3 校验、分派、结算 | — |
| `agents.commit.failTurn` | internalMutation | 活性守卫、写 modelCall、按错误码重试或 run → failed | — |
| `agents.commit.turnWatchdog` | internalMutation | 到期仍 running → TIMEOUT 处理；否则 no-op | — |
| `cancelLiveTurns` | helper | 尽力 `scheduler.cancel` + 回合 → cancelled | 不依赖取消成功 |

持久化放在独立的 internal mutation 里，而不是 action 内的多次 runMutation：模型调用之后只有**一次**提交事务，提交失败（OCC 重试由平台负责）不会触发重复付费的模型调用（F10.2）。

## 3. 持久化守卫（RN-3）

```ts
function assertTurnLive(room: Doc<"rooms">, run: Doc<"runs">, turn: Doc<"agentTurns">): LiveCheck {
  if (turn.status !== "running") return { live: false, why: "turn_not_running" };   // cancelled / 已超时
  if (room.currentRunId !== run._id) return { live: false, why: "run_not_current" };
  if (run.status !== "negotiating") return { live: false, why: "run_not_negotiating" };
  if (!run.pendingTurnIds.includes(turn._id)) return { live: false, why: "turn_not_pending" };
  if (run.constraintsVersion !== room.constraintsVersion) return { live: false, why: "constraints_changed" };
  return { live: true };
}
```
- `completeTurn` / `failTurn` 在不活时：若回合仍为 running（例如 run 被替换但回合未及取消）→ 置 stale 并写 `turn_rejected_stale`；若已是 cancelled/failed → 保持原状态。两种情况都**只**插入 modelCall（用量必须如实记录），不写任何业务表。
- 守卫只读信封快照与当前房间，不读模型输出里的任何版本或身份（05 part1 §2）。

## 4. 调度与并发

- **串行深度 2**：propose（provider）→ evaluate（customer ∥ finance）。两个评估回合的 `completeTurn` 都 patch run 与 room，OCC 串行化；后提交者看到 `pendingTurnIds` 已缩短，最后一个触发 `settleStep`。
- **每房间单活动 run**（RN-1）；不同房间互不影响。全局对 Anthropic 的并发由账户速率限制约束（具体额度待验证 #12）；v1 不引入 workpool，若 429 频繁，再加 `@convex-dev/workpool` 的 `maxParallelism`（17）。
- **`runs.start` 冷却**：同一房间两次 start 至少相隔 10 秒（读最近 run 的 createdAt），挡住连点。

## 5. 重试、超时与延迟预算（"一类错误只由一层负责"，F10.4）

| 错误类 | 负责层 | 参数 |
| --- | --- | --- |
| 传输：408/409/429/5xx、连接错误、单次 HTTP 超时 | SDK | `maxRetries: 1`，`timeout: 60_000`（每次 HTTP 尝试） |
| 语义：schema 不符、截断（stop_reason = max_tokens）、未知报价行、动作不允许 | 应用（新回合行 attempt + 1） | `MAX_AUTO_ATTEMPTS = 2`，立即重排 |
| 平台：action 被中断、超出 deadline | watchdog → 应用重试 | `TURN_DEADLINE_MS = 180_000` |
| 编程错误：400 BadRequest | 无重试；run → failed，告警 | — |
| 拒答：stop_reason = refusal | 无自动重试；run → failed，界面"代理拒绝了该请求"，可人工重试 | — |

最坏情况：单次逻辑调用 ≈ 2 × 60 s + 退避 ≈ 130 s < deadline 180 s < Convex action 上限（约 10 分钟，待验证 #1）；单回合最多 2 次自动尝试 ≈ 6 分钟；一轮（propose + 并行 evaluate）最坏 ≈ 12 分钟。这是**上限**，不是目标。目标（待用最终模型实测 ≥ 10 次后定稿，待验证 #5）：单回合 p95 ≤ 30 s、一轮 p95 ≤ 60 s、约束变化后到新提案出现 ≤ 2 轮。超出目标就先调 effort 与 max_tokens，再考虑模型选择（交用户决定，18）。

## 6. 调用预算与总开关

- `rooms.modelCallBudget` 默认 40；`scheduleTurn` 在 llm 模式下先 `modelCallsUsed += 1`，超出则不调度，run → failed（`CALL_BUDGET_EXHAUSTED`）。抽取调用也计入。运维可用 `ops.setRoomCallBudget` 调整（写事件）。
- `AGENTS_ENABLED`（Convex 环境变量）：为 false 时 `executeTurn` 不调用模型，直接 `failTurn(AGENTS_DISABLED)`；`startRun` 预先拒绝并说明。
- `AGENT_MODE = llm | stub`：在 `startRun` 时读取并固定在 `run.agentMode`，同一 run 内不切换。无 `ANTHROPIC_API_KEY` 的部署强制 stub。
- 花费上限的最终防线在 Anthropic 控制台：开发与生产使用不同 workspace 与 key，各设月度上限（15）。

## 7. 用量与成本记录

每次真实模型调用（成功、失败、截断、拒答、迟到被拒）都插入一行 `modelCalls`（03 §20），字段直接来自响应：`usage.input_tokens`、`cache_creation_input_tokens`、`cache_read_input_tokens`、`output_tokens`、`output_tokens_details.thinking_tokens`、`stop_reason`、`msg.model`、`msg.id`、`_request_id`，以及 effort、max_tokens、latencyMs、outcome。HTTP 错误没有 usage 时记 0 并标 outcome。成本 = token × 版本化价格表常量（`PRICE_TABLE = "2026-10"`，来自 inputs/04 §4.1），界面一律标注 "estimate"；不在仓库外宣称节省或改进（P-18）。SDK 内部重试的失败尝试是否计费待验证（#10），因此估算可能偏低，界面注明。
