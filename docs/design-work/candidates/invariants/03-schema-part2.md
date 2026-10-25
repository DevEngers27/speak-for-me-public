# 03 Convex schema v1 · part2：runs、agentTurns、proposals、decisions、humanRequests

> 约定见 part1 §1。

## 10. 公共片段

```ts
export const actorV = v.union(
  v.object({ kind: v.literal("user"), userId: v.id("users"), roleKey: v.optional(v.string()) }),
  v.object({ kind: v.literal("agent"), roleKey: v.string(), turnId: v.id("agentTurns") }),
  v.object({ kind: v.literal("system") }),
);
export const lineRefV = v.object({ itemKey: v.string(), variantKey: v.string() });
export const checkResultV = v.object({          // 只存结论，不存数值参数；参数读取时按投影重算
  checkId: v.string(),
  status: v.union(v.literal("pass"), v.literal("fail"), v.literal("info")),
  reasonCode: v.string(),
});
```

## 11. runs

```ts
export const runFeedbackV = v.union(
  v.object({ kind: v.literal("human_reject"), fromRunId: v.id("runs"), roleKey: v.string(),
             reasonCode: v.string(), publicNote: v.optional(v.string()) }),
  v.object({ kind: v.literal("renegotiation"), fromRunId: v.id("runs"), roleKey: v.string(),
             reasonCode: v.string() }),
  v.object({ kind: v.literal("constraint_change"), fromRunId: v.id("runs"),
             fromVersion: v.number(), toVersion: v.number(), categories: v.array(v.string()) }),
);

runs: defineTable({
  roomId: v.id("rooms"), runNo: v.number(),
  trigger: v.union(v.literal("initial"), v.literal("manual"), v.literal("constraint_change"),
                   v.literal("human_reject"), v.literal("renegotiation")),
  status: runStatusV,
  endReason: v.optional(v.union(v.literal("constraints_changed"), v.literal("rejected_by_human"),
    v.literal("renegotiation_requested"), v.literal("all_declined"), v.literal("room_closed"))),
  constraintsVersion: v.number(),          // 开始时的约束版本；CS-5 保证非终态时等于房间当前值
  agentMode: v.union(v.literal("llm"), v.literal("stub")),
  maxRounds: v.number(), round: v.number(),
  step: v.union(v.literal("propose"), v.literal("evaluate"), v.literal("idle")),
  pendingTurnIds: v.array(v.id("agentTurns")),   // 当前步骤尚未完成的回合（RN-3）
  clarifyUsedBy: v.array(v.string()),            // 本 run 已用过 clarify 的角色（每角色 1 次）
  lastValidProposalId: v.optional(v.id("proposals")),
  failedTurnId: v.optional(v.id("agentTurns")),
  feedback: v.optional(runFeedbackV),
  previousRunId: v.optional(v.id("runs")),
  startedBy: actorV,
  createdAt: v.number(), endedAt: v.optional(v.number()),
}).index("by_roomId_and_runNo", ["roomId", "runNo"]),
```
承载 RN-1（与 `rooms.currentRunId` 配对）、RN-2（status 唯一写者 `transitionRun`）、RN-3（pendingTurnIds）、CS-5。`runNo = ++rooms.runSeq`。

## 12. agentTurns（每次尝试一行）

```ts
agentTurns: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"),
  round: v.number(), step: v.union(v.literal("propose"), v.literal("evaluate")),
  roleKey: v.string(), attempt: v.number(),          // 同 (runId, round, step, roleKey) 的第几次尝试
  status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("invalid_output"),
                  v.literal("failed"), v.literal("stale"), v.literal("cancelled")),
  constraintsVersion: v.number(),                    // 信封快照：调度时的房间约束版本
  subjectProposalId: v.optional(v.id("proposals")), // evaluate 步骤评估的提案
  agentMode: v.union(v.literal("llm"), v.literal("stub")),
  output: v.optional(agentOutputV),                  // 通过 Zod 与业务校验后的输出，含 rationale（仅本角色可见）
  resultProposalId: v.optional(v.id("proposals")),
  modelCallId: v.optional(v.id("modelCalls")),
  errorCode: v.optional(v.string()),                 // TIMEOUT / REFUSAL / TRUNCATED / SCHEMA_INVALID / UNKNOWN_LINE / HTTP_4XX / HTTP_5XX / AGENTS_DISABLED / CALL_BUDGET_EXHAUSTED
  scheduledFnId: v.optional(v.id("_scheduled_functions")),   // 系统表 id 能否作 v.id 目标：待验证，否则存 string
  watchdogFnId: v.optional(v.id("_scheduled_functions")),
  isSimulated: v.boolean(),
  startedAt: v.number(), deadlineAt: v.number(), finishedAt: v.optional(v.number()),
})
  .index("by_runId", ["runId"])
  .index("by_roomId_and_roleKey", ["roomId", "roleKey"]),
```

