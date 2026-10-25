# 10 代理运行时（事件溯源候选）· part1：生命周期、调度、重试、用量、stub

> 分两片：part1（本文件）；`10-agent-runtime-part2.md` 模型调用规范（模型、effort、结构化输出、stop_reason、上下文与缓存）。

## 1. 决定

| # | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| AR-1 | **自建编排**：mutation 写状态 + 同事务 `ctx.scheduler.runAfter(0, internal.agents.runTurn)`；结果由 internal mutation `completeTurn`/`failTurn` 提交；看门狗 `turnWatchdog` | 事件日志 + 命令管线本身就是持久化编排：每一步状态都是事件，"工作流历史"已在日志里；等待人可能数天，只是状态行 | workflow 组件：要求 handler 确定性，改代码使在途实例失败，与日志重复记录历史；agent 组件：要换 Vercel AI SDK（与技术栈冲突） |
| AR-2 | 回合遥测放普通表 `agentTurns`，业务结果才成为事件 | 遥测量大、生命周期可变（running→终态）、含私有 rationale；不需要回放 | 遥测事件化：日志膨胀且隐私面扩大 |
| AR-3 | 重试只分两层：SDK 传输层（`maxRetries: 1`）+ 应用层（每回合至多 1 次自动新 attempt）；其余交给人点 "Retry turn" | 防止重试相乘（F10.4）；最坏调用数可算 | 多层叠加 |
| AR-4 | 持久化守卫在 `completeTurn` 中，迟到结果只记用量、写 `turn_rejected_stale` | scheduled action 不能被中止（inputs/04 §1.5） | 依赖 `scheduler.cancel` |
| AR-5 | stub 模式与真实模式共用全部下游（候选、schema、completeTurn、事件），回合标 `mode:"stub"`、提案 `authorKind:"rule"` | 确定性测试与无额度开发；如实标注（核心 8） | 独立的假流程 |

## 2. 生命周期与时序

```text
命令事务 (run_started 反应器 / proposal_created 反应器 / retryTurn)
  scheduleTurn(ctx, {runNo, role, phase, round, baseProposalVersion?}):
    candidates = enumerateCandidates(视角按 role)        // 06 §4
    insert agentTurns{status:"running", attempt:1, candidateIds, constraintsVersion, mode}
    fnId = scheduler.runAfter(0, internal.agents.runTurn, {turnId})
    scheduler.runAfter(WATCHDOG_MS, internal.agentsInternal.turnWatchdog, {turnId, attempt:1})
    patch agentTurns.scheduledFnId = fnId
──提交──▶
runTurn (internalAction, 默认运行时；若 SDK 打包/长连接有问题改 "use node" 文件——待验证)
  try {
    ctx0 = runQuery(internal.agentsInternal.getTurnContext, {turnId})   // 守卫预检 + 白名单上下文
    if (ctx0.stale) return runMutation(failTurn, {turnId, errorCode:"STALE_BEFORE_CALL"})
    if (!AGENTS_ENABLED) return runMutation(failTurn, {turnId, errorCode:"AGENTS_DISABLED", retryable:false})
    out = AGENT_MODE === "stub" ? stubDecide(ctx0) : await callModel(ctx0)   // part2
    await runMutation(internal.agentsInternal.completeTurn, {turnId, attempt, out})
  } catch (e) {
    await runMutation(internal.agentsInternal.failTurn, {turnId, attempt, errorCode: classify(e), usage})
  }
```

`completeTurn`（internalMutation，走 `runCommand`，actor = `{kind:"agent", role, runNo, turnSeq}`）：
1. 持久化守卫（04 §3）不过 → patch 回合 stale、写用量；追加 `turn_rejected_stale`；结束。
2. 写用量字段；Zod `safeParse` + 代码附加校验（05 §4）不过 → 回合 `invalid_output`；若 attempt = 1 → 同事务新建 attempt 2 并调度；否则按 failTurn 的终局处理。
3. 通过 → 回合 `succeeded`，output 存入；追加 `turn_completed`（+ propose 时 `proposal_created`）；反应器按 05 §7 决定下一步并在同事务调度。

