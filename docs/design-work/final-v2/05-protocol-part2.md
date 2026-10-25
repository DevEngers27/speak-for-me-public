# 05 · 协商协议（part2：TurnSpec 与输出 schema、解码层与 Zod 层）

> 分片清单见 `05-protocol.md` 开头。

## 5.4 `TurnSpec` 与输出 schema

### 5.4.1 唯一来源：`TurnSpec`（纯数据，`core/engine/protocol/turnSpec.ts`）

发给 API 的 JSON Schema 与事后校验的 Zod schema 出自同一份 `TurnSpec`（agentquality 底稿的"同源生成"），差别只在枚举是否进入解码约束。`TurnSpec` 是 Convex 值，可以从 `loadTurnContext` 经 `runQuery` 返回；Zod 对象与 JSON Schema **只在 action 内构造**，不经 `runQuery` 传递（canon D09：Zod 对象不是 Convex 值，带 `$defs` 的 schema 过不了 Convex 值校验）。

```ts
export const PROTOCOL_VERSION = 1 as const;
export type TurnKind = 'propose' | 'evaluate';
export type AgentAction = 'propose' | 'counter' | 'clarify' | 'recommend_accept' | 'reject' | 'escalate';

export type TurnSpec = {
  protocolVersion: typeof PROTOCOL_VERSION;
  scenarioKey: string; scenarioVersion: number;   // 话题表、reasonKey 表来自场景声明
  role: Role; kind: TurnKind;
  allowedActions: AgentAction[];                   // = turns.allowedActions（§5.3.3 裁剪后）
  optionCount: number;                             // n = candidateSnapshot.length，0..12
  topicKeys: string[];                             // 场景话题表中本角色可问的话题（§5.9）
  clarifyToRoles: Role[];                          // 这些话题的 ownerRole 去重
  escalateToRoles: Role[];                         // 场景全部角色
  reasonKeys: string[];                            // 场景为本角色声明的模型 reasonKey（取值以 14 §3 为唯一来源：customer missing_required_item / after_deadline /
                                                   // preference_not_met / price_too_high；finance over_budget / price_too_high；provider 只有 cannot_deliver）
};

/** schemaVersion：不做哈希（Convex 运行时 crypto.subtle 待验证），直接用规范串。 */
export const turnSpecKey = (s: TurnSpec) =>
  `p${s.protocolVersion}:${s.scenarioKey}@${s.scenarioVersion}:${s.role}:${s.kind}:n${s.optionCount}:${[...s.allowedActions].sort().join('+')}`;
```

`TurnSpec` **不含任何房间专有值**：没有 `baseProposalVersion` 的具体数字、没有 itemKey、没有 candidateKey。schema 因此只随 (场景版本, role, kind, n, 裁剪后的动作集) 变化，与房间无关，全局有界（§5.5.3）。

### 5.4.2 Zod schema（`convex/model/agents/outputSchema.ts`，Zod 只在 Convex 边界）

```ts
import { z } from 'zod/v4';
const optionKeysOf = (n: number) => Array.from({ length: n }, (_, i) => `O${i + 1}`) as [string, ...string[]];
const OPTION_KEY_RE = /^O(?:[1-9]|1[0-2])$/;
export const RATIONALE_MAX_CODEPOINTS = 1_200;   // canon §1.4
const RATIONALE_SANITY_MAX = 20_000;             // 仅防异常巨型输出；超 1,200 码点在归一化时截断（§5.6 步骤 9）

/** strict=true：发给 API 的形状（枚举进入解码约束）；strict=false：事后校验用的宽松形状。 */
export function buildTurnZod(s: TurnSpec, strict: boolean) {
  const enumOr = (vals: readonly string[], loose: z.ZodType) =>
    strict && vals.length > 0 ? z.enum(vals as [string, ...string[]]) : loose;
  const optionKey = enumOr(s.optionCount > 0 ? optionKeysOf(s.optionCount) : [], z.string().regex(OPTION_KEY_RE))
    .describe('One optionKey from <candidates>.');
  const version = z.int().min(1).max(1_000_000).describe('Proposal version number shown in <room_state>.');
  const rationale = z.string().min(1).max(RATIONALE_SANITY_MAX)
    .describe('Short note for YOUR OWN principal only, at most 3 sentences / 1,200 characters. Never shown to other parties.');
  const v = {
    propose: z.strictObject({ action: z.literal('propose'), optionKey, rationale }),
    counter: z.strictObject({ action: z.literal('counter'), optionKey, baseProposalVersion: version, rationale }),
    clarify: z.strictObject({ action: z.literal('clarify'),
      toRole: enumOr(s.clarifyToRoles, z.string()), topicKey: enumOr(s.topicKeys, z.string()), rationale }),
    recommend_accept: z.strictObject({ action: z.literal('recommend_accept'), proposalVersion: version, rationale }),
    reject: z.strictObject({ action: z.literal('reject'),
      proposalVersion: strict ? (s.kind === 'propose' ? z.null() : version) : version.nullable(),
      reasonKey: enumOr(s.reasonKeys, z.string()), rationale }),
    escalate: z.strictObject({ action: z.literal('escalate'),
      kind: z.enum(['infeasible', 'needs_tradeoff']), toRole: enumOr(s.escalateToRoles, z.string()), rationale }),
  } as const;
  const actions = strict ? s.allowedActions : (Object.keys(v) as AgentAction[]);   // 宽松形状接受全部六个动作，交给语义校验给出精确码
  const chosen = actions.map((a) => v[a]);
  if (chosen.length === 0) throw new Error('allowedActions must be non-empty');
  const turn = chosen.length === 1 ? chosen[0] : z.discriminatedUnion('action', chosen as never);
  return z.strictObject({ turn });                 // 根永远是 object（canon D09）
}
```

