# 04 平台约束与推荐模式（第 6/7 部分）

> 分片清单见 part1。本文件：§4 Claude（下）与 §4 对设计的直接含义。

## §4 Claude（下）

### 4.5 `stop_reason` 处理

- SDK 1.1.0 的枚举：`end_turn | max_tokens | stop_sequence | tool_use | pause_turn | refusal | model_context_window_exceeded`（`SDK:resources/messages/messages.d.ts:3870`）。
- `refusal`：HTTP 200，`stop_details = { type: "refusal", category, explanation }` 只在拒绝时出现；**按 `stop_reason` 分支，不按 `stop_details` 分支**，`category` 可能为 `null`；`content` 可能为空，也可能是半截（`SK:SKILL` Stop details；`SK:shared/model-migration.md` "`refusal` stop reason" 节）。
- Opus 5.5 的分类器类别含 `cyber`、`bio`、`reasoning_extraction`；后者针对"让模型把内部推理原样写进回复"的提示，可以要"简短的理由说明"，不要求"完整推理过程"（Opus 5.5 Safeguards 节）。
- 服务端回退（技能要求对 Opus 5.5 默认开启并告知用户）：`client.beta.messages.create({ ..., betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })`；列表形式 `fallbacks: [{ model }]` 必须配 `server-side-fallback-2026-06-01`，两种头与形式混用会 400；仅 Claude API 与 Claude Platform on AWS；Batches 不支持；只在策略拒绝时触发（429/5xx 不触发）；回退模型读不到 Opus 5.5 的 thinking 块；顶层 `usage` 只覆盖最终那次尝试，逐次计费看 `usage.iterations`；顶层 `model` 表示实际产出该消息的模型；`reasoning_extraction` 不会回退（同上两节；SDK 类型 `fallbacks?: BetaFallbacksParam`，`SDK:resources/beta/messages/messages.d.ts:7094`）。`beta.messages` 上 `fallbacks` 与 `output_config.format` 同用：待验证。
- `max_tokens`：输出被截断，结构化 JSON 不完整，应作为一次失败尝试处理（可有限次提高 `max_tokens` 重试）。
- `model_context_window_exceeded`：在 SDK 枚举中，触发条件与是否需要 beta 头：待验证（SDK beta 列表中有 `model-context-window-exceeded-2025-08-26`）。
- `pause_turn`：只在使用服务器工具时出现，本系统若不用服务器工具可视为异常。

### 4.6 SDK 超时、重试与 Convex action 的关系

- 默认 `timeout = 600000` ms（10 分钟），`maxRetries = 2`（`SDK:client.js:149, 162, 1036`）。重试条件：408、409、429、≥500、连接错误与超时；服务端 `x-should-retry` 头优先；有 `retry-after-ms` / `retry-after` 时按它等待，否则 0.5s 起指数退避、上限 8s、带抖动（`SDK:client.js:847-908`）。超时也会重试，所以单次逻辑调用的墙钟最长约 `timeout × (maxRetries + 1)`（`SK:SKILL` Client config）。
- 非流式请求的保护：当 `max_tokens` 换算出的预计时长超过 10 分钟（`max_tokens × 3600s / 128000 > 600s`，即约 **21,333** 以上）时，SDK 在发送前直接抛 "Streaming is required…"（`SDK:client.js:909-917`；`resources/messages/messages.js:33-35`）。更大的 `max_tokens` 必须用 `messages.stream(...).finalMessage()`。
- 单次覆盖：`client.messages.create(params, { timeout, maxRetries, signal })`。请求 ID：返回对象上不可枚举的 `_request_id`（`SDK:internal/parse.js:61`）。
- 与 Convex 的关系：action 的最长运行时间待验证（文档通常为 10 分钟）。SDK 默认配置的最坏情况（3 × 10 分钟）远超这个上限，action 会被平台中断且不会重试（part1 1.5）。必须显式设置较小的 `timeout` 与 `maxRetries`，让"单次 action 内的总耗时"小于平台上限并留出提交结果的时间；更长的恢复交给 Convex 层的新 attempt。原仓库用 `maxRetries: 1, timeout: 30_000`（`ORIG:convex/lib/anthropic.ts`）；对 thinking 常开的 Opus 5.5，30 秒是否足够需实测（待验证）。
- SDK 内部重试对应用不可见：一次逻辑调用可能经历多次 HTTP 尝试，失败尝试是否计费：待验证。

### 4.7 Prompt caching 与中途 system 消息

