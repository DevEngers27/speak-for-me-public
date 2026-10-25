# Spike 报告：Anthropic SDK 1.1.0 + Zod 4.6.7 结构化输出离线验证

> 目录：`/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/spikes/anthropic-zod/`（下称 SPK）
> 版本：@anthropic-ai/sdk 1.1.0、zod 4.6.7、typescript 6.0.3、ajv 8.17.1（仅用来离线模拟解码约束）、Node 24.21.0
> **没有做任何真实的 Claude API 调用，也没有读取或搜索任何密钥。** 运行时探针全部走进程内的假 `fetch`（`baseURL: http://stub.invalid`，`apiKey` 是写死的占位字符串 `offline-dummy-not-a-key`），运行时还 `env -u` 掉了 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_PROFILE`。

## 1. 目的

验证 10-agent-runtime 和 05-protocol 依赖的四组假设：

1. 协商回合的模型输出 schema（以 `action` 为判别字段的联合：propose / counter / clarify / recommend_accept / reject / request_tradeoff，不含任何金额字段）经 `zodOutputFormat()` 生成 JSON Schema 后，哪些约束会保留成真正的 JSON Schema 关键字（受解码约束），哪些会被降级成 `description` 文本。
2. `client.messages.parse({ model: 'claude-opus-5-5', max_tokens, messages, output_config: { effort: 'low', format } })` 能否通过类型检查；`thinking`、`temperature`、`tool_choice` 等字段在类型层面受到什么约束。
3. `parsed_output` 的静态类型，`stop_reason` 的枚举，以及 `parse()` 在截断、拒绝、校验失败时的实际行为。
4. 给出推荐的封装函数 `callModel()`（处理 max_tokens 与 refusal、对解析失败分类、记录用量）。

## 2. 做了什么

### 2.1 命令

```bash
mkdir -p SPK && cd SPK
npm install @anthropic-ai/sdk@1.1.0 zod@4.6.7 typescript@6.0.3 @types/node@24 ajv@8.17.1
npm run typecheck     # tsc --noEmit（strict、noUncheckedIndexedAccess、nodenext）
npm run schema        # node src/print-schema.ts   → out/*.json + out/print-schema.txt
npm run matrix        # node src/constraint-matrix.ts → out/constraint-matrix.txt
npm run gap           # node src/decode-gap.ts     → out/decode-gap.txt
npm run stub          # node src/stub-harness.ts   → out/stub-harness.txt（只走假 fetch）
npm run determinism   # node src/determinism.ts    → out/determinism.txt
```

Node 24 直接运行 `.ts`（类型擦除），不需要构建步骤。

### 2.2 关键代码路径

| 文件 | 作用 |
| --- | --- |
| `src/turn-schema.ts` | 协商回合的模型输出 schema：根级 `z.discriminatedUnion("action", …)`，6 个变体全部用 `z.strictObject`；`Terms = { scopeItemIds, deliveryDate }`，**没有金额字段**（价格由规则引擎按目录计算）；`noteToPrincipal` 用 `.nullable()` 而不用 `.optional()`；另有一个根为 object 的包装 `ModelTurnEnvelope = { turn: ModelTurnOutput }`；还有用于扫描禁止属性名的 `FORBIDDEN_PROPERTY_PATTERN` |
| `src/strict-format.ts` | 自建的 JSON Schema 生成器：保留 `enum` 和 `const`（它们在 API 支持的子集内），只把真正不支持的关键字挪进 `description`；去掉根级 `$schema`；格式受支持时丢弃 zod 附带的冗余 `pattern`；内联而不用 `$ref`。导出 `toStrictJsonSchema`、`strictJsonOutputFormat`（不带 parse，给 `create()` 用）、`strictZodOutputFormat`（带 Zod parse，可以给 `parse()` 用） |
| `src/print-schema.ts` | 打印 5 种 schema（zod 原始输出、SDK 根联合、SDK 包装、strict 根联合、strict 包装），并统计每个关键字是作为真关键字出现，还是被写进了 description |
| `src/constraint-matrix.ts` | 逐个 Zod 构造对比 SDK 与 strict 的输出 |
| `src/decode-gap.ts` | 用 Ajv（draft 2020-12）近似"解码器允许什么"，同一批载荷分别过 SDK schema、strict schema 和 Zod |
| `src/type-tests.ts` | 类型层探针（只做类型检查，从不执行）：`Expect<Equal<…>>` 断言加 `@ts-expect-error` 断言 |
| `src/call-model.ts` | 推荐的 `callModel()`、`classifyApiError()`、`toUsageRecord()` |
| `src/stub-harness.ts` | 用假 `fetch` 返回预制的 Message JSON，在运行时观察 `parse()` 的失败语义、实际发出的请求、非流式 max_tokens 守卫，以及 `callModel()` 的分类结果 |
| `src/determinism.ts` | 检查生成的 schema 是否逐字节稳定 |

阴性对照：把 `type-tests.ts` 中 temperature 那行的 `@ts-expect-error` 去掉，再把 `parsed_output` 的期望类型改成不含 `null`，tsc 随即报 `TS2769` 和 `TS2344`。这说明探针确实被检查了，不是空跑。

## 3. 实测结果（原样粘贴关键输出）

### 3.1 schema 生成：关键字保留/降级统计（`out/print-schema.txt`）

```text
== zod-raw-union {"rootType":null,"rootHasAnyOf":false,"asKeyword":{"oneOf":1,"$defs":1,"$schema":1,"additionalProperties":10,"const":6,"$ref":25,"minItems":5,"maxItems":5,"enum":4,"minLength":6,"maxLength":7,"pattern":2,"format":1,"anyOf":1},"inDescription":{},"forbiddenPropertyNames":[],"bytes":4478}
== sdk-zodOutputFormat-union {"rootType":null,"rootHasAnyOf":true,"asKeyword":{"anyOf":2,"$defs":1,"additionalProperties":10,"minItems":4,"$ref":25,"format":1},"inDescription":{"$schema":1,"maxItems":5,"pattern":2,"minLength":6,"maxLength":7,"enum":4,"const":6,"minItems":1},"forbiddenPropertyNames":[],"bytes":4908}
== sdk-zodOutputFormat-envelope {"rootType":"object","rootHasAnyOf":false,"asKeyword":{"$defs":1,"additionalProperties":11,"minItems":4,"$ref":25,"format":1,"anyOf":2},"inDescription":{"$schema":1,"maxItems":5,"pattern":2,"minLength":6,"maxLength":7,"enum":4,"const":6,"minItems":1},"forbiddenPropertyNames":[],"bytes":4997}
== strict-union {"rootType":null,"rootHasAnyOf":true,"asKeyword":{"anyOf":7,"additionalProperties":13,"const":6,"minItems":6,"format":3,"enum":6},"inDescription":{"maxItems":7,"minLength":16,"maxLength":22,"pattern":8,"minItems":1},"forbiddenPropertyNames":[],"bytes":6799}
== strict-envelope {"rootType":"object","rootHasAnyOf":false,"asKeyword":{"additionalProperties":14,"anyOf":7,"const":6,"minItems":6,"format":3,"enum":6},"inDescription":{"maxItems":7,"minLength":16,"maxLength":22,"pattern":8,"minItems":1},"forbiddenPropertyNames":[],"bytes":7644}

