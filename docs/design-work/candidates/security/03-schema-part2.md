# 03 Convex schema v1（part2：run、回合、代理笔记、模型调用、提案、决定、人工请求）

## 3.5 协商运行

```ts
runs: defineTable({                                   // R
  roomId: v.id("rooms"),
  seq: v.number(),                                    // 每房间从 1 递增
  trigger: v.union(v.literal("initial"), v.literal("constraints_changed"), v.literal("renegotiation")),
  status: runStatusV,                                 // 04 §4.3
  phase: v.union(v.literal("idle"), v.literal("proposing"), v.literal("reviewing")),  // 仅 running 时有意义
  constraintsVersion: v.number(),                     // 创建时的 cv，永不改变
  round: v.number(),                                  // 0 = 尚未开始第一轮
  maxRounds: v.number(),                              // 场景配置，默认 3
  nextProposerRoleKey: v.optional(v.string()),
  callCount: v.number(),                              // 已消耗的模型调用（含失败尝试）
  maxCalls: v.number(),                               // 默认 12
  outcome: v.optional(runOutcomeV),
  agentMode: v.union(v.literal("live"), v.literal("stub")),
  startedBy: v.union(v.object({ kind: v.literal("system") }),
    v.object({ kind: v.literal("participant"), participantId: v.id("participants") })),
  createdAt: v.number(),
  endedAt: v.optional(v.number()),
}).index("by_room_seq", ["roomId", "seq"]),

export const runOutcomeV = v.union(
  v.literal("EXECUTED"), v.literal("NO_FEASIBLE_OPTION"), v.literal("ROUNDS_EXHAUSTED"),
  v.literal("CALL_CAP_REACHED"), v.literal("AGENTS_DISABLED"), v.literal("TURN_FAILED"),
  v.literal("SUPERSEDED_BY_CONSTRAINTS"), v.literal("SUPERSEDED_BY_RENEGOTIATION"), v.literal("ROOM_CLOSED"));
```

## 3.6 代理回合、候选、笔记与模型调用

```ts
export const candidateV = v.object({                  // 场景联合；首场景如下
  candidateId: v.string(),                            // 本回合内的短 id："C1"…"C12"
  itemKeys: v.array(v.string()),                      // 升序
  deliveryOption: v.union(v.literal("standard"), v.literal("rush")),
});

agentTurns: defineTable({                             // S（X3 只投影 roleKey/kind/status）
  roomId: v.id("rooms"),
  runId: v.id("runs"),
  round: v.number(),
  roleKey: v.string(),
  kind: v.union(v.literal("propose"), v.literal("review")),
  attempt: v.number(),                                // 1 或 2
  status: v.union(v.literal("scheduled"), v.literal("running"), v.literal("succeeded"),
    v.literal("rejected_stale"), v.literal("failed")),
  constraintsVersion: v.number(),                     // = run.constraintsVersion
  subjectProposalId: v.optional(v.id("proposals")),   // review 回合审的提案
  inputBriefVersionId: v.optional(v.id("briefVersions")),     // beginTurn 时写入
  inputCatalogVersionId: v.optional(v.id("catalogVersions")),
  candidates: v.optional(v.array(candidateV)),        // beginTurn 时由本角色视图枚举并冻结
  contextDigest: v.optional(v.string()),              // action 内计算的上下文 SHA-256，只作审计
  action: v.optional(agentActionV),
  chosenCandidateId: v.optional(v.string()),
  resultProposalId: v.optional(v.id("proposals")),
  errorCode: v.optional(turnErrorV),
  runFnId: v.optional(v.id("_scheduled_functions")),     // 尽力取消用
  watchdogFnId: v.optional(v.id("_scheduled_functions")),
  agentMode: v.union(v.literal("live"), v.literal("stub")),
  createdAt: v.number(),
  startedAt: v.optional(v.number()),
  finishedAt: v.optional(v.number()),
}).index("by_run_round", ["runId", "round"]),

export const agentActionV = v.union(v.literal("propose"), v.literal("counter"),
  v.literal("recommend_accept"), v.literal("reject"));
export const turnErrorV = v.union(
  v.literal("MODEL_HTTP_400"), v.literal("MODEL_HTTP_429"), v.literal("MODEL_HTTP_5XX"),
  v.literal("MODEL_TIMEOUT"), v.literal("MODEL_NETWORK"), v.literal("STOP_MAX_TOKENS"),
  v.literal("STOP_REFUSAL"), v.literal("STOP_OTHER"), v.literal("OUTPUT_NOT_JSON"),
  v.literal("OUTPUT_SCHEMA"), v.literal("OUTPUT_SEMANTIC"), v.literal("WATCHDOG_TIMEOUT"),
  v.literal("AGENTS_DISABLED"), v.literal("CONFIG_ERROR"));

agentNotes: defineTable({                             // P（只给被服务的参与方）
  roomId: v.id("rooms"),
  participantId: v.id("participants"),
  runId: v.id("runs"),
  turnId: v.id("agentTurns"),
  action: agentActionV,
  chosenCandidate: v.optional(candidateV),
  rejectReasonCode: v.optional(v.string()),
  clarifyRequest: v.optional(v.object({ roleKey: v.string(), fieldKey: v.string() })),
  rationale: v.string(),                              // ≤ 1200，超出截断；纯文本渲染
  isSimulated: v.boolean(),                           // stub 回合为 true
  createdAt: v.number(),
}).index("by_participant", ["participantId"]),

modelCalls: defineTable({                             // S（运维指标）
  roomId: v.optional(v.id("rooms")),
  site: v.union(v.literal("negotiate_turn"), v.literal("extract_brief")),
  turnId: v.optional(v.id("agentTurns")),
  requestedModel: v.string(),
  model: v.optional(v.string()),                      // 响应中的实际模型（开启回退时可能不同）
  effort: v.string(),
  stopReason: v.optional(v.string()),
  httpStatus: v.optional(v.number()),
  errorCode: v.optional(turnErrorV),
  requestId: v.optional(v.string()),
  latencyMs: v.number(),
  usage: v.optional(v.object({
    inputTokens: v.number(), cacheCreationInputTokens: v.number(), cacheReadInputTokens: v.number(),
    outputTokens: v.number(), thinkingTokens: v.number() })),
  isSimulated: v.boolean(),
  createdAt: v.number(),
}).index("by_room", ["roomId"]).index("by_site", ["site"]),
```

