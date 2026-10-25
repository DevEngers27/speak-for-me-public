# 10 代理运行时（第 1/3 部分：生命周期、调度、并发、重试、过期拒绝）

## 10.1 编排选择：自建 scheduler 链
选择"mutation 写状态 + 同事务 `runAfter(0, internal.agents.runTurn)` + watchdog mutation"，不用 workflow / workpool / agent 组件（ADR-07）。理由：每回合只是"一次调用 + 一次提交"，等人只是状态行；workflow 的确定性重放与"改代码使在途实例失败"对频繁迭代提示词与协议是实际成本；agent 组件要求换 AI SDK。无论哪条路都必须自建过期拒绝与上下文隔离。

## 10.2 一个回合的完整时序

```text
mutation (R1/R3/...)  scheduleTurns(run, plans)
  ├─ insert turns{status:running, attemptCount:1, 信封快照, offeredCandidateKeys, roleViewHash}
  ├─ runAfter(0, internal.agents.runTurn, {turnId, attemptNo:1})
  └─ runAfter(TURN_DEADLINE_MS, internal.agents.turnWatchdog, {turnId})   // 记 watchdogFnId
action internal.agents.runTurn({turnId, attemptNo})
  1. snap = runQuery(internal.agents.loadTurnContext, {turnId})      // 只读本角色授权数据
     └─ 若 turn 已非 running / attemptNo 不符 → 直接返回（无模型调用）
  2. gate = runMutation(internal.agents.beginAttempt, {turnId, attemptNo})
     └─ 原子：G-T 检查、AGENTS_ENABLED、run.modelCallCount < limit、房间日上限 → callCount+1
     └─ 拒绝 → 返回（beginAttempt 已负责把 run 置 paused 或什么都不做）
  3. view = buildRoleView(snap); req = buildRequest(view, promptVersion)
  4. result = await driver.decide(req)        // live 时调用 Claude；try/catch 包住
  5. parsed = parseAndCheck(result, view.turnSpec)   // stop_reason → JSON → Zod → checkDecision
  6. runMutation(internal.agents.completeTurn, {turnId, attemptNo, usage, outcome, parsed})
     └─ 单个 mutation：G-T → 记 modelCalls → 分支：
        ok        → turn succeeded；归约 reduceRun → 应用 effects（提案、事件、调度下一批 turn、状态迁移）
        invalid   → attemptNo < 2 ? 调度 attempt 2（带反馈）: turn failed → run paused
        max_tokens/refusal/api_error/timeout → turn failed → run paused（R6）
        G-T 不通过 → turn stale（若仍 running）；只记 modelCalls（outcome stale_discarded）
mutation internal.agents.turnWatchdog({turnId})
  └─ turn 仍 running 且 now ≥ startedAt + deadline → turn failed(TIMEOUT)，run paused；否则无操作
```

要点：
- **持久化不在 action 里做多次写**：action 只有一次 `beginAttempt` 和一次 `completeTurn`；用量与结果在同一个 mutation 落库，避免"写失败触发再次付费调用"。
- `completeTurn` 永远会被调用（catch 分支也调用，outcome = api_error / timeout）；action 被平台中断时由 watchdog 兜底（at-most-once，inputs/04 §1.5）。
- `beginAttempt` 在调用模型前 +1 计数，所以即使 action 之后丢失，调用数上限仍然成立（I14）。

## 10.3 并行评估与 OCC
- 评估方两个 turn 在同一 mutation 中调度，两个 action 并行。
- 两个 `completeTurn` 都写同一个 run 文档（`openTurnCount -= 1`），OCC 让它们串行化；后提交者看到 `openTurnCount === 0`，负责调用 `resolveRound` 并推进。先提交者只落自己的 turn。
- 这把"等两个都完成"变成纯数据条件，无需锁或额外调度。

## 10.4 超时、重试只写一份预算

| 层 | 负责什么 | 配置 |
| --- | --- | --- |
| SDK 传输层 | 408/409/429/5xx/连接错误/超时 | `timeout: 60_000`、`maxRetries: 2`（显式设置，覆盖默认 10 分钟 × 3） |
| 应用层 attempt | 只针对 invalid_output（schema / 语义失败） | 每 turn 最多 2 次 attempt，第 2 次带错误反馈 |
| 人工 | turn failed 后成员点 "Retry turn"（R7） | 受 modelCallLimit 约束 |
| watchdog | action 丢失 | `TURN_DEADLINE_MS = 240_000`（≥ 60s × 3 + 退避 + 提交余量） |

最坏单 turn 墙钟 ≈ 2 attempt × 3 HTTP × 60s = 6 分钟，低于 Convex action 上限（文档通常 10 分钟，待验证 #1）；watchdog 240s 只覆盖单个 attempt，第 2 个 attempt 调度时重新登记 watchdog。延迟目标（实测后定，待验证 #5）：turn p95 ≤ 25s（Opus 5.5 medium 的预估），重新协商端到端 p95 ≤ 90s；若实测超出，先降 effort 再调 max_tokens，不换模型（技能规定不得为省钱自行降级）。

`BadRequestError`（400）视为编程错误：不重试，turn failed(`API_BAD_REQUEST`)，运维告警。

## 10.5 过期拒绝（stale）
G-T 守卫（04 §4.3）检查 currentRunId、run.status、turn.status、constraintsVersion、catalogRevision、attemptNo。任一不符 → 丢弃结果，写 `turn.stale` 事件（audience = 该角色），modelCalls 记 `stale_discarded`，用量照记（成本真实发生）。

## 10.6 上限与总开关

| 上限 | 值（默认） | 落点 | 触发后 |
| --- | --- | --- | --- |
| 每 turn attempt | 2 | completeTurn | turn failed |
| 每 run 模型调用 | 16 | beginAttempt | run paused(call_limit)，UI 提示"联系 owner 重启" |
| 每房间每日调用 | 60 | `usageCounters` 按 (roomId, utcDay) 分片计数文档（beginAttempt 内 +1） | 同上 |
| 全局 | `AGENTS_ENABLED`（Convex env） | beginAttempt / startRunInternal | run paused(agents_disabled)；stub 模式不受影响 |
| 花费 | Anthropic 控制台 workspace 花费上限（dev / prod 分开） | 平台 | 429/403 → api_error |

`usageCounters` 表：`{ roomId, utcDay: string, calls: number }`，索引 `by_roomId_and_utcDay`；只在 beginAttempt 写，冲突面限于单房间单日。
