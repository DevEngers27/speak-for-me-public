# 05 协商协议

## 1. 决定

| 目标 | 决定 | 被否决 |
| --- | --- | --- |
| 模型不能声明身份/版本/金额 | 信封（服务端）与模型输出两层；模型只输出 `action` + itemKeys/reasonCode + 私有文本 | 一个 schema 混装（GAP-04） |
| 模型不发明日期 | 交付日由代码 = 所选条目 `earliestDeliveryDate` 的最大值；模型连日期都不选 | 让模型选日期再校验（多一个出错面，首个场景无"加急/延后换价"条款） |
| 对他方可见文本无泄露面 | 公开内容 = 模板(结构化字段, reasonCode)；模型文本只给本方 | 扫描自由文本中的数字（F05.3 已论证不可靠） |
| 最少动作 | provider：`propose`、`clarify`；评估方：`recommend_accept`、`reject`、`clarify`。"还价"= 本 run 第二个及以后的 propose（派生标签） | 独立 `counter` 动作（形状相同） |
| 升级给人由代码决定 | 无可行解、轮次用尽、代理 clarify → 代码生成 `humanRequests` | 模型 `target:'human'` |
| 回合串行 | 一轮：provider → 代码校验 →（合格才）customer → finance；同时至多一个在途回合 | customer/finance 并行（省一跳延迟，但多一套"等两个都完成"的守卫；ADR-06，延迟不达标时再开） |

## 2. 服务端信封（不进模型输出）

```ts
type TurnEnvelope = {          // 全部取自 agentTurns / runs 行，completeTurn 只信这里
  roomId: Id<"rooms">; runId: Id<"runs">; turnId: Id<"agentTurns">;
  round: number; role: Role; attempt: number;
  constraintsVersion: number;  // = run.constraintsVersion
  proposalId?: Id<"proposals">;// 评估回合评估的对象
};
```
prompt 里可以给模型看版本号作背景，但输出 schema 中没有任何 ID/版本/金额/日期字段。

## 3. 一轮的规则

```text
round r:
  T1 provider 回合 → propose(itemKeys) | clarify
     propose → computeTerms → validateProposal(全部约束) → 插入 proposal v(n)（无论是否合格，历史只追加）
        reasonCodes ≠ [] → r < max ? R2 下一轮(provider 收到公开 reasonCode) : R3 needs_input
        reasonCodes = [] → T2
  T2 customer 回合（评估 v(n)）→ recommend_accept → T3 | reject(code) → R2/R3 | clarify → R3
  T3 finance 回合（评估 v(n)）→ recommend_accept → R1 pending_approval | reject → R2/R3 | clarify → R3
```
- 每轮最多 3 次调用，`maxRounds = 3`（场景配置）→ 每个 run 最多 9 个回合、27 次尝试（每回合 ≤ 3 次：1 次自动重试 + 1 次人工重试）。
- run 开始时若 `enumerateFeasible(全部约束) = ∅`：不调模型，直接 needs_input（R0′）。
- 人拒绝（R7）等价于"评估方拒绝"，进入下一轮，provider 上下文带人的拒绝 reasonCode。
- 代理的 `recommend_accept` 只改变 run 的推进，**永不写 approvals**（核心 2）。

## 4. 模型输出 schema（Zod，仅用于模型 I/O）

```ts
// convex/engine/agentOutput.ts
import { z } from "zod";
const rationale = z.string().max(1200);          // 私有，只给本方；真正限长靠 max_tokens

export const ProviderOutput = z.strictObject({
  message: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("propose"),
      itemKeys: z.array(z.string()).min(1).max(8), rationale }),
    z.strictObject({ action: z.literal("clarify"),
      question: z.string().max(400), rationale }),
  ]),
});

export const evaluatorOutput = (rejectCodes: readonly [string, ...string[]]) =>
  z.strictObject({
    message: z.discriminatedUnion("action", [
      z.strictObject({ action: z.literal("recommend_accept"), rationale }),
      z.strictObject({ action: z.literal("reject"), reasonCode: z.enum(rejectCodes), rationale }),
      z.strictObject({ action: z.literal("clarify"), question: z.string().max(400), rationale }),
    ]),
  });
export type AgentOutput = z.infer<typeof ProviderOutput> | z.infer<ReturnType<typeof evaluatorOutput>>;
```
- 外包一层 `{ message }`：API 是否接受根级 `anyOf` 待验证（inputs/04 待验证 #6），包一层规避。
- SDK 1.1.0 的 `zodOutputFormat` 把 `enum/const/max` 挪进 description（inputs/04 §4.4 实测）。因此：①用 `zodOutputFormat(schema).schema` 只取 JSON Schema 放进 `output_config.format`；②响应后**必须** `safeParse`；③再做业务校验：`itemKeys ⊆ 当前目录`、无重复、`reasonCode ∈ 场景词表`。任一失败 = `INVALID_OUTPUT`（可自动重试一次）。
- 不用原生 Citations（与结构化输出互斥）；来源由代码从 itemKeys 推出（`proposal.sourceBriefVersions` + `lines`）。