- 一行 `agentTurns` = 一次尝试。重试插入 `attempt + 1` 的新行，旧行保持 `failed`，历史完整。
- `candidates` 冻结在回合上：`completeTurn` 只按 `chosenCandidateId` 在这份冻结列表里查找，不重新枚举（避免 begin 与 complete 之间软信息变化导致映射漂移）。
- 不存 prompt 与模型原文；`contextDigest` 只证明"用的是同一上下文"，不保存内容。

## 3.7 提案

```ts
export const scopeTermsV = v.object({                 // 场景联合成员
  kind: v.literal("scope_change.terms"),
  itemKeys: v.array(v.string()),                      // 升序
  deferredItemKeys: v.array(v.string()),              // customer 请求范围 − itemKeys，升序
  deliveryOption: v.union(v.literal("standard"), v.literal("rush")),
  deliveryDate: v.string(),                           // 由目录计算
  lines: v.array(v.object({ itemKey: v.string(), priceCents: v.number() })),
  fees: v.array(v.object({ code: v.literal("rush_fee"), priceCents: v.number() })),
});

proposals: defineTable({                              // R，不可变
  roomId: v.id("rooms"),
  runId: v.optional(v.id("runs")),
  version: v.number(),                                // rooms.proposalSeq + 1
  terms: termsV,                                      // 场景联合
  priceCents: v.number(),                             // Σ lines + Σ fees，由 deriveTerms 计算
  termsKey: v.string(),                               // 规范化字符串，见下
  catalogVersionId: v.id("catalogVersions"),          // 定价来源
  constraintsVersionAtCreation: v.number(),
  author: v.union(
    v.object({ kind: v.literal("agent"), roleKey: v.string(), turnId: v.id("agentTurns"),
               mode: v.union(v.literal("live"), v.literal("stub")) }),
    v.object({ kind: v.literal("human"), participantId: v.id("participants"),
               requestId: v.id("humanRequests") })),  // 人在取舍请求中选中某个候选
  derivedFromProposalId: v.optional(v.id("proposals")),   // counter 所针对的提案
  requiredApproverRoleKeys: v.array(v.string()),      // 场景策略快照
  rulesVersion: v.string(),                           // 如 "scope_change@1"
  isSimulated: v.boolean(),
  createdAt: v.number(),
}).index("by_room_version", ["roomId", "version"]).index("by_run", ["runId"]),
```

