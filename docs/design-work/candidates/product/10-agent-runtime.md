# 10 代理运行时（part1）：生命周期、编排、并发、重试与超时、过期拒收、调用上限

> 本章分 2 片：part1（本文件）10.1–10.7；part2 10.8 模型调用规范、10.9 定时任务、10.10 上下文与提示布局、10.11 用量与成本、10.12 stub 模式、10.13 简报抽取调用、10.14 文件布局。平台事实以 inputs/04 为准。

## 10.1 一次回合的完整时序

```text
mutation（任一触发）            internal action                     internal mutation
startRun ─ scheduleTurn ──runAfter(0)──> runtime.runTurn ──runMutation──> runtime.completeTurn
   │         │                      │  getTurnInput (internalQuery)        │  G-PERSIST → 四步校验 → 选择/决议
   │         └─runAfter(150s)─> runtime.turnWatchdog                       │  → insertProposal / openAgentRequests
   │                                └─ catch ──runMutation──> runtime.failTurn   → scheduleTurn(下一回合) 或 finishRun
```

1. **状态迁移与启动外部调用在同一 mutation**：`scheduleTurn` 插入 turn 行并 `runAfter(0, runTurn)`；mutation 回滚则调度一并消失（04 平台约束 1.5）。
2. **action 只做 I/O**：读输入（一次 `runQuery`）、调用模型或 stub、提交结果（一次 `runMutation`）。持久化放在独立 mutation，不在 action 内多次写库，避免"持久化失败导致重复付费调用"（F10.2）。
3. **提交 mutation 重新校验一切**：G-PERSIST、输出校验、候选可执行性，都以落库时刻的状态为准（04 平台约束 1.4）。
4. **at-most-once 的兜底**：被调度的 action 不重试、平台中断时没有回调，所以每个回合同时调度一个看门狗 mutation（exactly-once）。

## 10.2 编排选型（ADR-06）

| 选项 | 结论 | 理由 |
| --- | --- | --- |
| 自建：mutation + `ctx.scheduler` + turn 表 + 看门狗 | **采用** | 一次 run 是 ≤ 3 轮、每轮 ≤ 3 个回合的有限序列；等待人是状态行而不是挂起的进程；迟到结果拒收、单活跃 run、私密上下文无论如何都要自建；不引入确定性重放约束 |
| `@convex-dev/workflow` | 否决 | handler 必须确定性、修改步骤结构会使在途实例失败（规则迭代期成本高）；`awaitEvent` 解决的"长时间等人"在本设计里本就是状态行；仍需自建过期拒收 |
| `@convex-dev/workpool` / `action-retrier` | 暂不采用 | 只有在全局并发需要限流时才有价值；v1 由每房间串行 + 供应商速率上限覆盖；若实测出现 429 风暴再引入 `maxParallelism`（17） |
| `@convex-dev/agent` | 否决 | 要求改用 Vercel AI SDK v7，与已定的 `@anthropic-ai/sdk` 冲突；线程模型需额外证明私密隔离 |

## 10.3 `runtime.runTurn`（internal action）

```ts
export const runTurn = internalAction({
  args: { turnId: v.id("turns") },
  handler: async (ctx, { turnId }) => {
    const input = await ctx.runQuery(internal.runtime.getTurnInput, { turnId });
    if (!input) return;                                  // 回合已非 running（被取消、超时、superseded）
    const t0 = Date.now();
    try {
      if (input.agentMode === "live" && process.env.AGENTS_ENABLED !== "true")
        throw new AgentError("AGENTS_DISABLED", { retryable: false });
      const raw = input.agentMode === "stub"
        ? stubResponse(input)                            // 确定性，无网络
        : await callModel(input);                        // convex/runtime/model.ts，只依赖 SDK
      await ctx.runMutation(internal.runtime.completeTurn, { turnId, raw, latencyMs: Date.now() - t0 });
    } catch (e) {
      await ctx.runMutation(internal.runtime.failTurn,
        { turnId, error: classifyError(e), latencyMs: Date.now() - t0 });
    }
  },
});
```

