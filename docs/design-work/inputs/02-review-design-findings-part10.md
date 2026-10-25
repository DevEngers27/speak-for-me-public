# 02 审查设计发现 · part10：10 代理运行时（二）模型调用约束

> 分片清单见 part1。本片的模型与 SDK 行为来自审查时对 `@anthropic-ai/sdk` 1.1.0 源码与参考资料（缓存于 2026-10-06，confidence medium）的核对，**全部以 inputs/04-platform-constraints.md 为准**，那里没有覆盖的视为待验证。

### F10.10 模型 ID 不校验，请求形状随模型不同
- 问题：`ANTHROPIC_MODEL` 只取环境变量、没有白名单（`convex/lib/anthropic.ts:6-13`），SDK 类型也不按模型区分参数。SDK 1.1.0 对每个请求发送 `anthropic-version: 2026-10-21`（`client.js:966`，CHANGELOG 1.0.0 唯一 BREAKING）。审查列出的差异：temperature/top_p/top_k 在所有模型上 400（即使传默认值）；assistant prefill 在所有当前一代模型上 400；强制 tool_choice 在 Opus 5.5 / Sonnet 5.5 上 400（Haiku 5.5 例外）；`thinking: {type:'disabled'}` 与 `between_tools` 只有部分模型接受。tsc 只能拦下对象字面量里直接写的 temperature，其余写法都能通过 typecheck。换模型就 400，而且 400 不会被 SDK 重试（`shouldRetry`）。
- 设计要求：模型选择是显式配置并有白名单；请求只用所有目标模型都接受的形状。
- 建议方案：`createAgentClient` 用常量白名单校验模型 ID；启动或部署时用 `client.models.list()` / `models.retrieve(id)` 核对账户可用 ID 与能力。请求不传 temperature/top_p/top_k、不 prefill、不强制 tool_choice、不传 thinking（或只传 `{type:'adaptive'}`）、显式传 `output_config.effort`。`BadRequestError` 视为不可重试的编程错误，直接 failTurn。
- 来源：gap2-01、gap2-03（P13 第 1–2 点）。

### F10.11 thinking 与 effort 是延迟和成本的主要杠杆
- 审查所述：当前一代模型默认开启 adaptive thinking，Opus 5.5 关不掉，只能靠 effort 调节；effort 默认值随模型变化（Haiku/Opus medium，Sonnet high）；thinking token 计入 output_tokens 与 max_tokens，按输出价计费。
- 成本量级（审查按 9 次调用、每次 3K 入 / 2K 出估算，需实测）：Opus 5.5 ≈ $0.47、Sonnet 5.5 ≈ $0.23、Haiku 5.5 ≈ $0.012，相差约 40 倍。
- 建议方案：每个调用点（简报抽取、协商回合、finance 解释）单独决定模型与 effort，写进配置与 ADR；抽取类用小模型、effort low；协商回合用同一组 fixture 对比候选模型与 effort 的质量和 p50/p95 再定；验收必须在最终模型上完成。仓库里不硬编码价格，成本只按 token 与账单换算并标为估算。
- 来源：gap2-02（P13 第 2、6 点）。

### F10.12 max_tokens、stop_reason 与 parse 失败
- 问题：thinking 计入 max_tokens，但默认不返回 thinking 文本；max_tokens 设小（如 512/1024）时，thinking 可能用完额度，响应只有 thinking 块、stop_reason 为 max_tokens，`messages.parse` 只解析 text 块，于是 `parsed_output` 为 null **而不报错**；截断发生在 JSON 中间则抛 AnthropicError；拒答（stop_reason: refusal）时输出也可能不符合 schema。parse 失败抛普通 AnthropicError，不属于 HTTP 错误，SDK 不会重试。`parsed_output: null` 若被状态机当成"代理没有提议"，流程会错误推进。
- 建议方案：解析前检查 stop_reason，只接受 end_turn；max_tokens 与 refusal 走可恢复失败分支（invalid_output 或 failed，计入有界重试）；`parsed_output === null` 一律视为失败，绝不视为"无动作"。max_tokens 先给 thinking 留余量，再按实测 `output_tokens_details.thinking_tokens` 收紧；它也是限制单次输出长度与成本的真正手段（结构化输出的 maxLength 不在解码层强制）。
- 来源：gap2-04、security-12（P13 第 3 点）。

### F10.13 结构化输出的调用方式
- 推荐：`client.messages.parse({ model, max_tokens, messages, output_config: { effort, format: zodOutputFormat(agentModelOutput) } })`，读 `parsed_output`。
- 需要在 schema 层强制枚举时，可用 `jsonSchemaOutputFormat(schema, { transform: false })` 并自行做 Zod 校验（`zodOutputFormat` 会把约束降为 description，见 F05.2）。
- 所选模型不支持 `output_config.format` 时，退回 `tool_choice: auto` + `strict: true`，并检查模型是否真的调用了工具。
- 新 schema 首次使用有编译延迟（缓存 24 小时，待验证），上线前用最终 schema 预热一次。
- 来源：gap2-05、architecture-07、code-06（P13 第 4、7 点）。

### F10.14 每回合无状态重建上下文
- 问题：若为每个代理保留多轮原始历史并回传含 thinking 块的 `response.content`，同时在约束变化时改写顶层 system 或早先的消息，在 2026-08-31 之后创建的账户上会在生成前返回 400，原样重试也失败（审查所述，待验证），正好落在"约束变化"这个核心时刻。
- 建议方案：每回合从 Convex 无状态重建上下文（brief、共享事实、结构化历史），不回传 thinking 块；约束变化只追加一条新的消息说明，不改写顶层 system；兜底：捕获该类 400 后剥离 thinking / redacted_thinking 块重试一次。这也与"不记录隐藏推理"（README.md:291）一致。
- 来源：gap2-06（P13 第 5 点）。

### F10.15 用量记录与提示缓存
- 每次调用记录：model、input/output/thinking tokens、cache_read tokens、request id、latencyMs、attempt、stop_reason、errorCode（字段见 F03.9）。这些是可观测性与成本度量的唯一来源，不能事后估算（README.md:47 禁止编造）。
- 稳定的 system 与本方 brief 放在请求前缀，开启 prompt caching。
- 来源：P13 第 6 点、architecture-13、code-08。

### F10.16 来源引用用目录键，不用原生 Citations
- 原生 Citations 与 `output_config.format` 互斥；代理之间转发带 citations 的文本也会 400。来源引用由代码从 itemKeys 推出（F05.2）。
- 来源：gap2-07（P13 第 7 点）。

### F10.17 finance 代理的定位
- 如果 finance 代理完全不调模型，"三个隔离代理都调用模型"（README.md:398 G2）不再成立；审查建议 finance 保留一次简短的模型调用（只解释、建议），校验交给代码。设计要在 01 和 10 里明确选择，并在产品文字中如实描述。
- 来源：architecture-14、P2 第 6 点、M10。
