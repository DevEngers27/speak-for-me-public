# 03 Convex schema v1（part2：协商、签字、执行、请求、事件、唯一性落点）

## 6. 协商运行与回合

```ts
runs: defineTable({
  roomId: v.id("rooms"), seq: v.number(),
  trigger: v.union(v.literal("initial"), v.literal("constraint_change"),
                   v.literal("request_answered"), v.literal("renegotiation_requested")),
  status: runStatusV,                    // 只经 assertRunTransition
  constraintsVersionAtStart: v.number(),
  round: v.number(), maxRounds: v.number(),       // 场景配置，默认 3
  nextTurnSeq: v.number(),
  openTurnSeqs: v.array(v.number()),     // 本轮尚未完成的回合（并行评估时 ≤ 2）
  modelCallCount: v.number(), maxModelCalls: v.number(), // 默认 12
  excludedAmountFloorCents: v.optional(centsV), // 本 run 内 provider 已获知"≥ 此金额会被拒"
  endedReason: v.optional(v.string()),
  startedByUserId: v.optional(v.id("users")),
  createdAt: v.number(), endedAt: v.optional(v.number()),
}).index("by_room_seq", ["roomId", "seq"]),

agentTurns: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"),
  turnSeq: v.number(), round: v.number(), role: roleV,
  kind: v.union(v.literal("propose"), v.literal("evaluate")),
  attempt: v.number(),                   // 1 起；retryTurn 时 +1，turnSeq 不变
  status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("invalid_output"),
                  v.literal("failed"), v.literal("stale")),
  constraintsVersion: v.number(),        // 快照
  subjectProposalId: v.optional(v.id("proposals")), // evaluate 的对象
  candidateKeys: v.array(v.string()),    // 发给模型的候选键（不含金额）
  output: v.optional(v.any()),           // 校验后的 TurnOutput（含本方 rationale）；仅本角色可读
  resultProposalId: v.optional(v.id("proposals")),
  authorKind: v.union(v.literal("agent"), v.literal("stub"), v.literal("rule")),
  model: v.optional(v.string()), effort: v.optional(v.string()),
  usage: v.optional(v.object({
    inputTokens: v.number(), outputTokens: v.number(), thinkingTokens: v.number(),
    cacheReadInputTokens: v.number(), cacheCreationInputTokens: v.number() })),
  stopReason: v.optional(v.string()), requestId: v.optional(v.string()),
  latencyMs: v.optional(v.number()), errorCode: v.optional(v.string()),
  simulated: v.boolean(),
  startedAt: v.number(), finishedAt: v.optional(v.number()),
}).index("by_run_turn_attempt", ["runId", "turnSeq", "attempt"])
  .index("by_room_role", ["roomId", "role"]),
```

## 7. 提案

```ts
proposalLineV = v.object({ itemKey: v.string(), catalogItemId: v.id("catalogItems"),
  revision: v.number(), title: v.string(), priceCents: centsV });
proposalFeeV = v.object({ kind: v.literal("rush_fee"), catalogItemId: v.id("catalogItems"),
  revision: v.number(), amountCents: centsV });

proposals: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"), turnId: v.optional(v.id("agentTurns")),
  version: v.number(),                   // 房间内单调
  authorKind: v.union(v.literal("agent"), v.literal("stub"), v.literal("human_choice")),
  sourceRole: roleV,                     // 提出方（provider，或 human_choice 时 customer）
  candidateKey: v.string(),
  itemKeys: v.array(v.string()),         // 排序后
  deferredItemKeys: v.array(v.string()), // = customer 请求的条目 − itemKeys（代码计算）
  lines: v.array(proposalLineV), fees: v.array(proposalFeeV),
  amountCents: centsV,                   // Σ lines + Σ fees（代码计算）
  delivery: v.union(v.literal("standard"), v.literal("rush")),
  deliveryDate: dateV,
  customerBriefVersionId: v.id("briefVersions"),
  createdUnderConstraintsVersion: v.number(),
  contentKey: v.string(),                // 06 §6
  requiredSignatures: v.array(v.object({ role: roleV, kind: signatureKindV })), // 快照
  status: v.union(v.literal("active"), v.literal("superseded"), v.literal("executed")),
  validationSnapshot: v.object({ constraintsVersion: v.number(), reasonCodes: v.array(v.string()) }),
  simulated: v.boolean(), createdAt: v.number(),
}).index("by_room_version", ["roomId", "version"]).index("by_run", ["runId"]),
```