- 缓存是**前缀匹配**：渲染顺序 `tools → system → messages`，任何字节变化都会使其后的缓存失效；最多 4 个断点；`cache_control: { type: "ephemeral" }`（5 分钟）或加 `ttl: "1h"`；也可在请求顶层放 `cache_control` 自动放置断点（`SK:shared/prompt-caching.md` 开头与 API reference）。
- Opus 5.5 / Sonnet 5.5 / Haiku 5.5 最小可缓存前缀为 512 token（技能注明"以官方文档为准"），更短的前缀静默不缓存；缓存按 workspace 隔离、按模型隔离（换模型即失效）；缓存条目要等第一条响应**开始流式返回**后才可读，同前缀的并行请求都按全价写入；TTL 从请求开始计，读取会刷新 TTL（同文件 Choosing the TTL、Concurrent-request timing）。
- 价格（Opus 5.5）：5 分钟写 1.25×（$5/MTok），1 小时写 2×（$8），读 0.05×（$0.20）。
- 静默失效源：system 中的时间戳/请求 ID、JSON 键序不确定、工具集合按用户变化、按条件拼接 system 段落（同文件 Silent invalidators）。
- 中途 system 消息：在 `messages` 里追加 `{ role: "system", content }`，Opus 5.5、Sonnet 5.5、Haiku 5.5 支持，无需 beta 头；必须紧跟 `user` 消息（或以服务器工具调用结尾的 assistant 消息），必须是最后一条或其后紧跟 assistant；不能是 `messages[0]`；仅文本。它不破坏已缓存前缀，并且是**不可被用户内容伪造的运营者通道**（对比把指令塞进 user 文本）（`SK:SKILL` Mid-Conversation System Messages；`prompt-caching.md` 同名节）。SDK 1.1.0 已有 `SystemMessageParam`（`messages.d.ts:3616, 3873`）。
- Citations 与结构化输出互斥（400），见 part5 4.3。

### 4.8 用量字段

- `usage.input_tokens`（**仅未缓存的剩余部分**）、`cache_creation_input_tokens`、`cache_read_input_tokens`、`cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`、`output_tokens`（含思考）、`output_tokens_details.thinking_tokens`、`service_tier`、`speed`、`inference_geo`、`server_tool_use`（`SDK:resources/messages/messages.d.ts:4440-4485`）。提示总量 = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`（`prompt-caching.md` Verifying cache hits）。
- 开启回退时还有 `usage.iterations`（逐次尝试）；另应记录 `msg.model`（实际模型）、`msg.id`、`msg._request_id`、`stop_reason`。
- 校验缓存是否生效的唯一依据是 `cache_read_input_tokens`；建议做成常驻断言（第二次同前缀请求应 > 0）。

### 4.9 是否需要流式

- 对用户界面：不需要 token 级流式。Convex 客户端通过订阅即可看到 run 状态与校验后的结果；把 token 增量写进数据库（agent 组件的做法）会产生大量写入，而且未经校验的提案本就不应展示。
- 对 action 内部：`max_tokens` ≤ ~21K 时可用非流式；更大或需要避免长时间空闲连接时，用 `messages.stream(...).finalMessage()`。注意 `finalMessage()` 在带 `parse` 函数的 format 下也会解析并可能抛错（part5 4.4），稳健做法同样是只传 `{ type, schema }`。

### 4.10 成本数量级（按 `SK:SKILL` 价格表估算，非实测）

假设一次代理回合：输入 8K token（其中 6K 稳定前缀）、输出 3K token（含 `medium` 思考）。

| 模型 | 无缓存 / 回合 | 命中 6K 前缀缓存 / 回合 | 3 方 × 4 轮 = 12 回合 |
| --- | --- | --- | --- |
| Opus 5.5 | 8K×$4 + 3K×$20 ≈ $0.09 | 6K×$0.20 + 2K×$4 + 3K×$20 ≈ $0.07 | ≈ $0.8–1.1 |
| Sonnet 5.5 | ≈ $0.046 | ≈ $0.035 | ≈ $0.4–0.55 |
| Haiku 5.5 | ≈ $0.0023 | 更低 | ≈ $0.03 |

- 输出（含思考）占大头；effort 每升一级都会显著增加输出 token，应以 `thinking_tokens` 实测。预算下调触发重新协商会让单个房间成本翻倍左右。Batch 半价但异步，不适合交互式协商。

## §4 对设计的直接含义

1. 模型调用规范（10-agent-runtime）应固定：`model: "claude-opus-5-5"`、显式 `output_config.effort`、不传 `thinking`（或 `{type:"adaptive"}`）、不传任何采样参数、不用 prefill、不用强制 `tool_choice`。
2. 代理回合的输出用结构化输出；建议 `messages.create` + 自行校验（不用会抛错的 `parse()`），这样截断、拒绝、校验失败时都能保留 `usage` 与原始响应并落库。
3. 若需要枚举/判别字段受解码约束，需自建 JSON Schema 生成，而不是直接用 `zodOutputFormat`；无论如何，Zod（或同等）校验 + 业务规则校验都必须在提交 mutation 前完成。
4. `max_tokens` 为"思考 + 输出"留余量；非流式时不超过约 21,333；`stop_reason` 分支至少覆盖 `end_turn / max_tokens / refusal / 其他`。
5. SDK 的 `timeout`、`maxRetries` 必须显式配置，使单个 action 总耗时低于 Convex 上限；跨 action 的重试由 Convex 层的 attempt 管理。
6. 提示词组装按稳定性排序：固定的协议与场景规则在前（可缓存）→ 本方私密简报与共享事实 → 本回合可变内容；不要在 system 中插入时间戳或 ID；运营者的动态指令用中途 `role: "system"` 消息，不要混进由他方代理或用户文本构成的 user 内容。
7. 回退开启后，实际模型可能变化；用量与审计记录要存 `msg.model` 与 `usage.iterations`。是否开启回退需在 18-decisions 中写明（技能建议默认开启）。
8. 用量表至少记录：`inputTokens`、`cacheCreationInputTokens`、`cacheReadInputTokens`、`outputTokens`、`thinkingTokens`、`model`、`stopReason`、`requestId`、`effort`、估算成本。
