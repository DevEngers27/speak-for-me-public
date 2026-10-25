# 03 Convex schema v1（第 1/2 部分：身份、房间、简报、目录、预算）

约定：所有金额 `v.number()` 存安全整数美分，写入口 `assertCents`；日期 `v.string()` 存 `YYYY-MM-DD`，写入口 `assertIsoDate`；`roleKey` 用 `v.string()`，写入口按场景 `roles` 校验。索引名包含全部字段。Convex 没有唯一约束，"唯一"列写明单一写入口（inputs/04 §1.6）。

```ts
// convex/schema.ts（节选一）
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const audience = v.union(
  v.object({ kind: v.literal("room") }),
  v.object({ kind: v.literal("roles"), roles: v.array(v.string()) }),
);

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),        // identity.tokenIdentifier
    displayName: v.string(),
    createdAt: v.number(),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  rooms: defineTable({
    ownerId: v.id("users"),
    title: v.string(),
    goal: v.string(),                   // 公开的共享目标（≤ 500 字符）
    scenarioKey: v.string(),            // "scope_change"
    scenarioVersion: v.number(),
    timeZone: v.string(),               // IANA，例如 "America/Los_Angeles"
    currency: v.literal("USD"),
    status: v.union(v.literal("open"), v.literal("closed")),
    constraintsVersion: v.number(),     // 从 1 起，只经 bumpConstraints
    proposalVersion: v.number(),        // 已分配的最大提案版本
    catalogRevision: v.number(),        // 每次 catalog.confirm +1
    runSeq: v.number(),                 // 已分配的最大 run 序号
    currentRunId: v.optional(v.id("runs")),
    currentProposalId: v.optional(v.id("proposals")),
    isSimulated: v.boolean(),
    fixtureKey: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_ownerId", ["ownerId"]),

  members: defineTable({
    roomId: v.id("rooms"),
    userId: v.id("users"),
    roleKey: v.string(),
    displayName: v.string(),            // 加入时快照
    inviteId: v.optional(v.id("invites")), // owner 自身席位为空
    joinedAt: v.number(),
  })
    .index("by_roomId_and_roleKey", ["roomId", "roleKey"])
    .index("by_roomId_and_userId", ["roomId", "userId"])
    .index("by_userId", ["userId"]),

  invites: defineTable({
    roomId: v.id("rooms"),
    roleKey: v.string(),
    codeHash: v.string(),               // sha256(code)；明文只返回给 owner 一次
    createdBy: v.id("users"),
    status: v.union(v.literal("open"), v.literal("accepted"), v.literal("revoked")),
    acceptedBy: v.optional(v.id("users")),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_codeHash", ["codeHash"])
    .index("by_roomId_and_roleKey", ["roomId", "roleKey"]),

  briefs: defineTable({
    roomId: v.id("rooms"),
    roleKey: v.string(),
    userId: v.id("users"),
    version: v.number(),                // 每 (room, role) 单调
    status: v.union(v.literal("draft"), v.literal("confirmed"), v.literal("superseded")),
    content: v.any(),                   // 由场景 briefSchema(roleKey) 校验（Zod，写入口）
    disclosures: v.array(v.object({ field: v.string(), audience })),
    hardHash: v.string(),               // 硬约束字段的规范化哈希，决定是否 bump
    confirmedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_roomId_and_roleKey_and_status", ["roomId", "roleKey", "status"])
    .index("by_roomId_and_roleKey_and_version", ["roomId", "roleKey", "version"]),

  catalogItems: defineTable({
    roomId: v.id("rooms"),
    itemKey: v.string(),                // 房间内稳定键，/^[A-Z][A-Z0-9_]{1,23}$/
    revision: v.number(),               // 每 itemKey 单调
    kind: v.union(v.literal("scope"), v.literal("fee")),
    title: v.string(),                  // ≤ 80 字符，清洗后存储（07 §5）
    priceCents: v.number(),
    standardLeadDays: v.optional(v.number()), // scope 必填
    rushLeadDays: v.optional(v.number()),     // scope 可选；缺省表示该条目不可加急
    feeRule: v.optional(v.literal("rush_delivery")), // fee 必填
    taskTitle: v.optional(v.string()),  // 任务模板；缺省用 title
    status: v.union(v.literal("draft"), v.literal("confirmed"), v.literal("retired")),
    confirmedBy: v.optional(v.id("users")),
    confirmedAt: v.optional(v.number()),
    catalogRevision: v.optional(v.number()), // 确认时的房间级修订号
    isSimulated: v.boolean(),
  })
    .index("by_roomId_and_itemKey_and_revision", ["roomId", "itemKey", "revision"])
    .index("by_roomId_and_status", ["roomId", "status"]),

  budgets: defineTable({
    roomId: v.id("rooms"),
    totalCents: v.number(),
    softHeadroomCents: v.optional(v.number()), // finance 软偏好，不 bump
    updatedBy: v.id("users"),
    updatedAt: v.number(),
    isSimulated: v.boolean(),
  }).index("by_roomId", ["roomId"]),

  budgetChanges: defineTable({
    roomId: v.id("rooms"),
    oldTotalCents: v.number(),
    newTotalCents: v.number(),
    reason: v.string(),                 // finance 私有，≤ 300 字符
    actorUserId: v.id("users"),
    constraintsVersionAfter: v.number(),
    createdAt: v.number(),
  }).index("by_roomId", ["roomId"]),

  commitments: defineTable({
    roomId: v.id("rooms"),
    kind: v.union(v.literal("baseline"), v.literal("change_order")),
    amountCents: v.number(),
    changeOrderId: v.optional(v.id("changeOrders")),
    isSimulated: v.boolean(),
    createdAt: v.number(),
  }).index("by_roomId", ["roomId"]),
  // …续 part2
});
```

