# 03 Convex schema v1（part4）：run、回合、人工请求、事件

## 3.17 `runs`

```ts
runs: defineTable({
  roomId: v.id("rooms"),
  number: v.number(),                        // rooms.runSeq + 1
  trigger: v.union(v.literal("ready"), v.literal("constraints_changed"), v.literal("rejection"),
                   v.literal("request_answered"), v.literal("manual")),
  triggeredBy: actorV,
  constraintsVersion: v.number(),            // 开始时的约束版本；持久化守卫与之比较
  status: v.union(v.literal("running"), v.literal("stalled"), v.literal("finished")),
  outcome: v.optional(v.union(v.literal("proposal_ready"), v.literal("needs_input"),
                              v.literal("superseded"), v.literal("cancelled"))),
  consensus: v.optional(v.boolean()),        // proposal_ready 时：全部审阅方都 recommend_accept
  phase: v.union(v.literal("proposing"), v.literal("reviewing")),
  round: v.number(),                         // 从 1 开始
  maxRounds: v.number(),                     // 来自插件 negotiation.maxRounds
  proposerAttempt: v.number(),               // 本轮提出方第几次（被阻断后再试），上限 2
  openTurnIds: v.array(v.id("turns")),       // 当前阶段尚未完成的回合
  nextSeq: v.number(),
  stalledTurnId: v.optional(v.id("turns")),
  baseProposalId: v.optional(v.id("proposals")),  // run 开始时的当前提案
  lastProposalId: v.optional(v.id("proposals")),  // 本 run 产生的最新提案
  excludedCandidateKeys: v.array(v.string()),     // 本约束版本内被人拒绝过的候选
  modelCallCount: v.number(),                // 本 run 已预留的模型调用次数
  agentMode: v.union(v.literal("live"), v.literal("stub")),
  endedReasonCode: v.optional(v.string()),   // 例如 AGENT_TIMEOUT、CALL_BUDGET_EXHAUSTED
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
})
  .index("by_room_number", ["roomId", "number"])
  .index("by_status", ["status"]),
```

- run 只描述"代理协商这一段"；审批与执行不是 run 的状态（18 ADR-07）。`status ∈ {running, stalled}` ⇔ `rooms.activeRunId === run._id`（I-23）。

## 3.18 `turns`（每次 attempt 一行）

```ts
export const modelMoveV = v.union(           // 与 05 的 Zod schema 一一对应
  v.object({ action: v.literal("propose"), rankedCandidateKeys: v.array(v.string()), rationale: v.string() }),
  v.object({ action: v.literal("counter"), rankedCandidateKeys: v.array(v.string()),
             reasonCode: v.string(), rationale: v.string() }),
  v.object({ action: v.literal("recommend_accept"), rationale: v.string() }),
  v.object({ action: v.literal("reject"), reasonCode: v.string(),
             suggestedCandidateKeys: v.array(v.string()), rationale: v.string() }),
  v.object({ action: v.literal("clarify"), targetRoleKey: v.string(), topicKey: v.string(), rationale: v.string() }),
);

turns: defineTable({
  roomId: v.id("rooms"),
  runId: v.id("runs"),
  seq: v.number(),
  attempt: v.number(),                       // 同一 seq 的第几次尝试，从 1 开始
  round: v.number(),
  kind: v.union(v.literal("propose"), v.literal("review")),
  seatId: v.id("seats"),
  roleKey: v.string(),
  status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("invalid_output"),
                  v.literal("failed"), v.literal("timed_out"), v.literal("stale")),
  constraintsVersion: v.number(),            // 信封快照
  baseProposalId: v.optional(v.id("proposals")),
  allowedActions: v.array(v.string()),
  allowedCandidateKeys: v.array(v.string()), // 本回合作用域视图下的候选键（schema 的 enum 来源）
  allowedTopicKeys: v.array(v.string()),
  move: v.optional(modelMoveV),              // 通过全部校验的输出；含 rationale，仅本席位可读
  selection: v.optional(v.object({           // 提出方：代码按排序挑出的候选与被阻断项
    chosenCandidateKey: v.optional(v.string()),
    blocked: v.array(v.object({ candidateKey: v.string(), reasonCodes: v.array(v.string()) })),
  })),
  resultProposalId: v.optional(v.id("proposals")),
  requestIds: v.optional(v.array(v.id("humanRequests"))),
  errorCode: v.optional(v.string()),
  errorDetail: v.optional(v.string()),       // 只含非敏感信息：HTTP 状态、stop_reason、Zod 路径
  model: v.optional(v.string()),             // 实际产出的模型（msg.model）
  effort: v.optional(v.string()),
  stopReason: v.optional(v.string()),
  providerRequestId: v.optional(v.string()), // msg._request_id
  usage: v.optional(usageV),
  latencyMs: v.optional(v.number()),
  agentMode: v.union(v.literal("live"), v.literal("stub")),
  actionFnId: v.optional(v.id("_scheduled_functions")),
  watchdogFnId: v.optional(v.id("_scheduled_functions")),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
})
  .index("by_run_seq", ["runId", "seq", "attempt"])
  .index("by_room_seat", ["roomId", "seatId"])
  .index("by_room_started", ["roomId", "startedAt"])
  .index("by_status_started", ["status", "startedAt"]),
```

