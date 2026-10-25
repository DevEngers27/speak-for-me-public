# 03 Convex schema v1（part3）：运行时表、请求、事件、用量、唯一性与不变量落点

> 分片清单见 part1。字段语义见 10（运行时）、05（协议）、07（受众）。

## 3.10 运行时三层表

```ts
const candidateV = v.object({ candidateKey: v.string(), rank: v.number(), terms: scopeTermsV, checks: v.array(checkV) });

runs: defineTable({
  roomId: v.id("rooms"),
  seq: v.number(),
  trigger: v.union(
    v.object({ kind: v.literal("manual"), userId: v.id("users") }),
    v.object({ kind: v.literal("constraints_changed"), constraintsVersion: v.number() }),
    v.object({ kind: v.literal("rejection"), proposalId: v.id("proposals"), decisionId: v.id("decisions") }),
    v.object({ kind: v.literal("request_answered"), requestId: v.id("humanRequests") }),
    v.object({ kind: v.literal("renegotiation_requested"), userId: v.id("users") }),
  ),
  constraintsVersion: v.number(),          // 创建后不变（R2）
  agentMode: agentModeV,
  status: runStatusV,                      // 04 §4.2
  outcome: v.optional(literalsV(["converged", "round_cap", "proposer_held", "reapproval", "manual",
                                 "no_feasible", "clarify", "agent_declined", "blocked"] as const)),
  currentRound: v.number(), maxRounds: v.number(),
  proposerRoleKey: v.string(), reviewerRoleKeys: v.array(v.string()),
  candidates: v.array(candidateV),         // 创建时快照，≤ 32 个；只含对全体可见的数据
  excludedCandidateKeys: v.array(v.string()),
  currentProposalId: v.optional(v.id("proposals")),
  clarifyUsed: v.number(),
  modelCallsUsed: v.number(),
  resumeCount: v.number(),
  failure: v.optional(v.object({ turnId: v.id("turns"), code: turnFailureCodeV })),
  endedReason: v.optional(literalsV(["constraints_changed", "rejected", "request_answered",
                                     "renegotiation_requested", "room_closed", "executed"] as const)),
  startedAt: v.number(), endedAt: v.optional(v.number()),
}).index("by_room_and_seq", ["roomId", "seq"])
  .index("by_room_and_constraintsVersion", ["roomId", "constraintsVersion"])
  .index("by_status", ["status"]),         // 巡检用

turns: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"),
  round: v.number(), roleKey: v.string(),
  kind: literalsV(["propose", "review"] as const),
  status: literalsV(["open", "completed", "failed", "discarded"] as const),
  baseProposalId: v.optional(v.id("proposals")),   // review 回合评审的提案
  currentAttemptId: v.optional(v.id("modelCalls")),// 租约（10 part1 §10.3）
  attemptCount: v.number(),
  retryCounters: v.object({ transport: v.number(), rate_limit: v.number(), server: v.number(),
    invalid_output: v.number(), refusal: v.number(), truncation: v.number(), timeout: v.number(), internal: v.number() }),
  lastMaxTokens: v.number(),
  result: v.optional(turnResultV),         // 公开部分：05 §5.4 的 PublicTurnResult
  privateRationale: v.optional(v.string()),// ≤ 1,200 字符，仅本角色参与者可见
  resultProposalId: v.optional(v.id("proposals")),
  failureCode: v.optional(turnFailureCodeV),
  resumedFromTurnId: v.optional(v.id("turns")),
  createdAt: v.number(), completedAt: v.optional(v.number()),
}).index("by_run_and_round", ["runId", "round"])
  .index("by_room_and_roleKey", ["roomId", "roleKey"]),

modelCalls: defineTable({
  roomId: v.id("rooms"),
  purpose: literalsV(["negotiation_turn", "brief_extraction"] as const),
  runId: v.optional(v.id("runs")), turnId: v.optional(v.id("turns")),
  extractionJobId: v.optional(v.id("extractionJobs")),
  attemptNo: v.number(),
  status: literalsV(["scheduled", "running", "received", "accepted", "stale", "failed", "timed_out", "skipped"] as const),
  agentMode: agentModeV,
  retryReason: v.union(v.literal("first"), retryClassV),
  retryNote: v.optional(v.string()), maxTokensOverride: v.optional(v.number()),
  scheduledAt: v.number(), deadlineAt: v.number(),
  startedAt: v.optional(v.number()), finishedAt: v.optional(v.number()),
  execFnId: v.optional(v.id("_scheduled_functions")),     // 系统表 id 的 validator 写法待验证；退路为 v.string()
  watchdogFnId: v.optional(v.id("_scheduled_functions")),
  applyFnId: v.optional(v.id("_scheduled_functions")),
  watchdogRearmed: v.optional(v.boolean()),
  protocolVersion: v.optional(v.number()), promptVersion: v.optional(v.string()), promptCacheKey: v.optional(v.string()),
  model: v.optional(v.string()), effort: v.optional(effortV), maxTokens: v.optional(v.number()),
  outcome: v.optional(attemptOutcomeV),    // 10 part5 §10.17–10.18 的判别联合；output 内含私密 rationale
  usage: v.optional(v.object({ inputTokens: v.number(), cacheCreationInputTokens: v.number(),
    cacheReadInputTokens: v.number(), outputTokens: v.number(), thinkingTokens: v.number(),
    serviceTier: v.optional(v.string()) })),
  responseModel: v.optional(v.string()), stopReason: v.optional(v.string()),
  requestId: v.optional(v.string()), messageId: v.optional(v.string()), latencyMs: v.optional(v.number()),
  skipReason: v.optional(v.string()), staleReason: v.optional(v.string()), failureNote: v.optional(v.string()),
  lateResult: v.optional(v.boolean()),
}).index("by_turnId_and_attemptNo", ["turnId", "attemptNo"])
  .index("by_runId", ["runId"])
  .index("by_room", ["roomId"])
  .index("by_status_and_deadlineAt", ["status", "deadlineAt"]),   // 巡检卡住的 attempt
```

