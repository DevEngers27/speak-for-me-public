# 03 Convex schema v1（part1：共享 validator、身份、房间、简报、目录、账务）

> 文件：`convex/schema.ts`；共享 validator 在 `convex/lib/validators.ts`（只用相对路径导入，不用 `@/`）。`v.*` 只表达形状；金额范围、日期格式、唯一性在 mutation 内校验（inputs/04 §1.6、§1.8）。所有 ID 用 `v.id(table)`。新签名 `ctx.db.get("table", id)`。

## 1. 共享 validator

```ts
// convex/lib/validators.ts
export const ROLES = ["customer", "provider", "finance"] as const;
export const roleV = v.union(v.literal("customer"), v.literal("provider"), v.literal("finance"));
// 编译期断言：Infer<typeof roleV> 与 (typeof ROLES)[number] 互相可赋值（见 06 §1）
export const centsV = v.number();          // 安全整数美分，assertCents 守卫
export const dateV = v.string();           // "YYYY-MM-DD"，assertIsoDate 守卫
export const signatureKindV = v.union(v.literal("terms"), v.literal("budget"));
export const actorKindV = v.union(v.literal("user"), v.literal("agent"), v.literal("rule"), v.literal("system"));
export const runStatusV = v.union(
  v.literal("negotiating"), v.literal("pending_approval"), v.literal("needs_input"),
  v.literal("failed"), v.literal("confirmed"), v.literal("superseded"), v.literal("cancelled"));
export const constraintCauseV = v.union(
  v.literal("budget_limit"), v.literal("opening_balance"), v.literal("brief_confirmed"),
  v.literal("catalog_changed"), v.literal("quote_expired"), v.literal("commitment_recorded"));
```

## 2. 身份与房间

```ts
users: defineTable({
  tokenIdentifier: v.string(),        // identity.tokenIdentifier，全局唯一
  clerkUserId: v.optional(v.string()),// identity.subject，仅展示与对账
  displayName: v.string(),
  createdAt: v.number(),
}).index("by_tokenIdentifier", ["tokenIdentifier"]),

rooms: defineTable({
  title: v.string(), goal: v.string(),
  scenarioKey: v.literal("scope_change"),
  ownerUserId: v.id("users"),
  status: v.union(v.literal("setup"), v.literal("active"), v.literal("closed")),
  timeZone: v.string(),               // IANA，today 按此计算（Intl 支持待验证）
  currency: v.literal("USD"),
  constraintsVersion: v.number(),     // 只经 bumpConstraints
  nextProposalVersion: v.number(),    // 从 1 开始，永不重置
  nextRunSeq: v.number(),
  currentRunId: v.optional(v.id("runs")),
  currentProposalId: v.optional(v.id("proposals")),
  simulated: v.boolean(), fixtureKey: v.optional(v.string()),
  createdAt: v.number(),
}).index("by_owner", ["ownerUserId"]),

roomInvites: defineTable({
  roomId: v.id("rooms"), role: roleV,
  tokenHash: v.string(),              // SHA-256(明文) hex；明文只在 create 返回一次
  expiresAt: v.number(),
  createdByUserId: v.id("users"),
  acceptedByUserId: v.optional(v.id("users")), acceptedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
}).index("by_tokenHash", ["tokenHash"]).index("by_room_role", ["roomId", "role"]),

members: defineTable({
  roomId: v.id("rooms"), userId: v.id("users"), role: roleV,
  displayName: v.string(),            // 加入时快照
  joinedAt: v.number(),
}).index("by_room_role", ["roomId", "role"])
  .index("by_room_user", ["roomId", "userId"])
  .index("by_user", ["userId"]),
```

- tokenHash 的计算在 mutation 内需要 SHA-256：Convex 默认运行时 `crypto.subtle` 可用性待验证；退路是用 32 字节随机 token 并存 `token` 前 8 位 + 全量比较（仍只在 owner 查询返回一次）。

## 3. 简报

