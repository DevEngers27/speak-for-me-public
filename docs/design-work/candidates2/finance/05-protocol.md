# 05 协商协议

## 1. 两层：服务端信封 vs 模型输出

```ts
// 服务端信封：全部来自 agentTurns 快照，模型从不提供
type AgentEnvelope = {
  runId: Id<"runs">; turnSeq: number; attempt: number; round: number;
  role: Role; kind: "propose" | "evaluate";
  constraintsVersion: number; subjectProposalId?: Id<"proposals">;
  candidateKeys: string[];               // 本回合允许选择的候选
};
```

模型输出（`convex/lib/agentOutput.ts`，只依赖 zod）：

```ts
const rationale = z.string().max(600);   // 只给本方；长度主要靠 max_tokens 约束
export const ProposeOutput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("propose"), candidateKey: z.string(), rationale }),
  z.strictObject({ action: z.literal("clarify"), question: z.string().max(400) }), // 问本方的人
  z.strictObject({ action: z.literal("decline"), rationale }),  // 无可接受候选
]);
export const EvaluateOutput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("recommend_accept"), rationale }),
  z.strictObject({ action: z.literal("counter"), candidateKey: z.string(), rationale }),
  z.strictObject({ action: z.literal("reject"),
    reasonCode: z.enum(["PRICE_TOO_HIGH", "SCOPE_INSUFFICIENT", "DATE_UNACCEPTABLE"]), rationale }),
  z.strictObject({ action: z.literal("clarify"), question: z.string().max(400) }),
]);
// 外包一层，避免根级 anyOf（inputs/04 §4.4 待验证项）
export const TurnOutput = (kind: "propose" | "evaluate") =>
  z.strictObject({ message: kind === "propose" ? ProposeOutput : EvaluateOutput });
```

- 没有 approve 动作；`recommend_accept` 不带版本号，服务端从信封绑定 `subjectProposalId`。
- 没有金额、日期、条目数组字段：模型只能选 `candidateKey`。SDK 的 `zodOutputFormat` 会把 enum/const 降为描述（inputs/04 §4.4），所以 `candidateKey ∈ envelope.candidateKeys`、`reasonCode` 枚举都在 `completeTurn` 里再校验；不合法 → `invalid_output`。
- `rationale`、`question` 是模型自由文本，只存在 `agentTurns.output`，只对本角色成员可见，**不进入任何其他代理的上下文**。

## 2. 候选（Candidate）

```ts
type Candidate = {
  candidateKey: string;                  // "c1".."cN"，按确定性排序生成
  itemKeys: string[];                    // 排序
  delivery: "standard" | "rush";
  deliveryDate: string;                  // today + max(leadTimeDays | rushLeadTimeDays)
  amountCents: number;                   // Σ 当前报价 + (rush ? rushFee : 0)
};
```

- 由 06 `enumerateCandidates` 生成：对当前 active scope 条目的所有子集 × 交付方式，去掉空集与不可加急组合。
- **给 provider 的候选**按"公开可行"过滤：报价有效、含 customer **已共享**的必需条目、不晚于**已共享**的截止日；并去掉 `amountCents ≥ run.excludedAmountFloorCents` 的候选（provider 在本 run 内已从拒绝码合法获知的信息）。**不按预算过滤**（ADR-10）。
- **给 customer / finance 评估者的候选**：完整可行集（满足全部硬约束）中按 customer 软偏好排序的前 5 个，用于 counter。
- 发给模型的候选描述：provider 看到条目标题、交付日期、金额（报价本来就是 provider 的）；customer 看到同样内容；finance 看到同样内容外加 `headroomAfterCents`。

## 3. 一轮的结构

```text
round r:
  [provider propose]  ──>  规则闸门（代码）
        │ 通过 → insertProposal → 并行调度 [customer evaluate] + [finance evaluate]
        │ 不通过 → 记录 rule 回合（authorKind "rule"），向 provider 返回投影拒绝码，provider 在同一轮重选（消耗 modelCallCount，不消耗 round）
  [customer evaluate] ┐
  [finance evaluate]  ┴─> 两个都完成（completeTurn 写同一 run 文档，OCC 串行）：
        都 recommend_accept → run: pending_approval
        有 counter          → 代码把 counter 候选落为新提案（sourceRole = 评估者），round+1，再走一次规则闸门与对方评估
        有 reject           → round+1，provider 重新选择（携带 reasonCode）
        有 clarify          → humanRequest(kind clarify, targetRole = 本方) → run: needs_input
```

