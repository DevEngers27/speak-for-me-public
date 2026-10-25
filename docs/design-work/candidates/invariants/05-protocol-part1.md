# 05 协商协议 · part1：信封与模型输出、动作集、输出 schema、校验与分派

## 1. 协议要守的不变量与设计目标

- **PR-3**：模型不提供任何金额；**RN-3**：模型不提供身份、版本、ID；**EV-4 / BR-4**：没有任何模型自由文本跨越参与方；**RN-7**：模型不写决定，不直接造人工请求。
- 因此协议的跨方内容只有三类：①动作类型；②引用共享词表的结构化选择（报价行键、请求项键）；③枚举 reasonCode / questionCode。模型自由文本只有 `rationale`，只给本方委托人看（`turns.mine`），不进入任何他方代理的上下文。
- 代价与取舍：代理不能写"说服性"的公开解释。我们接受这个代价：跨方说服由结构化动作与模板文本承担，价值在于"委托人能在 rationale 里读懂自己的代理为什么这么做"。

## 2. 服务端信封 vs 模型输出

| 层 | 字段 | 来源 | 存在哪里 |
| --- | --- | --- | --- |
| 信封 | `runId`、`turnId`、`round`、`step`、`roleKey`、`attempt`、`constraintsVersion`、`subjectProposalId` | `scheduleTurn` 写入回合行时的快照 | `agentTurns` 行本身 |
| 模型输出 | `action` 及该动作的字段、`rationale` | 模型，经三层校验 | `agentTurns.output` |
| 服务端派生 | 条款金额、行价格、deferred、sourceRefs、提案版本、检查结果、公开文本 | `materializeTerms`、`evaluateProposal`、模板 | `proposals`、事件、投影 |

规则：
1. 提示词里可以出现"Proposal v2"、"constraints v3"作背景，但输出 schema 里没有这些字段，`completeTurn` 也从不读取模型回显的任何版本或 ID（F05.1）。
2. evaluate 步骤评估的提案由信封 `subjectProposalId` 绑定，`recommend_accept` 不带版本号。
3. 代理与哪个参与方对应由信封 `roleKey` 决定，代理不能声明自己的身份。

## 3. 动作集（scope_change 的回合计划）

| 角色 @ 步骤 | 允许的动作 | 说明 |
| --- | --- | --- |
| provider @ propose | `propose`、`clarify`、`reject` | provider 拥有报价，因此是唯一提出条款的一方 |
| customer @ evaluate | `recommend_accept`、`counter`、`reject`、`clarify` | counter = 结构化的范围变更请求 |
| finance @ evaluate | `recommend_accept`、`reject`、`clarify` | finance 代理不做算术（代码已做），只为委托人解释并给出建议 |

与原方案五个动作的对应：

| 原动作 | 本设计 | 落点 |
| --- | --- | --- |
| propose | provider 在第 1 轮的 `propose` | 产生 `proposals`（derivedFrom 为空） |
| counter | provider 在第 ≥2 轮的 `propose`（derivedFrom = 上一提案，事件标为 counter）；customer 的 `counter`（请求包含/排除哪些项、偏好哪个变体） | 前者产生提案；后者成为下一轮 provider 的反馈 |
| clarify | `clarify`：结构化问题码 → 由代码转成向**字段所有者本人**的 disclosure 请求（part2 §3） | `humanRequests(kind = disclosure)` |
| recommend_accept | `recommend_accept` | 只写回合与事件 agent_move，永不写 decisions（RN-7、核心 2） |
| reject | `reject` + 枚举 reasonCode | 反馈或轮次结算 |
| （原文缺）声明不可行 | 不由模型声明；由代码的可行性枚举判定（SIM-2） | `humanRequests(kind = tradeoff)` |

枚举（场景常量，`convex/scenarios/scopeChange/codes.ts`）：

```ts
export const PROVIDER_REJECT = ["CANNOT_SERVE_REQUEST", "NEEDS_OFFER_REVISION"] as const;
export const CUSTOMER_COUNTER = ["NEED_ITEM", "DEFER_ITEM", "DATE_TOO_LATE", "PRICE_TOO_HIGH", "PREFER_VARIANT"] as const;
export const CUSTOMER_REJECT = ["SCOPE_UNACCEPTABLE", "DATE_UNACCEPTABLE", "PRICE_UNACCEPTABLE"] as const;
export const FINANCE_REJECT = ["BUDGET_CONCERN", "PAYMENT_TERMS_CONCERN"] as const;
export const QUESTIONS = {   // 问题码 → 字段所有者、涉及字段、谁可以问
  IS_ITEM_DEFERRABLE:      { owner: "customer", fields: ["requiredItemKeys"], askers: ["provider", "finance"], needsItem: true },
  LATEST_ACCEPTABLE_DATE:  { owner: "customer", fields: ["deadline"],          askers: ["provider"],            needsItem: false },
  HAS_LOWER_PRICED_VARIANT:{ owner: "provider", fields: ["offerLines"],        askers: ["customer"],            needsItem: true },
  BUDGET_HEADROOM:         { owner: "finance",  fields: ["budgetCapCents", "externalCommittedCents"], askers: ["provider", "customer"], needsItem: false },
} as const;
```

## 4. 模型侧输出 schema（Zod 4，每回合按上下文动态构造）

