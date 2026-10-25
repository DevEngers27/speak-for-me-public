// convex/schema.ts 的片段：只列本专题直接读写的表与字段。
// 其余字段（rooms.goal、runs.round 等）以 03-schema 为准；名称冲突时以 03 为准并回改本文件。
// 约定：金额是安全整数美分（assertCents），日期是 'YYYY-MM-DD' 字符串。
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const roleV = v.union(
  v.literal("customer"),
  v.literal("provider"),
  v.literal("finance"),
);
export const approvalKindV = v.union(v.literal("terms"), v.literal("budget"));
// withdraw = 撤回本人批准但不触发重谈；枚举归 versioned-approvals / 08 统一。
export const decisionV = v.union(v.literal("approve"), v.literal("reject"), v.literal("withdraw"));
export const requiredApprovalV = v.object({ role: roleV, kind: approvalKindV });

// 与 04-state-machines 共用；此处只列本专题会读写的状态。
export const runStatusV = v.union(
  v.literal("negotiating"),
  v.literal("pending_approval"),
  v.literal("needs_input"),
  v.literal("failed"),
  v.literal("superseded"),
  v.literal("confirmed"),
);

// 拒绝理由：固定词表，对他方可见的文本由模板渲染（I8）。自由文本不在 v1。
export const rejectReasonKeyV = v.union(
  v.literal("price_too_high"),
  v.literal("date_too_late"),
  v.literal("scope_mismatch"),
  v.literal("other"),
);

export const executionTables = {
  rooms: defineTable({
    ownerId: v.id("users"),
    status: v.union(v.literal("open"), v.literal("closed")),
    scenarioKey: v.string(),
    constraintsVersion: v.number(), // 只经 bumpConstraints 改变（I3）
    proposalVersion: v.number(),
    currentRunId: v.optional(v.id("runs")),
    currentProposalId: v.optional(v.id("proposals")),
  }),

  members: defineTable({
    roomId: v.id("rooms"),
    userId: v.id("users"), // users 表以 identity.tokenIdentifier 为键（04 §1.7 含义 7）
    role: roleV,
    displayName: v.string(),
    joinedAt: v.number(),
  })
    .index("by_roomId_and_role", ["roomId", "role"])
    .index("by_roomId_and_userId", ["roomId", "userId"]),

  runs: defineTable({
    roomId: v.id("rooms"),
    status: runStatusV,
    constraintsVersionAtStart: v.number(),
    nextTurnSeq: v.number(),
    endedReason: v.optional(v.string()),
  }).index("by_roomId", ["roomId"]),

  proposals: defineTable({
    roomId: v.id("rooms"),
    runId: v.id("runs"),
    version: v.number(),
    itemKeys: v.array(v.string()),
    deferredItemKeys: v.array(v.string()),
    amountCents: v.number(), // 服务端按目录求和，不来自模型
    deliveryDate: v.string(),
    // 来历字段：插入时的 room.constraintsVersion。不参与可执行性判定（RA-R11：约束变化后仍合规的提案保留，
    // 对同一 proposalId 在新版本上重新审批即可执行；与 versioned-approvals D7 一致）。
    createdAtConstraintsVersion: v.number(),
    requiredApprovals: v.array(requiredApprovalV), // 插入时从场景常量快照（D3）
    // 唯一可变字段：status（I1）
    status: v.union(
      v.literal("active"),
      v.literal("superseded"),
      v.literal("executed"),
    ),
  }).index("by_roomId_and_version", ["roomId", "version"]),

  // 只追加（D2）。"当前决定" = 每个 (proposalId, userId) seq 最大的一行。
  approvals: defineTable({
    roomId: v.id("rooms"),
    proposalId: v.id("proposals"),
    runId: v.id("runs"),
    userId: v.id("users"),
    role: roleV, // 从 members 读出的快照，不接受客户端传入
    kind: approvalKindV, // 由 proposal.requiredApprovals 按 role 查出
    decision: decisionV,
    seq: v.number(), // 每 (proposalId, userId) 从 1 连续递增，跨约束版本不重置
    constraintsVersion: v.number(), // 写入时 room.constraintsVersion（= 客户端 expectedConstraintsVersion）
    reasonKey: v.optional(rejectReasonKeyV),
    decidedAt: v.number(),
  })
    .index("by_proposalId_and_userId_and_seq", ["proposalId", "userId", "seq"])
    .index("by_proposalId", ["proposalId"])
    .index("by_roomId", ["roomId"]),

  budgets: defineTable({
    roomId: v.id("rooms"),
    totalBudgetCents: v.number(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_roomId", ["roomId"]),

  // 已承诺金额的唯一真相源（D7）。只有 seed 与 executeIfComplete 写入；不 patch、不 delete。
  commitments: defineTable({
    roomId: v.id("rooms"),
    kind: v.union(v.literal("baseline"), v.literal("change_order")),
    executionId: v.optional(v.id("executions")), // kind === 'change_order' 时必有
    operationId: v.optional(v.string()),
    amountCents: v.number(),
    simulated: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_roomId", ["roomId"])
    .index("by_operationId", ["operationId"]),

  // 引擎的幂等锚点与审计记录（D8）。by_operationId 逻辑唯一，只由 executeIfComplete 写。
  executions: defineTable({
    roomId: v.id("rooms"),
    runId: v.id("runs"),
    proposalId: v.id("proposals"),
    proposalVersion: v.number(),
    constraintsVersion: v.number(), // 执行时 room.constraintsVersion（= 全部 approvalIds 的版本）
    operationId: v.string(), // exec:${proposalId}（每个提案至多执行一次，I5）
    approvalIds: v.array(v.id("approvals")), // 与 requiredApprovals 一一对应
    executedBy: v.id("users"), // 提交最后一张 approve 的人
    scenarioKey: v.string(),
    planVersion: v.string(),
    amountCents: v.number(),
    // 执行时快照，仅供展示，不参与任何计算；披露按 07（provider 不可见）。
    committedBeforeCents: v.number(),
    committedAfterCents: v.number(),
    totalBudgetCents: v.number(),
    executedAt: v.number(),
  })
    .index("by_operationId", ["operationId"])
    .index("by_proposalId", ["proposalId"])
    .index("by_roomId", ["roomId"]),

  changeOrders: defineTable({
    roomId: v.id("rooms"),
    executionId: v.id("executions"),
    proposalId: v.id("proposals"),
    approvedItemKeys: v.array(v.string()),
    deferredItemKeys: v.array(v.string()),
    amountCents: v.number(),
    deliveryDate: v.string(),
    termsKey: v.string(), // `${sortedKeys}|${cents}|${date}`，可读的条款指纹
    simulated: v.boolean(), // 目录任一条目 simulated 则为 true（核心 8）
    createdAt: v.number(),
  })
    .index("by_executionId", ["executionId"])
    .index("by_roomId", ["roomId"]),

  tasks: defineTable({
    roomId: v.id("rooms"),
    executionId: v.id("executions"),
    itemKey: v.string(),
    title: v.string(),
    assigneeRole: roleV,
    dueDate: v.string(),
    status: v.union(v.literal("todo"), v.literal("done")),
    createdAt: v.number(),
  })
    .index("by_executionId", ["executionId"])
    .index("by_roomId", ["roomId"]),
};
