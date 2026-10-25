# 03 Convex schema v1 · part2：投影表与普通表

> 分片清单见 part1。标记：**[P]** = 投影（只由 `applyEvent` 写，可回放重建）；**[N]** = 普通表（不事件化，理由见 02 DM-6）；**[I]** = 投影且行不可变（只 insert）。

## 1. 普通表 [N]

```ts
users: defineTable({
  tokenIdentifier: v.string(),        // identity.tokenIdentifier，全局唯一
  subject: v.string(),                // Clerk user_...，仅展示/对账
  displayName: v.string(),
  createdAt: v.number(),
}).index("by_token", ["tokenIdentifier"]),

invites: defineTable({
  roomId: v.id("rooms"), role: roleV,
  tokenHash: v.string(),              // sha256(token)；明文只在创建时返回 owner 一次
  createdBy: v.id("users"), createdAt: v.number(), expiresAt: v.number(),
  acceptedBy: v.optional(v.id("users")), acceptedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
}).index("by_tokenHash", ["tokenHash"]).index("by_room_role", ["roomId", "role"]),

briefDrafts: defineTable({            // 私密、可变；不是事实
  roomId: v.id("rooms"), userId: v.id("users"), role: roleV,
  content: briefContentV, shareableFields: v.array(v.string()),
  updatedAt: v.number(),
}).index("by_room_user", ["roomId", "userId"]),

agentTurns: defineTable({             // 遥测 + 私有 rationale；终态后冻结
  roomId: v.id("rooms"), runNo: v.number(), turnSeq: v.number(), attempt: v.number(),
  role: roleV, phase: v.union(v.literal("propose"), v.literal("evaluate")), round: v.number(),
  status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("invalid_output"),
                  v.literal("failed"), v.literal("stale")),
  baseProposalVersion: v.optional(v.number()), constraintsVersion: v.number(),
  candidateIds: v.array(v.string()),  // 本回合允许选择的候选（05）
  mode: v.union(v.literal("model"), v.literal("stub")),
  output: v.optional(v.any()),        // 通过 Zod 的模型输出（含 rationale），仅本角色可读
  model: v.optional(v.string()), effort: v.optional(v.string()),
  inputTokens: v.optional(v.number()), cacheCreationInputTokens: v.optional(v.number()),
  cacheReadInputTokens: v.optional(v.number()), outputTokens: v.optional(v.number()),
  thinkingTokens: v.optional(v.number()), stopReason: v.optional(v.string()),
  requestId: v.optional(v.string()), latencyMs: v.optional(v.number()),
  errorCode: v.optional(v.string()), scheduledFnId: v.optional(v.id("_scheduled_functions")),
  startedAt: v.number(), finishedAt: v.optional(v.number()),
}).index("by_room_run_turn", ["roomId", "runNo", "turnSeq", "attempt"])
  .index("by_room_status", ["roomId", "status"]),
```

`agentTurns.output` 用 `v.any()` 是有意的：形状由 Zod（05）在写入前校验，存储层只做容器；该字段永不进入他方可调用的返回值。

## 2. 投影表 [P]/[I]

