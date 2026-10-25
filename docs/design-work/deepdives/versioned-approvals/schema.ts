// versioned-approvals/schema.ts — 本专题涉及的表与 validator 片段（设计稿，非可运行代码）。
// 其他字段由 03-schema 汇总；这里只写与版本化审批、约束失效相关的部分。
import { defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

// ---- 共享字面量（与 convex/lib/contract.ts 中的常量各写一份并加编译期断言，F03.13）----
export const ROLES = ["customer", "provider", "finance"] as const;
export const roleV = v.union(v.literal("customer"), v.literal("provider"), v.literal("finance"));

export const APPROVAL_KINDS = ["terms", "budget"] as const;
export const approvalKindV = v.union(v.literal("terms"), v.literal("budget"));

// 场景常量：首个场景（14）。插入提案时快照进 proposal.requiredApprovals。
export const REQUIRED_APPROVALS = [
  { role: "customer", kind: "terms" },
  { role: "provider", kind: "terms" },
  { role: "finance", kind: "budget" },
] as const;

export const decisionV = v.union(v.literal("approve"), v.literal("reject"), v.literal("withdraw"));

export const constraintCauseV = v.union(
  v.literal("budget"),
  v.literal("customer_requirements"),
  v.literal("catalog"),
  v.literal("human_answer"),
  v.literal("approver_set"), // v1 不触发，预留
  v.literal("seed"),
);

export const runEffectV = v.union(
  v.literal("none"),
  v.literal("kept_pending_approval"),
  v.literal("run_superseded"),
);

export const proposalStatusV = v.union(
  v.literal("active"),
  v.literal("superseded"),
  v.literal("executed"),
);

// 指向导致本次 bump 的源记录（判别联合，类型安全，不用字符串 id）
export const constraintSourceRefV = v.union(
  v.object({ kind: v.literal("budgetChange"), id: v.id("budgetChanges") }),
  v.object({ kind: v.literal("briefVersion"), id: v.id("briefVersions") }),
  v.object({ kind: v.literal("catalogItem"), id: v.id("catalogItems") }),
  v.object({ kind: v.literal("humanRequest"), id: v.id("humanRequests") }),
);

// ---- 表 ----
export const versioningTables = {
  // rooms：只列本专题字段
  rooms_versioningFields: {
    constraintsVersion: v.number(), // 建房 0；只由 bumpConstraints 改变（INV-C1）
    proposalVersion: v.number(), // 建房 0；只由 insertProposal 改变（INV-P3）
    currentRunId: v.optional(v.id("runs")),
    currentProposalId: v.optional(v.id("proposals")),
  },

  constraintRevisions: defineTable({
    roomId: v.id("rooms"),
    version: v.number(), // 新版本号 = previousVersion + 1
    previousVersion: v.number(),
    causes: v.array(constraintCauseV), // 非空
    sourceRefs: v.array(constraintSourceRefV),
    actorType: v.union(v.literal("user"), v.literal("system")),
    actorRole: v.optional(roleV),
    actorUserId: v.optional(v.string()), // tokenIdentifier；公共视图不返回
    runEffect: runEffectV,
    supersededRunId: v.optional(v.id("runs")),
    startedRunId: v.optional(v.id("runs")),
    invalidatedDecisionCount: v.number(), // 当前提案上在 previousVersion 下有效的决定数
    createdAt: v.number(),
  }).index("by_roomId_and_version", ["roomId", "version"]),

  proposals_versioningFields: {
    version: v.number(),
    baseProposalVersion: v.optional(v.number()),
    createdAtConstraintsVersion: v.number(), // 来历；isExecutable 不比较它（D7）
    requiredApprovals: v.array(v.object({ role: roleV, kind: approvalKindV })),
    validationAtCreation: v.object({
      constraintsVersion: v.number(),
      ok: v.boolean(),
      reasonCodes: v.array(v.string()), // 06 的枚举；此处简写
    }),
    status: proposalStatusV,
    statusChangedAt: v.number(),
  },

  // approvals：只追加（D2，INV-A2）
  approvals: defineTable({
    roomId: v.id("rooms"),
    proposalId: v.id("proposals"),
    proposalVersion: v.number(), // 冗余，便于时间线
    userId: v.string(), // tokenIdentifier
    role: roleV, // 从 members 派生（INV-A4）
    kind: approvalKindV, // 从 role 派生
    decision: decisionV,
    constraintsVersion: v.number(), // = 写入时 room.constraintsVersion = expectedConstraintsVersion
    seq: v.number(), // (proposalId, userId) 内从 1 递增（INV-A5）
    reasonCode: v.optional(v.string()), // reject 必填，07 定义枚举与可见性
    note: v.optional(v.string()), // 本人私有
    decidedAt: v.number(),
  })
    .index("by_proposalId_and_userId_and_seq", ["proposalId", "userId", "seq"])
    .index("by_proposalId_and_constraintsVersion", ["proposalId", "constraintsVersion"])
    .index("by_roomId", ["roomId"]),

  agentTurns_versioningFields: {
    constraintsVersion: v.number(), // 调度时快照（INV-T2）
  },

  humanRequests_versioningFields: {
    constraintsVersion: v.number(),
    cancelledByRevision: v.optional(v.id("constraintRevisions")),
  },

  // 源表回填：该写入导致 bump 时记下新版本号
  sourceTables_versioningFields: {
    producedConstraintsVersion: v.optional(v.number()),
  },
};

export type Role = Infer<typeof roleV>;
export type ApprovalKind = Infer<typeof approvalKindV>;
export type Decision = Infer<typeof decisionV>;
export type ConstraintCause = Infer<typeof constraintCauseV>;
export type RunEffect = Infer<typeof runEffectV>;
export type ProposalStatus = Infer<typeof proposalStatusV>;

// 编译期断言：字面量数组与 validator 一致
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _roleCheck: Equal<Role, (typeof ROLES)[number]> = true;
const _kindCheck: Equal<ApprovalKind, (typeof APPROVAL_KINDS)[number]> = true;
void _roleCheck;
void _kindCheck;