## 唯一性与不变量落点（part1 表）

| 逻辑唯一 / 不变量 | 索引 | 唯一写入口 |
| --- | --- | --- |
| 每 tokenIdentifier 一个 user | by_tokenIdentifier | `users.ensureViewer`（internal helper，在每个需要 userId 的 mutation 开头） |
| 每 (roomId, roleKey) 一名成员；每 (roomId, userId) 一个角色（I13） | by_roomId_and_roleKey、by_roomId_and_userId | `invites.accept`、`rooms.create`（owner 席位） |
| 邀请码唯一 | by_codeHash | `invites.create`（32 字节随机码，碰撞重抽） |
| 每 (roomId, roleKey) 至多一个 draft、一个 confirmed | by_roomId_and_roleKey_and_status | `briefs.saveDraft`、`briefs.confirm` |
| 每 (roomId, itemKey) 至多一个 confirmed 修订 | by_roomId_and_itemKey_and_revision | `catalog.confirm`（旧 confirmed → retired 同事务） |
| 每房间一个 budget | by_roomId | `rooms.create`（插入 0 预算）/ `seed`；之后只 `budgets.update` patch |
| 已承诺额 = Σ commitments（I10） | by_roomId | 只 seed 与执行 mutation 插入 |

## 字段说明

- `briefs.content` 用 `v.any()` 是刻意的：引擎不知道场景字段；场景导出 Zod `briefSchemas[roleKey]`，写入口 `parse` 后存储，读出时再 `parse`（防 schema 演进漂移）。备选"每场景一张表"被否决：第二场景要改 schema 与所有投影。
- `hardHash`：场景声明 `hardFields[roleKey]`（customer：`requiredItemKeys/desiredItemKeys/deferrableItemKeys/hardDeadline`；provider：`rushAvailable`），对其规范化 JSON 求哈希。新 confirmed 的 hardHash 与上一 confirmed 不同才 bump（09）。
- `catalogItems` 中 RUSH 是 `kind: "fee"` 的条目，`feeRule: "rush_delivery"`，只在候选 `deliveryMode === "rush"` 时计入价格。