## 8. 签字（只追加）

```ts
decisions: defineTable({
  roomId: v.id("rooms"), proposalId: v.id("proposals"),
  userId: v.id("users"), role: roleV,    // role 从 members 读
  signatureKind: signatureKindV,
  decision: v.union(v.literal("approve"), v.literal("reject"), v.literal("withdraw")),
  seq: v.number(),                       // 每 proposal×user 从 1 递增
  constraintsVersion: v.number(),        // 签字时房间约束版本
  contentKey: v.string(),                // 复制自提案
  rejectReasonCode: v.optional(v.union(v.literal("PRICE_TOO_HIGH"), v.literal("SCOPE_INSUFFICIENT"),
    v.literal("DATE_UNACCEPTABLE"), v.literal("OTHER"))),
  note: v.optional(v.string()),          // ≤ 500；noteShared 为 true 才对房间可见
  noteShared: v.boolean(),
  createdAt: v.number(),
}).index("by_proposal_user_seq", ["proposalId", "userId", "seq"])
  .index("by_proposal", ["proposalId"]),
```

## 9. 执行记录

```ts
changeOrders: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"),
  number: v.number(),                    // 房间内 CO-n，= 已执行变更单数 + 1
  proposalId: v.id("proposals"), proposalVersion: v.number(),
  constraintsVersion: v.number(),        // 执行时（递增前）的版本 = 签字版本
  operationKey: v.string(),              // `exec:${proposalId}:cv${constraintsVersion}`
  contentKey: v.string(),
  itemKeys: v.array(v.string()), deferredItemKeys: v.array(v.string()),
  lines: v.array(proposalLineV), fees: v.array(proposalFeeV),
  amountCents: centsV, deliveryDate: dateV,
  authorizingDecisionIds: v.array(v.id("decisions")),
  budgetSnapshot: v.object({ limitCents: centsV, committedBeforeCents: centsV,
    committedAfterCents: centsV, headroomAfterCents: centsV, limitRevision: v.number() }),
  executedByUserId: v.id("users"),       // 最后签字者
  simulated: v.boolean(), createdAt: v.number(),
}).index("by_room_number", ["roomId", "number"]).index("by_operationKey", ["operationKey"]),

tasks: defineTable({
  roomId: v.id("rooms"), changeOrderId: v.id("changeOrders"),
  itemKey: v.string(), title: v.string(), assigneeRole: roleV,
  status: v.union(v.literal("todo"), v.literal("in_progress"), v.literal("done")),
  operationKey: v.string(),              // `${changeOrder.operationKey}:task:${itemKey}`
  createdAt: v.number(), updatedAt: v.number(),
}).index("by_changeOrder", ["changeOrderId"]).index("by_room", ["roomId"]),
```

## 10. 人工请求、约束变更、事件