## 5. 各角色上下文（由 `buildAgentContext(roomId, role)` 组装，07 §5）

| 块（按缓存稳定性排序） | provider | customer | finance |
| --- | --- | --- | --- |
| system：协议规则 + 场景规则 + 输出说明（固定，可缓存） | ✓ | ✓ | ✓ |
| 本方已确认简报（结构化 + notes，notes 放 `<untrusted_principal_notes>` 定界块） | ✓ | ✓ | ✓ |
| 他方已披露字段（按披露矩阵） | customer 披露的 required/wanted/deadline | 目录（公开）+ finance 披露字段 | 目录 + customer 披露字段 |
| 候选组合（代码枚举，**只用本方可见约束**） | ✓ | — | — |
| 本 run 公开历史（提案结构化条款 + 公开 reasonCode，模板文本） | ✓ | ✓ | ✓ |
| 被评估提案 + 代码对本方可见的校验结论 | — | ✓ | ✓（含余量数字） |
| 中途 `role:"system"` 消息：本回合指令（"Choose one candidate" / "委托人确认按现有简报继续"） | ✓ | ✓ | ✓ |

**为什么候选只用本方可见约束**：若把"满足全部约束"的组合交给 provider 代理，组合边界会泄露 finance 的余量区间。provider 只知道公开约束，越界的提案由代码挡下并以 reasonCode 反馈（"Blocked: exceeds the finance limit"）——这正是代理协商的价值，也与人看到的信息一致（07 §4 最小披露）。

## 6. 公开文本模板（场景提供，读时按查看者渲染）

| 键 | 输入 | 渲染（英文，示例） |
| --- | --- | --- |
| `proposal.created` | version, itemKeys, deferred, amount, date, isCounter | "Provider agent proposes LOGIN + REPORTS for $900, delivery 2026-11-14; EXPORT deferred." / counter: "Provider agent counters with …" |
| `proposal.blocked` | reasonCodes | 全员："Blocked: exceeds the finance limit"；买方（可见预算时）追加 "over by $100" |
| `evaluation.reject` | role, reasonCode | "Customer agent declines: wants more scope." |
| `evaluation.accept` | role | "Finance agent recommends accepting v3 (not an approval)." |
| `request.waiting` | targetRoles | "Waiting on a decision from finance and customer." |
| `brief.confirmed` | role, version, changeCode | "Finance updated constraints (budget revised). Constraints are now v5." |

金额只出现在：提案条款（provider 已公开的目录价格之和，全员可见）与买方专属块。预算、已承诺、余量从不进入 provider 可见模板（07 §4）。

## 7. 向具体的人请求取舍：结构

`humanRequests` 由 `scenario.buildRequests(ctx)` 生成，问题与选项全部由代码决定；模型只在 `clarify` 时提供写给**自己委托人**的问题文本。

| 场合 | 目标角色 | 选项（effect） |
| --- | --- | --- |
| 无可行组合，原因含 OVER_BUDGET | finance | `patch_brief`：`totalBudgetCents += 最小缺口`（"Raise cap by $100 to $4,900"） |
| 同上 | customer | 对每个"移出 required 即可行"的条目：`patch_brief` 把它移入 wanted（"Allow REPORTS to be deferred"） |
| 无可行组合，原因含 DELIVERY_AFTER_DEADLINE | customer | `patch_brief`：`deadline = 最早可行日` |
| 轮次用尽，本 run 有 ≥1 个合格提案 | customer（场景配置 `tieBreakerRole`） | 每个合格提案一个 `select_proposal` |
| 代理 clarify | 该代理的委托人 | `continue`；卡片另有"Edit my brief"入口（改简报 = 约束变化，请求自动作废） |

多个请求并行发出（Q8）；**谁先回答谁生效**：`patch_brief` 会递增约束版本并开新 run，其他请求因 `requestIsOpen` 不再成立而自动作废。请求对 targetRole 可见；他方只看到 `request.waiting` 模板。

## 8. 注入防护

- 他方内容只以结构化字段进入上下文；任何自由文本（本方 notes、clarify 回答）放定界块并在 system 中声明为不可信数据。
- 他方代理的 rationale **永不**进入任何其他代理的上下文——跨代理注入通道不存在。
- 运营者指令只走 system 与中途 `role:"system"` 消息（inputs/04 §4.7）。
