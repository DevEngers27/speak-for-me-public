# 03 Convex schema v1 · part1：表定义

> part1 = 完整 `convex/schema.ts`；part2 = 场景内容 validator、唯一性落点、不变量落点、演进规则。
> 约定：`v` 只管存储形状；金额/日期/长度等规则由代码校验（inputs/04 §1.8）。角色在引擎表中是 `v.string()`，由 `assertRole(scenario, role)` 在入口校验（ADR-07）。表名在前的新 db API：`ctx.db.get("rooms", id)`。

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { briefContentV } from "./scenarios/registry.validators"; // 判别联合，见 part2

const cents = v.number();        // assertCents(): 安全整数, 0..100_000_000
const isoDate = v.string();      // "YYYY-MM-DD"，assertIsoDate()
const role = v.string();         // assertRole(scenario, role)

export const runStatusV = v.union(
  v.literal("negotiating"), v.literal("pending_approval"), v.literal("needs_input"),
  v.literal("failed"), v.literal("executed"), v.literal("superseded"),
);
export const runTriggerV = v.union(
  v.literal("briefs_ready"), v.literal("constraint_change"), v.literal("manual"),
);
export const turnStatusV = v.union(
  v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("stale"),
);
export const reasonCodeV = v.string(); // 场景注册的 reasonCode，入口校验（06 §3）

