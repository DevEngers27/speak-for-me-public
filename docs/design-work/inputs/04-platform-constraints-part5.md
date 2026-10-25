# 04 平台约束与推荐模式（第 5/7 部分）

> 分片清单见 part1。本文件：§4 Claude API 与 @anthropic-ai/sdk 1.1.0（上）。技能文件缓存日期 2026-10-06；`SK:SKILL` 指 claude-api 技能主文档（以 Skill 工具加载，磁盘上无 SKILL.md）。

## §4 Claude（上）

### 4.1 模型与默认值

| 模型 ID | 上下文 / 最大输出 | 价格 $/MTok（入 / 出） | 缓存读 | effort 默认 | 关键差异 |
| --- | --- | --- | --- | --- | --- |
| `claude-opus-5-5`（默认） | 1M / 128K | 4 / 20；5 分钟缓存写 5，1 小时缓存写 8；Batch 2 / 10 | 0.20（0.05×） | `medium` | thinking 不可关闭；强制 `tool_choice` 返回 400；安全分类器含 `cyber`、`bio`、`reasoning_extraction`；无 Priority Tier；fast mode 仅 Claude API，8 / 40；知识截止 2026-06 |
| `claude-sonnet-5-5` | 1M / 128K | 2 / 10；缓存写 2.50 / 4 | 0.20 | `high`（等级已重新校准） | `thinking: {type:"disabled"}` 返回 400，最低档是 `{type:"between_tools"}`（仅 effort ≤ high、不得带其他字段、不能逐条改 effort、仅此模型接受）；强制 `tool_choice` 400；拒绝类别 `cyber/bio/frontier_llm/reasoning_extraction/general_harms`；服务端回退只重试 `cyber`、`frontier_llm` |
| `claude-haiku-5-5` | 1M / 128K | 提示 ≤100K token：0.10 / 0.50；更长：0.50 / 2.50 | 0.1× | `medium` | 仅 adaptive thinking；非默认采样参数与 prefill 返回 400；**没有服务端回退**（`fallbacks` 列表形式 400，`"default"` 形式拒绝仍是拒绝） |

来源：`SK:SKILL` Current Models 表与三个模型小节；`SK:shared/model-migration.md` 中 "Migrating to Claude Opus 5.5 / Sonnet 5.5 / Haiku 5.5" 各节（Opus 5.5 定价见其 "What carries over" 小节）。SDK 的 `Model` 联合类型包含这三个 ID（`SDK:resources/messages/messages.d.ts:3640`）。

- 技能硬规则：未经用户明确指定，一律用 `claude-opus-5-5`；不得为省钱自行降级；模型 ID 原样使用、不加日期后缀（`SK:SKILL` "ALWAYS use claude-opus-5-5"）。因此"某些路由用 Sonnet/Haiku"只能作为待用户拍板的选项写进 18-decisions。
- 速率限制：Opus 5.5 有独立于 Opus 5 的配额池，具体数值按账户等级，待验证。

### 4.2 Thinking 与 effort

