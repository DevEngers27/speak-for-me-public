# 10 代理运行时

## 1. 编排：自建 scheduler 链（ADR-11）

- 不用 `@convex-dev/workflow`（确定性约束、部署打断在途实例）与 `@convex-dev/agent`（要求 Vercel AI SDK，与技术栈冲突）。我们需要的只是"一个回合 = 一次 action + 一次提交 mutation + 一个看门狗"，自建更少依赖、守卫更直接。
- 无论哪条路，过期拒绝、单活动 run、私密过滤都要自建（inputs/04 §2 含义 1）。

## 2. 回合生命周期

```text
mutation（startRunInternal / completeTurn / reject / retryTurn）
  └─ startTurn(ctx, run, role, kind)          // 同一 mutation 内
       ├─ G-T 前置检查；modelCallCount < maxModelCalls 才 +1（超限 → run needs_input）
       ├─ insert agentTurns{status running, constraintsVersion, candidateKeys, attempt}
       ├─ run.openTurnSeqs.push(turnSeq)；run.nextTurnSeq++
       ├─ runAfter(0, internal.agents.runTurn, { turnId })
       └─ runAfter(WATCHDOG_MS, internal.agents.turnWatchdog, { turnId })
action internal.agents.runTurn({ turnId })
  ├─ if (!AGENTS_ENABLED) → failTurn(AGENTS_DISABLED)
  ├─ ctx = runQuery(internal.agents.context.build, { turnId })   // 一次读
  ├─ AGENT_MODE === "stub" ? stubDecide(ctx) : callModel(ctx)     // try/catch 包住
  └─ runMutation(internal.agents.completeTurn | failTurn, {...})  // 一次写
mutation completeTurn({ turnId, output?, usage, stopReason, requestId, latencyMs })
  ├─ G-T；不通过 → stale（仍记录 usage）
  ├─ 校验输出（§4）；不合法 → invalid_output，attempt < 2 则同 turnSeq attempt+1 重新 startTurn
  ├─ 应用动作：规则闸门 / insertProposal / 调度评估 / 推进 run（05 §3）
  └─ openTurnSeqs 移除本 turnSeq
mutation turnWatchdog({ turnId }) —— exactly-once
  └─ 若仍 running → failed(errorCode "TIMEOUT")，按 failTurn 规则推进
```

- 持久化与模型调用分离：提交失败（OCC 重试由平台完成）不会触发重复付费调用。
- `failTurn`：可重试错误（429、5xx、超时、invalid_output）且 attempt < 2 → 自动 retry 一次；否则 turn failed，run → failed（界面 "Retry turn"）。`BadRequestError`（400）视为编程错误，不重试。

## 3. 超时与重试预算（只有一层负责传输重试）

| 层 | 设置 | 说明 |
| --- | --- | --- |
| SDK | `maxRetries: 1`，`timeout: 45_000` | 显式覆盖默认 10 分钟 × 3（inputs/04 §4.6）；45s 待按实测 p95 调整 |
| 应用 | invalid_output / 可重试失败自动 1 次 | attempt 记录在 agentTurns |
| 看门狗 | `WATCHDOG_MS = 45s × 2 + 30s = 120s` | 覆盖 action 被平台中断无回调的情况 |
| 最坏情况 | 每 run ≤ `maxModelCalls`(12) 次逻辑调用 | 每次 ≤ 2 HTTP 尝试；写进 15 的成本上限 |

## 4. 模型调用规范（`convex/agents/callModel.ts`，只依赖 SDK 与 zod）

```ts
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45_000 });
const MODEL_ALLOWLIST = ["claude-opus-5-5"] as const;          // 用户可在 18 中拍板加入 sonnet/haiku
const msg = await client.messages.create({
  model: cfg.model,                    // 默认 "claude-opus-5-5"，启动时校验白名单
  max_tokens: 8000,                    // 思考 + 输出；< 21,333 非流式上限
  output_config: { effort: cfg.effort /* 默认 "medium" */,
                   format: { type: "json_schema", schema: turnSchemaJson(kind, candidateKeys) } },
  system: [{ type: "text", text: PROTOCOL_AND_SCENARIO_RULES, cache_control: { type: "ephemeral" } }],
  messages: [
    { role: "user", content: renderContext(ctx) },           // 本方简报、共享事实、候选、历史
    { role: "system", content: renderTask(ctx.envelope) },    // 中途 system：本回合任务
  ],
});
record(msg.usage, msg.model, msg.stop_reason, msg._request_id);  // 先记用量
if (msg.stop_reason !== "end_turn") return invalid(`STOP_${msg.stop_reason}`);
const text = msg.content.find(b => b.type === "text")?.text;
const parsed = TurnOutput(kind).safeParse(safeJson(text));
if (!parsed.success) return invalid("SCHEMA");
```

- 不传 temperature/top_p/top_k、不 prefill、不强制 tool_choice、不传 thinking（Opus 5.5 恒开）；用 `create` 而非 `parse()`（parse 失败会丢 usage）。
- `turnSchemaJson` 自建 JSON Schema：`candidateKey` 写成 `enum: candidateKeys`（保留 enum 以获得解码约束，是否被 API 接受待验证；不接受则退回 `zodOutputFormat` 的描述形式，靠事后校验）。
- 不回放 thinking 块；每回合无状态重建上下文；约束变化不改写 system，只体现在新 run 的上下文中。
- 不用 Citations；来源由代码从 itemKeys 推出。
- 服务端回退（`fallbacks: "default"`）：与 `output_config.format` 同用待验证；v1 默认关闭，在 18 记录为待用户拍板。若开启，记录 `msg.model` 与 `usage.iterations`。
- 运行时：默认 isolate + 显式 apiKey；首个最小部署实验失败则把 `runTurn` 移到 `"use node"` 文件（只含 action）。

## 5. 上下文与缓存

- 前缀顺序：固定协议与场景规则（system，可缓存，≥ 512 token）→ 本方简报（user 前段，跨回合稳定）→ 本回合变化部分。
- system 中不放时间戳、ID、版本号；"today" 放在 user 内容。
- 三个角色的 system 相同 → 跨角色共享缓存前缀；角色差异只在 user 与中途 system 中。

## 6. stub 模式（`AGENT_MODE=stub`）

- provider：选候选列表第一个（已按偏好排序）；evaluator：若候选是完整可行集中的第一名则 recommend_accept，否则 counter 第一名。
- 与真实代理共用 TurnOutput schema 与全部后续流程；回合 `authorKind: "stub"`、`simulated: true`，界面显示 "Simulated agent"。
- 用于开发、确定性测试和无额度演示。

## 7. 用量与成本

- 每个回合尝试记录：model、effort、input/output/thinking/cacheRead/cacheCreation tokens、stopReason、requestId、latencyMs、attempt、errorCode。
- 成本只在运维视图按 token × 配置价格估算并标 "estimate"；仓库不把价格写进业务逻辑。
- 每 run `maxModelCalls`；全局 `AGENTS_ENABLED`；dev / prod 不同 key 与 workspace，各设花费上限（15）。

## 8. 延迟目标（待用最终模型实测 ≥ 10 次后修订）

单回合 p95 ≤ 20s；约束变化后到新提案出现 ≤ 2 轮；阻断显示 = 同一次订阅推送（不依赖模型）。界面按回合显示 "Provider agent choosing…"、"Finance agent reviewing…"，不做 token 流式。
