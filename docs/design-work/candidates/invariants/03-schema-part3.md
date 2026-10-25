# 03 Convex schema v1 · part3：执行产物、事件、用量、唯一性与不变量落点

> 约定见 part1 §1。

## 16. executions（只追加，即变更单）

```ts
executions: defineTable({
  roomId: v.id("rooms"), runId: v.id("runs"), proposalId: v.id("proposals"),
  constraintsVersion: v.number(),            // 全部审批所绑定的约束版本
  resultingConstraintsVersion: v.number(),   // 本次执行产生的新约束版本（台账变化，CS-3）
  operationKey: v.string(),                  // `exec:${proposalId}:${constraintsVersion}`（EX-1）
  number: v.number(),                        // ++rooms.executionSeq，渲染为 "CO-0003"
  recordKind: v.literal("change_order"),     // 场景声明的记录名
  decisionIds: v.array(v.id("decisions")),   // 计数的那几条 approve
  amountCents: v.number(),
  budgetSnapshot: v.object({ capCents: v.number(), committedBeforeCents: v.number(),
                             committedAfterCents: v.number() }),   // 只按派生闭包投影
  scenarioVersion: v.number(),               // 任务模板版本
  executedByUserId: v.id("users"),           // 投下最后一票的人
  isSimulated: v.boolean(), executedAt: v.number(),
})
  .index("by_operationKey", ["operationKey"])
  .index("by_proposalId", ["proposalId"])
  .index("by_roomId_and_number", ["roomId", "number"]),
```

## 17. commitments（只追加，金额台账）

```ts
commitments: defineTable({
  roomId: v.id("rooms"), executionId: v.id("executions"),
  amountCents: v.number(), isSimulated: v.boolean(), createdAt: v.number(),
})
  .index("by_roomId", ["roomId"])
  .index("by_executionId", ["executionId"]),
```
台账只记录本系统执行产生的承诺；系统外已存在的承诺（原文 $4,000）是 finance 简报的 `externalCommittedCents`，由 finance 确认并随版本保留来源（GAP-16）。CS-4 把二者连起来。

## 18. tasks

```ts
tasks: defineTable({
  roomId: v.id("rooms"), executionId: v.id("executions"),
  itemKey: v.string(), title: v.string(),           // 来自报价行的 taskTitle
  assigneeRoleKey: v.string(),                       // 场景模板决定（scope_change：provider）
  dueDate: v.string(),                               // = 提案 deliveryDate
  status: v.union(v.literal("todo"), v.literal("in_progress"), v.literal("done")),
  isSimulated: v.boolean(), createdAt: v.number(),
  updatedByUserId: v.optional(v.id("users")), updatedAt: v.number(),
})
  .index("by_roomId", ["roomId"])
  .index("by_executionId", ["executionId"]),
```

## 19. events（只追加）

```ts
export const eventAudienceV = v.union(
  v.object({ kind: v.literal("room") }),
  v.object({ kind: v.literal("participant"), participantId: v.id("participants") }),
);
events: defineTable({
  roomId: v.id("rooms"), seq: v.number(),            // ++rooms.eventSeq（EV-1）
  audience: eventAudienceV,
  audienceKey: v.string(),                           // "room" 或 participantId；由 emitEvent 计算，仅用于索引
  actor: actorV,
  refs: v.object({
    runId: v.optional(v.id("runs")), proposalId: v.optional(v.id("proposals")),
    constraintsVersion: v.optional(v.number()), executionId: v.optional(v.id("executions")),
    requestId: v.optional(v.id("humanRequests")), turnId: v.optional(v.id("agentTurns")),
    briefVersionId: v.optional(v.id("briefVersions")),
  }),
  payload: eventPayloadV,                            // 以 payload.type 判别的联合
  isSimulated: v.boolean(),
  createdAt: v.number(),
})
  .index("by_roomId_and_seq", ["roomId", "seq"])
  .index("by_roomId_and_audienceKey_and_seq", ["roomId", "audienceKey", "seq"]),
```