`modelCalls` 与 `turns.privateRationale` 含本方私密内容，只通过按角色投影的 `runs.timeline` 查询读取（07 §7.3）。

运行时枚举与 outcome（`convex/engine/literals.ts`，10 part4–part5 的唯一来源）：

```ts
export const RETRY_CLASSES = ["transport", "rate_limit", "server", "invalid_output", "refusal", "truncation", "timeout", "internal"] as const;
export const TURN_FAILURE_CODES = ["RETRY_EXHAUSTED", "INVALID_OUTPUT", "TRUNCATED", "MODEL_REFUSED", "MODEL_BAD_REQUEST",
  "MODEL_AUTH", "MODEL_QUOTA", "MODEL_NOT_FOUND", "UNEXPECTED_STOP", "AGENTS_DISABLED", "AGENTS_CIRCUIT_OPEN",
  "CALL_BUDGET_EXCEEDED", "APPLY_FAILED", "INTERNAL_PRECONDITION"] as const;
export const effortV = literalsV(["low", "medium", "high"] as const);
export const attemptOutcomeV = v.union(
  v.object({ kind: v.literal("output"), output: turnOutputV }),            // 05 §5.3 的判别联合（含私密 rationale）
  v.object({ kind: v.literal("invalid_output"), code: v.string() }),
  v.object({ kind: v.literal("refused"), category: v.union(v.string(), v.null()) }),
  v.object({ kind: v.literal("truncated") }),
  v.object({ kind: v.literal("unexpected_stop"), stopReason: v.string() }),
  v.object({ kind: v.literal("api_error"), status: v.number(), errorType: v.union(v.string(), v.null()),
             retryAfterMs: v.union(v.number(), v.null()) }),
  v.object({ kind: v.literal("transport_timeout") }),
  v.object({ kind: v.literal("transport_error") }),
  v.object({ kind: v.literal("internal_error"), name: v.string() }),
);
```

## 3.11 人工请求