- 不存 prompt 原文与思考内容（P-12）；可追溯性靠结构化字段。失败的 attempt 也保留用量（计费依据）。
- 被阻断候选的原因码只对本席位可见（07 第 7.6 节）。

## 3.19 `humanRequests`

```ts
const requestIntentV = v.union(
  v.object({ type: v.literal("patch_brief"), patch: P.briefFields }),       // 字段全 optional，作为补丁
  v.object({ type: v.literal("edit_list"), listKey: v.string(), baseItemKey: v.optional(v.string()) }),
  v.object({ type: v.literal("choose_candidate"), candidateKey: v.string(), selection: P.selection }),
  v.object({ type: v.literal("share_fields"), refs: v.array(ownFieldRefV), audience: audienceV }),
  v.object({ type: v.literal("decline") }),
);

humanRequests: defineTable({
  roomId: v.id("rooms"),
  runId: v.optional(v.id("runs")),
  turnId: v.optional(v.id("turns")),
  groupKey: v.string(),                      // 例如 "tradeoff:cv12"；同组请求一起被关闭
  targetSeatId: v.id("seats"),
  targetRoleKey: v.string(),
  kind: v.union(v.literal("tradeoff"), v.literal("preference"), v.literal("disclosure")),
  constraintsVersion: v.number(),
  blockingReasonCodes: v.array(v.string()),
  askedByRoleKey: v.optional(v.string()),    // preference/disclosure：哪个代理发起（disclosure 时是他方）
  topicKey: v.optional(v.string()),
  options: v.array(v.object({
    key: v.string(),
    intent: requestIntentV,
    enablesCandidateKeys: v.array(v.string()),
  })),
  status: v.union(v.literal("open"), v.literal("answered"), v.literal("declined"),
                  v.literal("superseded"), v.literal("cancelled")),
  answerOptionKey: v.optional(v.string()),
  answeredByUserId: v.optional(v.id("users")),
  result: v.optional(v.object({
    briefVersionId: v.optional(v.id("briefVersions")),
    proposalId: v.optional(v.id("proposals")),
    constraintsVersion: v.optional(v.number()),
  })),
  createdAt: v.number(),
  closedAt: v.optional(v.number()),
})
  .index("by_room_status", ["roomId", "status"])
  .index("by_target_status", ["targetSeatId", "status"]),
```

- 选项（例如"上限调到 $4,450"）只对目标席位可见；他人只见 `{targetRoleKey, kind, status}`（07）。
- `cancelled`：房间关闭或 run 被取消时；`superseded`：约束变化时（I-34）。

## 3.20 `events`（只追加）