```ts
import { z } from "zod/v4";
const Rationale = z.string().min(1).max(1200);   // 只给本方委托人
const IsoDate = z.iso.date();

export function outputSchemaFor(c: {
  role: "provider" | "customer" | "finance";
  ownLineKeys: string[];        // provider 自己确认版本中的 "ITEM:VARIANT"
  requestedItemKeys: string[];  // 共享词表
  visibleLineKeys: string[];    // 本角色可见的报价行（出现过在提案/选项中的）
  questionCodes: string[];      // 本角色可问、所涉字段尚未全部对本角色披露、且本 run 尚未用过 clarify 时非空
}) {
  const nonEmpty = (xs: string[]) => xs as [string, ...string[]];
  const Item = z.enum(nonEmpty(c.requestedItemKeys));
  const clarify = c.questionCodes.length ? [z.strictObject({
    action: z.literal("clarify"),
    question: z.strictObject({ code: z.enum(nonEmpty(c.questionCodes)), itemKey: Item.optional() }),
    rationale: Rationale })] : [];
  const variants = c.role === "provider" ? [
    z.strictObject({ action: z.literal("propose"),
      lineKeys: z.array(z.enum(nonEmpty(c.ownLineKeys))).min(1), deliveryDate: IsoDate, rationale: Rationale }),
    z.strictObject({ action: z.literal("reject"), reasonCode: z.enum(PROVIDER_REJECT), rationale: Rationale }),
  ] : c.role === "customer" ? [
    z.strictObject({ action: z.literal("recommend_accept"), rationale: Rationale }),
    z.strictObject({ action: z.literal("counter"),
      include: z.array(Item), exclude: z.array(Item),
      ...(c.visibleLineKeys.length ? { preferLineKeys: z.array(z.enum(nonEmpty(c.visibleLineKeys))) } : {}),
      reasonCodes: z.array(z.enum(CUSTOMER_COUNTER)).min(1), rationale: Rationale }),
    z.strictObject({ action: z.literal("reject"), reasonCode: z.enum(CUSTOMER_REJECT), rationale: Rationale }),
  ] : [
    z.strictObject({ action: z.literal("recommend_accept"), rationale: Rationale }),
    z.strictObject({ action: z.literal("reject"), reasonCode: z.enum(FINANCE_REJECT), rationale: Rationale }),
  ];
  // 外包一层对象：避免根级 anyOf（是否被接受待验证，inputs/04 待验证 #6）
  return z.strictObject({ message: z.discriminatedUnion("action", [...variants, ...clarify]) });
}
```

**JSON Schema 生成**：不用 SDK 的 `zodOutputFormat`，因为 SDK 1.1.0 的转换会把 `enum`、`const` 挪进 description，枚举不受解码约束（inputs/04 §4.4 实测）。改用自有的 `toStructuredOutputSchema(zodSchema)`：`z.toJSONSchema` 后只保留 API 支持的关键字（type、properties、required、`additionalProperties: false`、items、enum、const、anyOf、description、`format: "date"`），把 minLength/maxLength/minItems>1 等移进 description。输出形状不随 action 变化，但 enum 内容随房间目录变化；新 schema 首次请求有编译开销、之后缓存 24 小时（inputs/04 §4.4），报价目录不常变，可以接受。

## 5. 三层校验与分派

| 层 | 在哪里 | 拦截什么 | 失败后 |
| --- | --- | --- | --- |
| L1 解码约束 | Claude 结构化输出 | 形状、枚举（行键、项键、动作、码） | — |
| L2 Zod | `executeTurn` action 内 `safeParse` | 长度、日期真实性、strict 多余字段 | 回合 `invalid_output`（SCHEMA_INVALID），按 04 §4 重试 |
| L3 业务 | `completeTurn` mutation 内 | 见下表 | `invalid_output`（UNKNOWN_LINE / ACTION_NOT_ALLOWED）或进入规则检查 |

L3 规则（`validateMove(role, step, output, inputs, run)`）：
1. 动作 ∈ 本角色本步骤允许集；clarify 时角色不在 `run.clarifyUsedBy`，问题码的 askers 含本角色，needsItem 时 itemKey 在共享词表内；问题涉及的字段若已全部对本角色披露，视为 `ACTION_NOT_ALLOWED`（它在上下文里已经能看到）。
2. propose：每个行键在 constraintSet 引用的 provider 确认版本中存在；同一 itemKey 不出现两次；`deliveryDate ≥ max(所选行 earliestDeliveryDate)`。这些都是 provider 自己的数据，违反说明代理出错，记 invalid_output。
3. counter：include、exclude ⊆ 请求项且不相交；preferLineKeys ⊆ 本角色可见行。
4. 依赖他方约束的条件（预算、必需项、截止日、报价有效期）**不**在 L3 拦截，而是由 `evaluateProposal` 产生 blocked 提案与 reasonCode——它们是协商信息，不是代理错误。

分派（`completeTurn` 内，L3 通过后）：

| 角色 @ 步骤 | 动作 | 效果 |
| --- | --- | --- |
| provider @ propose | propose | `materializeTerms` → `insertProposal`（derivedFrom = 本 run 上一提案）→ 写 `agent_move` 与 `proposal_created` → verdict = pass：`lastValidProposalId = P`，step = evaluate，并行调度各评估方回合；verdict = blocked：进入轮次结算（part2 §2） |
| provider @ propose | reject | 写 agent_move → 轮次用尽处理（part2 §2） |
| 任一 | clarify | `run.clarifyUsedBy += role`；`openRequests(disclosure)`；写 agent_move；待 pendingTurnIds 为空时 run → awaiting_input |
| evaluator | recommend_accept / counter / reject | 写 agent_move；pendingTurnIds 为空时 `settleStep` |

`materializeTerms(lineRefs, deliveryDate, inputs)`：从 provider 确认版本复制每行 label、priceCents、earliestDeliveryDate、taskTitle；`amountCents = Σ priceCents`（逐步 `assertCents`）；`includedItemKeys` = 行的 itemKey 集合；`deferredItemKeys = requested − included`（Role A RA-B13 的口径修正）；`source` = constraintSet 中 provider 与 customer 的版本 id；`contentKey` 规范化排序后拼接。
