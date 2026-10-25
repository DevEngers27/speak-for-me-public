# 10 · 代理运行时（part5：modelGateway、错误分类、用量与成本、缓存验证）

> 分片清单见 `10-agent-runtime.md` 开头。平台事实以 inputs/05 为准，未经实测的标"待验证"。

## 10.14 `modelGateway`

### 10.14.1 请求构造与运行时白名单（`convex/model/agents/modelGateway.ts`，只被 internal action 导入；canon §1.6 / 11 §11.3 的唯一接缝名是 `callModel`，`callNegotiationModel` 是它的内部实现）

```ts
import Anthropic from '@anthropic-ai/sdk';
export const NEGOTIATION_MODEL = 'claude-opus-5-5' as const;   // canon D09 / U5；不得静默降级
export const NEGOTIATION_EFFORT = 'medium' as const;           // 所有协商回合统一，保持缓存
const TOP_KEYS = new Set(['model', 'max_tokens', 'system', 'messages', 'output_config']);
const OUTPUT_CONFIG_KEYS = new Set(['effort', 'format']);

export function buildNegotiationRequest(p: { system: SystemBlock[]; user: UserBlock[]; turnInstruction: string; schema: Json }) {
  const body = {                                               // 网关内新建字面量，从不展开调用方对象
    model: NEGOTIATION_MODEL,
    max_tokens: MODEL_BUDGET.maxTokens,                        // 16000
    system: p.system.map((b) => ({ type: 'text' as const, text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}) })),
    messages: [
      { role: 'user' as const, content: p.user.map((b) => ({ type: 'text' as const, text: b.text,
          ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}) })) },
      { role: 'system' as const, content: p.turnInstruction },  // 中途运营者消息：紧跟 user 且为最后一条（05 §5.13）
    ],
    output_config: { effort: NEGOTIATION_EFFORT, format: { type: 'json_schema' as const, schema: p.schema } },
  };
  assertWhitelisted(body);
  return body;
}

export function assertWhitelisted(body: Record<string, unknown>): void {
  must([...Object.keys(body)].every((k) => TOP_KEYS.has(k)), 'gateway.unknown_param');
  must(body.model === NEGOTIATION_MODEL, 'gateway.model_not_allowed');
  const oc = body.output_config as Record<string, unknown>;
  must(Object.keys(oc).every((k) => OUTPUT_CONFIG_KEYS.has(k)) && oc.effort === NEGOTIATION_EFFORT, 'gateway.output_config');
  const msgs = body.messages as { role: string }[];
  must(msgs[0]?.role === 'user' && msgs.at(-1)?.role !== 'assistant', 'gateway.prefill_or_order');
  must(msgs.findIndex((m) => m.role === 'system') === msgs.length - 1, 'gateway.mid_system_position');
  must(countCacheControl(body) <= 4, 'gateway.too_many_breakpoints');
  must(body.max_tokens === MODEL_BUDGET.maxTokens, 'gateway.max_tokens');
}

export const callModel = callNegotiationModel;                       // 唯一导出的接缝名（11 §11.3、16 vi.mock 的目标）
export async function callNegotiationModel(body: ReturnType<typeof buildNegotiationRequest>) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new GatewayConfigError('ANTHROPIC_API_KEY');   // 不打印值；分类为 config_invalid（§10.15.1）
  const client = new Anthropic({ apiKey, maxRetries: MODEL_BUDGET.sdkMaxRetries });   // 0：传输层拒绝非零值（I6）
  const deadline = abortAfter(CALL_DEADLINE_MS);                    // 总截止：覆盖首发 + 退避 + 重试（§10.10.1）
  // 网关重试循环（§10.10.1）：429 / 连接错误至多重发 1 次（原请求体）；max_tokens 截断至多重发 1 次——以同一请求体重建（system / user 块与
  // schema 不变，末条 role:'system' 回合指令追加 RETRY_NOTES['output.truncated']，05 §5.6.2；重建体再过 assertWhitelisted），两次响应 usage 求和；
  // 每次发送 timeout = min(REQUEST_TIMEOUT_MS, 剩余预算)；deadline 在发送前、退避中、发送中触发 → 不可重试的 model_timeout
  const stream = client.messages.stream(body, { timeout: Math.min(REQUEST_TIMEOUT_MS, remainingMs(deadline)), signal: deadline });
  const msg = await stream.finalMessage();                          // 不用 messages.parse()：失败会抛错并丢失 usage
  return { msg, requestId: requestIdOf(stream, msg) };              // 流式下 requestId 的取法待验证（V6）；usage 为本次调用全部带响应发送之和
}
```

