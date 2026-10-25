# 05 协商协议（part1）：信封与模型输出、动作集、schema

> 分片：part1 两层消息、动作集、Zod 与语义校验、公开结果与私密理由；part2 应用规则、回合与轮次、澄清 / 升级 / 不可行、向具体的人请求取舍、人工动作、完整示例。
> 实现：`convex/engine/protocol.ts`（纯模块，只依赖 zod）；场景词表在 `convex/scenarios/scopeChange/vocab.ts`。`PROTOCOL_VERSION = 1`。

## 5.1 两层：服务端信封 vs 模型输出（GAP-04、F05.1）

| 层 | 谁产生 | 内容 | 存在哪 |
| --- | --- | --- | --- |
| 信封 `TurnEnvelope` | 服务端，在 `claimAttempt` 中由 turn / run / room 当前值组装 | `protocolVersion`、`roomId`、`runId`、`round`、`turnId`、`attemptId`、`roleKey`、`turnKind`、`constraintsVersion`、`baseProposalId?`、`candidateSetKey` | 由 turn 与 attempt 行的字段构成，不单独存 |
| 模型输出 `TurnOutput` | 模型（或 stub） | `action` 与该动作所需的选择：候选键、理由码、澄清问题键、私密理由 | `modelCalls.outcome.output`（原样）；校验后拆成 `turns.result`（公开）与 `turns.privateRationale`（本方） |

规则：
1. 模型**从不**提供身份、角色、版本、ID、金额、日期、范围项。它只能从服务端给出的有限词表中选择（候选键、问题键、理由码）。
2. 提示里可以展示版本号作为背景，但输出 schema 没有任何版本字段，所以过期判断只依赖信封快照与当前数据库值的比较（10 part3 G-A*），不可能被模型回显"骗过"。
3. 金额、日期、范围项由 `run.candidates[candidateKey].terms` 决定，候选由代码枚举（06 §6.5），因此"模型不得发明金额"（核心 4）在结构上成立，而不是靠事后比对。

## 5.2 动作集

原方案的五个动作全部保留，按回合类型分配（GAP-10 的"谁做什么"）：

| 回合 | 动作 | 必需字段 | 含义 | 由代码决定的后果（part2 §5.5） |
| --- | --- | --- | --- | --- |
| propose（提议方：provider） | `propose` | `candidateKey` | 选择一个候选作为提案 | 新候选 → 插入提案新版本并安排评审；与当前提案相同（第 2 轮起）→ 提议方坚持，结束本 run 的协商 |
| propose | `clarify` | `clarify{questionKey, targetRole, itemKey?}` | 请求某一方的**人**回答一个封闭问题 | 本 run 澄清额度未用 → 创建 humanRequest，run → waiting_human |
| propose | `reject` | `rejectReason` | 候选里没有本方能接受的 | 向提议方的人发请求（手动选择或更新目录），run → waiting_human |
| review（评审方：customer、finance） | `recommend_accept` | — | 建议本方的人接受当前提案（**不是批准**，核心 2） | 计入本轮结论 |
| review | `counter` | `candidateKey`（≠ 当前提案候选）、`reasonCode` | 表达对另一个候选的偏好 | 本轮未收敛 → 下一轮由提议方回应 |
| review | `clarify` | 同上 | 同上 | 本轮结束后若额度未用 → humanRequest |
| review | `reject` | `reasonCode` | 当前提案本方不能建议接受，且没有更偏好的候选 | 同 counter（未收敛） |

没有"代理之间互答"的澄清：问题总是交给目标方的人，由人决定是否披露（ADR-09，GAP-11）。也没有"宣布不可行"的模型动作：不可行由代码在调模型之前判定（06 §6.5），不让模型决定是否打扰人（F05.6）。

## 5.3 输出 schema：扁平形状 + 判别联合

JSON Schema 用扁平对象（10 part5 §10.15），Zod 先校验扁平形状，再映射为判别联合并做语义校验。