- 宽松形状是静态的（`AgentModelOutputLoose = buildTurnZod(LOOSE_SPEC, false)`），只检查结构：动作是否认识、字段是否齐全、类型是否正确、有无多余字段。动作是否允许、optionKey 是否在快照内、版本号是否等于 base，全部交给 `validateMoveSemantics`（§5.6），这样每类错误都有精确的 reasonCode，而不是一个笼统的 `schema_violation`。
- 不用 `z.iso.date()`、`z.record`、`.default()`、`.optional()`：输出里没有日期（日期由代码物化），没有可选字段。

### 5.4.3 严格 JSON Schema（`core/engine/strictSchema.ts`，纯 JSON → JSON）

调用链：`toStrictOutputSchema(z.toJSONSchema(buildTurnZod(spec, true), { target: 'draft-2020-12', reused: 'inline' }))`。`reused: 'inline'` 不产生 `$defs` / `$ref`（`$defs` 的 API 接受度待验证，spikes §8 #13），代价是 schema 多几百字节。`toStrictOutputSchema` 合并 protocol-rules 的 `toStrictOutputSchema`（剔除记录 + `apiSubsetViolations`）与 anthropic-zod 的 `toStrictJsonSchema`（内联、去 `$schema`、丢冗余 pattern），规则：

1. 删除根 `$schema`；根必须是 `type: 'object'`，否则抛错。
2. `oneOf` 改写为 `anyOf`（Zod 4.6.7 对 `discriminatedUnion` 原始输出是 `oneOf`，np-review r11 更正）。
3. 保留：`type`、`properties`、`required`、`items`、`anyOf`、`allOf`、`enum`、`const`、`description`、`title`、受支持的 `format`、`minItems ∈ {0,1}`；每个 object 强制 `additionalProperties: false`，并断言 `required` 覆盖全部属性。
4. 其余关键字（`minLength`、`maxLength`、`pattern`、`minimum`、`maximum`、`exclusive*`、`multipleOf`、`maxItems`、`minItems ≥ 2`、`default`、不受支持的 `format`）移入 `description`（`{key: value}` 文本），并把 `(path, key)` 记入返回值 `stripped[]`。
5. 节点既无 `type` 又无 `anyOf` / `allOf` / `enum` / `const` → **抛错**（与 SDK 行为一致；防止将来误加 `z.any()` 得到不受约束的 `{}`）。
6. 返回 `{ schema, stripped }`；`apiSubsetViolations(schema)` 必须为空（单测）。

customer · evaluate、n = 2、动作集 `[recommend_accept, counter, reject, clarify, escalate]` 的产物（节选，`rationale` 节点省略为 `R`）：

```json
{ "type": "object", "additionalProperties": false, "required": ["turn"],
  "properties": { "turn": { "anyOf": [
    { "type": "object", "additionalProperties": false, "required": ["action", "proposalVersion", "rationale"],
      "properties": { "action": { "type": "string", "const": "recommend_accept" },
        "proposalVersion": { "type": "integer", "description": "Proposal version number shown in <room_state>.\n\n{minimum: 1, maximum: 1000000}" }, "rationale": "R" } },
    { "type": "object", "additionalProperties": false, "required": ["action", "optionKey", "baseProposalVersion", "rationale"],
      "properties": { "action": { "type": "string", "const": "counter" },
        "optionKey": { "type": "string", "enum": ["O1", "O2"], "description": "One optionKey from <candidates>." },
        "baseProposalVersion": { "type": "integer" }, "rationale": "R" } },
    { "…reject: reasonKey enum [missing_required_item, after_deadline, preference_not_met, price_too_high]…" },
    { "…clarify: toRole enum [finance], topicKey enum [budget_room]…" },
    { "…escalate: kind enum [infeasible, needs_tradeoff], toRole enum [customer, provider, finance]…" } ] } } }
```

### 5.4.4 属性名白名单测试（canon §1.4"schema 中不得出现金额 / 版本 / 身份属性名"）