```ts
requestOptionEffectV = v.union(
  v.object({ kind: v.literal("choose_candidate"), candidateKey: v.string() }),
  v.object({ kind: v.literal("defer_item"), itemKey: v.string() }),
  v.object({ kind: v.literal("raise_limit"), toLimitCents: centsV }),
  v.object({ kind: v.literal("extend_deadline"), toDate: dateV }),
  v.object({ kind: v.literal("close_without_change") }));

humanRequests: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"), targetRole: roleV,
  kind: v.union(v.literal("tradeoff"), v.literal("clarify")),
  questionKey: v.string(),               // 模板键，如 "no_feasible_option"
  params: v.any(),                       // 模板参数（结构化，按 targetRole 投影后渲染）
  options: v.array(v.object({ key: v.string(), effect: requestOptionEffectV })),
  clarifyText: v.optional(v.string()),   // 仅 clarify：本方代理写给本方的人
  status: v.union(v.literal("open"), v.literal("answered"), v.literal("cancelled")),
  constraintsVersion: v.number(),
  answerKey: v.optional(v.string()), answerText: v.optional(v.string()),
  answeredByUserId: v.optional(v.id("users")), answeredAt: v.optional(v.number()),
  cancelReason: v.optional(v.string()), createdAt: v.number(),
}).index("by_room_status", ["roomId", "status"]).index("by_run", ["runId"]),

constraintChanges: defineTable({
  roomId: v.id("rooms"), fromVersion: v.number(), toVersion: v.number(),
  cause: constraintCauseV,
  refId: v.string(),                     // budgetRevisions / commitments / briefVersions / catalogItems 的 _id
  actorKind: actorKindV, actorRole: v.optional(roleV), createdAt: v.number(),
}).index("by_room_version", ["roomId", "toVersion"]),

events: defineTable({
  roomId: v.id("rooms"),
  type: eventTypeV,                      // 字面量联合，见 07 §6
  audience: v.union(v.object({ kind: v.literal("room") }),
                    v.object({ kind: v.literal("roles"), roles: v.array(roleV) })),
  payload: v.any(),                      // 结构化；room 受众的 payload 不得含私密数值（07 §6）
  runId: v.optional(v.id("runs")), proposalId: v.optional(v.id("proposals")),
  constraintsVersion: v.number(), actorKind: actorKindV, actorRole: v.optional(roleV),
  orderTs: v.commitTs(),                 // 提交顺序全序（inputs/04 §1.6）
  createdAt: v.number(),
}).index("by_room_order", ["roomId", "orderTs"]),
```

## 11. 唯一性与不变量落点

| 逻辑唯一 / 不变量 | 索引 | 唯一写入口 |
| --- | --- | --- |
| tokenIdentifier → user | by_tokenIdentifier | `users.ensure` |
| (room, role) 成员、(room, user) 成员 | by_room_role、by_room_user | `invites.accept`、`rooms.create` |
| 邀请一次性 | by_tokenHash | `invites.accept` |
| (room, role, version) 简报 | by_room_role_version | `briefs.confirm` |
| (room, itemKey, revision) 报价 | by_room_item_revision | `catalog.saveItem`、`catalog.retireItem` |
| 每房间一个预算 | by_room | `rooms.create`（同事务建 budgets） |
| revision / seq 连续 | budgets 计数器 | `budget.setLimit` / 执行 / `budget.recordOpeningBalance` |
| 每预算一条 opening_balance | by_operationKey(`open:{budgetId}`) | `budget.recordOpeningBalance` |
| operationKey → 一张变更单、一条承诺 | by_operationKey（两表） | `executeProposal` |
| (proposal, user, seq) 签字 | by_proposal_user_seq | `decisions.approve/reject/withdraw` |
| 每房间一个活动 run | rooms.currentRunId | `startRunInternal`（所有开 run 的路径都调用它） |
| 每房间一个 active 提案 | rooms.currentProposalId | `insertProposal` |
| (run, turnSeq, attempt) 回合 | by_run_turn_attempt | `startTurn`、`retryTurn` |

## 12. schema 演进
- 新增字段先 `v.optional` 再回填；开发部署可清表重 seed。
- 不使用 `v.int64()`：金额上限 1e8 美分远小于 2^53。
- `payload: v.any()` 与 `output: v.any()` 的形状由写入 helper 的 TypeScript 类型与 Zod 保证（写入前 parse）。