`failTurn`：守卫不过 → stale；否则回合 `failed`。可重试错误（超时、429、5xx、连接错误、`max_tokens`、`refusal`、`invalid_output`）且 attempt = 1 且调用上限未到 → 追加 `turn_failed{willRetry:true}` + 调度 attempt 2；否则追加 `turn_failed{willRetry:false}` + `run_failed`。不可重试：`BadRequestError`（400，编程错误）、`AGENTS_DISABLED`、认证错误。

`turnWatchdog`（exactly-once 被调度 mutation）：若该 attempt 仍 running → 等同 `failTurn{errorCode:"TIMEOUT"}`。迟到的真实结果随后到达时，守卫第 1 条（attempt/status）使其 stale。

## 3. 时间与次数预算

| 常量 | 值 | 依据 |
| --- | --- | --- |
| `SDK_TIMEOUT_MS` | 45_000 | 显式覆盖 SDK 默认 10 分钟（inputs/04 §4.6）；Opus 5.5 medium 实际耗时**待验证**（实测 10 次取 p95 后调整） |
| `SDK_MAX_RETRIES` | 1 | 单 action 最坏 ≈ 2 × 45 s + 退避 ≈ 100 s，低于 action 上限（10 分钟，待验证） |
| `WATCHDOG_MS` | 150_000 | > 单 action 最坏耗时 + 提交余量 |
| 应用层自动重试 | 每回合 1 次 | AR-3 |
| `ROOM_CALL_LIMIT` | 30 次模型调用（按 agentTurns 中 mode=model 的行计数） | F10.5；到达后 `CALL_LIMIT_REACHED` |
| 最坏单轮 | 3 回合 × 2 attempt × 2 HTTP = 12 次 HTTP | 写进 15 的成本上限 |
| 延迟目标 | 单回合 p95 ≤ 20 s，单轮 ≤ 45 s（待最终模型实测确认） | 原审查目标 8 s 以 Opus 5.5 恐难达成，如实标"待验证" |

## 4. 并发控制

- 每房间至多一个活动 run（`rooms.currentRunNo`）；同一 run 同时最多两个在途回合（customer、finance 评估）。
- 两个评估回合提交时都写 rooms 流头 → OCC 串行化；后提交者在 `afterEvaluation` 中看到前者结果。
- 全局 Anthropic 速率：v1 不加 workpool；若出现 429 集中，再引入 workpool `maxParallelism`（17）。
- 全局总开关 `AGENTS_ENABLED`（Convex 环境变量）；关闭时 run 可启动但回合立即 `failed{AGENTS_DISABLED}`，界面提示。

## 5. 用量与成本记录

每个 attempt 一行 `agentTurns`，无论成败都写：`model`（取 `msg.model`，开启回退时可能不同）、`effort`、`inputTokens`、`cacheCreationInputTokens`、`cacheReadInputTokens`、`outputTokens`、`thinkingTokens`（`usage.output_tokens_details.thinking_tokens`）、`stopReason`、`requestId`（`_request_id`）、`latencyMs`、`errorCode`。成本不入库，由 `metrics.summary` 按价格表离线估算并标"估算"。

为保证截断/拒绝时也有用量，用 `messages.create` 而不是会抛错的 `parse()`（inputs/04 §4.4）。

## 6. stub 模式

`AGENT_MODE=stub`（每个 deployment 可设）：

| 回合 | stub 行为 |
| --- | --- |
| provider propose | 选 buyer 视角排序第一的候选（若本回合 candidateIds 中有）否则 seller 视角第一 |
| customer evaluate | 提案校验通过且满足全部 desired → recommend_accept；否则 counter 到最优候选；无可行 → reject NEEDS_TRADEOFF |
| finance evaluate | 校验通过 → recommend_accept；OVER_BUDGET → counter 到最便宜满足必需项的候选 |

rationale 写固定英文 "Deterministic stub: …"。stub 回合 `mode:"stub"`，由它产生的提案 `authorKind:"rule"`，UI 徽章 "Rule-based (no model)"。