| 不传的参数 | 原因 |
| --- | --- |
| `thinking`（任何形式） | Opus 5.5 thinking 不可关闭、默认 adaptive、计入 `max_tokens`；`disabled` / `enabled` / `between_tools` 能 400 且过得了 tsc（inputs/05 A4，canon C17） |
| `temperature` / `top_p` / `top_k` | Opus 5.5 上 400；非字面量对象里的 `temperature` 会被原样发出（spike 实测） |
| `tools` / `tool_choice` | 无工具；强制 `tool_choice` 400 |
| 末尾 assistant 预填 | 400 |
| `stop_sequences`、`metadata` | 不需要；`metadata` 会多送一个用户标识（数据最小化） |
| `betas` / `fallbacks` | canon D09 / C16：默认关，见 10.14.3 |
| 每条消息的 effort、`service_tier` | 不需要；effort 变化会让 messages 缓存失效 |

单测 RQ-01（沿用 foundation/model-call 的"真实 SDK 客户端 + 进程内假 fetch"）：发出的请求体顶层键恰好是上表白名单、最后一条消息不是 assistant、`anthropic-version` 为 SDK 默认值、`authorization` 头在任何日志中被脱敏（SDK 以 Bearer 发送密钥）。

### 10.14.2 启动检查（fail-closed）

部署后运维执行 `ops.checkModelConfig`（internal action）：`AGENT_MODE = live` 而缺 `ANTHROPIC_API_KEY` → 失败告警，**不**静默改用 stub；`client.models.retrieve(NEGOTIATION_MODEL)` 成功 → `opsLog('model_config_verified')`（不写 opsFlags，03 §3.12 只有 `draining`）；失败 → 告警（`model_not_found` / `auth` / `config_invalid`）。preview 部署强制 `AGENT_MODE = stub` 且不持有密钥（15）。SDK 在 Convex 默认运行时的打包与请求待验证（V2）；退路是只把 `runAttempt` 移入 `"use node"` 文件，其余不变。

### 10.14.3 服务端回退（`MODEL_FALLBACKS`，默认 `off`）

- v1 启动检查拒绝 `on`，直到 spikes §8 #16（`fallbacks` 与 `output_config.format` 同用、回退模型是否遵守同一 schema）验证通过并在 18 记 ADR。
- 开启后的实现约束：改走 `client.beta.messages.stream({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })`；顶层 `usage` 只覆盖最终尝试，逐次计费在 `usage.iterations`，attempt 增加 `usageIterations[]` 并按其求和结算成本；`responseModel` 取 `msg.model`；按 `responseModel !== model` 分组监控 `invalid_output` 与规则阻断率。
- 收益很小：Opus 5.5 的拒答类别是 cyber / bio / reasoning_extraction，商务协商文本很少触发前两类，而 reasoning_extraction 不回退（np-review r13）。

## 10.15 错误分类

### 10.15.1 `AttemptErrorCode`（运行时码，不属于 reasonCode，不给他方）

```ts
export const ATTEMPT_ERROR_CODES = ['transport', 'model_timeout', 'watchdog_timeout', 'action_crashed', 'bad_request', 'auth',
  'quota_exhausted', 'model_not_found', 'context_overflow', 'unexpected_stop', 'api_error', 'agents_disabled',
  'config_invalid',   // GatewayConfigError：缺 ANTHROPIC_API_KEY / 非法 AGENT_MODE 等（11 §11.10、15、16 使用）；不重试、告警
  'internal'] as const;
export const attemptErrorCodeV = v.union(...ATTEMPT_ERROR_CODES.map((c) => v.literal(c)));   // 与常量双向编译期对账（run-lifecycle-review r14）
```

本方成员只看到概括（"Your agent could not complete this turn: the model service was unavailable"）；运维看到具体码。

### 10.15.2 `classifyError(err)`（纯函数，不抛，丢弃 `err.message`——`APIError.message` 可能回显请求）

| 捕获到的异常 | attempt 状态 | `errorCode` | 保留字段 |
| --- | --- | --- | --- |
| `APIUserAbortError`（我们的总截止触发，含退避等待中到期）、`APIConnectionTimeoutError`、发送前发现总截止已耗尽 | `timeout` | `model_timeout` | —（不重试，§10.10.1） |
| `APIConnectionError`（其余；网关重试 1 次后仍失败） | `error` | `transport` | — |
| `RateLimitError`（429，网关重试 1 次后仍失败） | `error` | `transport` | `httpStatus`、`retryAfterMs`（`retry-after-ms` / `retry-after`）、`requestID` |
| `InternalServerError`（≥ 500）、529 overloaded、流中 `overloaded_error` 事件（网关不重试） | `error` | `transport` | `httpStatus`、`requestID` |
| `BadRequestError`（400）、413、`UnprocessableEntityError`（422） | `error` | `bad_request` | 同上；若为 schema 被拒，告警建议切 `OUTPUT_SCHEMA_TRANSFORM = sdk`（05 §5.4.5） |
| `AuthenticationError`（401）、`PermissionDeniedError`（403） | `error` | `auth` | — |
| `GatewayConfigError`（缺 `ANTHROPIC_API_KEY`、非法 `AGENT_MODE`、SDK `maxRetries` 非零等） | `error` | `config_invalid` | —（不重试、告警，§10.15.1） |
| `APIError` 且 `error.type === 'billing_error'` | `error` | `quota_exhausted` | — |
| `NotFoundError`（404） | `error` | `model_not_found` | — |
| 其他 `APIError` | `error` | `api_error` | `httpStatus` |
| 非 SDK 异常 | `error` | `internal` | 只记 `err.name` |