场景代理输出的存储形（与 05 的 Zod 一一对应，Zod 是模型侧、这里是存储侧）：

```ts
export const scAgentOutputV = v.union(
  v.object({ action: v.literal("propose"), lines: v.array(lineRefV),
             deliveryDate: v.string(), rationale: v.string() }),
  v.object({ action: v.literal("counter"),
             changes: v.object({ include: v.array(v.string()), exclude: v.array(v.string()),
                                 preferLines: v.array(lineRefV) }),
             reasonCodes: v.array(v.string()), rationale: v.string() }),
  v.object({ action: v.literal("recommend_accept"), rationale: v.string() }),
  v.object({ action: v.literal("reject"), reasonCode: v.string(), rationale: v.string() }),
  v.object({ action: v.literal("clarify"), targetRole: v.string(),
             question: v.object({ code: v.string(), itemKey: v.optional(v.string()) }),
             rationale: v.string() }),
);
export const agentOutputV = scAgentOutputV;   // 引擎侧别名；第二场景时改为联合
```
承载 RN-3、RN-4（watchdogFnId）、EV-4（rationale 只在此）。

## 13. proposals（只追加）

```ts
export const scTermsV = v.object({
  scenario: v.literal("scope_change"),
  lines: v.array(v.object({ itemKey: v.string(), variantKey: v.string(), label: v.string(),
                            priceCents: v.number(), earliestDeliveryDate: v.string(),
                            taskTitle: v.string() })),           // 从 provider 确认版本复制
  includedItemKeys: v.array(v.string()),
  deferredItemKeys: v.array(v.string()),                         // = requested − included（代码算）
  amountCents: v.number(),                                       // = Σ lines.priceCents（代码算）
  deliveryDate: v.string(),
  source: v.object({ providerBriefVersionId: v.id("briefVersions"),
                     customerBriefVersionId: v.id("briefVersions") }),
});
export const termsV = scTermsV;

proposals: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"),
  version: v.number(),                               // ++rooms.proposalSeq（PR-2）
  constraintsVersion: v.number(), constraintSetId: v.id("constraintSets"),
  author: v.union(
    v.object({ kind: v.literal("agent"), roleKey: v.string(), turnId: v.id("agentTurns"),
               agentMode: v.union(v.literal("llm"), v.literal("stub")) }),
    v.object({ kind: v.literal("human_choice"), roleKey: v.string(), userId: v.id("users"),
               requestId: v.id("humanRequests") }),
  ),
  derivedFromProposalId: v.optional(v.id("proposals")),    // 还价时指向被还价的提案
  terms: termsV,
  contentKey: v.string(),        // 规范化条款串："SSO_LOGIN:std@50000|USAGE_REPORTS:full@40000|90000|2026-11-20|-CSV_EXPORT"
  requiredApproverRoles: v.array(v.string()),               // 快照（PR-6）
  approvalKinds: v.array(v.object({ roleKey: v.string(),
                  kind: v.union(v.literal("terms"), v.literal("budget")) })),
  creationChecks: v.array(checkResultV),
  creationVerdict: v.union(v.literal("pass"), v.literal("blocked")),
  isSimulated: v.boolean(),
  createdAt: v.number(),
})
  .index("by_roomId_and_version", ["roomId", "version"])
  .index("by_runId", ["runId"]),
```
没有 `status`、`blocked`、`publicSummary` 字段：状态派生（02 part3 §5）；公开摘要读取时由模板渲染（07 §6）。没有内容哈希：不可变 + 绑定 proposalId 已足够（02 part3 §3）。承载 PR-1–PR-7。

