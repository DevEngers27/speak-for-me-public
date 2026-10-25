# 03 Convex schema v1（part3）：提案、签核、执行、任务

## 3.13 `proposals`（条款不可变）

```ts
const proposalAuthorV = v.union(
  v.object({ kind: v.literal("agent"), seatId: v.id("seats"), roleKey: v.string(),
             agentMode: v.union(v.literal("live"), v.literal("stub")) }),
  v.object({ kind: v.literal("human"), seatId: v.id("seats"), roleKey: v.string(),
             userId: v.id("users"),
             via: v.union(v.literal("request_answer"), v.literal("direct")),
             requestId: v.optional(v.id("humanRequests")) }),
);

proposals: defineTable({
  roomId: v.id("rooms"),
  version: v.number(),                       // rooms.proposalSeq + 1（I-12）
  runId: v.optional(v.id("runs")),
  turnId: v.optional(v.id("turns")),
  author: proposalAuthorV,
  candidateKey: v.string(),                  // 例如 "LOGIN+REPORTS@standard"
  selection: P.selection,
  terms: P.terms,                            // 含引擎标准字段 refs
  termsKey: v.string(),                      // canonicalKey(terms)
  constraintsVersion: v.number(),            // 创建时的约束版本
  requiredSignoffs: v.array(v.object({
    seatId: v.id("seats"), roleKey: v.string(), kind: v.string(),
  })),                                       // 创建时由 RoleSpec.signoff 快照
  creationChecks: v.array(v.object({         // 只存 checkId 与通过码，不存 params（params 可能含私密数值）
    checkId: v.string(), reasonCode: v.string(),
  })),
  previousProposalId: v.optional(v.id("proposals")), // 用于结构化差异
  status: v.union(v.literal("active"), v.literal("superseded"), v.literal("executed")),
  supersededAt: v.optional(v.number()),
  supersededByProposalId: v.optional(v.id("proposals")),
  isSimulated: v.boolean(),
  createdAt: v.number(),
})
  .index("by_room_version", ["roomId", "version"])
  .index("by_room_status", ["roomId", "status"])
  .index("by_run", ["runId"]),
```

- 只经 `convex/engine/proposals.ts#insertProposal` 插入（I-11～I-14）：分配版本、重算全部检查、置旧当前提案 `superseded`、patch `rooms.currentProposalId`、写 `proposal_created` 事件，同一事务。
- "blocked / executable" 不是字段（I-10）。`creationChecks` 全为 pass（I-14），供审计。
- 不用内容哈希：Convex 运行时 `crypto.subtle` 在 mutation 中是否可用待验证；提案不可变 + 签核绑定 `proposalId` 已证明"批准的就是这份条款"，`termsKey` 作为可读的规范化证据复制进签核与执行记录。

## 3.14 `decisions`（只追加）

```ts
decisions: defineTable({
  roomId: v.id("rooms"),
  proposalId: v.id("proposals"),
  proposalVersion: v.number(),
  constraintsVersion: v.number(),            // 记录时的房间约束版本
  termsKey: v.string(),                      // 记录时提案的 termsKey 副本
  seatId: v.id("seats"),
  roleKey: v.string(),                       // 从席位读取，不接受客户端传入
  userId: v.id("users"),
  signoffKind: v.string(),                   // 来自提案 requiredSignoffs 快照，例如 "terms" | "budget"
  kind: v.union(v.literal("approve"), v.literal("reject"), v.literal("withdraw")),
  reasonCode: v.optional(v.string()),        // reject 必填，场景枚举
  note: v.optional(v.string()),              // 仅本席位与本方代理可见
  via: v.union(v.literal("direct"), v.literal("request_answer")),
  createdAt: v.number(),
})
  .index("by_proposal_seat", ["proposalId", "seatId"])
  .index("by_room", ["roomId"]),
```

- 当前签核状态由 `engine/signoff.ts#signoffStates(proposal, roomConstraintsVersion, decisions)` 派生：

| 该席位最新一条决定 | 约束版本 = 当前 | 状态 |
| --- | --- | --- |
| 无 | — | `pending` |
| approve | 是 | `approved` |
| reject | 是 | `rejected` |
| withdraw | 是 | `pending` |
| approve | 否 | `stale_approve` |
| reject | 否 | `stale_reject` |

- 完成判定读取 `by_proposal_seat` 上 `proposalId` 前缀的**整个区间**（不是逐席位点查），使并发插入落在读集内而触发 OCC（X4，待在真实部署验证）。
- 解决：两表合一（RA-D12）、拒绝必须留痕（product-12）、删除历史（RA-B06）、旧拒绝显示为 pending（RA-B30）。

## 3.15 `executions`（场景称"变更单"）

```ts
executions: defineTable({
  roomId: v.id("rooms"),
  number: v.number(),                        // rooms.executionSeq + 1，显示为 "CO-1"
  operationKey: v.string(),                  // "exec:" + proposalId + ":" + constraintsVersion
  proposalId: v.id("proposals"),
  proposalVersion: v.number(),
  constraintsVersion: v.number(),            // 执行时（递增前）的约束版本
  termsKey: v.string(),
  terms: P.terms,                            // 冻结副本，变更单内容
  decisionIds: v.array(v.id("decisions")),   // 计入完成判定的那些 approve
  amountCents: v.number(),                   // records.commitmentCents(terms)
  ledgerBeforeCents: v.number(),
  ledgerAfterCents: v.number(),
  snapshot: v.array(v.object({               // records.snapshotFields 的冻结值，读时按披露投影
    roleKey: v.string(), fieldKey: v.string(),
    value: v.union(v.number(), v.string(), v.array(v.string())),
  })),
  recordsVersion: v.string(),                // `${scenarioKey}@${scenarioVersion}`，派生规则版本
  triggeredByUserId: v.id("users"),          // 完成最后一个签核的人
  executedAt: v.number(),
  isSimulated: v.boolean(),
})
  .index("by_operation", ["operationKey"])
  .index("by_proposal", ["proposalId"])
  .index("by_room", ["roomId"]),
```

- 与"变更单"一一对应，不再单设 `changeOrders` 表（两者无独立生命周期，合并更简单；18 ADR-15）。
- 结果页的"执行前 / 后"直接读快照，不用减法推算（RA-B09）。

## 3.16 `tasks`

```ts
tasks: defineTable({
  roomId: v.id("rooms"),
  executionId: v.id("executions"),
  ordinal: v.number(),                       // 执行内顺序
  itemKey: v.optional(v.string()),
  title: v.string(),                         // 公开信息（范围项标题），派生时生成
  assigneeSeatId: v.id("seats"),
  dueDate: v.string(),
  status: v.union(v.literal("todo"), v.literal("in_progress"), v.literal("done")),
  statusChangedAt: v.number(),
  statusChangedByUserId: v.optional(v.id("users")),
  createdAt: v.number(),
})
  .index("by_room", ["roomId"])
  .index("by_execution", ["executionId"])
  .index("by_assignee_status", ["assigneeSeatId", "status"]),
```

- 只由执行事务插入（I-36）；派生规则 `plugin.records.tasks(terms, view)` 与 `recordsVersion` 一并记录，审批界面预先展示"将创建的任务"（RA-B19）。
- 状态可在 todo / in_progress / done 之间切换（只被指派席位），每次写 `task_updated` 事件。任务取消属于"变更单修订"，v1 不支持（17）。
