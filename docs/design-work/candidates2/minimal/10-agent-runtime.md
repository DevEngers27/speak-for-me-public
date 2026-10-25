# 10 代理运行时

## 1. 决定

| 目标 | 决定 | 被否决及原因 |
| --- | --- | --- |
| 编排 | 基于 `ctx.scheduler` 自建，状态全在 `runs`/`agentTurns`；一个 run 同时至多一个在途回合（`run.activeTurnId`） | `@convex-dev/workflow`：确定性约束 + 改代码使在途实例失败，迭代期成本高，且仍要自建过期拒绝与隐私；`@convex-dev/agent`：要求 Vercel AI SDK，与技术栈冲突（inputs/04 §2） |
| 重试只一层 | SDK `maxRetries: 1`、`timeout: 60_000` 负责传输层；应用层只做"失败回合自动再试 1 次 + 人工再试 1 次" | 多层相乘（F10.4） |
| action 丢失可恢复 | 每个回合同时调度 `turnWatchdog`（exactly-once mutation） | 只靠 catch（平台中断不进 catch） |
| 结果提交在 mutation | action 只"读上下文 → 调模型 → 一次 runMutation 提交"；提交 mutation 做 GT 守卫 | 在 action 里多次写库 |
| 流式 | 不做 token 级流式；界面显示回合状态 | 写 token 增量到库（大量写入，且未校验内容不应展示） |

## 2. 回合生命周期

```text
scheduleTurn(ctx, run, role, round, attempt, proposalId?)        // mutation helper
  insert agentTurns{status:"running", mode: AGENT_MODE, …}; patch run.activeTurnId
  ctx.scheduler.runAfter(0, internal.agents.runTurn, { turnId })
  ctx.scheduler.runAfter(TURN_DEADLINE_MS, internal.agents.turnWatchdog, { turnId })

internal.agents.runTurn({ turnId })                               // action，默认运行时
  if (env.AGENTS_ENABLED !== "true") → runMutation(failTurn, {code:"AGENTS_DISABLED"}); return
  ctx0 = runQuery(internal.agents.getTurnContext, { turnId })     // null = 已过期，直接 return
  try {
    out = mode === "stub" ? stubDecide(ctx0) : await callModel(ctx0)   // 见 §4
    runMutation(internal.agents.completeTurn, { turnId, output: out.parsed, meta: out.meta })
  } catch (e) {
    runMutation(internal.agents.failTurn, { turnId, code: classify(e), meta })
  }

internal.agents.completeTurn({ turnId, output, meta })           // mutation
  GT 守卫失败 → turn 若 running 则 stale；补记 meta；return
  业务校验（itemKeys ⊆ 目录、reasonCode 合法）失败 → 视同 failTurn(INVALID_OUTPUT)
  turn → succeeded（存 output、meta）
  按 05 §3 推进：插提案 / 下一回合 / pending_approval / needs_input（同事务调度下一回合）

internal.agents.failTurn({ turnId, code, meta })                  // mutation
  GT 失败 → stale；return
  turn → failed（errorCode、meta）
  可重试（INVALID_OUTPUT | MAX_TOKENS | TIMEOUT | API_ERROR）且 attempt < 2 → scheduleTurn(同 role/round, attempt+1)
  否则 → run failed（R4），activeTurnId 清空

internal.agents.turnWatchdog({ turnId })                          // mutation
  turn.status !== "running" → return
  否则等价 failTurn(TIMEOUT)；之后若真实结果到达，completeTurn 只补记用量并 lateResult = true
```

常量（`convex/engine/config.ts`，可由环境变量覆盖）：`TURN_DEADLINE_MS = 150_000`（> SDK 最坏 2×60s + 退避）、`MAX_AUTO_ATTEMPTS = 2`、`MAX_ATTEMPTS = 3`、`MAX_ROUNDS = 3`（场景）、`MAX_RUNS_PER_ROOM = 20`。

**最坏调用数**：每 run ≤ 3 轮 × 3 回合 × 3 尝试 = 27 次逻辑调用（每次 ≤ 2 次 HTTP 尝试）；正常路径 3 次。最坏墙钟：单回合 150 s 后判失败。

**延迟预算（目标，待用最终模型 10 次实测 p50/p95 后定参数）**：单回合 p95 ≤ 20 s（Opus 5.5，effort medium，thinking 常开）；一轮 ≤ 60 s；约束变化后到新的待批提案 ≤ 90 s（一轮通过）。不达标时的调参顺序：降 effort → 收紧 max_tokens → 并行评估（ADR-06）。

## 3. 并发控制

- 同一 run 只有一个在途回合，因此不存在两个提交互相覆盖；GT 中的 `run.activeTurnId === turn._id` 同时拦下"看门狗之后的重复结果"和"被新尝试取代的旧尝试"。
- 约束变化不取消在途 action（`scheduler.cancel` 不能中止在途 action，inputs/04 §1.5），只靠 GT 拒收；未开始的调度也不取消，`runTurn` 读上下文时发现 turn 非 running 即返回（不调模型、不花钱）。
- 全局速率：v1 不做；若触及账户速率限制（待验证 #12），再引入 workpool `maxParallelism`。

