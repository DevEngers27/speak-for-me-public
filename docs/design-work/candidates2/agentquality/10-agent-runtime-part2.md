# 10 代理运行时（第 2/3 部分：模型调用规范、stop_reason、用量与成本、缓存）

## 10.7 客户端与请求形状（对齐 inputs/04 §4）

```ts
// engine/llm/claude.ts —— 只依赖 @anthropic-ai/sdk 与 zod，可在 Convex 外用脚本调试
import Anthropic from "@anthropic-ai/sdk";
export const MODEL_ALLOWLIST = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export const AGENT_MODEL = "claude-opus-5-5";        // 默认；换模型必须经用户决定（ADR-13）
export const EFFORT = { negotiate: "medium" } as const; // 显式设置；评测决定是否改 low

export function createClient(apiKey: string) {
  return new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
}
export function buildParams(p: PromptPack, schema: object) {
  return {
    model: AGENT_MODEL,
    max_tokens: 8_000,                   // 思考 + JSON；< 21,333 可非流式（inputs/04 §4.6）
    output_config: { effort: EFFORT.negotiate, format: { type: "json_schema" as const, schema } },
    system: p.system,                    // 稳定前缀，带 cache_control
    messages: p.messages,                // [user(brief 块 + 状态块), system(回合指令)]
    // 不传：temperature/top_p/top_k（400）、thinking（Opus 5.5 恒开）、tool_choice、prefill、citations
  };
}
```

调用使用 `client.messages.create`，**不用 `messages.parse`**：1.1.0 的 parse 在解析失败时抛错并丢掉 usage（inputs/04 §4.4）。启动自检：部署后 `internal.ops.checkModel` 调 `client.models.retrieve(AGENT_MODEL)` 确认可用（失败只告警）。

## 10.8 响应处理 `parseAndCheck`

| 顺序 | 条件 | outcome / errorCode | 后续 |
| --- | --- | --- | --- |
| 0 | 抛 `APIError` 且 status 400 | api_error / `API_BAD_REQUEST` | 不重试，告警 |
| 0 | 抛超时 / 连接 / 5xx / 429（SDK 重试已耗尽） | timeout / api_error | turn failed → paused |
| 1 | 先记 usage、`msg.model`、`msg.id`、`_request_id`、`stop_reason`（无论后续成败） | — | — |
| 2 | `stop_reason === "refusal"` | refusal / `MODEL_REFUSAL:{category ?? "none"}` | 不自动重试（提示词不要求完整推理，避免 `reasoning_extraction`） |
| 3 | `stop_reason === "max_tokens"` | max_tokens | 不在同 turn 自动重试；评测中统计并据 `thinking_tokens` 调整 max_tokens |
| 4 | `stop_reason !== "end_turn"`（含 `model_context_window_exceeded`、`pause_turn`） | api_error / `UNEXPECTED_STOP:{reason}` | turn failed |
| 5 | 取第一个 `type === "text"` 块（按类型找，不按位置；可能先有 thinking 块） | 无 text → invalid_output / `NO_TEXT` | attempt 2 |
| 6 | `JSON.parse` → `buildOutputZod(spec).safeParse` | invalid_output / `SCHEMA_INVALID` + Zod issue 路径 | attempt 2 |
| 7 | `checkDecision`（05 §5.2） | invalid_output / 语义码 | attempt 2 |
| 8 | 通过 | ok | completeTurn 归约 |

attempt 2 的反馈：在同一个 user 消息末尾追加一个 `<previous_attempt_feedback>` 文本块（位于缓存断点 2 之后，不破坏已缓存前缀），内容只有错误码与被拒的键，例如 "Rejected: CANDIDATE_NOT_OFFERED (candidateKey \"X\" is not offered)."，不回放模型原输出；随后的中途 system 回合指令追加一句 "Correct the error above and answer again."。消息序列仍是 `[user, system]`，满足中途 system 消息紧跟 user 的要求（inputs/04 §4.7）。

## 10.9 服务端回退（fallbacks）
技能建议对 Opus 5.5 默认开启 `server-side-fallback`。但 `beta.messages` 上 `fallbacks` 与 `output_config.format` 能否同用待验证（inputs/04 待验证 #7）。决定：v1 先不开；验证通过后以配置 `ENABLE_FALLBACK=true` 开启，开启后 modelCalls 记录 `msg.model`（实际模型）与 `usage.iterations` 汇总，评测报告按实际模型分组（ADR-13）。

## 10.10 用量与成本记录
每个 attempt 一行 modelCalls（03 part2），字段直接取 `usage`：

```ts
const u = msg.usage;
record({ inputTokens: u.input_tokens, cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
  cacheReadInputTokens: u.cache_read_input_tokens ?? 0, outputTokens: u.output_tokens,
  thinkingTokens: u.output_tokens_details?.thinking_tokens ?? 0, model: msg.model,
  requestId: (msg as any)._request_id, stopReason: msg.stop_reason, latencyMs });
// 估算成本（微美元）只用于展示，标"estimate"；价格表放配置，不散落代码
estimatedCostMicroUsd = price(model).in * input + price.cacheWrite5m * cacheCreate + price.cacheRead * cacheRead + price.out * output;
```

stub / replay / scripted 也写 modelCalls（token 为 0，driverMode 标明），保证指标口径一致。SDK 内部重试的失败尝试是否计费待验证（#10），报告中注明。

## 10.11 提示缓存
- 渲染顺序 `system → messages`（不用 tools）。断点 1：system 末尾（协议章程 + 角色卡 + 场景规则，按 (promptVersion, scenarioVersion, roleKey) 稳定，目标 ≥ 1,500 token，超过 Opus 5.5 的 512 最小值）。断点 2：user 消息中本方 brief 块末尾（在一个 run 内按角色稳定）。
- 静默失效源的规避：system 中不放日期、ID、版本号；JSON 用规范化序列化（键排序）；同一角色的 system 不随候选或回合变化；effort 全 run 固定（effort 变化会使 messages 缓存失效）。
- 常驻断言：评测与运维看板统计 `cacheReadInputTokens / (input + cacheCreate + cacheRead)`；同角色第二回合起应 > 0，否则告警"cache miss regression"。
- 并行的两个评估调用前缀不同（角色不同），不存在"并发同前缀全价写"的浪费。

## 10.12 运行时与文件布局
- Claude 调用放 `convex/agents.ts`（默认运行时，显式传 apiKey）；SDK 在默认运行时的长请求行为待验证（#4），退路是 `convex/agentsNode.ts` 加 `"use node"`，该文件只放 `runTurn` action，mutation 留在 `convex/agents.ts`。
- `ANTHROPIC_API_KEY` 只在 Convex 环境变量中；Next 不持有。