```ts
export const PROPOSER_ACTIONS = ["propose", "clarify", "reject"] as const;
export const REVIEWER_ACTIONS = ["recommend_accept", "counter", "clarify", "reject"] as const;

const clarifyFlat = z.object({
  questionKey: z.string(), targetRole: z.string(), itemKey: z.string().nullable(),
}).strict();

export const proposerOutputFlat = z.object({
  action: z.enum(PROPOSER_ACTIONS),
  candidateKey: z.string().nullable(),
  clarify: clarifyFlat.nullable(),
  rejectReason: z.string().nullable(),
  rationale: z.string(),
}).strict();

export const reviewerOutputFlat = z.object({
  action: z.enum(REVIEWER_ACTIONS),
  counterCandidateKey: z.string().nullable(),
  reasonCode: z.string().nullable(),
  clarify: clarifyFlat.nullable(),
  rationale: z.string(),
}).strict();

const ClarifyRequest = z.object({ questionKey: z.string(), targetRole: z.string(), itemKey: z.string().optional() });
export const TurnOutput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("propose"), candidateKey: z.string(), rationale: z.string() }),
  z.object({ action: z.literal("clarify"), clarify: ClarifyRequest, rationale: z.string() }),
  z.object({ action: z.literal("reject"), reasonCode: z.string(), rationale: z.string() }),
  z.object({ action: z.literal("recommend_accept"), rationale: z.string() }),
  z.object({ action: z.literal("counter"), candidateKey: z.string(), reasonCode: z.string(), rationale: z.string() }),
]);
export type TurnOutput = z.infer<typeof TurnOutput>;
```

`toTurnOutput(flat, vocab)`（纯函数）的语义规则，失败码即 `invalid_output.code`：

| 规则 | 失败码 |
| --- | --- |
| 该动作的必需字段非 null（propose → candidateKey；counter → counterCandidateKey 与 reasonCode；clarify → clarify；reject → rejectReason / reasonCode） | `SEM_FIELDS` |
| 候选键 ∈ `vocab.candidateKeys`（本 run 候选，扣除 `excludedCandidateKeys`） | `SEM_CANDIDATE` |
| counter 的候选 ≠ 当前提案的候选 | `SEM_COUNTER_SAME` |
| 动作属于本回合类型（即使解码约束失效，也要拦住评审回合输出 propose） | `SEM_ACTION` |
| clarify：`questionKey` ∈ 场景问题目录，`targetRole` ∈ 该问题允许的目标且 ≠ 本角色，需要 itemKey 的问题 itemKey ∈ 请求范围 | `SEM_CLARIFY` / `SEM_SELF_TARGET` |
| 理由码 ∈ 场景对应词表 | `SEM_REASON` |

与本动作无关的字段即使非 null 也忽略（只记 `ignoredFields` 计数用于质量评估），不判失败——减少无谓重试。`rationale` 去首尾空白、截断到 1,200 字符，不判失败。

**动态 schema**：当 `run.clarifyUsed >= MAX_CLARIFY_PER_RUN`（默认 1）时，生成的 JSON Schema 的 `action` 枚举里不含 `clarify`，从解码层面消除"额度用完还要澄清"的情况；Zod 语义校验同样拒绝（`SEM_ACTION`）。

## 5.4 公开结果与私密理由

校验通过的 `TurnOutput` 在 apply 中拆成两部分：

```ts
type PublicTurnResult =                       // turns.result；对全房间可见；渲染用模板
  | { action: "propose"; candidateKey: string; proposalId?: Id<"proposals"> }
  | { action: "clarify"; questionKey: string; targetRole: string; itemKey?: string; accepted: boolean }
  | { action: "reject"; reasonCode: string }
  | { action: "recommend_accept" }
  | { action: "counter"; candidateKey: string; reasonCode: string }
  | { action: "no_recommendation"; failureCode: TurnFailureCode };   // 评审回合失败时由代码写入
```

- `rationale` 只存在 `turns.privateRationale` 与 `modelCalls.outcome`，只对**本角色的参与者**可见（07 §7.3），**永不进入其他代理的上下文**（关闭跨代理提示注入与"代理说漏嘴"两条通道，F05.3）。
- 对他方可见的文本一律由模板从 `PublicTurnResult` + 候选的公开条款生成（07 §7.7），例如 `"Customer agent prefers LOGIN + REPORTS (standard, 2026-11-20): earlier scope over earlier date."`。
- 委托条款（07 §7.6）在简报确认时告知本人：本方代理会以固定理由码向他方表达对候选的偏好，但不会透露任何数值或备注。这就是"偏好与理由码对他方可见"的显式披露决定。