export default defineSchema({
  rooms: defineTable({
    scenarioKey: v.string(),            // "scope_change"
    scenarioVersion: v.number(),        // 插件版本快照（规则演进时可追溯）
    title: v.string(),                  // ≤ 120 字符，代码校验
    goal: v.string(),                   // 公共目标，≤ 500 字符；修改 goal 不是约束变化（v1 不可改）
    timeZone: v.string(),               // IANA，例 "America/Los_Angeles"，"今天"按它算
    createdBy: v.string(),              // tokenIdentifier
    constraintsVersion: v.number(),     // 从 0 开始，只经 applyBriefVersion 递增
    proposalSeq: v.number(),            // 已分配的最大提案版本
    runSeq: v.number(),                 // 已分配的最大 run 序号
    currentRunId: v.optional(v.id("runs")),
    simulated: v.boolean(),             // seed 房间 = true，界面整页徽章
  }).index("by_createdBy", ["createdBy"]),

  seats: defineTable({
    roomId: v.id("rooms"),
    role,
    userId: v.optional(v.string()),     // tokenIdentifier；未认领时缺省
    displayName: v.optional(v.string()),// 认领时快照
    inviteHash: v.optional(v.string()), // SHA-256(token) hex；认领后删除
    inviteExpiresAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
  })
    .index("by_room_role", ["roomId", "role"])
    .index("by_room_user", ["roomId", "userId"])
    .index("by_user", ["userId"])
    .index("by_inviteHash", ["inviteHash"]),

  briefs: defineTable({                 // 只追加：每行是一份已确认版本
    roomId: v.id("rooms"),
    role,
    version: v.number(),                // 该角色内 1,2,3…
    constraintsVersion: v.number(),     // 本版本确认后的房间约束版本
    content: briefContentV,             // 判别联合：{ kind: "scope_change.customer", ... }
    disclosed: v.array(v.string()),     // 本人勾选披露的字段键（场景白名单内）
    notes: v.string(),                  // 私密自由文本，只给本人与本人代理；≤ 2000 字符
    reason: v.optional(v.string()),     // 变更原因（非首版必填），只给本人可见；公开侧用 reasonCode
    changeCode: v.optional(v.string()), // 公开的变更类别，如 "BUDGET_REVISED"（场景词表）
    confirmedBy: v.string(),            // tokenIdentifier（或 "system:seed"）
    viaRequestId: v.optional(v.id("humanRequests")),
    simulated: v.boolean(),
  }).index("by_room_role_version", ["roomId", "role", "version"])
    .index("by_room_cv", ["roomId", "constraintsVersion"]),

  runs: defineTable({
    roomId: v.id("rooms"),
    seq: v.number(),
    trigger: runTriggerV,
    constraintsVersion: v.number(),     // 开始时的约束版本（终生不变）
    status: runStatusV,
    round: v.number(),                  // 1..maxRounds
    maxRounds: v.number(),              // 场景配置快照，首个场景 3
    activeTurnId: v.optional(v.id("agentTurns")), // 唯一在途回合；守卫用
    currentProposalId: v.optional(v.id("proposals")),
    startedBy: v.string(),              // tokenIdentifier 或 "system"
    endedReason: v.optional(v.union(
      v.literal("executed"), v.literal("constraints_changed"), v.literal("manual_restart"),
    )),
    endedAt: v.optional(v.number()),
  }).index("by_room_seq", ["roomId", "seq"]),

  agentTurns: defineTable({
    roomId: v.id("rooms"),
    runId: v.id("runs"),
    round: v.number(),
    role,                               // 本回合为谁服务（provider/customer/finance）
    attempt: v.number(),                // 1..MAX_ATTEMPTS(3)
    proposalId: v.optional(v.id("proposals")), // 评估回合所评估的提案
    status: turnStatusV,
    mode: v.union(v.literal("model"), v.literal("stub")),
    output: v.optional(v.any()),        // 已通过 Zod 校验的 AgentOutput（含私有 rationale）；写入前校验
    resultProposalId: v.optional(v.id("proposals")),
    errorCode: v.optional(v.string()),  // INVALID_OUTPUT | MAX_TOKENS | REFUSAL | TIMEOUT | API_ERROR | BAD_REQUEST | AGENTS_DISABLED
    model: v.optional(v.string()),      // msg.model（实际产出模型）
    effort: v.optional(v.string()),
    stopReason: v.optional(v.string()),
    requestId: v.optional(v.string()),  // msg._request_id
    usage: v.optional(v.object({
      inputTokens: v.number(), cacheCreationInputTokens: v.number(),
      cacheReadInputTokens: v.number(), outputTokens: v.number(),
      thinkingTokens: v.number(),
    })),
    latencyMs: v.optional(v.number()),
    lateResult: v.optional(v.boolean()),// 看门狗判超时后才到达的结果，只补记用量
    finishedAt: v.optional(v.number()),
  }).index("by_run", ["runId"])
    .index("by_room", ["roomId"]),

  proposals: defineTable({              // 只追加，无 status
    roomId: v.id("rooms"),
    runId: v.id("runs"),
    turnId: v.optional(v.id("agentTurns")),
    version: v.number(),                // rooms.proposalSeq + 1
    round: v.number(),
    authorRole: role,                   // 场景 proposerRole（provider）
    authorKind: v.union(v.literal("agent"), v.literal("stub"), v.literal("human_selection")),
    itemKeys: v.array(v.string()),      // 排序去重后
    deferredItemKeys: v.array(v.string()), // 代码计算：customer 想要但未选
    lines: v.array(v.object({ itemKey: v.string(), title: v.string(), priceCents: cents })),
    amountCents: cents,                 // Σ lines.priceCents
    deliveryDate: isoDate,              // max(earliestDeliveryDate)
    constraintsVersion: v.number(),
    sourceBriefVersions: v.record(v.string(), v.number()), // { customer: 2, provider: 1, finance: 3 }
    requiredApproverRoles: v.array(role),                 // 场景 approverRoles 快照
    validation: v.object({ reasonCodes: v.array(reasonCodeV) }), // 写入时快照，仅审计
    simulated: v.boolean(),
  }).index("by_room_version", ["roomId", "version"])
    .index("by_run", ["runId"]),

  approvals: defineTable({              // 只追加
    roomId: v.id("rooms"),
    proposalId: v.id("proposals"),
    seatId: v.id("seats"),
    role,                               // 从 seat 读，不接受客户端
    userId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    reasonCode: v.optional(v.string()), // reject 必填，场景词表；公开
    constraintsVersion: v.number(),     // 冗余快照，插入时断言 = proposal.constraintsVersion
  }).index("by_proposal", ["proposalId"])
    .index("by_room", ["roomId"]),

  humanRequests: defineTable({
    roomId: v.id("rooms"),
    runId: v.id("runs"),
    targetRole: role,
    kind: v.union(v.literal("tradeoff"), v.literal("clarify"), v.literal("choose")),
    reasonCodes: v.array(reasonCodeV),  // 为什么要人来定（公开）
    questionKey: v.string(),            // 模板键；问题文本读时渲染
    clarifyText: v.optional(v.string()),// 仅 clarify：本方代理的问题原文，只给 targetRole（= 代理的委托人）
    options: v.array(v.object({
      key: v.string(),
      effect: v.union(
        v.object({ type: v.literal("patch_brief"), role, patch: v.any() }), // patch 由场景 validator 校验
        v.object({ type: v.literal("select_proposal"), proposalId: v.id("proposals") }),
        v.object({ type: v.literal("continue") }),
      ),
    })),
    constraintsVersion: v.number(),
    answer: v.optional(v.object({ optionKey: v.string(), userId: v.string(), at: v.number() })),
  }).index("by_run", ["runId"])
    .index("by_room_target", ["roomId", "targetRole"]),

  changeOrders: defineTable({           // 只追加；proposalId 即幂等键
    roomId: v.id("rooms"),
    runId: v.id("runs"),
    proposalId: v.id("proposals"),
    proposalVersion: v.number(),
    constraintsVersion: v.number(),
    itemKeys: v.array(v.string()),
    deferredItemKeys: v.array(v.string()),
    lines: v.array(v.object({ itemKey: v.string(), title: v.string(), priceCents: cents })),
    amountCents: cents,
    deliveryDate: isoDate,
    approvalIds: v.array(v.id("approvals")), // 触发执行的那组最新 approve（审计）
    commitment: v.object({              // 内嵌预算承诺快照（买方可见，见 07）
      amountCents: cents,
      committedBeforeCents: cents,
      committedAfterCents: cents,
      totalBudgetCents: cents,
    }),
    simulated: v.boolean(),
  }).index("by_proposal", ["proposalId"])
    .index("by_room", ["roomId"]),

  tasks: defineTable({
    roomId: v.id("rooms"),
    changeOrderId: v.id("changeOrders"),
    itemKey: v.string(),
    title: v.string(),
    assigneeRole: role,
    dueDate: isoDate,
    doneAt: v.optional(v.number()),
    doneBy: v.optional(v.string()),
  }).index("by_changeOrder", ["changeOrderId"])
    .index("by_room", ["roomId"]),
});
```

## 字段说明的几个要点

- `agentTurns.output` 用 `v.any()` 是唯一的宽松字段：它存的是**已经过 Zod `AgentOutput` 校验**的对象（05 §4），Convex 侧无须重复表达判别联合；读取只经 `turns` 投影给本角色。
- `humanRequests.options[].effect.patch` 同理：写入前由场景 `briefPatchSchema[role]` 校验；应用时再按完整内容 validator 校验（防止旧补丁套到新版本上失效）。
- 没有 `updatedAt` 类热点字段（OCC 放大，inputs/04 §1.3）。时间一律用 `_creationTime`（展示用，不作排序真相）。
- `rooms.constraintsVersion` 初始 0；三方首版简报确认后为 3（每次确认 +1），然后自动开始第一个 run。
