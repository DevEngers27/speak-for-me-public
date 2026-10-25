# 03 Convex schema v1（part2）：简报、目录、约束版本、提案、决定、执行

> 分片清单见 part1。场景字段的业务含义见 14；这里给出存储形状。

## 3.4 简报

### briefDrafts —— 可变草稿，仅本人可读写

```ts
briefDrafts: defineTable({
  roomId: v.id("rooms"),
  participantId: v.id("participants"),
  roleKey: v.string(),
  draft: briefDraftV,                // 场景草稿联合：各字段 optional，允许不完整
  privateNotes: v.string(),
  disclosures: v.array(v.object({ fieldKey: v.string(), audience: audienceV })),
  updatedAt: v.number(),
}).index("by_participantId", ["participantId"]),
```

### briefVersions —— 确认后不可变

```ts
briefVersions: defineTable({
  roomId: v.id("rooms"),
  participantId: v.id("participants"),
  roleKey: v.string(),
  version: v.number(),               // 该参与者的第 n 个确认版本，从 1 开始
  fields: briefFieldsV,              // 场景联合，完整且已通过场景 Zod 校验
  privateNotes: v.string(),          // ≤ 2,000 字符；仅本人与本方代理可见
  disclosures: v.array(v.object({ fieldKey: v.string(), audience: audienceV })),  // 逐字段显式披露决定
  delegationTermsVersion: v.string(),// 确认时展示的委托条款版本（07 §7.6），例如 "deleg.v1"
  ruleKey: v.string(),               // 规则相关字段的规范串；与上一版本不同才递增约束版本
  changeNote: v.optional(v.string()),// 例如预算调整原因；受众同本人
  confirmedBy: v.id("users"),
  confirmedAt: v.number(),
  isSimulated: v.boolean(),
}).index("by_participantId_and_version", ["participantId", "version"])
  .index("by_room_and_roleKey_and_version", ["roomId", "roleKey", "version"]),
```

首个场景的 `briefFieldsV`（`schemaKey` 作判别字段）：

```ts
const customerFieldsV = v.object({
  schemaKey: v.literal("scope_change.customer.v1"),
  requestedItems: v.array(v.object({ itemKey: v.string(), title: v.string() })),  // 请求的范围；披露固定为 room（provider 要据此报价）
  requiredItemKeys: v.array(v.string()),   // 硬约束：⊆ requestedItems；默认披露 room，可改为 private
  importantItemKeys: v.array(v.string()),  // 软偏好；默认 private
  deadline: v.string(),                    // 硬约束：最晚交付日；默认 private
  preferredDate: v.optional(v.string()),   // 软偏好：不使审批失效；默认 private
});
const providerFieldsV = v.object({
  schemaKey: v.literal("scope_change.provider.v1"),
  preferredDeliveryMode: literalsV(["standard", "rush", "either"] as const),   // 软偏好
});
const financeFieldsV = v.object({
  schemaKey: v.literal("scope_change.finance.v1"),
  budgetCapCents: v.number(),        // 硬约束；assertCents
});
export const briefFieldsV = v.union(customerFieldsV, providerFieldsV, financeFieldsV);
```

`ruleKey` 由场景函数 `briefRuleKey(fields)` 生成：customer = requestedItems 的 itemKey（排序）+ requiredItemKeys（排序）+ deadline；finance = budgetCapCents；provider = 空串。`importantItemKeys`、`preferredDate`、`preferredDeliveryMode`、私密备注、披露变化都不改变 ruleKey（F09.1【改写】：软约束不使旧审批失效）。

## 3.5 目录（供给方已确认的条目）

