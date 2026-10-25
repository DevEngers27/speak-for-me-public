# 10 代理运行时

## 1. 编排：自建 scheduler 链（ADR-05）
Convex 被调度的 action at-most-once、不重试、无超时回调（04 §1.5）。v1 自建：`turns` 表即 attempt 记录 + watchdog mutation。理由：组件（workflow/workpool）只覆盖调度与重试，单活跃 run、过期拒收、私密过滤仍要自建；workflow 的确定性约束让"部署时有在途 run"变成失败源；agent 组件要换 Vercel AI SDK，与技术栈冲突。

## 2. 生命周期与时序

```
public mutation (runs.start / bumpConstraints / decide(reject) / answer)
  └─ startRunInternal → enumerate → scheduleTurn(proposer)
        scheduleTurn: run.callCount+1 (> callLimit → needs_input)；插 turn(running)；
                      runAfter(0, internal.agentTurns.run, {turnId})；runAfter(TURN_DEADLINE_MS, internal.turns.watchdog, {turnId})
internal action agentTurns.run({turnId})
  1. if (!AGENTS_ENABLED) → runMutation(turns.fail, {code:'AGENTS_DISABLED', retryable:false})
  2. ctx = runQuery(internal.agentContext.build, {turnId})   // 若 turn 已非 running → 直接返回
  3. mode==='stub' ? stubChoose(ctx) : callModel(ctx)          // try/catch 包住 2–3
  4. 成功 → runMutation(internal.turns.complete, {turnId, output, usage})
     失败 → runMutation(internal.turns.fail, {turnId, code, retryable, usage?})
internal mutation turns.complete
  回合持久化守卫（04 §6）→ 不通过：turn=stale，写 turn_rejected_stale，只保留 usage
  Zod 校验 + 动作合法性 + 候选重新 derive/evaluate → 失败：按 invalid_output 处理（可能重排）
  写 turn(succeeded, output, usage)；按动作推进（propose→插提案+调度评估；evaluate→汇总）
internal mutation turns.watchdog({turnId})
  turn 仍 running → 视同 fail({code:'TIMEOUT', retryable:true})
```
持久化与推进在 mutation 里，模型调用在 action 里：持久化失败不会触发重复付费调用；推进与调度下一回合原子提交。

## 3. 重试、超时、上限（只写一份预算）

| 层 | 设置 | 说明 |
| --- | --- | --- |
| SDK 传输层 | `maxRetries: 1`，`timeout: 45_000` ms | 唯一的传输层重试；单次 action 最坏约 90 s，低于 Convex action 上限（待验证，文档通常 10 分钟） |
| 应用层 | invalid_output 或 retryable failed 自动重排 1 次（attempt+1） | 不可重试：400 BadRequest（编程错误）、AGENTS_DISABLED、callLimit |
| watchdog | `TURN_DEADLINE_MS = 120_000` | 覆盖 action 被平台中断、进程丢失 |
| 人工 | failed 后 "Retry turn"（R6） | 仍受 callLimit 约束 |
| 每房间 | `callLimit = 24`（scope change 最坏 18 次） | 记在 `runs.callCount`，`scheduleTurn` 同事务 +1 |
| 全局 | `AGENTS_ENABLED`、供应商 workspace 花费上限 | 见 15 |

延迟目标（待以最终模型实测 ≥10 次确认）：单回合 p95 ≤ 20 s；约束变化后到 pending_approval ≤ 2 轮、串行深度 4 次调用。数值是参数，不是承诺。

## 4. 模型调用规范 `callModel(ctx)`（`packages/engine/src/model.ts`，纯模块，可脚本调试）