## 4. 模型调用规范 `callModel(ctx0)`（纯模块 `convex/engine/model.ts`，只依赖 SDK 与 zod）

```ts
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
const MODEL = assertAllowedModel(env.AGENT_MODEL ?? "claude-opus-5-5");  // 白名单常量
const t0 = Date.now();
const msg = await client.messages.create({
  model: MODEL,
  max_tokens: 8_000,                           // thinking + 小 JSON；< 21,333 非流式上限
  output_config: { effort: ctx0.effort /* 默认 "medium" */, format: { type: "json_schema", schema: ctx0.jsonSchema } },
  system: [{ type: "text", text: ctx0.systemPrompt, cache_control: { type: "ephemeral" } }],
  messages: ctx0.messages,                     // user(本方简报+公开状态) → system(本回合指令)
});
// 不传 temperature/top_p/top_k、不 prefill、不传 thinking、不强制 tool_choice（inputs/04 §4.3）
const meta = { model: msg.model, effort, stopReason: msg.stop_reason, requestId: msg._request_id,
  usage: toUsage(msg.usage), latencyMs: Date.now() - t0 };
if (msg.stop_reason !== "end_turn") throw new TurnError(
  msg.stop_reason === "max_tokens" ? "MAX_TOKENS" : msg.stop_reason === "refusal" ? "REFUSAL" : "INVALID_OUTPUT", meta);
const text = msg.content.find(b => b.type === "text")?.text;
const parsed = ctx0.schema.safeParse(safeJson(text));
if (!parsed.success) throw new TurnError("INVALID_OUTPUT", meta);
return { parsed: parsed.data, meta };
```
- 用 `create` + 自行 `safeParse`，不用 `parse()`（1.1.0 解析失败直接抛错并丢失 usage，inputs/04 §4.4）。`TurnError` 携带 meta，failTurn 照样记录用量。
- `BadRequestError`（400）→ `BAD_REQUEST`，不可重试（编程错误）。`REFUSAL` 不自动重试。
- 上下文**每回合无状态重建**，从不回放模型自己的 assistant/thinking 块 → "保留思考"约束不会触发（inputs/04 §4.2）。
- 缓存：system（协议 + 场景规则，固定字节）放前缀并设断点；本方简报在第一条 user 消息；可变内容在后；本回合指令用中途 `role:"system"` 消息。system 中不放时间戳/ID。缓存是否生效以 `cache_read_input_tokens` 断言（Opus 5.5 最小 512 token）。
- 服务端回退（`fallbacks:"default"`）：与 `output_config.format` 能否同用待验证（#7）；v1 默认关闭，验证通过后开启并记录 `msg.model`。
- 模型选择：默认 `claude-opus-5-5`；Sonnet/Haiku 只作为用户拍板的选项（18 号 Q）。effort 每个调用点可配置，默认 medium。

## 5. 用量与成本

- 每次尝试一行 `agentTurns`，记录 `model/effort/stopReason/requestId/usage{input, cacheCreation, cacheRead, output, thinking}/latencyMs/attempt`；失败、过期、迟到的尝试同样记录（真实花费）。
- 成本只按 token × 价格表离线估算（`ops.usageSummary` 输出 token 与"估算美元"，标注 estimate）；仓库不硬编码价格以外的账单逻辑。
- 估算量级：Opus 5.5 每回合约 $0.07–0.09，正常一次协商 3 回合 ≈ $0.25（inputs/04 §4.10，需实测）。

## 6. stub 模式（`AGENT_MODE=stub`）

- provider：从 provider 视角候选中取第 1 个（wanted 覆盖最多、再最便宜）；若上一轮被拒，取下一个未提过的候选。
- 评估方：若被评估提案省略了本方 wanted 条目且候选中存在更大覆盖的合格组合 → `reject WANTS_MORE_SCOPE`；否则 `recommend_accept`。
- 输出与真实模型同一 schema、同一提交路径；turn `mode:"stub"`，由它产生的提案 `authorKind:"stub"`、`simulated:true`，界面徽章 "Simulated agent"。
- 用途：无额度开发、确定性端到端测试、演示降级。

## 7. 文件布局

`convex/agents.ts`（runTurn action + internal mutations/query；不放 `convex/actions/` 目录）、`convex/engine/model.ts`（纯模块，可用 `node --env-file-if-exists=.env.local scripts/try-agent.ts` 离线调试）、`convex/engine/context.ts`（`buildAgentContext` 纯函数，输入是已读出的文档）。SDK 在默认运行时打包可行（显式 apiKey），长请求行为待验证 #4；失败则把 `runTurn` 单独移入 `"use node"` 文件，其余不动。