```ts
export const eventDataV = v.union(
  v.object({ type: v.literal("room_created") }),
  v.object({ type: v.literal("room_closed") }),
  v.object({ type: v.literal("seat_joined"), seatId: v.id("seats") }),
  v.object({ type: v.literal("invite_created"), seatId: v.id("seats") }),
  v.object({ type: v.literal("invite_revoked"), seatId: v.id("seats") }),
  v.object({ type: v.literal("brief_confirmed"), seatId: v.id("seats"), version: v.number(),
             ruleChanged: v.boolean(), publicReasonCode: v.optional(v.string()) }),
  v.object({ type: v.literal("list_items_confirmed"), listKey: v.string(), itemKeys: v.array(v.string()) }),
  v.object({ type: v.literal("list_item_withdrawn"), listKey: v.string(), itemKey: v.string(),
             publicReasonCode: v.optional(v.string()) }),
  v.object({ type: v.literal("ledger_changed"), change: v.union(v.literal("baseline_added"), v.literal("baseline_voided")) }),
  v.object({ type: v.literal("constraints_changed"), fromVersion: v.number(), toVersion: v.number(),
             cause: v.string(), causeRoleKey: v.optional(v.string()), publicReasonCode: v.optional(v.string()) }),
  v.object({ type: v.literal("run_started"), runId: v.id("runs"), trigger: v.string() }),
  v.object({ type: v.literal("run_resumed"), runId: v.id("runs") }),
  v.object({ type: v.literal("run_stalled"), runId: v.id("runs"), roleKey: v.string(), errorCode: v.string() }),
  v.object({ type: v.literal("run_finished"), runId: v.id("runs"), outcome: v.string(), consensus: v.optional(v.boolean()) }),
  v.object({ type: v.literal("turn_stale"), runId: v.id("runs"), roleKey: v.string() }),
  v.object({ type: v.literal("proposal_created"), proposalId: v.id("proposals"), version: v.number(),
             previousProposalId: v.optional(v.id("proposals")) }),
  v.object({ type: v.literal("agent_stance"), runId: v.id("runs"), roleKey: v.string(),
             action: v.union(v.literal("recommend_accept"), v.literal("counter"), v.literal("reject"), v.literal("clarify")),
             candidateKeys: v.optional(v.array(v.string())), reasonCode: v.optional(v.string()),
             proposalId: v.optional(v.id("proposals")) }),
  v.object({ type: v.literal("decision_recorded"), proposalId: v.id("proposals"), seatId: v.id("seats"),
             kind: v.string(), reasonCode: v.optional(v.string()), constraintsVersion: v.number() }),
  v.object({ type: v.literal("execution_completed"), executionId: v.id("executions"), number: v.number() }),
  v.object({ type: v.literal("request_opened"), requestId: v.id("humanRequests"), targetRoleKey: v.string(), kind: v.string() }),
  v.object({ type: v.literal("request_closed"), requestId: v.id("humanRequests"), status: v.string() }),
  v.object({ type: v.literal("task_updated"), taskId: v.id("tasks"), status: v.string() }),
);

events: defineTable({
  roomId: v.id("rooms"),
  data: eventDataV,
  audience: eventAudienceV,
  actor: actorV,
  constraintsVersion: v.number(),            // 写入时的房间约束版本，便于按版本筛选
  isSimulated: v.boolean(),
  order: v.commitTs(),                       // 提交序全序（Convex 1.48）；写入时赋 ctx.db.vars.commitTs，用法待验证
})
  .index("by_room_order", ["roomId", "order"]),
```

- payload 不含任何私密值与自由文本（I-32）；`agent_stance` 只含动作、候选键（公开词汇）与原因码。代理 rationale 不进事件。
- 若 `v.commitTs()` 实测不可用，退回 `_creationTime` 排序（展示可接受，墙钟不保证提交序）。
- 受众几乎都是 `room`；`seats` 用于只给目标席位的事件（例如 `request_opened` 的详细版本另有房间版）。