事件类型与受众约束（`EVENT_SPECS`，EV-3：payload validator 里根本没有不该出现的字段）：

| type | 受众 | payload（全部字段） |
| --- | --- | --- |
| `room_created` / `room_renamed` / `room_closed` | room | title?、goal? |
| `participant_joined` | room | roleKey、displayName |
| `invite_created` / `invite_revoked` | participant（房主） | roleKey、expiresAt |
| `brief_confirmed` | room | roleKey、versionNo、ruleChanged: boolean、categories: ("scope" \| "schedule" \| "offer" \| "budget")[] |
| `brief_confirmed_detail` | participant（本人） | versionNo、ruleFieldsChanged、disclosureChanges |
| `budget_changed_detail` | participant（finance） | oldCapCents、newCapCents、oldExternalCents、newExternalCents、reason? |
| `constraints_changed` | room | fromVersion、toVersion、causeKind、roleKey?、categories、sharedReason?（仅当 changeReasonShared） |
| `run_started` / `run_status_changed` | room | runNo、trigger / from、to、endReason? |
| `agent_move` | room | runNo、round、roleKey、action、proposalVersion?、reasonCodes?、changes?（itemKey 级） |
| `turn_failed` / `turn_rejected_stale` | room | runNo、roleKey、attempt、errorCategory（`timeout` / `invalid_output` / `provider_error` / `disabled`） |
| `proposal_created` | room | version、authorKind、roleKey、verdict、reasonCodes、amountCents、deliveryDate、includedItemKeys、deferredItemKeys |
| `reapproval_required` | room | proposalVersion、fromVersion、toVersion |
| `decision_recorded` | room | proposalVersion、constraintsVersion、roleKey、approvalKind、kind、reasonCode?、publicNote? |
| `request_opened` | participant（目标） | requestId、kind、questionCode |
| `request_waiting` / `request_closed` | room | targetRoleKey、kind、status |
| `execution_completed` | room | number、proposalVersion、amountCents、taskCount |
| `execution_budget_detail` | participant（finance） | committedBeforeCents、committedAfterCents、capCents |
| `task_updated` | room | taskId、from、to |

`amountCents` 可以进房间事件：报价行价格在被提案引用时公开，provider 在确认简报时已显式确认（BR-4b）。已承诺总额、上限、余量只出现在 finance 受众的 detail 事件中（customer 若获得披露，在工作台投影里看到，不靠事件）。

## 20. modelCalls（只追加）

```ts
modelCalls: defineTable({
  roomId: v.id("rooms"), participantId: v.id("participants"), roleKey: v.string(),
  purpose: v.union(v.literal("turn"), v.literal("extraction")),
  turnId: v.optional(v.id("agentTurns")),
  requestedModel: v.string(), model: v.string(),      // 实际产出消息的模型（开启回退时可能不同）
  effort: v.string(), maxTokens: v.number(),
  inputTokens: v.number(), cacheCreationInputTokens: v.number(), cacheReadInputTokens: v.number(),
  outputTokens: v.number(), thinkingTokens: v.number(),
  stopReason: v.optional(v.string()), requestId: v.optional(v.string()), messageId: v.optional(v.string()),
  outcome: v.union(v.literal("ok"), v.literal("schema_invalid"), v.literal("refused"),
    v.literal("truncated"), v.literal("http_error"), v.literal("timeout"), v.literal("aborted")),
  errorCode: v.optional(v.string()),
  latencyMs: v.number(),
  estimatedCostMicroUsd: v.number(), priceTableVersion: v.string(),   // 估算，界面标注 "estimate"
  createdAt: v.number(),
})
  .index("by_roomId", ["roomId"])
  .index("by_turnId", ["turnId"]),
```
不存 prompt、简报或模型原文（07 §8）。stub 回合不写 modelCalls。