```ts
rooms: defineTable({                  // [P] 流头 + 聚合指针；重建时只 patch 不删
  scenarioKey: v.literal("scope_change"), scenarioVersion: v.number(),
  title: v.string(), goal: v.string(), timeZone: v.string(),
  ownerUserId: v.id("users"), status: v.union(v.literal("open"), v.literal("closed")),
  maxRounds: v.number(), simulated: v.boolean(), fixtureKey: v.optional(v.string()),
  lastSeq: v.number(), lastHash: v.string(),           // 流头
  constraintsVersion: v.number(),                      // 只由约束事件推进
  proposalVersion: v.number(),                         // 最新已分配版本（0 = 无）
  lastRunNo: v.number(), lastRequestNo: v.number(),
  currentRunNo: v.optional(v.number()),                // 活动 run（终态后清空）
  currentProposalVersion: v.optional(v.number()),
  createdAt: v.number(),
}).index("by_owner", ["ownerUserId"]),

members: defineTable({                // [P] ← member_joined
  roomId: v.id("rooms"), userId: v.id("users"), role: roleV,
  displayName: v.string(), joinedSeq: v.number(),
}).index("by_room_role", ["roomId", "role"]).index("by_room_user", ["roomId", "userId"])
  .index("by_user", ["userId"]),

briefVersions: defineTable({          // [I] ← brief_confirmed
  roomId: v.id("rooms"), role: roleV, version: v.number(),
  content: briefContentV, shareableFacts: v.array(factV),
  confirmedBy: v.id("users"), confirmedSeq: v.number(), confirmedAt: v.number(),
  constraintsVersionAfter: v.union(v.number(), v.null()), simulated: v.boolean(),
}).index("by_room_role_version", ["roomId", "role", "version"]),

catalogItems: defineTable({           // [I] ← catalog_item_confirmed / withdrawn（撤回 = status 行）
  roomId: v.id("rooms"), itemKey: v.string(), itemVersion: v.number(),
  status: v.union(v.literal("confirmed"), v.literal("withdrawn")),
  title: v.string(), priceCents: v.number(), standardLeadDays: v.number(),
  rushLeadDays: v.optional(v.number()), taskTemplates: v.array(v.object({ title: v.string() })),
  confirmedSeq: v.number(), simulated: v.boolean(),
}).index("by_room_item_version", ["roomId", "itemKey", "itemVersion"]),

budgets: defineTable({                // [P] ← budget_changed；每房间一行
  roomId: v.id("rooms"), totalCents: v.number(), currency: v.literal("USD"),
  lastChangeSeq: v.number(), simulated: v.boolean(),
}).index("by_room", ["roomId"]),

commitments: defineTable({            // [I] 台账
  roomId: v.id("rooms"), kind: v.union(v.literal("baseline"), v.literal("change_order")),
  amountCents: v.number(), operationId: v.optional(v.string()), label: v.string(),
  createdSeq: v.number(), simulated: v.boolean(),
}).index("by_room", ["roomId"]).index("by_room_operation", ["roomId", "operationId"]),

runs: defineTable({                   // [P] ← run_* / proposal_created / execution_completed
  roomId: v.id("rooms"), runNo: v.number(),
  status: runStatusV,                 // 与 convex/engine/state/run.ts 共用（04）
  trigger: runTriggerV, constraintsVersionAtStart: v.number(),
  round: v.number(), maxRounds: v.number(),
  lastReasonCode: v.optional(v.string()), endedSeq: v.optional(v.number()),
  startedSeq: v.number(),
}).index("by_room_run", ["roomId", "runNo"]),

proposals: defineTable({              // [I] ← proposal_created；无 status 字段
  roomId: v.id("rooms"), runNo: v.number(), version: v.number(), round: v.number(),
  authorKind: v.union(v.literal("agent"), v.literal("rule"), v.literal("human_option")),
  authorRole: roleV, turnSeq: v.optional(v.number()), candidateId: v.string(),
  lines: v.array(lineV), terms: v.array(termLineV), deferredItemKeys: v.array(v.string()),
  amountCents: v.number(), deliveryDate: v.string(),
  requiredApprovals: v.array(reqApprovalV), constraintsVersion: v.number(),
  termsKey: v.string(),               // "LOGIN_SSO@1,USAGE_REPORTS@1|RUSH|90000|2026-11-13"
  validation: v.object({ ok: v.boolean(), reasonCodes: v.array(v.string()) }), // 写入时快照
  createdSeq: v.number(), simulated: v.boolean(),
}).index("by_room_version", ["roomId", "version"]),

decisions: defineTable({              // [I] ← decision_recorded
  roomId: v.id("rooms"), proposalVersion: v.number(), userId: v.id("users"), role: roleV,
  kind: v.union(v.literal("terms"), v.literal("budget")),
  decision: v.union(v.literal("approve"), v.literal("reject"), v.literal("withdraw")),
  reasonCode: v.optional(v.string()), note: v.optional(v.string()),
  constraintsVersion: v.number(), seq: v.number(), at: v.number(),
}).index("by_room_proposal_seq", ["roomId", "proposalVersion", "seq"]),

humanRequests: defineTable({          // [P] ← human_request_*
  roomId: v.id("rooms"), requestNo: v.number(), runNo: v.number(), targetRole: roleV,
  kind: v.union(v.literal("tradeoff"), v.literal("clarify"), v.literal("budget_below_committed"), v.literal("no_feasible_option")),
  reasonCode: v.string(), options: v.array(optionV), constraintsVersion: v.number(),
  status: v.union(v.literal("open"), v.literal("answered"), v.literal("cancelled")),
  answerKey: v.optional(v.string()), answeredBy: v.optional(v.id("users")),
  openedSeq: v.number(), closedSeq: v.optional(v.number()),
}).index("by_room_request", ["roomId", "requestNo"]).index("by_room_status", ["roomId", "status"]),

changeOrders: defineTable({           // [I] ← execution_completed
  roomId: v.id("rooms"), runNo: v.number(), proposalVersion: v.number(),
  constraintsVersion: v.number(), operationId: v.string(),
  lines: v.array(lineV), terms: v.array(termLineV), deferredItemKeys: v.array(v.string()),
  amountCents: v.number(), deliveryDate: v.string(),
  committedBeforeCents: v.number(), committedAfterCents: v.number(), totalBudgetCents: v.number(),
  executedSeq: v.number(), executedAt: v.number(), simulated: v.boolean(),
}).index("by_room_operation", ["roomId", "operationId"])
  .index("by_room_proposal", ["roomId", "proposalVersion"]),

tasks: defineTable({                  // [P] ← execution_completed / task_completed
  roomId: v.id("rooms"), taskKey: v.string(),           // `${operationId}:${itemKey}`
  operationId: v.string(), itemKey: v.string(), title: v.string(),
  assigneeRole: v.literal("provider"),
  status: v.union(v.literal("open"), v.literal("done")),
  createdSeq: v.number(), completedSeq: v.optional(v.number()),
}).index("by_room_task", ["roomId", "taskKey"]).index("by_room_operation", ["roomId", "operationId"]),
```

## 3. 字段说明（易错点）

| 字段 | 说明 |
| --- | --- |
| `rooms.proposalVersion` vs `currentProposalVersion` | 前者是计数器（已分配的最大值），后者是"当前在谈/待批"的指针；执行后指针保留，用于显示 executed |
| `proposals.validation` | 写入时快照，仅供时间线与审计；执行永远重算（06） |
| `proposals.termsKey` | 规范化条款字符串，人类可读的"批准的是哪份条款"证据；不需要 contentHash，因为行不可变且审批绑定版本 |
| `changeOrders.totalBudgetCents` 等 | 执行快照：以后预算再变，旧变更单的"执行前/后"不变（RA-B09 回归） |
| `members.displayName` | 加入时快照；Clerk JWT 是否带 name：待验证，取不到就让用户在接受邀请时填写 |
| `*.simulated` | 从事件信封继承；任何由 seed 产生的行都为 true |
| `runs.status` | 唯一允许写它的是 `applyEvent` 中 run_* 分支，且必经 `assertRunTransition`（04） |