`stop_reason` 的分类在 05 §5.6.1（`max_tokens` → `output.truncated`；`refusal` → `output.refusal`；`model_context_window_exceeded` → `context_overflow`；`tool_use` / `pause_turn` / `stop_sequence` / 未知 → `unexpected_stop`）。`stop_details.category` 运行时按 `string | null` 存（SDK 类型是封闭联合，inputs/05 A6）。

## 10.16 用量与成本

### 10.16.1 `normalizeUsage(u)`（稳定版 `Usage` 类型已有这些字段，不需要 `as any`，run-lifecycle-review r10）

| attempt 字段 | SDK 来源 |
| --- | --- |
| `usage.inputTokens` | `u.input_tokens`（只含未缓存部分） |
| `usage.cacheCreationInputTokens` | `u.cache_creation_input_tokens ?? 0` |
| `usage.cacheReadInputTokens` | `u.cache_read_input_tokens ?? 0` |
| `usage.outputTokens` | `u.output_tokens`（含 thinking） |
| `usage.thinkingTokens` | `u.output_tokens_details?.thinking_tokens ?? 0`（03 §3.4 的 `usageV` 是整数；缺失记 0，`outputTokens` 已含 thinking，成本不受影响） |

不记 `service_tier`：请求从不传它（§10.14.1），03 的 `usageV` 也没有该字段。

同一行还有 `model`（请求）、`responseModel`（`msg.model`）、`effort`、`maxTokens`、`stopReason`、`stopCategory`、`requestId`、`messageId`、`latencyMs`、`schemaVersion`、`promptVersion`、`protocolVersion`、`provenance`。稳定版没有 `usage.iterations`（只在 beta 类型里），v1 不记。

### 10.16.2 成本

- `costMicroUsd = estimateCostMicroUsd(usage, responseModel ?? model, PRICE_TABLE)`：整数微美元，纯函数在 `core/engine/runtime/pricing.ts`；价目表的 `asOf` 归 15，attempt 记 `priceTableAsOf`（03 §3.8）。界面一律标 "Estimated"。
- stub attempt：usage 全 0、成本 0、`model: 'stub:v1'`。
- 无响应的 attempt：usage 为 null，计入 `unknownCostAttempts`，不编造金额；未发出请求的 attempt（`stale_context`、`agents_disabled`、`config_invalid`）成本记 0，不计入（§10.12.2）。

### 10.16.3 度量（15 的面板直接读取，样本量与失败一并显示）

| 指标 | 定义 |
| --- | --- |
| 回合延迟 p50 / p95（按 role × kind） | `completed` attempt 的 `latencyMs`；另列含重试的回合级耗时 |
| `invalid_output` 率、截断率、拒答率、stale 率、自动重试率 | 按 attempt 终态计数 ÷ attempt 总数 |
| 缓存命中率 | `Σ cacheReadInputTokens ÷ Σ(inputTokens + cacheCreationInputTokens + cacheReadInputTokens)` |
| 每 run / 每次执行的估算成本 | 按 `runId` 回溯 attempts；执行经 `runs.currentProposalId` 关联 |
| 首个有效提案用时 | run 创建 → 首个 `passesChecks` 提案插入 |
| 人工介入次数 | 按 kind 统计 `humanRequests` |
| 延期与停泊 | `opsLog('spend_deferred')` 计数、按 `turns.waitingReason`（`spend_deferred` / `draining` / `run_cap`）统计的等待回合数（延期与停泊不写事件，§10.4.5） |

## 10.17 缓存验证

- 常驻断言：同一 run、同一角色的第二个及以后的 `completed` attempt 期望 `cacheReadInputTokens > 0`；为 0 时写 `opsLog('cache_miss_unexpected', { attemptId, promptVersion, schemaVersion })`，不带内容。
- 断点两个（`system` 末尾、本方简报块末尾，05 §5.13.4）；effort 恒为 `medium`，不会因 effort 变化让 messages 缓存失效；`system` 中没有时间戳、ID、版本号。
- 最小可缓存前缀 512 token（待验证）；缓存只影响成本与延迟，不影响正确性，命中率低于 30% 才需要调查。