== SDK root keys: [ '$defs', 'anyOf', 'description' ]
== SDK root description: "{$schema: \"https://json-schema.org/draft/2020-12/schema\"}"
== SDK $defs keys: [ '__schema0', … '__schema8' ]
```

经 SDK 处理后，6 个分支的判别字段全都退化成没有约束的字符串：

```text
[{'type': 'string', 'description': '{const: "propose"}'}, {'type': 'string', 'description': '{const: "counter"}'}, … '{const: "request_tradeoff"}'}]
```

SDK 输出里 propose 分支的 `sourceRefs` 片段：`"minItems": 1, "description": "{maxItems: 12}"`；日期字段：`"format": "date"`，外加一段约 300 字符的闰年正则被塞进 description。

### 3.2 逐构造矩阵（`out/constraint-matrix.txt`，节选）

```text
## literal        sdk: {"type":"string","description":"{const: \"propose\"}"}   strict: {"type":"string","const":"propose"}
## enum           sdk: {"type":"string","description":"{enum: [\"a\",\"b\"]}"}  strict: {"type":"string","enum":["a","b"]}
## string.min(1).max(600)  sdk/strict: {"type":"string","description":"{minLength: 1, maxLength: 600}"}
## iso.date       sdk: {"type":"string","format":"date","description":"{pattern: \"^(?:(?:\\\\d\\\\d[2468][048]|…\"}"}  strict: {"type":"string","format":"date"}
## string.nullable sdk/strict: {"type":["string","null"]}
## optional field sdk/strict: {...,"properties":{"a":…,"b":…},"additionalProperties":false,"required":["a"]}
## array.min(2).max(3) sdk: {"type":"array","items":{"$ref":"#/$defs/__schema0"},"description":"{maxItems: 3, minItems: 2}"}
## array.min(1)   sdk: {"type":"array","items":{…},"minItems":1}
## int.min(0)     sdk/strict: {"type":"integer","description":"{minimum: 0, maximum: 9007199254740991}"}
## record(string,string) sdk/strict: {"type":"object","properties":{},"additionalProperties":false,"description":"{propertyNames: {\"type\":\"string\"}}"}
## union of literals sdk: {"anyOf":[{"type":"string","description":"{const: \"x\"}"},…]}  strict: {"anyOf":[{"type":"string","const":"x"},…]}
## default('x')   sdk/strict: {"type":"string","description":"{default: \"x\"}"}（且被列入 required）
```

### 3.3 解码缺口（`out/decode-gap.txt`）：同一载荷分别过 SDK schema、strict schema 和 Zod

```text
valid propose                      sdkSchema=ACCEPT  strictSchema=ACCEPT  zod=ok
counter missing baseProposalId     sdkSchema=ACCEPT  strictSchema=reject  zod=FAIL(baseProposalId)
unknown action 'approve'           sdkSchema=ACCEPT  strictSchema=reject  zod=FAIL(action)
reject with bad reasonCode         sdkSchema=ACCEPT  strictSchema=reject  zod=FAIL(reasonCode)
clarify addressee 'cfo'            sdkSchema=ACCEPT  strictSchema=reject  zod=FAIL(addressee)
tradeoff with 1 option             sdkSchema=ACCEPT  strictSchema=ACCEPT  zod=FAIL(options)
publicRationale 2000 chars         sdkSchema=ACCEPT  strictSchema=ACCEPT  zod=FAIL(publicRationale)
amount smuggled as extra key       sdkSchema=reject  strictSchema=reject  zod=FAIL(terms)
```

（Ajv 只是对"解码器会允许什么"的近似；API 的真实语法编译器是否与它一致，无法离线验证。）

### 3.4 schema 是否逐字节稳定（`out/determinism.txt`）

```text
sdk hash 910bb6fea0af3e09 == 910bb6fea0af3e09: true; first build 1.4ms
strict hash a1f5b0e866612f20 == a1f5b0e866612f20: true
```

两次独立进程的哈希相同。

### 3.5 类型检查（`src/type-tests.ts`，`npm run typecheck` 退出码 0）

| 探针 | 结果 |
| --- | --- |
| `client.messages.parse({ model:'claude-opus-5-5', max_tokens:16000, messages, output_config:{ effort:'low', format: zodOutputFormat(ModelTurnOutput) } })` | 通过 |
| `typeof res.parsed_output` 等于 `ModelTurnOutput \| null` | 通过（`Expect<Equal<…>>`） |
| `parsed_output.action === "counter"` 时可以访问 `baseProposalId`；`=== "propose"` 时访问会报错 | 收窄正确 |
| `Anthropic.StopReason` 等于 `'end_turn'\|'max_tokens'\|'stop_sequence'\|'tool_use'\|'pause_turn'\|'refusal'\|'model_context_window_exceeded'`；`res.stop_reason` 是 `StopReason \| null` | 通过；对 `never` 做穷尽检查的 switch 也通过 |
| `stop_details.category` 是 `'cyber'\|'bio'\|'frontier_llm'\|'reasoning_extraction'\|'general_harms'\|null` | 通过（SDK 把它定义成**封闭**联合，技能文档说它是开放集合） |
| `res._request_id` 是 `string \| null \| undefined` | 通过 |
| `thinking: {type:'adaptive'}`、`{type:'adaptive', display:'summarized'}` | 通过 |
| `thinking: {type:'disabled'}`、`{type:'enabled', budget_tokens}`、`{type:'between_tools'}` | **都能通过类型检查**（运行时在 Opus 5.5 上返回 400，类型拦不住） |
| `thinking: {type:'adaptive', display:'updates'}` | 报错（这是 beta，非 beta 类型里没有） |
| 对象字面量里写 `temperature` / `top_p` / `top_k` | 报错（多余属性检查） |
| 用**非字面量**变量带上 `temperature: 0` 传给 `create()` | **能通过**（结构类型），而且运行时会原样发出去，见 3.6 B |
| `tool_choice: {type:'any'}` / `{type:'tool', name}` | **能通过**（运行时在 Opus 5.5 上返回 400） |
| `output_config.effort: 'minimal'` | 报错 |
| `output_format: …`（已弃用） | 报错（1.1.0 的参数类型里已经没有这个字段） |
| `model: 'claude-opus-5.5'`（拼错） | **能通过**（`Model` 的定义是 `已知联合 \| (string & {})`） |
| 末尾放一条 assistant 消息（prefill） | 能通过（运行时返回 400） |
| `messages` 中途放 `{role:'system'}` | 能通过 |
| `strictZodOutputFormat(schema)` 传给 `parse()` | `parsed_output` 推断为 `ModelTurnOutput \| null` |
| 不带 parse 函数的 `{type:'json_schema', schema}` 传给 `parse()` | `parsed_output` 的类型是 `null` |
| `client.beta.messages.create({ betas:['server-side-fallback-2026-07-01'], fallbacks:'default', output_config:{effort, format} })` | 类型通过；`BetaStopReason` 比非 beta 多一个 `'compaction'`；`usage.iterations` 存在 |

### 3.6 假 fetch 运行时探针（`out/stub-harness.txt`）

```text
=== A. messages.parse() failure semantics
[parse] end_turn + thinking + valid JSON: OK stop=end_turn parsed_output=propose
[parse] max_tokens truncated JSON: THROWS AnthropicError: Failed to parse structured output: Error: Failed to parse structured output as JSON: Unterminated string in JSON at position 40 (line 1 colu
[parse] refusal, empty content: OK stop=refusal parsed_output=null
[parse] refusal, partial text: THROWS AnthropicError: Failed to parse structured output: Error: Failed to parse structured output as JSON: Unterminated string in JSON at position 14 (line 1 colu
[parse] end_turn, schema mismatch (action=approve): THROWS AnthropicError: Failed to parse structured output: Error: Failed to parse structured output: [
[parse] end_turn, two text blocks: THROWS AnthropicError: Failed to parse structured output: Error: Failed to parse structured output as JSON: Unexpected token 'a', "trailing note" is not valid JSON

=== B. what goes on the wire
url: http://stub.invalid/v1/messages
anthropic-version: 2026-10-21
header names: accept,anthropic-version,authorization,content-type,user-agent,x-stainless-arch,…,x-stainless-retry-count,x-stainless-runtime,x-stainless-runtime-version,x-stainless-timeout
body keys: [ 'model', 'max_tokens', 'messages', 'output_config' ]
output_config keys: [ 'effort', 'format' ] format keys: [ 'type', 'schema' ]
non-literal temperature forwarded to body: true

=== C. non-streaming max_tokens guard (fetch calls before/after)
max_tokens=21333: sent (fetch calls +1)
max_tokens=21334: THROWS before fetch=true: Streaming is required for operations that may take longer than 10 minutes. See https://git
max_tokens=64000: THROWS before fetch=true: Streaming is required for operations that may take longer than 10 minutes. See https://git

=== D. callModel() classification (stubbed)
[callModel] valid: ok action=propose cost=52800µ$ thinking=700 reqId=req_stub_1 attempts=1
[callModel] max_tokens: kind=max_tokens retryable=true usage=kept status=- paths=- attempts=1
[callModel] refusal: kind=refusal retryable=false usage=kept status=- paths=- attempts=1
[callModel] schema mismatch: kind=schema_mismatch retryable=true usage=kept status=- paths=baseProposalId attempts=1
[callModel] invalid json: kind=invalid_json retryable=true usage=kept status=- paths=- attempts=1
[callModel] tool_use stop: kind=unexpected_stop retryable=false usage=kept status=- paths=- attempts=1
[callModel] HTTP 400: kind=bad_request retryable=false usage=null status=400 paths=- attempts=1
[callModel] HTTP 429: kind=rate_limited retryable=true usage=null status=429 paths=- attempts=1
[callModel] HTTP 529: kind=overloaded_or_server retryable=true usage=null status=529 paths=- attempts=1
[callModel] timeout 50ms: kind=timeout retryable=true usage=null status=- paths=- attempts=1
[callModel] timeout 50ms, maxRetries=1: kind=timeout retryable=true usage=null status=- paths=- attempts=2
[callModel] 500 x3 with maxRetries=2: kind=overloaded_or_server retryable=true usage=null status=500 paths=- attempts=3
callModel body keys: [ 'model', 'max_tokens', 'system', 'messages', 'output_config' ] (no thinking)
```

说明：stub 的 usage 是 input 1200、output 900、5 分钟缓存写入 6000，按 Opus 5.5 价目估算为 1200×4 + 900×20 + 6000×5 = 52,800 微美元，与输出一致。SDK 1.1.0 把 `apiKey` 作为 `Authorization: Bearer …` 发送，没有用 `x-api-key`（`client.js:446`）。

## 4. 对设计的结论

### 4.1 被证实

1. **`zodOutputFormat` 会把 `enum` 和 `const` 降级成描述文字**（与 inputs/04 part5 的探针结论一致，这次用协议 schema 复现）。协议里 6 个 `action` 字面量、`reasonCode`、`addressee`、`topic`、`sourceRefs.kind` 在发给 API 的 schema 中全是没有约束的 `type: string`。`minLength`、`maxLength`、`pattern`、`maxItems`、`minItems ≥ 2`、`minimum`/`maximum`、`default` 同样被挪进 description；真正保留下来的只有 `type`、`anyOf`、`properties`、`required`、`additionalProperties:false`、受支持的 `format`、`minItems∈{0,1}`、`$ref`/`$defs`。
2. **判别联合的生成方式**：zod 4 产出根级 `oneOf`，SDK 改写成根级 `anyOf`。全程**不会出现 `discriminator` 关键字**。根级 `$schema` 被 SDK 当成"未知约束"拼进了根的 `description`（无害但多余）。`reused:"ref"` 产出 `__schema0..8` 这种不透明的 `$defs` 名。
3. **SDK schema 的解码缺口是实在的**：只要 `action` 不受约束，"counter 缺 `baseProposalId`"会命中 propose 分支的结构，`action:'approve'` 也能命中 recommend_accept 分支的结构。这些都是 SDK schema 接受、Zod 拒绝的载荷（3.3），会稳定地变成客户端的 `schema_mismatch`。`additionalProperties:false` 生效：模型无法在 `terms` 里夹带 `priceUsd`。
4. **自建的 strict 生成器能把枚举类缺口补上**：保留 `enum`/`const` 之后，上面 4 类载荷在 schema 层就被拒绝；剩下的长度、数组上界、`minItems:2` 仍然只能靠 Zod 事后校验。
5. **`messages.parse()` 的失败语义**（以 1.1.0 源码与运行结果为准，技能文档里"解析失败时为 null"的说法不准确）：截断、带半截文本的拒绝、Zod 不匹配、多个 text 块都会**直接抛 `AnthropicError`**，整个 Message（含 `usage` 和 `_request_id`）随之丢失；只有"拒绝且 content 为空"时才返回 `parsed_output: null`。thinking 块不影响解析。结论：生产路径用 `create()` 加自行 `safeParse`，不要用 `parse()`。
6. **类型层的约束**：采样参数、`output_format`、非法 effort、beta 才有的 `display:'updates'` 会被类型挡住；`thinking:{disabled|enabled|between_tools}`、强制 `tool_choice`、prefill、拼错的模型 ID 都能通过类型检查，只会在运行时返回 400。因此这些规则必须写进封装函数（`callModel` 固定参数），外加一条 lint/测试，而不能指望类型。
7. **非字面量对象绕过多余属性检查**：`temperature` 会被原样发出（3.6 B）。封装函数应当由自己构造请求字面量，不接受调用方透传的参数对象。
8. **非流式 `max_tokens` 守卫**：21,333 能发出，21,334 在发请求之前就被 SDK 拒绝（不产生网络调用）。
9. **超时与重试**：`maxRetries` 对超时同样生效（50 ms 超时、`maxRetries=1` 时实际发了 2 次）；500 错误在 `maxRetries=2` 时实际发了 3 次。单次 action 内的墙钟上限 ≈ `timeoutMs × (maxRetries+1)` 加上退避时间。
10. **schema 逐字节稳定**（同进程与跨进程哈希一致），每次请求重新生成也不会破坏 API 的 24 小时 schema 缓存；不过应当在模块加载时预先算好，并把哈希记作 `schemaVersion`。
11. **请求 ID**：`_request_id` 取自响应头 `request-id`，类型是 `string|null|undefined`，可以写入用量记录。

### 4.2 被证伪或需要修正的说法

1. inputs/04 part5 写"`z.string().nullable()` 生成 `{"type":["string","null"]}`"：单独使用时确实如此；但当它带 `.describe()` 并且被复用（`reused:"ref"`）时，SDK 产出的是 `anyOf:[{$ref}, {type:null}]`，而 strict 内联产出 `anyOf:[{type:string},{type:null}]`。两种形状都会出现，设计里不要假定只有一种。
2. 技能文档 tool-use-concepts 说"SDK 会去掉不支持的约束并在客户端校验"：去掉（挪进 description）是真的，"客户端校验"只发生在 `parse()` 路径上，并且是以抛错的方式。走 `create()` 时不会有任何校验。
3. 技能文档说 `stop_details.category` 是开放集合，SDK 1.1.0 的类型却是封闭联合。运行时要按 `string|null` 处理，存库时也不要用封闭的 `v.union` 字面量。
4. `z.record()` 不能用于模型输出：转换后变成 `properties:{}` + `additionalProperties:false`，模型只能输出 `{}`（被 SDK 静默改写，不报错）。`.default()` 会让字段进入 `required`，而默认值只写在描述里，同样不适合模型输出。

### 4.3 无法离线验证（需要一次真实调用，列入待验证）

1. API 是否接受**根级 `anyOf`** 的 `output_config.format`（SDK 的 `jsonSchemaOutputFormat` 自己要求根是 object，`zodOutputFormat` 却不检查）。建议在验证前默认用根为 object 的包装 `ModelTurnEnvelope`，两份 schema 都已生成。
2. API 的语法编译器对 `const`/`enum` 的实际约束效果是否与 Ajv 的近似一致；`type:["string","null"]` 这种数组写法是否被接受；`$defs` 名字（`__schema0`）对模型行为有没有影响。
3. 可选属性（不在 `required` 里）的接受情况与数量上限；schema 大小（6.8–7.6 KB）对编译延迟和输入 token 的影响。
4. `beta.messages` 上 `fallbacks:"default"` 与 `output_config.format` 同时使用（类型通过，运行时未知）；回退模型产出的 JSON 是否同样受 schema 约束。
5. `effort:'low'` 时，Opus 5.5 在这个 schema 下的 thinking token 量，以及 `max_tokens:16000` 是否足够；拒绝率与 `schema_mismatch` 率。
6. SDK 内部重试的失败尝试是否计费；`model_context_window_exceeded` 的触发条件。

### 4.4 对 10-agent-runtime / 05-protocol 的具体建议

- schema 生成：用 `toStrictJsonSchema(ModelTurnEnvelope)`（保留 enum/const、根为 object、内联），在模块加载时算好，并把 sha256 前 16 位记为 `schemaVersion`。Zod `safeParse` 仍然是权威校验，其后才是业务规则校验（引用的 id 必须存在于上下文、日期可行等）。
- 调用：只走 `callModel()`。固定 `model`，`effort` 必须显式给，不传 `thinking`、采样参数和 `tool_choice`，`max_tokens ≤ 21,333`（默认 16,000），`timeout` 和 `maxRetries` 显式配置；跨 action 的重试交给 Convex attempt。
- 失败分类（闭集 16 种）：`refusal` 不重试，转人工；`max_tokens` 可以重试一次（提高 `max_tokens` 或降低 effort）；`schema_mismatch` 和 `invalid_json` 有界重试；`bad_request`/`auth` 视为配置错误，告警且不重试。除了没有收到响应的情况，`usage` 始终保留并落库。
- 日志纪律：`detail` 字段不含模型文本和私密简报内容；`rawText` 只写进私有表；Zod 错误只记录 issue 的路径；日志要脱敏 `authorization` 头（SDK 1.1.0 用 Bearer 发 key）。
- 协议 schema 的取舍：`noteToPrincipal` 用 `nullable` 而不用 `optional`（保证全部字段 required）；不使用 `record`/`default`；金额字段一律不出现（`FORBIDDEN_PROPERTY_PATTERN` 扫描结果为空，可以做成测试）。

## 5. 可直接复用的代码清单

| 路径 | 用途 |
| --- | --- |
| `SPK/src/turn-schema.ts` | 协商回合模型输出的 Zod schema（6 个动作的判别联合，无金额字段）与根为 object 的包装 |
| `SPK/src/strict-format.ts` | `toStrictJsonSchema` / `strictJsonOutputFormat` / `strictZodOutputFormat`：保留 enum/const 的 schema 生成器 |
| `SPK/src/call-model.ts` | `callModel()`、`classifyApiError()`、`toUsageRecord()`（含 Opus 5.5 成本估算，单位为整数微美元） |
| `SPK/src/type-tests.ts` | SDK 类型契约回归测试（升级 SDK 时先跑 tsc） |
| `SPK/src/stub-harness.ts` | 假 fetch 测试夹具：不联网就能测试 parse/create 的行为和 callModel 的分类，可以改写成 vitest |
| `SPK/src/decode-gap.ts` | 用 Ajv 近似解码约束、对照 Zod 的检查脚本 |
| `SPK/out/strict-envelope.json` 等 | 生成好的 schema 快照，可以做成快照测试 |
