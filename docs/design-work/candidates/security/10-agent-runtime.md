# 10 代理运行时（part1：编排选型、回合生命周期、重试与超时、限流与开关、stub）

> 本章分 2 个文件：part1（本文件）；part2 模型调用规范、上下文与缓存、用量与成本、简报抽取、待验证事项。

## 10.1 编排选型：自建 scheduler 链

| 选项 | 结论 | 理由 |
| --- | --- | --- |
| 自建：mutation + `ctx.scheduler` + 回合表 + 看门狗 | **采用** | 无论选哪条路，"迟到结果拒收、每房间一个活动 run、私密上下文组装、用量记录"都要自建（inputs/04 §2.2）；剩下的只是"调度一次 action + 重试 + 超时"，自建代码量小且全部状态都在自有表中、可按受众建模 |
| `@convex-dev/workflow` | 否决（v1） | handler 必须确定性、改代码会让在途实例失败；本系统的规则与协议会持续迭代；等待人审批本来就只是状态行，不需要 `awaitEvent` |
| `@convex-dev/workpool` / `action-retrier` | 否决（v1），保留为扩展点 | 重试与并发上限是它们的价值；我们的重试必须由同一层负责并记录每次 HTTP 尝试（§10.4），自建更直接；若将来需要全局并发上限再引入 workpool |
| `@convex-dev/agent` | 否决 | 要求换成 Vercel AI SDK，与已定技术栈冲突；线程模型默认跨上下文读取历史，与逐方隔离相悖（inputs/04 §2.1） |

## 10.2 函数与职责

| 函数 | 类型 | 职责 |
| --- | --- | --- |
| `startRun` | helper（在 mutation 内） | 终止旧 run、插入新 run、按起始状态调度第一个回合或生成请求（04 R1–R3） |
| `scheduleTurn` | helper | 校验上限与开关、插入 `agentTurns(scheduled)`、`callCount + 1`、`runAfter` 调度 `runTurn` 与 `turnWatchdog`，记下两个调度 id |
| `agentRuntime.runTurn` | internalAction | 调 `beginTurn` → 调模型（或 stub）→ 调 `completeTurn` 或 `failTurn`；整体 try/catch |
| `agentRuntime.beginTurn` | internalMutation | 回合守卫；`scheduled → running`；冻结候选与输入版本；返回 `AgentContext` 与输出 schema |
| `agentRuntime.completeTurn` | internalMutation | 写 `modelCalls`；回合守卫；`interpretOutput`；写笔记、提案、披露请求；推进轮次（05 §5.6） |
| `agentRuntime.failTurn` | internalMutation | 写 `modelCalls`；回合仍为当前则判定自动重试或 run → failed |
| `agentRuntime.turnWatchdog` | internalMutation | 截止时回合仍非终态 → `WATCHDOG_TIMEOUT`，同 failTurn 的后续 |
| `runs.retry` | mutation | 人工重试失败的回合（04 R8） |

```ts
export const runTurn = internalAction({
  args: { turnId: v.id("agentTurns") },
  handler: async (ctx, { turnId }) => {
    const begin = await ctx.runMutation(internal.agentRuntime.beginTurn, { turnId });
    if (begin.kind !== "go") return;                              // stale、已取消、开关关闭
    const t0 = Date.now();
    let r: CallResult;
    try {
      r = begin.agentMode === "stub" ? stubCall(begin.context) : await callModel(clientFromEnv(), begin.request);
    } catch (e) {
      r = { kind: "error", errorCode: classifyError(e), httpStatus: httpStatusOf(e) };   // 不保存 e.message
    }
    const meta = { latencyMs: Date.now() - t0, contextDigest: await sha256Hex(canonicalJson(begin.context)) };
    if (r.kind === "ok") {
      const interpreted = interpretOutput(r.raw, begin.context, begin.rejectReasons);
      await ctx.runMutation(internal.agentRuntime.completeTurn, { turnId, interpreted, usage: r.usage, meta: { ...meta, ...r.meta } });
    } else {
      await ctx.runMutation(internal.agentRuntime.failTurn, { turnId, errorCode: r.errorCode, usage: r.usage, meta });
    }
  },
});
```

`completeTurn` 收到的是解释后的决定（候选 id、枚举、截断后的 rationale），它在事务内再按冻结的候选列表核对一次 id（不信任 action 的映射）。原始模型文本不跨越 action 边界写入任何表。

## 10.3 回合时序与失败点