```ts
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 45_000 });
assertAllowedModel(env.AGENT_MODEL ?? 'claude-opus-5-5');      // 白名单常量
const msg = await client.messages.create({
  model, max_tokens: 8_000,                                    // 思考 + 输出；< 21,333 非流式上限
  output_config: { effort: env.AGENT_EFFORT ?? 'medium', format: { type: 'json_schema', schema: toOutputSchema(ctx) } },
  system: [{ type: 'text', text: ctx.protocol + ctx.scenario, cache_control: { type: 'ephemeral' } }],
  messages: [
    { role: 'user', content: [
      { type: 'text', text: renderRoleBlock(ctx.role, ctx.myBrief, ctx.sharedFacts, ctx.myLedgerView), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: renderTurnBlock(ctx.candidates, ctx.history, ctx.currentProposal) } ] },
  ],
});
recordUsage(msg);                                // 无论成败先取 usage、model、id、_request_id、stop_reason
if (msg.stop_reason !== 'end_turn') return fail(msg.stop_reason === 'refusal' ? 'REFUSAL' : 'STOP_' + msg.stop_reason, { retryable: msg.stop_reason === 'max_tokens' });
const text = msg.content.find(b => b.type === 'text')?.text;   // 按块 type 取，不按位置
const parsed = schemaFor(ctx).safeParse(safeJson(text));
return parsed.success ? ok(parsed.data) : fail('INVALID_OUTPUT', { retryable: true });
```

禁止：`temperature/top_p/top_k`、prefill、强制 `tool_choice`、`thinking: disabled/budget_tokens`、`messages.parse()`（1.1.0 解析失败抛错并丢 usage）、Citations（与结构化输出互斥）。`BadRequestError` → 不可重试的 failTurn 并告警。

## 5. 上下文构造与缓存
- 每回合从 Convex **无状态重建**，不回放任何 assistant 历史或 thinking 块（规避"保留思考"400 条件）。
- 前缀按稳定性排序：system（引擎协议 + 插件场景说明，跨角色共享）→ 本角色块（指令 + 本人简报 + 共享事实，同角色跨回合稳定）→ 本回合块（候选、结构化历史）。system 与本角色块各一个缓存断点；不含时间戳与 ID；JSON 序列化用稳定键序（`stableStringify`）。
- 约束变化不改写 system；新约束只体现在本回合块。
- 断言：同一 run 第二回合起 `cache_read_input_tokens > 0`（低于 512 token 的前缀不缓存，属预期）。

## 6. 模型与 effort
默认 `claude-opus-5-5`、effort `medium`（协商回合）。按调用点可配置（`AGENT_MODEL_<CALLSITE>`），但改用 Sonnet/Haiku 属于用户决策（18 开放问题），代码不得为省钱自动降级。服务端回退（`fallbacks: 'default'`）与 `output_config.format` 能否同用待验证；v1 默认不开启，开启后必须记录 `msg.model` 与 `usage.iterations`。

## 7. 用量记录（写在 turns 行）
`model, effort, stopReason, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, thinkingTokens, requestId, latencyMs, attempt, errorCode`。成本不存储，由运维查询按价目表离线估算并标注"估算"。

## 8. stub 模式
`AGENT_MODE=stub`（Convex 环境变量）或房间 `fixtureKey` 指定：`stubChoose` 用插件规则（proposer 取 rank 1；评估方对 rank 1 推荐、否则 object 偏好 rank 1），与真实代理共用输出 schema、complete 流程与全部守卫；turn.mode = 'stub'，提案 authorKind 仍为 `agent` 但 `simulated: true`，界面显示 "Simulated agent"。用途：无额度开发、确定性端到端测试、演示降级。

## 9. LLM 的职责边界（回答"为什么需要代理"）
代码做：可行性、算术、来源、状态、权限。模型做：①读本方私密的自由文本偏好（notes）在可行候选中替委托人取舍；②在不泄露底线的前提下给本方写解释（rationale）；③判断何时该问本方的人（`ask_principal`）。finance 代理保留一次评估调用（解释本方视角、可提 `ask_principal`），校验仍由代码完成——产品文案如实写"three isolated agents advise; code decides feasibility"。
