# 03 Convex schema v1（第 2/2 部分：协商、审批、执行、事件）

```ts
// convex/schema.ts（节选二，接 part1）
const runStatus = v.union(
  v.literal("negotiating"), v.literal("needs_input"), v.literal("pending_approval"),
  v.literal("paused"), v.literal("executed"), v.literal("superseded"), v.literal("canceled"));
const driverMode = v.union(v.literal("live"), v.literal("stub"), v.literal("replay"), v.literal("scripted"));
const terms = v.object({
  candidateKey: v.string(), itemKeys: v.array(v.string()), deferredItemKeys: v.array(v.string()),
  deliveryMode: v.union(v.literal("standard"), v.literal("rush")), deliveryDate: v.string(),
  priceCents: v.number(), catalogRevision: v.number(),
  sourceRefs: v.array(v.object({ catalogItemId: v.id("catalogItems"), itemKey: v.string(),
    revision: v.number(), priceCents: v.number() })),
});
const decisionV = v.union(   // 模型决策经 Zod 校验后的存储形状（05 §2）
  v.object({ action: v.literal("propose"), candidateKey: v.string() }),
  v.object({ action: v.literal("counter"), candidateKey: v.string() }),
  v.object({ action: v.literal("recommend_accept") }),
  v.object({ action: v.literal("reject"), reasonCode: v.string() }),
  v.object({ action: v.literal("clarify"), topicKey: v.string() }),
);

runs: defineTable({
  roomId: v.id("rooms"), runSeq: v.number(),
  trigger: v.union(v.literal("initial"), v.literal("constraint_change"), v.literal("human_rejection"),
    v.literal("human_answer"), v.literal("manual_restart")),
  status: runStatus,
  pauseReason: v.optional(v.union(v.literal("turn_failed"), v.literal("agents_disabled"), v.literal("call_limit"))),
  constraintsVersionAtStart: v.number(),
  roundIndex: v.number(),             // 从 1 起
  maxRounds: v.number(),              // 场景配置快照
  nextTurnSeq: v.number(),
  openTurnCount: v.number(),          // 本轮尚未结束的 turn 数（并行评估用）
  modelCallCount: v.number(), modelCallLimit: v.number(),
  proposedCandidateKeys: v.array(v.string()),   // 本 run 已提出过的候选（防重复）
  clarifyUsedBy: v.array(v.string()),            // 已用过澄清的 roleKey
  driverMode,
  startedBy: v.optional(v.id("users")),          // 系统触发时为空
  endedAt: v.optional(v.number()), createdAt: v.number(),
}).index("by_roomId_and_runSeq", ["roomId", "runSeq"]),

turns: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"), turnSeq: v.number(), roundIndex: v.number(),
  roleKey: v.string(),
  purpose: v.union(v.literal("propose"), v.literal("evaluate")),
  status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("failed"),
    v.literal("stale"), v.literal("canceled")),
  attemptCount: v.number(),
  // —— 服务端信封快照（模型永不提供）——
  constraintsVersionAtStart: v.number(), catalogRevisionAtStart: v.number(),
  baseProposalId: v.optional(v.id("proposals")),
  offeredCandidateKeys: v.array(v.string()), allowedActions: v.array(v.string()),
  roleViewHash: v.string(), promptVersion: v.string(), scenarioVersion: v.number(),
  driverMode,
  // —— 结果（写一次）——
  decision: v.optional(decisionV),
  rationale: v.optional(v.string()),  // 本方私有，≤ 600 字符
  validation: v.optional(v.array(v.string())), // propose/counter 物化后的 reasonCode（系统视角，仅本方与审计可读）
  flags: v.optional(v.array(v.string())),      // rationaleTruncated / agentClaimDisputed …
  effect: v.optional(v.union(v.literal("proposal_created"), v.literal("blocked_by_rules"), v.literal("endorsed"),
    v.literal("rejected"), v.literal("counter_unused"), v.literal("request_created"))),
  errorCode: v.optional(v.string()),
  watchdogFnId: v.optional(v.id("_scheduled_functions")),
  startedAt: v.number(), endedAt: v.optional(v.number()),
}).index("by_runId_and_turnSeq", ["runId", "turnSeq"])
  .index("by_roomId_and_roleKey", ["roomId", "roleKey"]),

modelCalls: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"), turnId: v.id("turns"), roleKey: v.string(),
  attemptNo: v.number(), driverMode, model: v.optional(v.string()), effort: v.optional(v.string()),
  promptVersion: v.string(), requestId: v.optional(v.string()), stopReason: v.optional(v.string()),
  outcome: v.union(v.literal("ok"), v.literal("invalid_output"), v.literal("max_tokens"),
    v.literal("refusal"), v.literal("api_error"), v.literal("timeout"), v.literal("stale_discarded")),
  errorCodes: v.array(v.string()),
  inputTokens: v.number(), cacheCreationInputTokens: v.number(), cacheReadInputTokens: v.number(),
  outputTokens: v.number(), thinkingTokens: v.number(),
  latencyMs: v.number(), estimatedCostMicroUsd: v.number(),
  startedAt: v.number(), endedAt: v.number(),
}).index("by_turnId", ["turnId"]).index("by_roomId", ["roomId"]),

proposals: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"), version: v.number(),
  authorRole: v.string(), authoredByTurnId: v.optional(v.id("turns")),
  authorKind: v.union(v.literal("agent"), v.literal("human_choice")), // human_choice：取舍请求选中
  terms, contentHash: v.string(),
  constraintsVersion: v.number(),
  requiredApprovals: v.array(v.object({ roleKey: v.string(), kind: v.union(v.literal("terms"), v.literal("budget")) })),
  validationAtCreate: v.array(v.string()),  // reasonCode 快照，仅供审计
  status: v.union(v.literal("under_review"), v.literal("endorsed"), v.literal("superseded"),
    v.literal("rejected_by_human"), v.literal("executed")),
  isSimulated: v.boolean(), createdAt: v.number(),
}).index("by_roomId_and_version", ["roomId", "version"]).index("by_runId", ["runId"]),

decisions: defineTable({
  roomId: v.id("rooms"), proposalId: v.id("proposals"), constraintsVersion: v.number(),
  contentHash: v.string(), userId: v.id("users"), roleKey: v.string(),
  kind: v.union(v.literal("terms"), v.literal("budget")),
  decision: v.union(v.literal("approve"), v.literal("reject"), v.literal("withdraw")),
  reasonCode: v.optional(v.string()),     // reject：场景枚举
  createdAt: v.number(),
}).index("by_proposalId_and_constraintsVersion", ["proposalId", "constraintsVersion"]),

humanRequests: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"), groupId: v.string(),
  kind: v.union(v.literal("tradeoff"), v.literal("choose_option"), v.literal("clarification")),
  targetRole: v.string(), questionKey: v.string(), params: v.any(),
  options: v.array(v.object({ optionKey: v.string(), labelKey: v.string(), params: v.any(),
    effect: v.any() })),               // RequestEffect，见 05 §6
  constraintsVersion: v.number(),
  status: v.union(v.literal("open"), v.literal("answered"), v.literal("canceled")),
  answeredBy: v.optional(v.id("users")), answerOptionKey: v.optional(v.string()),
  cancelReason: v.optional(v.string()), createdAt: v.number(), resolvedAt: v.optional(v.number()),
}).index("by_roomId_and_status", ["roomId", "status"]).index("by_runId", ["runId"]),

changeOrders: defineTable({
  roomId: v.id("rooms"), proposalId: v.id("proposals"), constraintsVersion: v.number(),
  operationId: v.string(),              // exec:{proposalId}:{constraintsVersion}
  terms, contentHash: v.string(), decisionIds: v.array(v.id("decisions")),
  executedBy: v.id("users"), isSimulated: v.boolean(), createdAt: v.number(),
}).index("by_operationId", ["operationId"]).index("by_roomId", ["roomId"]),

tasks: defineTable({
  roomId: v.id("rooms"), changeOrderId: v.id("changeOrders"), itemKey: v.string(),
  title: v.string(), assigneeRole: v.string(), assigneeUserId: v.id("users"), dueDate: v.string(),
  status: v.union(v.literal("todo"), v.literal("in_progress"), v.literal("done")),
}).index("by_changeOrderId", ["changeOrderId"]).index("by_assigneeUserId", ["assigneeUserId"]),

events: defineTable({
  roomId: v.id("rooms"), commitTs: v.commitTs(),   // 提交序全序（inputs/04 §1.6）
  type: v.string(), payload: v.any(),             // 结构化；读时按受众渲染
  audience, actorRole: v.optional(v.string()),    // "system" 用 undefined
  runId: v.optional(v.id("runs")), requestId: v.optional(v.string()), // ctx.meta requestId
}).index("by_roomId_and_commitTs", ["roomId", "commitTs"]),
```

