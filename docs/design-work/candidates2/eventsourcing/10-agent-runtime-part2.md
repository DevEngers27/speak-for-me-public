# 10 代理运行时 · part2：模型调用规范

> 分片清单见 part1。平台事实以 inputs/04 §4 为准。

## 7. 调用点与模型

| 调用点 | 模型 | effort | max_tokens | 说明 |
| --- | --- | --- | --- | --- |
| provider propose 回合 | `claude-opus-5-5` | `medium` | 8_000 | 默认模型；不得为省钱自行降级（技能硬规则） |
| customer / finance evaluate 回合 | `claude-opus-5-5` | `medium` | 6_000 | finance 代理保留模型调用，但只做"选择 + 解释"，算术与预算判断由代码完成（F10.17 裁决） |
| （可选）简报抽取 | `claude-opus-5-5` | `low` | 4_000 | 17 扩展点；只预填草稿 |

- 模型 ID 来自 Convex 环境变量 `AGENT_MODEL`，用常量白名单 `["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"]` 校验；默认与唯一推荐值是 `claude-opus-5-5`。换 Sonnet/Haiku 只能作为用户决策（18 开放问题），写入 ADR 后才改配置。
- `max_tokens` 为"思考 + 输出"留余量（thinking 计入，inputs/04 §4.2）；非流式上限约 21,333，这里远低于它。上线前按实测 `thinkingTokens` 收紧。

## 8. 请求形状（所有目标模型都接受的子集）

```ts
// convex/engine/agents/callModel.ts —— 只依赖 @anthropic-ai/sdk 与 zod，可在 Convex 外用脚本调试
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: SDK_TIMEOUT_MS, maxRetries: SDK_MAX_RETRIES });

export async function callModel(c: TurnContext): Promise<ModelCallResult> {
  const t0 = Date.now();
  const msg = await client.messages.create({
    model: c.model,                                   // 白名单校验后的值
    max_tokens: c.maxTokens,
    system: [{ type: "text", text: c.stableSystem, cache_control: { type: "ephemeral" } }],
    messages: [
      { role: "user", content: [
        { type: "text", text: c.principalBlock, cache_control: { type: "ephemeral" } },   // 本方委托（较稳定）
        { type: "text", text: c.turnBlock } ] },                                        // 候选、提案、历史
      ...(c.operatorNote ? [{ role: "system" as const, content: c.operatorNote }] : []), // 中途 system 消息
    ],
    output_config: { effort: c.effort, format: { type: "json_schema", schema: buildJsonSchema(c.envelope) } },
  });
  const usage = extractUsage(msg, Date.now() - t0);  // 先记用量
  if (msg.stop_reason !== "end_turn") return { ok: false, errorCode: `STOP_${msg.stop_reason.toUpperCase()}`, usage };
  const text = msg.content.find(b => b.type === "text")?.text;
  if (!text) return { ok: false, errorCode: "NO_TEXT_BLOCK", usage };
  let json: unknown; try { json = JSON.parse(text); } catch { return { ok: false, errorCode: "INVALID_JSON", usage }; }
  const parsed = outputSchemaFor(c.envelope).safeParse(json);
  return parsed.success ? { ok: true, message: parsed.data.message, usage }
                        : { ok: false, errorCode: "SCHEMA_MISMATCH", usage };
}
```

禁止项（会 400，inputs/04 §4.3）：`temperature`/`top_p`/`top_k`、assistant prefill、强制 `tool_choice`、`thinking:{type:"disabled"}` 或 `budget_tokens`、Citations 与结构化输出同用。thinking 不传（Opus 5.5 恒为 adaptive），不读取、不存储 thinking 内容（只记 thinkingTokens）。

`completeTurn` 收到 `ok:false` 时按 `invalid_output`（INVALID_JSON、SCHEMA_MISMATCH、NO_TEXT_BLOCK）或 `failed`（STOP_MAX_TOKENS、STOP_REFUSAL、其他）分类，两类都计入应用层 1 次自动重试。`parsed === null` 永远不被当作"代理没有动作"。

## 9. 结构化输出

- 自建 `buildJsonSchema(envelope)`：根为 `{type:"object", properties:{message:{anyOf:[…]}}, required:["message"], additionalProperties:false}`；每个分支 `action` 用 `const`，`candidateId` 用当前回合的 `enum`，所有 object `additionalProperties:false`；不写 `minLength/maxLength/minimum`（不受支持）。
- 待验证（inputs/04 待验证 #6）：API 对嵌套 `anyOf`、`const`、`enum` 的接受情况。退路：去掉 `const`/`enum` 的解码约束，仍靠 Zod 事后校验 + 1 次重试。
- 新 schema 首次请求有编译开销、缓存 24 小时；`candidateId` 的 enum 每回合不同，会频繁产生新 schema——**待验证其延迟影响**。若显著，改为固定 schema（`candidateId: string`）+ 代码成员检查，enum 只写进描述。

## 10. 上下文构造与缓存

| 层 | 内容 | 稳定性 | 缓存 |
| --- | --- | --- | --- |
| system | `plugin.agentBriefing.protocolText` + `scenarioRules` + 角色说明（每角色一份固定文本） | 部署内不变 | 断点 1 |
| principalBlock | 本方最新确认简报（结构化，键排序的规范 JSON）、买方专属预算数字 | 到简报/预算变更为止 | 断点 2 |
| turnBlock | 候选（按角色投影）、当前提案、本 run 的 `turn_completed` 模板文本、counter 原因 | 每回合变化 | 无 |
| operatorNote | 例如 "Constraints changed to v5; earlier proposals are void." | 偶发 | 无 |

- 每回合**无状态重建**：不回放任何 assistant 轮次与 thinking 块，因此"保留思考需逐字节不变"的约束不触发（inputs/04 §4.2）。
- system 中不放时间戳、ID、版本号；版本号在 turnBlock 中。JSON 用规范化序列化保证键序稳定。
- 前缀长度需 ≥ 512 token 才会缓存；验证手段：同角色第二次调用 `cacheReadInputTokens > 0`，作为 15 的常驻指标。
- 同一轮 customer 与 finance 并行调用的前缀不同（角色不同），互不影响。

## 11. 服务端回退（fallbacks）

技能建议对 Opus 5.5 默认开启 `fallbacks:"default"`（beta）。本设计 **v1 不开启**：①需改用 `client.beta.messages.create`；②与 `output_config.format` 同用待验证（inputs/04 待验证 #7）；③回退只在策略拒绝时触发，本场景拒绝概率低。拒绝按 `STOP_REFUSAL` 走失败分支与人工重试。若开启，用量记 `usage.iterations` 与实际 `msg.model`。见 18 开放问题。

## 12. 运行时位置与调试

- `convex/agents.ts`（action，默认运行时，显式 `apiKey`）；不放 `convex/actions/` 目录。若最小部署实验显示 SDK 在默认运行时有问题（inputs/04 待验证 #4），把 action 移到 `convex/agentsNode.ts`（`"use node"`，只含 action），internal mutation 留在 `convex/agentsInternal.ts`。
- `scripts/try-agent.ts`：用 fixture 构造 `TurnContext` 直接调用 `callModel`，不经 Convex，便于调 prompt。
- 日志纪律见 07 §8。