```ts
const ALLOWED_PROPS = new Set(['turn', 'action', 'optionKey', 'baseProposalVersion', 'proposalVersion',
  'toRole', 'topicKey', 'reasonKey', 'kind', 'rationale']);
const FORBIDDEN = /cents|amount|price|cost|total|budget|cap$|headroom|date|deadline|constraints?version|catalog|revision|termskey|candidatekey|executionkey|roomid|runid|turnid|proposalid|userid|^role$|actor|itemkeys?/i;
// 对全部 schema 变体（§5.5.3）递归遍历 properties：每个属性名 ∈ ALLOWED_PROPS，且不匹配 FORBIDDEN。
```

用白名单而不是只用黑名单：新增任何属性都必须改这份常量并经评审。`proposalVersion` / `baseProposalVersion` 是 canon §1.4 明文允许的**提案引用**（模型见过的小整数，服务端映射回 ID）；"禁止版本属性名"针对的是 `constraintsVersion`、目录修订号等快照字段，测试把这两个名字列为显式例外。

### 5.4.5 退路形态（待验证项失败时启用）

两个独立开关，评测集对每种组合都跑（16）：

| 开关 | 取值 | 何时切换 |
| --- | --- | --- |
| `OUTPUT_SCHEMA_STYLE` | `union`（默认，§5.4.3）/ `flat` | API 拒绝属性级 `anyOf` 或分支内 `const`（spikes §8 #13） |
| `OUTPUT_SCHEMA_TRANSFORM` | `strict`（默认，保留 enum / const）/ `sdk` | API 拒绝保留了 enum / const 的 schema（返回 400）：改用 `zodOutputFormat(buildTurnZod(spec, true)).schema`，枚举降级为描述，语义校验兜底 |

`flat` 形态（security 底稿 §5.4 的 `NONE` 哨兵写法）：`turn` 是单个 object，属性 `action`（enum 允许集）、`optionKey`（enum `['NONE', 'O1'..'On']`）、`proposalVersion`（integer，`0` 表示无）、`toRole` / `topicKey` / `reasonKey` / `kind`（各自 enum 前加 `'NONE'`）、`rationale`，全部 required。服务端 `fromFlat(flat, spec)` 先做字段组合检查（例：`action = counter` 而 `optionKey = 'NONE'` → `output.schema_violation`），再转成与 `union` 相同的 `AgentMove`（counter 的 `proposalVersion` 改名为 `baseProposalVersion`），之后的流水线完全相同。

## 5.5 解码层与 Zod 层各管什么

### 5.5.1 约束落点表

| 约束 | 严格 schema（解码期） | 宽松 Zod（事后） | 语义校验（§5.6） |
| --- | --- | --- | --- |
| 根是 object、`turn` 必有 | `type: object` + `required` | `strictObject` | — |
| 动作判别 | `const`（解码是否真正强制待验证，spikes §8 #14） | 六个 `literal` 之一 | ∈ `turn.allowedActions`，否则 `action.not_allowed_for_role` |
| `optionKey` | `enum O1..On` | 正则 `O1..O12` | ∈ 快照，否则 `action.option_not_in_snapshot` |
| 提案版本引用 | `integer` | `int ≥ 1`（provider 的 reject 为 `null`） | == `turn.baseProposalVersion`，否则 `output.unknown_reference` |
| `toRole` / `topicKey` / `reasonKey` | `enum`（按角色） | `string` | 话题表、角色表、reasonKey 表，否则 `output.unknown_reference` |
| 多余字段 | `additionalProperties: false` | `strictObject` | — |
| `rationale` 长度 | 只在 description | ≤ 20,000 | NFC 后 > 1,200 码点 → 截断并记 `rationaleTruncated`，**不重试** |
| JSON 合法 | 解码保证（截断除外） | `JSON.parse` | — |

只有 Zod 层才能发现的违规（长度、`flat` 形态的字段组合）是可预期的 `output.schema_violation`，进入有界自动重试（10）。

### 5.5.2 为什么长 rationale 截断而不重试

长度不受解码约束，真正的上限是 `max_tokens`；rationale 只给本方，截断不影响任何他方或任何判定；一次重试是一次完整计费调用。截断位置在码点边界，并在本方视图标注 "Truncated"。

### 5.5.3 schema 变体数与预热

| 单元 | 依赖 | 变体数（每场景版本） |
| --- | --- | --- |
| provider · propose | n ∈ 1..12 × {clarify±, escalate±, reject±} | 96 |
| customer · evaluate | 有 counter：n ∈ 1..12 × {clarify±, escalate±}；无 counter：{clarify±, escalate±} | 52 |
| finance · evaluate | {clarify±, escalate±}（不依赖 n） | 4 |

合计 ≤ 152 个，全部与房间无关。新 schema 首次请求有一次编译开销、之后缓存 24 小时（编译延迟与同一性判定待验证，spikes §8 #13）。v1 不做付费预热：12 §12.24 否决了 `ops.warmSchemas`（它的调用不写 `attempts`、不经美元预留与全局日花费计数），每个变体由首个真实回合承担一次编译开销；将来若要预热，必须走与业务调用相同的预留 / 用量 / `attempts` 记账，且不能用 `max_tokens: 0`（与 `output_config.format` 同用会被拒）。