- Opus 5.5 的 thinking **始终开启**：省略 `thinking` 或传 `{ type: "adaptive" }` 等价；`{ type: "disabled" }` 与 `{ type: "enabled", budget_tokens }` 在任何 effort 下都返回 400（`model-migration.md` Opus 5.5 Breaking change 1）。
- effort 是唯一的思考深度/成本/延迟旋钮：`output_config: { effort: "low" | "medium" | "high" | "xhigh" | "max" }`，Opus 5.5 默认 `medium`，**应显式设置**；降低 effort 比提示词"少想一点"更可靠（同节 "Choosing an effort level"）。SDK 类型：`OutputConfig { effort?, format? }`（`messages.d.ts:3641-3655`）。
- thinking 计入 `max_tokens`，即使 `display` 为默认的 `"omitted"`（thinking 文本为空字符串）也一样；`max_tokens` 要为"思考 + 回复"留足余量。响应可能以一个或多个 `thinking` 块开头，必须按块 `type` 读取，不能按位置取 `content[0]`。`display: "summarized"` 返回可读摘要；`display: "updates"` 是 beta（`thinking-display-updates-2026-08-18`），SDK 1.1.0 的类型只列 `'summarized' | 'omitted'`（`messages.d.ts:4002-4054`）。
- 顶层 effort 在请求间变化会使 messages 缓存失效；逐条 effort 变更是 beta（`mid-conversation-output-config-2026-07-01`）（`SK:shared/prompt-caching.md` Invalidation hierarchy）。
- 用量：`usage.output_tokens` 含思考 token；`usage.output_tokens_details.thinking_tokens` 给出其中的推理部分（`messages.d.ts:3610, 3664-3666`）。
- "保留思考"约束：thinking 块绑定产生它的模型与会话；若把历史 assistant 轮次（含 thinking 块）回放给模型，`system`、`tools` 和更早的消息必须逐字节不变，2026-08-31 及之后创建的账户默认强制，编辑过的历史直接 400（Opus 5.5 Breaking change 3）。若每次代理调用都重新组装、不回放模型自己的历史 thinking 块，此约束不触发。本项目 API key 所属账户的创建日期：待验证。

### 4.3 会返回 400 的参数与写法

| 写法 | 结果 | 依据 |
| --- | --- | --- |
| `temperature` / `top_p` / `top_k`（任意值，含默认值） | 400，所有模型 | SDK 1.1.0 默认发送 `anthropic-version: 2026-10-21`（`SDK:client.js:966`；`SDK:CHANGELOG.md` 1.0.0 "add support for new API version 2026-10-21"），该版本移除采样参数（`SK:shared/api-version-migration.md:95-124`）；SDK 1.1.0 的消息参数类型里已无这三个字段 |
| 末尾 assistant 消息（prefill） | 400 | `SK:SKILL` Common Pitfalls "Prefill removed" |
| `tool_choice: {type:"any"}` / `{type:"tool", name}` | Opus 5.5、Sonnet 5.5 返回 400（含 `count_tokens` 与 Batches）；Haiku 5.5 未列入，待验证 | `SK:shared/tool-use-concepts.md:93-108` |
| `thinking: {type:"disabled"}` 或 `budget_tokens` | Opus 5.5 400 | 4.2 |
| `assistant` 消息里直接放 `document` 块 | 400（2026-10-21 版本） | `api-version-migration.md:125-129` |
| `user` 消息里带非空 `citations` 的 `text` 块（含 `tool_result`/`search_result` 内） | 400（2026-10-21 版本）；把一个代理带引用的输出转交另一个代理时会踩到 | `api-version-migration.md:131-137` |
| `output_config.format` 与 Citations 同用 | 400 | `tool-use-concepts.md:560-566`；`SK:SKILL` Citations |

替代：要 JSON 就用结构化输出（4.4）；要引导调用某工具就用 `tool_choice: auto` + 提示词点名 + 工具 `strict: true`，并检查是否真的调用了，没调用就重试。没有"温度 0"可用，可复现性只能靠保存完整请求与响应。

### 4.4 结构化输出