| 步 | 位置 | 可能的失败 | 失败后状态 |
| --- | --- | --- | --- |
| 1 | `scheduleTurn`（调用方 mutation 内） | 达到上限 / 开关关闭 | 不调度；上限：当前提案通过则 run → `awaiting_approval`，否则 `needs_human`（04 R6）；开关关闭：run → `failed`（`AGENTS_DISABLED`） |
| 2 | 调度器启动 `runTurn` | 平台未执行（at-most-once） | 看门狗在截止时置 failed |
| 3 | `beginTurn` | 守卫不成立 | 回合 `rejected_stale`，不调用模型 |
| 4 | 模型调用 | 超时、429、5xx、网络、max_tokens、refusal | `failTurn` |
| 5 | action 被部署打断或超时 | 无回调 | 看门狗 |
| 6 | `completeTurn` | 守卫不成立 | `rejected_stale`（用量照记） |
| 7 | `completeTurn` | 语义无效 | 回合 failed（`OUTPUT_SEMANTIC`），按重试规则 |
| 8 | `completeTurn` | OCC 冲突 | Convex 自动重试该 mutation（被调度/被调用的 mutation 会重试，inputs/04 §1.5） |

## 10.4 重试与超时：只有一层

| 层 | 设置 | 理由 |
| --- | --- | --- |
| SDK 传输层 | `maxRetries: 0`，`timeout: 90_000` | 让每一次 HTTP 尝试都对应一行 `modelCalls`，用量与成本可精确记录；避免 SDK 默认 10 分钟 × 3 次超出 action 上限（inputs/04 §4.6） |
| 应用层自动重试 | 每回合最多 2 次尝试；可重试错误见 04 §4.6；退避：429 读 `retry-after`（上限 30 s），其余 `2 s × attempt` + 抖动 | 一层负责，计数可见 |
| 人工重试 | 每回合最多 3 次（`runs.retry`） | 让人决定是否继续花钱 |
| 看门狗 | `TURN_DEADLINE_MS = 150_000` | > SDK 超时 + 提交余量；action 最长运行时间待验证（文档常见为 10 分钟），只要大于 90 s 即可 |

最坏情况：每 run `maxCalls = 12`（含失败尝试），单次最长 90 s；一个 run 的模型墙钟最坏约 18 分钟，但它不阻塞任何人的操作，任何约束变更都会立即取代它。延迟目标（待用最终模型实测 10 次后确认）：单回合 p95 ≤ 20 s；正常两轮协商从开始到 `awaiting_approval` ≤ 60 s。

## 10.5 并发控制

- 每房间至多一个非终态 run（I-10）；run 内同一轮的 review 回合并行，轮与轮串行。
- 回合之间没有锁：正确性来自回合守卫（04 §4.9）与 OCC。
- 全局并发：Anthropic 速率上限按账户等级（待验证）。v1 不做全局队列；遇 429 由应用层退避。若实测出现持续 429，再引入 workpool 的 `maxParallelism`（17）。

## 10.6 限流与总开关

| 限制 | 默认 | 落点 |
| --- | --- | --- |
| 每 run 模型调用 | 12 | `runs.callCount`，`scheduleTurn` 内原子 +1 |
| 每房间每日模型调用 | 40 | `counters`（`calls:room:<id>`, UTC 日） |
| 每用户每日"请求重新协商" | 5 | `counters` |
| 每用户每日简报抽取 | 20 | `counters` |
| 每房间每日目录发布 | 5 | `counters`（同时抑制 T-09 的探测） |
| 建房 | `ROOM_CREATION=allowlist`（生产默认）或 `open` | `rooms.create` |
| 总开关 | `AGENTS_ENABLED=false` 时不调度、不调用 | `scheduleTurn`、`beginTurn` |
| 花费上限 | 开发与生产各自的 Anthropic workspace 上限 | 供应商控制台（15） |

## 10.7 stub 模式

- `AGENT_MODE=stub`（Convex 部署环境变量）时，`startRun` 把 `run.agentMode` 置为 `stub`，该 run 的所有回合由 `stubDecide(context)` 产生决定（05 §5.4），不访问网络。
- stub 与真实代理共用：上下文组装、输出 schema、`interpretOutput`、轮次裁决、全部守卫与记录。所以无密钥的开发环境、CI 与 convex-test 能确定性地跑通"激活 → 提案 → 审批 → 降预算阻断 → 重谈 → 执行"。
- 标注：`agentTurns.agentMode`、`agentNotes.isSimulated`、`proposals.author.mode`、`modelCalls.isSimulated` 都为 stub/true；界面在提案与笔记上显示 "Simulated agent"（核心 8）。
- 不提供"录制回放"模式：预跑结果容易被误当成现场生成（F10.8），而 stub 已满足离线与演示需求。
