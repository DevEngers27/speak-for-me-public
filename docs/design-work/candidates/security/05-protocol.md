# 05 协商协议（part1：模型与代码的分工、信封与输出、动作集、输出 schema）

> 本章分 3 个文件：part1（本文件）；part2 回合与轮次规则、轮次裁决算法、澄清（披露请求）、升级给人；part3 完整消息示例与拒绝/不可行处理。

## 5.1 为什么需要三个代理，以及它们不做什么

价格来自已发布目录、约束由代码校验之后，"找出一个满足所有硬约束的组合"是代码可解的小组合问题（F01.1）。所以本设计把一切与数字有关的工作留给代码，模型只做代码做不好的事：

| 工作 | 谁做 | 理由 |
| --- | --- | --- |
| 枚举组合、定价、算日期 | 代码（`enumerateCandidates`、`deriveTerms`） | 确定性；核心 4 |
| 判定是否满足硬约束、是否可执行、是否无解 | 代码（`evaluate`、`globalFeasible`） | 同上 |
| 何时升级给人、问谁、给哪些选项 | 代码（`openRequests`、`relaxations`） | 让模型决定"要不要打扰人"等于把权限交给模型（F05.6） |
| 在本方可接受的候选中，按软偏好与自由备注选择（如"REPORTS 比提前交付重要"） | 本方代理 | 软偏好与备注是非结构化的，代码无法权衡 |
| 对他方提案表态：接受、还价、建议拒绝 | 本方代理 | 同上；表态只是建议 |
| 向本方委托人解释取舍（rationale） | 本方代理 | 人需要可读的理由 |
| 判断"如果对方披露某字段，协商会更顺利"并发起披露请求 | 本方代理 | 只是请求，披露决定永远由人做 |
| 把粘贴的混乱文本变成待确认草稿 | 抽取调用（10） | 只预填，不生效 |

finance 也保留一个 LLM 代理：它读取 finance 的备注（例如"Q4 想保留余量"）给出建议并向 finance 解释，算术与预算判定仍是代码。产品文案如实写成"three advisory agents + deterministic checks"，不宣称代理"批准"或"核算"（ADR-15）。

## 5.2 服务端信封与模型输出分离

```ts
// 服务端信封：全部来自 agentTurns / runs 记录，模型既看不到要求回显，也无法改写
type TurnEnvelope = {
  roomId: Id<"rooms">; runId: Id<"runs">; turnId: Id<"agentTurns">;
  round: number; roleKey: string; kind: "propose" | "review";
  constraintsVersion: number;               // = run.constraintsVersion
  subjectProposalId?: Id<"proposals">;       // review 回合审的提案
  candidates: Candidate[];                  // beginTurn 冻结
};
```

- `completeTurn` 只拿信封与当前房间比较（回合持久化守卫），从不读取模型输出中的任何 id、版本或角色。prompt 中可以出现版本号作为背景，但输出 schema 里没有这些字段。
- 模型输出只决定：动作、候选 ID、拒绝理由枚举、披露请求目标枚举、一段 rationale。

## 5.3 动作集

| 动作 | 允许的回合 | 含义 | 产生的记录 |
| --- | --- | --- | --- |
| `propose` | propose 回合（必须） | 从本方候选中选一个作为新提案 | 提案（author = 本方代理）、本方笔记 |
| `counter` | review 回合 | 不接受当前提案，提出本方候选中的另一个 | 本方笔记；是否成为提案由轮次裁决决定（part2） |
| `recommend_accept` | review 回合 | 建议本方委托人接受当前提案 | 本方笔记；**永不写 decisions**（核心 2） |
| `reject` | review 回合 | 建议本方委托人拒绝，附理由枚举，不提出替代 | 本方笔记 |
| 附加：`clarifyTarget` | 任一回合 | 请求某角色向本方披露某字段 | 发给该角色的人的 disclosure 请求（非阻塞，part2 §5.6） |

没有"升级给人"动作，也没有"声明不可行"动作：无解与升级由代码判定（PR-01、F05.6）。代理的 `reject` 不阻断流程：一个通过代码检查、没有被有效还价的提案仍会交给人审批，各方代理的建议只出现在各自委托人的界面上。

## 5.4 输出 schema

### 设计约束

1. 平台对根级 `anyOf`、`type` 数组（可空）、可选属性的接受情况待验证（inputs/04 §4.4 与待验证 #6）；`zodOutputFormat` 会把 `enum`/`const` 降为描述文字。
2. 因此输出 schema 由服务端**按回合手工生成**：只用 `object`、`string`、`enum`、`required`、`additionalProperties: false` 这些确定受支持的构造；不用联合、不用 null，"不适用"用字面量 `"NONE"` 表示。
3. 枚举的取值来自本回合冻结的候选与本角色词表，于是模型在解码层就只能选择服务端给出的值（inputs/04 的结构化输出以 `jsonSchemaOutputFormat(schema, { transform: false })` 或直接 `output_config.format` 传入）。