- 串行深度 2（provider → 两个并行评估）。`maxRounds` 默认 3（场景配置）；`maxModelCalls` 默认 12 / run。
- 评估回合中若代码已判定提案违反该评估者的硬约束，**不调用模型**，直接写 `authorKind: "rule"` 的回合（例如 finance 的 OVER_BUDGET）。finance 代理只对软偏好（如"希望保留余量"）发表意见。
- counter 的提案仍要过规则闸门，并只发给另外两方中尚未表态的评估者；避免无限往返由 `maxRounds` 保证。

## 4. 规则闸门（代码）

在 `completeTurn` 内、插入提案前后执行（06 `validateProposal`）：

| 结果 | 动作 |
| --- | --- |
| 全部通过 | 插入提案，调度评估 |
| 违反 provider 侧事实（UNKNOWN_ITEM、ITEM_RETIRED、PRICE_MISMATCH、QUOTE_EXPIRED） | 视为 invalid_output（模型选了不存在的候选不可能发生，出现即编程错误） |
| 违反买方私密硬约束（OVER_BUDGET、MISSING_REQUIRED_ITEM、DATE_AFTER_DEADLINE） | 不插入提案；写 rule 回合；更新 `excludedAmountFloorCents`（仅 OVER_BUDGET 时 = min(现值, amount)）；向 provider 返回投影码 `FINANCE_LIMIT` 或 `CUSTOMER_CONSTRAINT` |

## 5. 升级给人（代码决定）

触发条件（只由代码判定）：
1. `enumerateCandidates` 在完整约束下为空（无可行方案）——**不调用模型**；
2. 轮次用尽或调用超限；
3. 某代理 `clarify`（只问本方的人）。

`openHumanRequests(ctx, run, situation)` 生成结构化请求：

| 情形 | targetRole | questionKey | options（effect） |
| --- | --- | --- | --- |
| 无可行方案，抬高上限可解 | finance | `no_feasible_option` | `raise_limit{toLimitCents: committed + 最便宜可行候选金额}`、`close_without_change` |
| 无可行方案，延后某必需条目可解 | customer | `no_feasible_option` | 每个可解的 `defer_item{itemKey}`、`close_without_change` |
| 无可行方案，放宽截止日可解 | customer | `no_feasible_option` | `extend_deadline{toDate}` |
| 多个可行候选、轮次用尽 | customer | `choose_option` | 最多 3 个 `choose_candidate{candidateKey}` |
| 代理 clarify | 本方 | `agent_question` | 自由回答 `answerText`（仅本方可见） |

- 同时发给所有"单独即可恢复可行"的角色；任一回答改变约束 → bumpConstraints → 其余请求被取消（I10）。
- 问题文本由模板按 targetRole 渲染；finance 的请求里可以有数字，customer 的请求里有数字（买方），provider 永远收不到含预算的请求。
- `choose_candidate` 的回答直接由代码把候选落为提案（`authorKind: "human_choice"`），run → pending_approval；回答本身**不是签字**，customer 仍要点 "Accept terms"。

## 6. 回合输入（给模型看的上下文）

由 `buildAgentContext(roomId, role, turn)`（internalQuery）组装，显式白名单：
1. 固定协议说明与场景规则（system，可缓存）；
2. 本方已确认简报全文（含 privateNotes）；
3. 他方的 shareableFields 值；
4. 当前候选列表（按 §2 的角色过滤）；
5. 结构化历史：本 run 内各提案的 `{version, candidateKey, itemKeys, amountCents, deliveryDate, sourceRole}` 与投影后的拒绝码；
6. 本回合任务：中途 `role: "system"` 消息说明"你是 X 的代理，选择一个 candidateKey"。
他方代理的 rationale、用户粘贴文本永不进入；若将来需要，放进 `<untrusted>` 定界块并在 system 中声明为数据。

## 7. 对他方可见文本

全部由模板渲染（`convex/scenarios/scopeChange/templates.ts`），输入只有结构化字段与 reasonCode。例："Provider proposes LOGIN + REPORTS (rush) for $900, delivery 2026-11-07; EXPORT deferred."、"Customer agent recommends accepting v3 — this is not an approval."