```ts
const itemAttrsV = v.object({
  kind: v.literal("item"),
  title: v.string(),                 // ≤ 80 字符；进入所有代理上下文（不可信文本，07 §7.10）
  description: v.optional(v.string()),     // ≤ 300 字符
  priceCents: v.number(),
  standardDeliveryDate: v.string(),
  rushDeliveryDate: v.optional(v.string()),// 缺省表示不可加急
  taskTitle: v.string(),             // 执行后派生任务的标题模板结果
});
const termAttrsV = v.object({
  kind: v.literal("term"),
  termKey: v.literal("RUSH"),        // v1 只有加急费一种条款
  title: v.string(),
  feeCents: v.number(),
});

catalogItems: defineTable({
  roomId: v.id("rooms"),
  itemKey: v.string(),               // /^[A-Z][A-Z0-9_]{1,23}$/，房间内稳定
  version: v.number(),               // 同一 itemKey 的第 n 个版本
  status: literalsV(["confirmed", "withdrawn"] as const),
  attributes: v.union(itemAttrsV, termAttrsV),
  ownerRoleKey: v.string(),          // 场景声明的目录所有者角色（provider）
  confirmedBy: v.id("users"),
  confirmedAt: v.number(),
  origin: literalsV(["manual", "fixture"] as const),
  isSimulated: v.boolean(),
}).index("by_room_and_itemKey_and_version", ["roomId", "itemKey", "version"])
  .index("by_room", ["roomId"]),
```

确认即对全房间披露（ADR-20）：provider 确认时界面明示"确认后条目与价格对房间所有参与者可见"。改价 = 插入新版本；撤回 = 插入 `status: "withdrawn"` 的新版本。两者都递增约束版本（09 §9.3）。

## 3.6 约束版本快照

```ts
constraintVersions: defineTable({
  roomId: v.id("rooms"),
  version: v.number(),
  cause: v.union(
    v.object({ kind: v.literal("room_created") }),
    v.object({ kind: v.literal("brief_confirmed"), roleKey: v.string(), briefVersionId: v.id("briefVersions") }),
    v.object({ kind: v.literal("catalog_changed"), itemKey: v.string(), catalogItemId: v.id("catalogItems") }),
    v.object({ kind: v.literal("baseline_recorded"), commitmentId: v.id("commitments") }),
    v.object({ kind: v.literal("execution_recorded"), executionId: v.id("executions") }),
  ),
  actorUserId: v.optional(v.id("users")),
  briefVersionIds: v.array(v.object({ roleKey: v.string(), briefVersionId: v.id("briefVersions") })),
  catalogItemIds: v.array(v.id("catalogItems")),   // 本版本下有效的条目版本（每个 itemKey 的最新版本且为 confirmed）
  scenarioState: v.object({ kind: v.literal("scope_change.v1"),
    committedCents: v.number(), baselineRecorded: v.boolean(),
    executedItemKeys: v.array(v.string()) }),     // 本房间已执行变更单中批准过的条目（修订时不再重复承诺）
  createdAt: v.number(),
}).index("by_room_and_version", ["roomId", "version"]),
```

这张表让"在约束 vN 下的评估"永远可复现：`RuleInput(vN)` 完全由这一行的指针决定（09 §9.2）。表中含 finance 的数值（committedCents），因此**只被服务端读取**，从不出现在任何 public 查询的返回值里。

## 3.7 提案（不可变）

```ts
const scopeTermsV = v.object({
  kind: v.literal("scope_change.v1"),
  itemKeys: v.array(v.string()),            // 排序
  deferredItemKeys: v.array(v.string()),    // = (requested − executedItemKeys) − itemKeys，排序
  deliveryMode: literalsV(["standard", "rush"] as const),
  deliveryDate: v.string(),
  termKeys: v.array(v.string()),            // rush 时为 ["RUSH"]
  amountCents: v.number(),                  // 代码按目录求和
  catalogItemIds: v.array(v.id("catalogItems")),   // 来源：具体条目版本
});

proposals: defineTable({
  roomId: v.id("rooms"),
  version: v.number(),               // 房间内单调，从 1 开始
  runId: v.optional(v.id("runs")),
  turnId: v.optional(v.id("turns")),
  authorKind: literalsV(["agent", "human", "rule", "fixture"] as const),
  authorRoleKey: v.string(),
  authorUserId: v.optional(v.id("users")),  // human 时必填
  agentMode: v.optional(agentModeV),        // agent 时必填
  candidateKey: v.string(),
  terms: scopeTermsV,                       // 场景联合（v1 只有一种）
  termsKey: v.string(),                     // terms 的规范串，审批绑定与视图校验用
  createdUnderConstraintsVersion: v.number(),
  checksAtCreation: v.array(checkV),        // 审计快照，只有结果码
  requiredApprovals: v.array(v.object({ roleKey: v.string(), approvalKind: approvalKindV })),
  derivedFromProposalId: v.optional(v.id("proposals")),
  isSimulated: v.boolean(),
  createdAt: v.number(),
}).index("by_room_and_version", ["roomId", "version"])
  .index("by_runId", ["runId"]),
```