```ts
// packages/engine/src/agentProtocol.ts
export function buildOutputSchema(ctx: AgentContext, reasons: string[]) {
  const actions = ctx.turn.kind === "propose" ? ["propose"] : ["counter", "recommend_accept", "reject"];
  return {
    type: "object", additionalProperties: false,
    required: ["action", "candidateId", "rejectReason", "clarifyTarget", "rationale"],
    properties: {
      action:        { type: "string", enum: actions },
      candidateId:   { type: "string", enum: ["NONE", ...ctx.candidates.map((c) => c.candidateId)] },
      rejectReason:  { type: "string", enum: ["NONE", ...reasons] },
      clarifyTarget: { type: "string", enum: ["NONE", ...ctx.clarifyTargets.map((t) => `${t.roleKey}.${t.fieldKey}`)] },
      rationale:     { type: "string", description: "Plain text for your principal only. At most 120 words." },
    },
  } as const;
}
```

### 解码后的校验（Zod + 语义）

```ts
export const AgentOutputRaw = z.strictObject({
  action: z.enum(["propose", "counter", "recommend_accept", "reject"]),
  candidateId: z.string(), rejectReason: z.string(), clarifyTarget: z.string(),
  rationale: z.string().max(4000),
});

export type AgentDecision =
  | { action: "propose" | "counter"; candidate: Candidate; clarify?: ClarifyTarget; rationale: string }
  | { action: "recommend_accept"; clarify?: ClarifyTarget; rationale: string }
  | { action: "reject"; reasonCode: string; clarify?: ClarifyTarget; rationale: string };

export function interpretOutput(raw: unknown, ctx: AgentContext, reasons: string[]):
    { ok: true; decision: AgentDecision } | { ok: false; error: "OUTPUT_SCHEMA" | "OUTPUT_SEMANTIC" } {
  const p = AgentOutputRaw.safeParse(raw);
  if (!p.success) return { ok: false, error: "OUTPUT_SCHEMA" };
  const o = p.data;
  const allowed = ctx.turn.kind === "propose" ? ["propose"] : ["counter", "recommend_accept", "reject"];
  if (!allowed.includes(o.action)) return { ok: false, error: "OUTPUT_SEMANTIC" };
  const cand = ctx.candidates.find((c) => c.candidateId === o.candidateId);
  const needsCand = o.action === "propose" || o.action === "counter";
  if (needsCand !== Boolean(cand)) return { ok: false, error: "OUTPUT_SEMANTIC" };
  if ((o.action === "reject") !== (o.rejectReason !== "NONE")) return { ok: false, error: "OUTPUT_SEMANTIC" };
  if (o.rejectReason !== "NONE" && !reasons.includes(o.rejectReason)) return { ok: false, error: "OUTPUT_SEMANTIC" };
  const clarify = parseClarify(o.clarifyTarget, ctx.clarifyTargets);       // NONE → undefined；不在列表 → 错误
  if (clarify === "INVALID") return { ok: false, error: "OUTPUT_SEMANTIC" };
  const rationale = o.rationale.trim().slice(0, 1200);
  // 按 action 组装 AgentDecision（略）
}
```

要点：
- 输出中不存在金额、日期、条目键、提案版本、角色身份字段（I-23）。即便模型在 rationale 里写了数字，rationale 也只回到本方委托人（I-29）。
- `counter` 选的候选若与当前提案的目录决定部分完全相同（`pricingKey` 相等），视为 `recommend_accept` 处理，不产生重复提案。
- 本角色的拒绝理由词表来自场景（14 §14.4），例如 finance：`OVER_BUDGET`、`PRICE_TOO_HIGH`；customer：`MISSING_REQUIRED_ITEM`、`AFTER_DEADLINE`、`PREFERENCE_NOT_MET`；provider：`BELOW_PROVIDER_MINIMUM`、`CAPACITY`、`TERMS_UNACCEPTABLE`。它们只进入本方笔记与本方代理之后的上下文。

### stub 模式共用同一协议

`AGENT_MODE=stub` 时，`callModel` 被 `stubDecide(ctx)` 替换：propose 回合选排名第一的候选；review 回合若当前提案的 `pricingKey` 出现在本方候选集中（即满足本方可见的全部约束，"够用即接受"）则 `recommend_accept`，否则 `counter` 排名第一的候选（本方候选集为空时 `reject`，理由取本方视图求值的第一个失败 code）；rationale 为模板句 "[Simulated] Picked C1 by the scenario ranking." 输出经过同一个 `interpretOutput`，后续流程完全相同，记录标 `isSimulated`（I-26）。
