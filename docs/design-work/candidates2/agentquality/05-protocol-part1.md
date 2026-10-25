# 05 协商协议（第 1/2 部分：信封、输出 schema、候选投影）

## 5.1 两层：服务端信封 vs 模型输出

| 层 | 内容 | 谁产生 | 是否给模型看 | 是否要模型回显 |
| --- | --- | --- | --- | --- |
| 信封 `TurnEnvelope` | runId、turnId、turnSeq、roundIndex、roleKey、purpose、attemptNo、constraintsVersionAtStart、catalogRevisionAtStart、baseProposalId、offeredCandidateKeys、allowedActions、promptVersion | `scheduleTurns`，写入 turns 行 | 部分（roleKey、round、提案版本号作背景） | **否**，completeTurn 只拿快照与当前 room 比较 |
| 模型输出 `TurnOutput` | action、candidateKey / reasonCode / topicKey、rationale | 模型（或 stub） | — | — |
| 派生层 | 条款、金额、日期、sourceRefs、公开文本、reasonCode | 代码 | 以结构化形式给后续回合 | — |

不变量：模型永远不提供身份、版本、ID、金额、日期、硬约束结论（I15）。

## 5.2 动作集与输出 schema

| action | 字段 | 允许的 purpose | 含义 |
| --- | --- | --- | --- |
| `propose` | candidateKey | propose | 提出在审方案 |
| `counter` | candidateKey | evaluate | 用另一个候选还价（本方隐含背书） |
| `recommend_accept` | — | evaluate | 建议本方的人接受当前在审方案（不是批准） |
| `reject` | reasonCode ∈ `AgentRejectCode` | propose、evaluate | 不接受且不还价 |
| `clarify` | topicKey ∈ 本角色可问话题 | propose、evaluate | 请求代码向信息所有者发人工请求 |

```ts
// engine/protocol/agent-codes.ts —— 模型可用的拒绝码只有"软"理由；硬约束码不在其中（I15）
export const AGENT_REJECT_CODES = ["SOFT_PREFERENCE_UNMET", "DELIVERY_RISK",
  "NO_ACCEPTABLE_CANDIDATE", "OTHER"] as const;
```

### 回合规格 → JSON Schema + Zod（同源）

`zodOutputFormat` 会把 `enum`/`const` 降级为描述文字（inputs/04 §4.4 实测），所以本设计**手写 JSON Schema 生成器**，保留 `enum`，并由同一个 `TurnSpec` 生成 Zod 校验器：

```ts
// engine/protocol/turn-spec.ts
export type TurnSpec = {
  allowedActions: ("propose" | "counter" | "recommend_accept" | "reject" | "clarify")[];
  candidateKeys: string[];        // 本回合本角色的候选（已排除重复与当前提案）
  rejectCodes: readonly string[];
  topicKeys: string[];            // 本角色未用过的澄清话题
  rationaleMaxChars: number;      // 600
};
export function buildOutputJsonSchema(s: TurnSpec): Record<string, unknown> {
  const branch = (action: string, extra: Record<string, unknown>, req: string[]) => ({
    type: "object", additionalProperties: false,
    properties: { action: { type: "string", enum: [action] }, ...extra,
      rationale: { type: "string", description: `Brief reason for your own principal, max ${s.rationaleMaxChars} chars.` } },
    required: ["action", ...req, "rationale"],
  });
  const branches = s.allowedActions.flatMap((a) => {
    if (a === "propose" || a === "counter")
      return s.candidateKeys.length ? [branch(a, { candidateKey: { type: "string", enum: s.candidateKeys } }, ["candidateKey"])] : [];
    if (a === "reject") return [branch(a, { reasonCode: { type: "string", enum: [...s.rejectCodes] } }, ["reasonCode"])];
    if (a === "clarify") return s.topicKeys.length ? [branch(a, { topicKey: { type: "string", enum: s.topicKeys } }, ["topicKey"])] : [];
    return [branch(a, {}, [])];
  });
  // 根必须是 object（避免根级 anyOf，inputs/04 待验证 #6）
  return { type: "object", additionalProperties: false,
    properties: { decision: { anyOf: branches } }, required: ["decision"] };
}
export function buildOutputZod(s: TurnSpec) {      // 事后校验，与上面同源
  const cand = z.string().refine((k) => s.candidateKeys.includes(k), "CANDIDATE_NOT_OFFERED");
  const rationale = z.string().max(4000);          // 宽松上限；超过 600 截断并记标志
  return z.strictObject({ decision: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("propose"), candidateKey: cand, rationale }),
    z.strictObject({ action: z.literal("counter"), candidateKey: cand, rationale }),
    z.strictObject({ action: z.literal("recommend_accept"), rationale }),
    z.strictObject({ action: z.literal("reject"), reasonCode: z.enum(s.rejectCodes as [string, ...string[]]), rationale }),
    z.strictObject({ action: z.literal("clarify"), topicKey: z.string().refine((t) => s.topicKeys.includes(t), "TOPIC_NOT_ALLOWED"), rationale }),
  ]) }).refine((o) => s.allowedActions.includes(o.decision.action), "ACTION_NOT_ALLOWED");
}
```

