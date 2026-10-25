# 03 Convex schema v1（part1：约定、身份与房间、简报、目录、约束快照）

> 本章分 3 个文件：part1（本文件）；part2 run/回合/笔记/模型调用/提案/决定/人工请求；part3 变更单/承诺/任务/事件/计数器、唯一性落点、不变量落点、演进规则。
> 每张表标注受众类别（07 §7.11）：R 房间可见、P 参与方私有、F 角色私有、O 房主、S 系统。

## 3.1 约定

- 文件：`convex/schema.ts` 组合引擎表与场景校验器；场景校验器来自 `packages/scenario-scope-change/src/validators.ts`，经 `convex/scenarios/registry.ts` 汇总成联合类型。`convex/` 内只用相对路径与 workspace 包名导入，不用 `@/` 别名（打包器是否解析根 tsconfig paths：待验证，直接避开）。
- 金额：`v.number()` 存整数美分，所有入口调用 `assertCents`（`Number.isSafeInteger(n) && 0 <= n && n <= 100_000_000`）。不用 `v.int64()`：范围足够，且避免 bigint 在前后端的序列化差异。
- 日期：`v.string()` 存 `YYYY-MM-DD`，入口调用 `parseIsoDate`（正则 + 真实日历日校验，拒绝 `2026-02-30`），格式合法后按字典序比较。
- 时间戳：`v.number()` 毫秒；展示用 `_creationTime`/`createdAt`；事件全序用 `commitTs`（3.3 part3）。
- 角色、字段、reasonCode 在存储层是 `v.string()`，运行时用场景声明校验（引擎不能写死场景枚举）。引擎自己的枚举写成字面量联合，并与 TS 常量做编译期互相可赋值断言：

```ts
// packages/engine/src/enums.ts
export const RUN_STATUSES = ["running", "awaiting_approval", "needs_human", "failed",
  "executed", "superseded", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
// convex/lib/validators.ts
export const runStatusV = v.union(v.literal("running"), v.literal("awaiting_approval"),
  v.literal("needs_human"), v.literal("failed"), v.literal("executed"),
  v.literal("superseded"), v.literal("cancelled"));
type _A = Assert<Equals<Infer<typeof runStatusV>, RunStatus>>;   // 漂移即编译失败
```

- 校验分层：Convex `v` 管形状（函数参数与存储）；值规则（金额范围、日期、itemKey 格式、披露受众合法性、文本长度与字符集）由场景/引擎的纯函数 `validate*` 管，同一函数在 mutation 与前端表单中复用（前端只为即时反馈）；Zod 只用于模型输入输出（05）。
- 文本：所有会被他人看到或进入他方 prompt 的人类文本在写入时经 `sanitizeInlineText(s, max)`（07 §7.13）。

## 3.2 身份与房间

```ts
users: defineTable({                                  // S（本人行经 users.me）
  tokenIdentifier: v.string(),                        // identity.tokenIdentifier，全局唯一
  clerkSubject: v.string(),                           // identity.subject，仅对账与展示
  displayName: v.string(),                            // ≤ 60
  canCreateRooms: v.boolean(),                        // ROOM_CREATION=allowlist 时生效
  createdAt: v.number(),
}).index("by_tokenIdentifier", ["tokenIdentifier"]),

rooms: defineTable({                                  // R
  title: v.string(),                                  // ≤ 120，sanitize
  goal: v.string(),                                   // ≤ 500，sanitize；只作说明，不进规则
  scenarioKey: v.string(),                            // "scope_change"
  scenarioVersion: v.number(),                        // 插件版本，决定校验器与模板版本
  timeZone: v.string(),                               // IANA，如 "America/Los_Angeles"；建房后不可改
  lifecycle: v.union(v.literal("setup"), v.literal("active"), v.literal("closed")),
  ownerUserId: v.id("users"),
  constraintsVersion: v.number(),                     // setup 期 0；激活 1；只经 bumpConstraints 递增
  proposalSeq: v.number(),                            // 已分配的最大提案版本
  runSeq: v.number(),                                 // 已分配的最大 run 序号
  currentRunId: v.optional(v.id("runs")),
  currentProposalId: v.optional(v.id("proposals")),
  isSimulated: v.boolean(),
  fixtureKey: v.optional(v.string()),                 // seed 生成的房间才有
  createdAt: v.number(),
  closedAt: v.optional(v.number()),
}).index("by_owner", ["ownerUserId"]).index("by_fixtureKey", ["fixtureKey"]),

participants: defineTable({                           // R（DTO 不输出 userId）
  roomId: v.id("rooms"),
  roleKey: v.string(),                                // 场景 roles[] 之一
  status: v.union(v.literal("open"), v.literal("occupied")),
  userId: v.optional(v.id("users")),
  displayName: v.optional(v.string()),                // 接受邀请时快照
  joinedAt: v.optional(v.number()),
}).index("by_room_role", ["roomId", "roleKey"])
  .index("by_room_user", ["roomId", "userId"])
  .index("by_user", ["userId"]),

roomInvites: defineTable({                            // O
  roomId: v.id("rooms"),
  participantId: v.id("participants"),
  tokenHash: v.string(),                              // SHA-256 hex；明文不落库
  status: v.union(v.literal("open"), v.literal("accepted"), v.literal("revoked")),
  createdByUserId: v.id("users"),
  expiresAt: v.number(),                              // createdAt + 72h；过期读时派生
  acceptedByUserId: v.optional(v.id("users")),
  createdAt: v.number(),
  closedAt: v.optional(v.number()),
}).index("by_tokenHash", ["tokenHash"])
  .index("by_participant_status", ["participantId", "status"]),
```