```ts
const requestOptionV = v.object({
  optionKey: v.string(),             // 场景词表，例如 "raise_cap"、"relax_required"、"defer_ok"、"decline"
  effect: literalsV(["share_answer", "edit_constraints", "propose_manually", "decline"] as const),
  params: v.record(v.string(), paramV),   // 只含目标角色可见的值（例如给 finance 的最低上限）
  deepLink: v.optional(v.string()),       // edit_constraints / propose_manually 时打开的界面路径
});

humanRequests: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"),
  targetRoleKey: v.string(),
  kind: literalsV(["tradeoff", "clarify", "blocked"] as const),
  blockingCodes: v.array(v.string()),
  questionKey: v.string(), questionParams: v.record(v.string(), paramV),
  options: v.array(requestOptionV),
  constraintsVersion: v.number(),
  status: literalsV(["open", "answered", "superseded", "cancelled"] as const),
  answer: v.optional(v.object({ optionKey: v.string(), note: v.optional(v.string()) })),
  answeredBy: v.optional(v.id("users")), answeredAt: v.optional(v.number()),
  closedReason: v.optional(v.string()),
  requestedByTurnId: v.optional(v.id("turns")),   // clarify 来源回合
  createdAt: v.number(),
}).index("by_room_and_status", ["roomId", "status"])
  .index("by_runId", ["runId"]),
```

请求文档只返回给目标角色；其他角色只看到事件里的摘要（"Waiting for Finance on a budget tradeoff"）。

## 3.12 事件（只追加，按受众渲染）

```ts
events: defineTable({
  roomId: v.id("rooms"),
  type: eventTypeV,                  // 引擎与场景声明的字面量联合（07 §7.8 的事件目录）
  payload: v.record(v.string(), paramV),   // 写入时按 type 用 Zod 校验；只含受众内每个人都可以看到的数据
  audience: eventAudienceV,
  actor: v.union(
    v.object({ kind: v.literal("user"), userId: v.id("users"), roleKey: v.string() }),
    v.object({ kind: v.literal("agent"), roleKey: v.string(), agentMode: agentModeV }),
    v.object({ kind: v.literal("system") }),
  ),
  refs: v.object({ runId: v.optional(v.id("runs")), proposalId: v.optional(v.id("proposals")),
    constraintsVersion: v.optional(v.number()), executionId: v.optional(v.id("executions")),
    requestId: v.optional(v.id("humanRequests")) }),
  commitTs: v.commitTs(),            // 按提交顺序的全序游标（inputs/04 §1.6）
  createdAt: v.number(),
}).index("by_room_and_commitTs", ["roomId", "commitTs"]),
```

写入只经 `emitEvent(ctx, def, …)`：`def` 来自事件目录，声明该类型允许的受众与 payload schema，emit 时断言受众合法（例如 `budget_cap_changed` 只允许 `roles` 受众且只含有预算可见权的角色）。读取时服务端过滤受众并按查看者渲染成文本，**payload 本身从不返回给客户端**。

## 3.13 用量计数与抽取任务

```ts
usageCounters: defineTable({
  scope: literalsV(["room", "deployment"] as const),
  scopeKey: v.string(),              // roomId 或 "*"
  day: v.string(),                   // UTC "YYYY-MM-DD"；房间累计用 "total"
  shard: v.number(),                 // 房间 0；部署 0–7
  modelCalls: v.number(), inputTokens: v.number(), cacheCreationInputTokens: v.number(),
  cacheReadInputTokens: v.number(), outputTokens: v.number(), thinkingTokens: v.number(),
}).index("by_scope_and_scopeKey_and_day_and_shard", ["scope", "scopeKey", "day", "shard"]),

extractionJobs: defineTable({
  roomId: v.id("rooms"), participantId: v.id("participants"),
  status: literalsV(["queued", "running", "succeeded", "failed"] as const),
  inputText: v.optional(v.string()), // 任务结束即清除
  resultDraft: v.optional(briefDraftV), warnings: v.array(v.string()),
  currentAttemptId: v.optional(v.id("modelCalls")),
  createdAt: v.number(), finishedAt: v.optional(v.number()),
}).index("by_participantId", ["participantId"]),
```

```ts
purgeLog: defineTable({            // 整房间删除的留痕（07 §7.11）；roomId 存字符串，因为房间行已被删除
  roomId: v.string(), purgedAt: v.number(), operatorNote: v.string(),
}),
```