## 21. 唯一性落点表（Convex 没有唯一约束，inputs/04 §1.6）

| 逻辑唯一键 | 索引 | 唯一写入口（先查后写） | 不变量 |
| --- | --- | --- | --- |
| users.tokenIdentifier | by_tokenIdentifier | `users.ensure` | ID-2 |
| (roomId, roleKey) 参与方 | by_roomId_and_roleKey | `rooms.create`、`invites.accept`、`ops.seed*`（复用同一 helper `addParticipant`） | ID-3 |
| (roomId, userId) 参与方 | by_roomId_and_userId | `addParticipant` | ID-4 |
| invite tokenHash | by_tokenHash | `invites.insertHashed` | ID-6 |
| (roomId, roleKey) open 邀请 | by_roomId_and_roleKey | `invites.insertHashed`（旧行改 revoked） | ID-6 |
| participant 草稿 | by_participantId | `briefs.saveDraft` | — |
| (participantId, versionNo) | by_participantId_and_versionNo | `commitBriefVersion` | BR-1 |
| (roomId, version) 约束集 | by_roomId_and_version | `bumpConstraints` | CS-1 |
| (roomId, runNo) | by_roomId_and_runNo | `startRun` | RN-1 |
| 房间非终态 run | rooms.currentRunId | `startRun` / `transitionRun` | RN-1 |
| (roomId, version) 提案 | by_roomId_and_version | `insertProposal` | PR-2 |
| 连续相同决定 | by_proposalId_and_constraintsVersion_and_participantId_and_roomSeq | `decisions.record` | DE-5 |
| 每提案一次执行 | by_proposalId（executions） | `executeIfReady` | EX-1 |
| operationKey | by_operationKey | `executeIfReady` | EX-1 |
| execution ↔ commitment | by_executionId（commitments） | `executeIfReady` | EX-4 |
| (roomId, seq) 事件 | by_roomId_and_seq | `emitEvent` | EV-1 |

所有入口都在同一房间内 patch `rooms`（M-ROOM），因此"先查后写"在 OCC 下串行；`users.ensure` 不涉及房间，依赖 OCC 对 `by_tokenIdentifier` 区间读的冲突检测（待验证 #2；万一失败，后果是重复 users 行，`ops.auditUsers` 会发现并合并，不影响房间不变量，因为参与方按 userId 去重且由同一请求创建）。

## 22. 不变量落点总表（表 → 不变量）

| 表 | 不变量 |
| --- | --- |
| users | ID-1、ID-2 |
| rooms | M-ROOM、CS-1、RN-1、RN-5、PR-2、PR-4、EV-1、VAL-3 |
| participants | ID-3、ID-4、ID-5、BR-1 |
| invites | ID-6 |
| briefDrafts | BR-2（永不被规则读取） |
| briefVersions | BR-1、BR-3、BR-4、BR-5、CS-3 |
| constraintSets | CS-1、CS-2、CS-4 |
| runs | RN-1、RN-2、RN-3、CS-5、HR-4 |
| agentTurns | RN-3、RN-4、EV-4 |
| proposals | PR-1–PR-7、SIM-1 |
| decisions | DE-1–DE-5 |
| humanRequests | HR-1–HR-4、CS-6 |
| executions / commitments / tasks | EX-1–EX-5、CS-4 |
| events | EV-1–EV-3 |
| modelCalls | 用量真实性（核心 8） |

## 23. schema 演进

- 新字段先 `v.optional` 推送，再用 internal mutation 分批回填，最后收紧（inputs/04 §1.6 的 staged 索引用于大表新索引）。
- 场景版本升级不改已存在房间：房间固定 `scenarioVersion`，旧版本规则与模板保留在场景模块中，直到没有房间引用。
- 只追加表永不做破坏性迁移；若必须修正历史数据，追加一条修正记录并写事件，而不是改旧行。