- 规范写法：`messages.create({ ..., output_config: { format: { type: "json_schema", schema } } })`；旧的 `output_format` 已弃用（`SK:SKILL` Architecture）。辅助函数：`zodOutputFormat(zodSchema)`（`@anthropic-ai/sdk/helpers/zod`，内部用 `zod/v4` 的 `z.toJSONSchema(..., { reused: "ref" })` 再做 `transformJSONSchema`）与 `jsonSchemaOutputFormat(schema, { transform? })`（`@anthropic-ai/sdk/helpers/json-schema`，根必须是 `type: "object"`）（`SDK:helpers/zod.js:17-44`；`SDK:helpers/json-schema.js:13-36`）。
- `client.messages.parse(params)` 就是 `create(params).then(parseMessage)`（`SDK:resources/messages/messages.js:75-76`）；`messages.stream(...).finalMessage()` 也会解析（`SDK:lib/MessageStream.js:296, 455, 482`）。
- API 支持的 JSON Schema 子集（`tool-use-concepts.md:541-558`）：类型 object/array/string/integer/number/boolean/null；`enum`、`const`、`anyOf`、`allOf`、`$ref`/`$def`；字符串格式 date-time、time、date、duration、email、hostname、uri、ipv4、ipv6、uuid；所有 object 必须 `additionalProperties: false`。不支持：递归、`minimum/maximum/multipleOf`、`minLength/maxLength`、复杂数组约束、`additionalProperties` 非 false。
- **SDK 1.1.0 实测（PROBE：用 `NM:zod/v4` 与 `NM:@anthropic-ai/sdk/helpers/zod` 只读运行）**：`transformJSONSchema` 只保留 `type/anyOf/allOf/description/title/properties/required/additionalProperties(强制 false)/受支持的 format/items/minItems∈{0,1}/$ref/$defs`，其余键（**包括 `enum` 与 `const`**）都被挪进字段 `description` 文本（`SDK:lib/transform-json-schema.js:21-118`）：

```text
z.literal("propose")        -> {"type":"string","description":"{const: \"propose\"}"}
z.enum(["a","b"])           -> {"type":"string","description":"{enum: [\"a\",\"b\"]}"}
z.number().int().min(0)     -> {"type":"integer","description":"{minimum: 0, maximum: 9007199254740991}"}
z.string().max(200).optional() -> 不在 required 中，description "{maxLength: 200}"
z.string().nullable()       -> {"type":["string","null"]}
z.array(x).min(2)           -> description "{minItems: 2}"
z.discriminatedUnion(...)   -> 根级 {"anyOf":[...]}（oneOf 也会被改写为 anyOf）
```

  含义：经 `zodOutputFormat` 时，枚举、判别字段、数值边界都**不受解码约束**，只靠描述文字引导模型，事后由 Zod `safeParse` 校验。要让枚举受约束，需要自己生成 JSON Schema（保留 `enum`/`const`、去掉不支持的键）直接放进 `output_config.format`。待验证：API 是否接受根级 `anyOf`、`type` 数组写法、未列入 `required` 的可选属性（及其数量上限）。
- **失败语义（SDK 1.1.0，`SDK:lib/parser.js:30-64`）**：对每个 `text` 块解析，JSON 或 Zod 失败直接抛 `AnthropicError`；只有没有任何 `text` 块时（如空内容的拒绝）`parsed_output` 才是 `null`。技能文档写"解析失败时为 null"，与 1.1.0 源码不符，以源码为准。由于 `parse()` 在你检查 `stop_reason` 之前就抛错，`max_tokens` 截断时会丢失整个 Message（含 `usage`）。稳健写法：

```ts
const fmt = zodOutputFormat(TurnOutput);                 // schema 生成
const msg = await client.messages.create({               // 不用 parse()
  model: "claude-opus-5-5", max_tokens: 16000,
  output_config: { effort: "medium", format: { type: "json_schema", schema: fmt.schema } },
  system, messages,
});
recordUsage(msg.usage);                                  // 无论成败先记用量
if (msg.stop_reason !== "end_turn") { /* max_tokens | refusal | ... 分支处理 */ }
const text = msg.content.find((b) => b.type === "text")?.text;
const parsed = TurnOutput.safeParse(JSON.parse(text ?? "null"));
```

- 其他要点（`tool-use-concepts.md:560-566`）：新 schema 首次请求有编译开销，之后 24 小时缓存；`refusal` 时输出可能不符合 schema；`max_tokens` 时输出不完整；与 Batches、流式、token 计数、thinking 兼容。
- 结构化输出只保证"形状"，不保证内容真实：金额、范围项、日期必须由代码与用户确认过的数据核对（任务书核心第 4 条）。