```ts
const customerFieldsV = v.object({
  kind: v.literal("customer"),
  requiredItemKeys: v.array(v.string()),   // 硬
  wantedItemKeys: v.array(v.string()),     // 软，按优先级排序
  deferrableItemKeys: v.array(v.string()), // 明确可延后
  preferredDate: v.optional(dateV),        // 软
  deadline: dateV,                         // 硬
  privateNotes: v.string(),                // 只给本人与本方代理
});
const providerFieldsV = v.object({ kind: v.literal("provider"), privateNotes: v.string() });
const financeFieldsV  = v.object({ kind: v.literal("finance"),  privateNotes: v.string() });
export const briefFieldsV = v.union(customerFieldsV, providerFieldsV, financeFieldsV);
export const shareableFieldV = v.union(
  v.literal("requiredItemKeys"), v.literal("wantedItemKeys"), v.literal("deferrableItemKeys"),
  v.literal("preferredDate"), v.literal("deadline"));

briefDrafts: defineTable({
  roomId: v.id("rooms"), userId: v.id("users"), role: roleV,
  fields: briefFieldsV, shareableFields: v.array(shareableFieldV), updatedAt: v.number(),
}).index("by_room_user", ["roomId", "userId"]),

briefVersions: defineTable({
  roomId: v.id("rooms"), role: roleV, userId: v.id("users"),
  version: v.number(),                  // 每 room×role 从 1 递增
  fields: briefFieldsV, shareableFields: v.array(shareableFieldV),
  hardKey: v.string(),                  // 硬字段规范化串；与上一版不同才 bump
  constraintsVersion: v.number(),       // 确认后房间的约束版本
  simulated: v.boolean(), confirmedAt: v.number(),
}).index("by_room_role_version", ["roomId", "role", "version"]),
```

## 4. 报价目录（只追加修订）

```ts
catalogItems: defineTable({
  roomId: v.id("rooms"),
  itemKey: v.string(),                 // /^[A-Z][A-Z0-9_]{1,23}$/，房间内稳定
  revision: v.number(),                // 每 room×itemKey 从 1 递增
  kind: v.union(v.literal("scope"), v.literal("rush_fee")),
  status: v.union(v.literal("active"), v.literal("retired")),
  title: v.string(),
  priceCents: centsV,
  leadTimeDays: v.optional(v.number()),     // scope：标准工期（整数天）
  rushLeadTimeDays: v.optional(v.number()), // scope：加急工期；缺省则不可加急
  validUntil: v.optional(dateV),            // 报价有效期（含当日）
  taskTitle: v.optional(v.string()),        // scope：派生任务标题模板
  confirmedByUserId: v.id("users"), confirmedAt: v.number(),
  simulated: v.boolean(),
}).index("by_room_item_revision", ["roomId", "itemKey", "revision"])
  .index("by_room", ["roomId"]),
```

- "当前报价" = 每个 itemKey revision 最大且 status 为 active 的那一行。目录 ≤ 12 条（场景配置 `maxCatalogItems`），读全部再归约是有界的。
- 每房间至多一个 `rush_fee` 条目（`catalog.saveItem` 守卫）。

## 5. 账务表

```ts
budgets: defineTable({
  roomId: v.id("rooms"),
  currency: v.literal("USD"),
  nextRevision: v.number(),            // 下一条 budgetRevisions.revision
  nextCommitmentSeq: v.number(),       // 下一条 commitments.seq
  openingBalanceDeclared: v.boolean(), // 期初已录入或声明为零（setup→active 守卫）
  createdAt: v.number(),
}).index("by_room", ["roomId"]),
// 注：不存 limitCents / committedCents；每次台账写入都 patch 本文档，使同一预算的写入在 OCC 下串行

budgetRevisions: defineTable({
  roomId: v.id("rooms"), budgetId: v.id("budgets"),
  revision: v.number(),
  limitCents: centsV,
  previousLimitCents: v.union(centsV, v.null()),
  reasonCode: v.union(v.literal("initial"), v.literal("increase"), v.literal("decrease"),
                      v.literal("tradeoff_answer")),
  note: v.string(),                    // 必填原因，≤ 500 字符，仅买方可见
  actorUserId: v.id("users"),
  constraintsVersion: v.number(),      // 写入后房间的约束版本
  simulated: v.boolean(), createdAt: v.number(),
}).index("by_budget_revision", ["budgetId", "revision"]),

commitments: defineTable({
  roomId: v.id("rooms"), budgetId: v.id("budgets"),
  seq: v.number(),
  kind: v.union(v.literal("opening_balance"), v.literal("change_order")),
  amountCents: centsV,                 // > 0
  changeOrderId: v.optional(v.id("changeOrders")), // change_order 必填
  proposalId: v.optional(v.id("proposals")),       // change_order 必填
  operationKey: v.string(),            // opening: `open:{budgetId}`；change_order: 同变更单
  constraintsVersion: v.number(),      // 写入后的约束版本
  description: v.string(),             // 模板渲染（无私密数字以外的内容）
  recordedByUserId: v.id("users"),
  simulated: v.boolean(), createdAt: v.number(),
}).index("by_budget_seq", ["budgetId", "seq"])
  .index("by_operationKey", ["operationKey"])
  .index("by_changeOrder", ["changeOrderId"]),
```

续见 part2：runs、agentTurns、proposals、decisions、changeOrders、tasks、humanRequests、constraintChanges、events，以及唯一性落点表与迁移规则。