`raw = { text, stopReason, usage, model, providerRequestId }`：解析与校验在 `completeTurn` 中进行（05 第 5.5 节），这样截断、拒答、校验失败都能先保存用量再判定。

## 10.4 并发控制

| 机制 | 保证 |
| --- | --- |
| `rooms.activeRunId` 单指针（I-23） | 每房间至多一个 running/stalled run；`startRun` 在同一 mutation 内检查并设置 |
| `run.openTurnIds` | 只有当前阶段登记的回合能落库；审阅并行的两个回合各自 `completeTurn`，都 patch 同一个 run 文档，由 OCC 串行化；最后一个完成者执行阶段决议 |
| `run.constraintsVersion` | 约束变化后整批结果被拒（G-PERSIST） |
| 每回合看门狗 | action 丢失或超时 → 回合 `timed_out`，不会永远 running |
| 房间间不共享状态 | 不同房间的 run 完全独立，不需要全局锁 |

## 10.5 重试与超时（只在一处计数）

| 层 | 设置 | 说明 |
| --- | --- | --- |
| SDK 传输层 | `new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 })` | 超时、408/409/429/5xx、连接错误由 SDK 重试 1 次；默认 10 分钟超时 × 3 次会远超 action 上限，必须显式覆盖（04 平台约束 4.6） |
| 应用层（每个 seq） | 自动 attempt 上限 2（首次 + 1 次自动重试）；可重试错误退避 `2s × attempt` | `invalid_output`、可重试失败、`timed_out` 计入；不可重试错误直接 stalled |
| 人工重试 | `negotiation.retryRun`：每次新增 1 个 attempt 并附带 1 次自动重试；每个 seq 总 attempt ≤ 6 | |
| 看门狗 | `TURN_DEADLINE_MS = 150_000` | ≥ 单次 attempt 最坏耗时（60s × 2 + 退避 ≈ 125s）+ 余量 |

最坏调用数（写成常量并在启动时断言）：每轮提出方 2 次尝试（a1、a2）× 2 attempt + 审阅方 2 × 2 attempt = 8 次逻辑调用；3 轮 = 24（`RUN_CALL_BUDGET = 24`）；HTTP 层最多 ×2 = 48。延迟目标（待用最终模型实测 10 次后确认）：单回合 p95 ≤ 20s；无故障时一轮串行深度 2，约束变化后到新提案出现 p95 ≤ 45s。若实测超出，先降 `effort`、收紧 `max_tokens`，再考虑换模型（需用户决策，18）。

## 10.6 过期结果拒收

`completeTurn` / `failTurn` / `turnWatchdog` 的第一步都是 G-PERSIST。失败时：回合 → `stale`（只记录用量与 `errorCode: "STALE_RESULT"`），不写提案、不写立场、不调度后续，若模型确实产出了结果则写 `turn_stale` 事件。这同时覆盖：约束变化、run 被取消或执行、看门狗已判超时后才到达的结果、并行回合中另一个已触发阶段决议的情况。`ctx.scheduler.cancel` 只是尽力而为（不能中止在途 action），正确性从不依赖它。

## 10.7 调用上限与总开关

| 上限 | 值（默认，可配置） | 落点 | 超限时 |
| --- | --- | --- | --- |
| 每 run 模型调用 | 24 | `runtime.reserveCall`（`scheduleTurn` 内原子 +1） | run → stalled（`CALL_BUDGET_EXHAUSTED`），人工路径照常 |
| 每房间每 24 小时 | 120 | `turns.by_room_started` 计数 | 不开新 run；阶段 `blocked/call_budget_exhausted` |
| 每房间每小时人工触发（requestRun/retryRun/cancelRun 合计） | 10 | `runs`/事件计数 | `RATE_LIMITED` |
| 全局开关 | `AGENTS_ENABLED`（Convex 环境变量） | `startRun`、`runTurn` 开头检查 | 新 run 不启动；在途回合以 `AGENTS_DISABLED` 失败并 stalled |
| 供应商侧 | Anthropic workspace 花费上限，dev/prod 分开 | 控制台 | 429/402 → 可重试/不可重试分类 |

不做全局每日计数文档（单文档热点、OCC 冲突），以供应商侧花费上限兜底（F10.5）。