没有 status 字段：current / superseded / executed 与 executable 全部派生（04 §4.6）。

## 3.8 审批决定（只追加）

```ts
decisions: defineTable({
  roomId: v.id("rooms"),
  proposalId: v.id("proposals"),
  participantId: v.id("participants"),
  userId: v.id("users"),
  roleKey: v.string(),
  approvalKind: approvalKindV,       // 取自提案快照，不接受客户端传入
  decision: literalsV(["approve", "reject", "withdraw"] as const),
  constraintsVersion: v.number(),    // 决定时房间的约束版本
  termsKey: v.string(),              // 决定时看到的条款（与提案相同，作冗余证据）
  reasonCode: v.optional(v.string()),// reject 必填，取自场景拒绝理由词表
  reasonNote: v.optional(v.string()),// ≤ 500 字符
  reasonNoteAudience: v.optional(literalsV(["private", "room"] as const)),  // 本人显式选择
  createdAt: v.number(),
}).index("by_proposal_and_participant", ["proposalId", "participantId"])
  .index("by_proposal_and_constraintsVersion", ["proposalId", "constraintsVersion"])
  .index("by_room", ["roomId"]),
```

## 3.9 执行与场景记录

```ts
executions: defineTable({
  roomId: v.id("rooms"), proposalId: v.id("proposals"), runId: v.id("runs"),
  constraintsVersion: v.number(),
  operationKey: v.string(),          // `exec:${proposalId}:${constraintsVersion}`，服务端派生
  decisionIds: v.array(v.id("decisions")),
  triggeredByUserId: v.id("users"),  // 投出最后一票的人
  derivationVersion: v.string(),     // 场景派生规则版本，如 "scope_change.exec.v1"
  executedAt: v.number(),
}).index("by_operationKey", ["operationKey"])
  .index("by_proposalId", ["proposalId"])
  .index("by_room", ["roomId"]),

commitments: defineTable({          // 场景表：预算台账
  roomId: v.id("rooms"),
  kind: literalsV(["baseline", "execution"] as const),
  amountCents: v.number(),
  executionId: v.optional(v.id("executions")),
  recordedBy: v.id("users"),
  note: v.optional(v.string()),
  isSimulated: v.boolean(),
  createdAt: v.number(),
}).index("by_room", ["roomId"]).index("by_executionId", ["executionId"]),

changeOrders: defineTable({         // 场景表：执行的主记录（冻结条款与预算影响快照）
  roomId: v.id("rooms"), executionId: v.id("executions"), proposalId: v.id("proposals"),
  proposalVersion: v.number(), constraintsVersion: v.number(),
  approvedItemKeys: v.array(v.string()), deferredItemKeys: v.array(v.string()),
  deliveryMode: literalsV(["standard", "rush"] as const), deliveryDate: v.string(),
  amountCents: v.number(),
  committedBeforeCents: v.number(), committedAfterCents: v.number(), capCentsAtExecution: v.number(),  // 仅买方投影可见
  catalogItemIds: v.array(v.id("catalogItems")),
  isSimulated: v.boolean(), createdAt: v.number(),
}).index("by_room", ["roomId"]).index("by_executionId", ["executionId"]),

tasks: defineTable({                // 场景表：唯一允许 patch status 的执行产物
  roomId: v.id("rooms"), executionId: v.id("executions"), changeOrderId: v.id("changeOrders"),
  itemKey: v.string(), title: v.string(), assigneeRoleKey: v.string(), dueDate: v.string(),
  status: literalsV(["todo", "in_progress", "done"] as const),
  createdAt: v.number(), updatedAt: v.number(),
}).index("by_room", ["roomId"]).index("by_executionId", ["executionId"]),
```

`tasks.status` 是运营状态而非历史：每次修改同事务写 `task_status_changed` 事件，历史在事件里保留。变更单把"执行前 / 后已承诺额与上限"冻结下来，结果页直接读快照，不再用减法推算（RA-B09）。