## 唯一性与不变量落点（part2 表）

| 逻辑唯一 / 不变量 | 索引 | 唯一写入口 |
| --- | --- | --- |
| 每房间一个非终态 run（I6） | rooms.currentRunId + by_roomId_and_runSeq | `startRunInternal`（helper，被 `runs.start`、`bumpConstraints`、`humanRequests.answer` 调用） |
| proposal.version 唯一（I2） | by_roomId_and_version | `insertProposal` helper（只在 `agents.completeTurn` 与 `humanRequests.answer` 内） |
| 每 (proposal, cv, user) 最新决定 | by_proposalId_and_constraintsVersion | `decisions.submit` |
| 每 operationId 一个变更单（I5） | by_operationId | `executeIfComplete` helper（只在 `decisions.submit` 内） |
| 每 (run, turnSeq) 一个 turn | by_runId_and_turnSeq | `scheduleTurns` helper |
| 每 run 调用数上限（I14） | runs.modelCallCount | `agents.beginAttempt` |

## 演进
- 新增字段一律 `v.optional` 起步，回填后再收紧；大表索引用 `staged: true`（inputs/04 §1.6）。
- `v.commitTs()` 读回占位符问题：同一 mutation 内不读 `commitTs`；排序只在 query 中用（待验证：commitTs 在 convex-test 中的支持）。

## 附：运行时计数表

```ts
usageCounters: defineTable({
  roomId: v.id("rooms"), utcDay: v.string(),   // "2026-11-02"
  calls: v.number(),
}).index("by_roomId_and_utcDay", ["roomId", "utcDay"]),   // 唯一写入口 agents.beginAttempt（10 §10.6）
```