退路（待验证 #6：若 API 拒绝 `anyOf` 内的 `enum` 或嵌套 anyOf）：改为扁平对象 `{ action: enum, candidateKey: string|null, reasonCode: string|null, topicKey: string|null, rationale }`，全部字段 required、可空，由 Zod `superRefine` 做判别。两种形态由 `OUTPUT_SCHEMA_STYLE = "union" | "flat"` 配置切换，评测集对两者都跑。

### 语义校验 `checkDecision`（Zod 之后、归约之前）

| 错误码 | 条件 | 处理 |
| --- | --- | --- |
| `SCHEMA_INVALID` | JSON 解析或 Zod 失败 | invalid_output → 第 2 次 attempt（带反馈） |
| `ACTION_NOT_ALLOWED` | 动作不在 `allowedActions` | 同上 |
| `CANDIDATE_NOT_OFFERED` | candidateKey ∉ offeredCandidateKeys（I11） | 同上 |
| `REPEATED_CANDIDATE` | candidateKey ∈ run.proposedCandidateKeys | 同上（offered 集已排除，出现即模型违规） |
| `COUNTER_EQUALS_CURRENT` | counter 的候选等于在审提案 | 视为 recommend_accept？**否**：判 invalid，避免语义猜测 |
| `TOPIC_NOT_ALLOWED` | 话题不属于本角色或已用过 | invalid_output |
| `REJECT_UNSUPPORTED` | `NO_ACCEPTABLE_CANDIDATE` 但该角色候选集非空且含至少一个满足本方硬约束的候选 | 不 invalid；记 `agentClaimDisputed` 标志，按普通 reject 处理（评测指标之一） |

rationale 超过 600 字符：截断存储，记 `rationaleTruncated`，不重试（长度不受解码约束，真正的限制是 `max_tokens`）。

## 5.3 候选集按角色投影

候选由场景 `enumerateCandidates(input)` 生成；**输入是 RoleView，不是系统全量**，所以一个角色的候选标注只用它有权看到的信息：

| 角色 | 枚举时可用的约束 | 每个候选附带的事实 |
| --- | --- | --- |
| provider | 已确认目录、`rushAvailable`、customer 已披露的 requiredItemKeys / hardDeadline（若披露）、当前约束版本下对本角色可见的阻断结果 | itemKeys、deliveryMode、deliveryDate、priceCents、`knownBlocked?: "EXCEEDS_FINANCE_LIMIT" | "MISSING_REQUIRED_ITEM" | "DATE_AFTER_DEADLINE"` |
| customer | 目录 + 本方完整简报 + 预算余量（买方可见，07 §2） | 同上 + `meetsPreferredDate`、`includesDesired[]`、`fitsBudget`、`headroomAfterCents` |
| finance | 目录 + 预算 + customer 已披露字段 | priceCents、`fitsBudget`、`headroomAfterCents`、`meetsSoftHeadroom` |
| 系统（仅代码） | 全部 | `jointFeasible`：全部硬约束通过的候选；不进入任何上下文 |

规则：
1. 每角色最多列 `MAX_CANDIDATES_IN_PROMPT = 12` 个，按场景的确定性排序（硬约束可满足优先 → 本角色软分 → 价格 → candidateKey）。在审提案总是单独列出。
2. `offeredCandidateKeys` = 列出的候选 − `run.proposedCandidateKeys` − 当前在审提案；它写进 turn 信封与输出 schema 的 enum。
3. provider 的 `knownBlocked` 只来自**当前约束版本下 provider 界面本来就能看到的阻断结果**（本 run 被代码裁决的提议、旧提案的派生阻断），按 07 §2 映射成 provider 可见码；与界面信息完全一致（最小披露）。
4. 候选不含任何总额、已承诺额或余量给 provider。