`termsKey = ${itemKeys.join("+")}|defer:${deferredItemKeys.join("+")}|${deliveryOption}|${deliveryDate}|${priceCents}|cat${catalogVersion}`，例：`LOGIN+REPORTS|defer:EXPORT|rush|2026-11-13|90000|cat1`（规则里的来源核对用不含延后项的 `pricingKey`，06 §6.3）。它不是安全机制（提案不可变 + 决定绑定 proposalId 已足够），而是给人看、写进变更单的可读证据。提案上不存 `status`、不存检查结果（02 §2.7）。

## 3.8 决定

```ts
decisions: defineTable({                              // R，只追加
  roomId: v.id("rooms"),
  proposalId: v.id("proposals"),
  constraintsVersion: v.number(),                     // 决定时的 cv（= 调用者传入的期望值）
  participantId: v.id("participants"),
  roleKey: v.string(),                                // 从席位读出的快照
  userId: v.id("users"),
  kind: v.union(v.literal("approve"), v.literal("reject"), v.literal("withdraw")),
  reasonCode: v.optional(v.string()),                 // 场景声明的公开拒绝理由词表
  note: v.optional(v.string()),                       // ≤ 500，房间可见，只进本方代理
  createdAt: v.number(),
}).index("by_proposal_cv_participant", ["proposalId", "constraintsVersion", "participantId"])
  .index("by_room", ["roomId"]),
```

当前决定：`by_proposal_cv_participant` 取该前缀下 `_creationTime` 最大的一行（索引自动以 `_creationTime` 收尾，`.order("desc").first()`）。同一人重复点击产生两行同样的 approve，集合判定按席位去重，不影响结果。

## 3.9 人工请求

```ts
export const requestOptionV = v.union(
  v.object({ optionKey: v.string(), kind: v.literal("adopt_candidate"), candidate: candidateV }),
  v.object({ optionKey: v.string(), kind: v.literal("amend_brief"), patch: briefHardPatchV }),
  v.object({ optionKey: v.string(), kind: v.literal("revise_catalog") }),
  v.object({ optionKey: v.string(), kind: v.literal("disclose_field"),
             fieldKey: v.string(), audience: v.array(v.string()) }),
  v.object({ optionKey: v.string(), kind: v.literal("decline") }));
// briefHardPatchV（场景联合），首场景：
//   { kind: "scope_change.customer.patch", dropRequiredItemKeys?: string[], deadline?: string }
//   { kind: "scope_change.finance.patch", capCents: number }

humanRequests: defineTable({                          // P（目标人）；X4 投影存在性
  roomId: v.id("rooms"),
  runId: v.id("runs"),
  targetParticipantId: v.id("participants"),
  targetRoleKey: v.string(),
  kind: v.union(v.literal("tradeoff"), v.literal("disclosure")),
  publicReason: v.union(v.literal("NO_FEASIBLE_OPTION"), v.literal("ROUNDS_EXHAUSTED"),
    v.literal("DISCLOSURE_ASKED")),
  constraintsVersion: v.number(),                     // 取舍请求据此失效；披露请求只作记录
  options: v.array(requestOptionV),                   // 由代码生成；每个选项只含目标人有权看到的值
  status: v.union(v.literal("open"), v.literal("answered"), v.literal("cancelled"), v.literal("expired")),
  askedByRoleKey: v.optional(v.string()),             // disclosure：哪个角色的代理请求披露
  answer: v.optional(v.object({ optionKey: v.string(), note: v.optional(v.string()) })),
  answeredByUserId: v.optional(v.id("users")),
  expiresAt: v.optional(v.number()),                  // disclosure 请求 7 天过期
  createdAt: v.number(),
  closedAt: v.optional(v.number()),
}).index("by_target_status", ["targetParticipantId", "status"])
  .index("by_room_status", ["roomId", "status"])
  .index("by_run", ["runId"]),
```

`amend_brief` 选项被选中时，`requests.answer` 以 `origin: "request_answer"` 写入新的简报版本（补丁应用在当前版本上），然后按 09 的统一流程递增 cv。`raise_cap` 的金额只出现在 finance 的请求里（07 §7.9）。