## 14. decisions（只追加）

```ts
decisions: defineTable({
  roomId: v.id("rooms"), proposalId: v.id("proposals"), constraintsVersion: v.number(),
  participantId: v.id("participants"), userId: v.id("users"), roleKey: v.string(),
  approvalKind: v.union(v.literal("terms"), v.literal("budget")),   // 来自提案快照
  kind: v.union(v.literal("approve"), v.literal("reject"), v.literal("withdraw")),
  reasonCode: v.optional(v.string()),         // reject 必填，取场景枚举
  note: v.optional(v.string()),               // ≤ 500 字符
  notePublic: v.boolean(),                    // 作者显式选择是否让房间看到 note
  roomSeq: v.number(),                        // 对应 decision_recorded 事件的 seq，房间内全序
  createdAt: v.number(),
})
  .index("by_proposalId_and_constraintsVersion_and_participantId_and_roomSeq",
         ["proposalId", "constraintsVersion", "participantId", "roomSeq"])
  .index("by_proposalId", ["proposalId"])
  .index("by_roomId", ["roomId"]),
```
"最新决定" = 前一个索引 `eq(proposalId).eq(cv).eq(participantId)` 后 `.order("desc").first()`。用 roomSeq 而非 `_creationTime` 排序，避免墙钟与提交顺序不一致（inputs/04 §1.6）。承载 DE-1–DE-5。

## 15. humanRequests

```ts
export const scRequestOptionV = v.union(
  v.object({ key: v.string(), effect: v.literal("make_optional"), itemKeys: v.array(v.string()) }),
  v.object({ key: v.string(), effect: v.literal("relax_deadline_to_fit"),
             proposalId: v.id("proposals"), toDate: v.string() }),
  v.object({ key: v.string(), effect: v.literal("raise_cap_to_fit"),
             proposalId: v.id("proposals"), toCents: v.number() }),
  v.object({ key: v.string(), effect: v.literal("revise_offer"), itemKeys: v.array(v.string()) }),
  v.object({ key: v.string(), effect: v.literal("choose_package"),
             lines: v.array(lineRefV), deliveryDate: v.string() }),
  v.object({ key: v.string(), effect: v.literal("disclose"), field: v.string(), audience: audienceV }),
  v.object({ key: v.string(), effect: v.literal("decline") }),
);

humanRequests: defineTable({
  roomId: v.id("rooms"), runId: v.optional(v.id("runs")),
  constraintsVersion: v.number(),
  targetParticipantId: v.id("participants"), targetRoleKey: v.string(),
  kind: v.union(v.literal("tradeoff"), v.literal("disclosure"), v.literal("choose_package")),
  blocking: v.boolean(),                     // true 时它让 run 停在 awaiting_input（HR-4）
  groupKey: v.string(),                      // 同一次触发打开的一组请求共享
  cause: v.array(v.string()),                // 触发的 reasonCode，例如 ["OVER_BUDGET"]
  question: v.object({ code: v.string(), itemKey: v.optional(v.string()),
                       askerRoleKey: v.optional(v.string()) }),   // 由模板渲染为文本（HR-1）
  options: v.array(scRequestOptionV),
  status: v.union(v.literal("open"), v.literal("answered"), v.literal("declined"),
                  v.literal("cancelled")),
  answer: v.optional(v.object({ optionKey: v.string() })),
  answeredByUserId: v.optional(v.id("users")),
  askedByTurnId: v.optional(v.id("agentTurns")),   // disclosure 请求来自哪个 clarify 回合
  createdAt: v.number(), closedAt: v.optional(v.number()),
})
  .index("by_roomId_and_status", ["roomId", "status"])
  .index("by_targetParticipantId_and_status", ["targetParticipantId", "status"])
  .index("by_runId_and_status", ["runId", "status"]),
```
承载 HR-1–HR-4、CS-6。选项 effect 的语义与可见性见 05 §6 与 09 §5；数值参数只来自公开提案（HR-3）。