说明：
- 没有 `members.approvalRequired`：必需审批角色由场景策略在提案插入时计算并快照（08）。
- `rooms` 上没有任何预算字段（GAP-01、RA-B08）；也没有 `status` 混合字段（GAP-05）。
- `rooms.timeZone` 建房后不可改：它影响"今天"的判定，若可改就要纳入 cv，徒增复杂度（ADR-20）。

## 3.3 简报

```ts
briefDrafts: defineTable({                            // P
  roomId: v.id("rooms"),
  participantId: v.id("participants"),
  roleKey: v.string(),
  content: briefDraftContentV,                        // 场景联合，字段全部可选（部分填写）
  notes: v.string(),
  disclosures: v.array(disclosureV),
  catalogDraft: v.optional(catalogDraftContentV),     // 仅有 catalog.publish 能力的角色；未发布即私有
  extractedFieldKeys: v.array(v.string()),            // 抽取预填、尚未被本人逐项确认的字段
  baseVersion: v.number(),                            // 草稿基于哪个已确认版本（0 = 无）
  updatedAt: v.number(),
}).index("by_participant", ["participantId"]),

briefVersions: defineTable({                          // P（X1 投影已披露字段）
  roomId: v.id("rooms"),
  participantId: v.id("participants"),
  roleKey: v.string(),
  version: v.number(),                                // 每席位从 1 连续递增
  content: briefContentV,                             // 场景联合：{ kind, hard, soft }
  notes: v.string(),                                  // ≤ 4000，永不披露
  disclosures: v.array(disclosureV),
  inherentDisclosuresAck: v.boolean(),                // 必须为 true 才能确认
  hardDigest: v.string(),                             // hard 部分的规范化 JSON；相等即不递增 cv
  changeReason: v.optional(v.string()),               // ≤ 300，只有本人可见
  origin: v.union(v.literal("manual"), v.literal("extracted_reviewed"),
    v.literal("budget_update"), v.literal("request_answer"), v.literal("fixture")),
  isSimulated: v.boolean(),
  confirmedByUserId: v.id("users"),
  createdAt: v.number(),
}).index("by_participant_version", ["participantId", "version"])
  .index("by_room_role_version", ["roomId", "roleKey", "version"]),
```

```ts
export const disclosureV = v.object({ fieldKey: v.string(), audience: v.array(v.string()) });
// briefContentV 由注册表汇总，首场景三个成员（字段定义见 14）：
//   { kind: "scope_change.customer", hard: { requestedItemKeys, requiredItemKeys, deadline },
//                                    soft: { preferredItemKeys, preferredDate? } }
//   { kind: "scope_change.provider", hard: { minChangeOrderCents }, soft: {} }
//   { kind: "scope_change.finance",  hard: { capCents, baselineCommittedCents, baselineSource }, soft: {} }
```

`hardDigest` 的计算：`canonicalJson(content.hard)`（键排序、数组按场景声明排序或保持语义顺序）。用规范化字符串而不是哈希，避开 Convex 运行时 `crypto.subtle` 的不确定性，长度也很小。

## 3.4 目录与约束快照

```ts
catalogVersions: defineTable({                        // R（发布即披露）
  roomId: v.id("rooms"),
  participantId: v.id("participants"),                // 发布者席位（首场景 provider）
  version: v.number(),
  content: catalogContentV,                           // 场景联合；首场景见下
  origin: v.union(v.literal("manual"), v.literal("fixture")),
  isSimulated: v.boolean(),
  publishedByUserId: v.id("users"),
  createdAt: v.number(),
}).index("by_room_version", ["roomId", "version"]),

constraintSnapshots: defineTable({                    // S
  roomId: v.id("rooms"),
  constraintsVersion: v.number(),
  briefVersionIds: v.array(v.object({ roleKey: v.string(), briefVersionId: v.id("briefVersions") })),
  catalogVersionId: v.optional(v.id("catalogVersions")),
  cause: v.union(
    v.object({ kind: v.literal("activation") }),
    v.object({ kind: v.literal("brief_confirmed"), roleKey: v.string(),
               briefVersionId: v.id("briefVersions") }),
    v.object({ kind: v.literal("catalog_published"), catalogVersionId: v.id("catalogVersions") }),
    v.object({ kind: v.literal("executed"), changeOrderId: v.id("changeOrders") }),  // 已承诺额变了
  ),
  createdAt: v.number(),
}).index("by_room_cv", ["roomId", "constraintsVersion"]),
```

```ts
// 首场景目录内容（packages/scenario-scope-change/src/validators.ts）
export const scopeCatalogV = v.object({
  kind: v.literal("scope_change.catalog"),
  currency: v.literal("USD"),
  rushFeeCents: v.number(),                           // 订单级加急费；0 表示不提供加急
  items: v.array(v.object({
    itemKey: v.string(),                              // ^[A-Z][A-Z0-9_]{1,23}$，同版本内唯一
    title: v.string(),                                // ≤ 80，sanitize
    priceCents: v.number(),
    standardDate: v.string(),                         // 标准交付日
    rushDate: v.optional(v.string()),                 // 加急交付日；缺省表示该条目不能加急
    taskTitle: v.string(),                            // ≤ 80，任务派生模板
  })),
});
```

约束输入的读取：`loadConstraintInput(ctx, roomId, cv)` 按 `by_room_cv` 取快照，再按 id 取各简报版本与目录版本，组装成场景的 `ConstraintInput`；其中 `committedCents = baselineCommittedCents + Σ commitments(constraintsVersion < cv)`。因为每次执行都会把 cv 加 1（已承诺额是规则输入，09 §9.1），"cv 为 M 时的已承诺额"只由 cv < M 的承诺决定，任何历史时刻的求值都可精确重算。
