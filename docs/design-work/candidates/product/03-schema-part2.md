# 03 Convex schema v1（part2）：简报、清单、约束修订、台账

## 3.7 `briefDrafts`（可变，仅本人）

```ts
briefDrafts: defineTable({
  roomId: v.id("rooms"),
  seatId: v.id("seats"),
  roleKey: v.string(),
  fields: P.briefFields,              // 场景判别联合；草稿允许字段缺省（校验器中全部 optional）
  notes: v.string(),                  // 私密自由文本：目标、偏好、背景，只进入本方代理
  sharedNote: v.string(),             // 人写的共享说明，需披露项 shared_note 才对他方可见
  disclosures: v.array(disclosureV),
  basedOnVersion: v.number(),         // 草稿基于的确认版本，0 = 尚无
  revision: v.number(),               // 每次保存 +1；saveDraft 要求客户端回传当前 revision
  suggestedFieldKeys: v.array(v.string()), // 由抽取预填、尚未被用户逐项确认的字段
  updatedAt: v.number(),
}).index("by_seat", ["seatId"]),
```

- 每席位恰好一条，建房时创建（I-2 的同一 mutation）。
- 确认时若 `suggestedFieldKeys` 非空则拒绝（`BRIEF_INCOMPLETE`，界面要求逐项确认或清除），保证"抽取结果未经本人确认不生效"（RO-11）。
- 原始粘贴文本不落库（F02.8）。

## 3.8 `briefVersions`（不可变）

```ts
briefVersions: defineTable({
  roomId: v.id("rooms"),
  seatId: v.id("seats"),
  roleKey: v.string(),
  version: v.number(),                // 每席位从 1 连续
  fields: P.briefFields,              // 确认时通过场景 validate 的完整字段
  notes: v.string(),
  sharedNote: v.string(),
  disclosures: v.array(disclosureV),
  ruleDigest: v.string(),             // canonicalKey(规则字段)，用于检测规则变化
  ruleChanged: v.boolean(),           // 与上一版本相比规则字段是否变化
  causedConstraintsVersion: v.optional(v.number()),
  changeReason: v.optional(v.string()),       // 私密说明，仅本席位
  publicReasonCode: v.optional(v.string()),   // 场景枚举，例如 "budget_revision"，全房间可见
  origin: v.union(v.literal("manual"), v.literal("quick_update"),
                  v.literal("request_answer"), v.literal("fixture")),
  requestId: v.optional(v.id("humanRequests")),
  confirmedBy: actorV,                // fixture 为 system，其余为 user
  confirmedAt: v.number(),
  isSimulated: v.boolean(),
})
  .index("by_seat_version", ["seatId", "version"])
  .index("by_room", ["roomId"]),
```

- 读"最新确认版本"：`by_seat_version` 上 `.order("desc").first()`。
- 他方只能通过投影拿到 `{version, confirmedAt}` 与披露给自己的字段值（07）。

## 3.9 `listItems`（版本化共享清单）

```ts
listItems: defineTable({
  roomId: v.id("rooms"),
  listKey: v.string(),                // scope_change："scope" | "quote"
  itemKey: v.string(),                // 房间 + 清单内的稳定键，例如 "LOGIN"、"LOGIN_LITE"
  version: v.number(),                // 每个 itemKey 从 1 递增；草稿占用下一个版本号
  status: v.union(v.literal("draft"), v.literal("confirmed"),
                  v.literal("superseded"), v.literal("withdrawn")),
  data: P.listItemData,               // 场景定型，例如报价行 {kind:"line", scopeItemKey, priceCents, ...}
  validUntil: v.optional(v.string()),
  authorSeatId: v.id("seats"),
  confirmedBy: v.optional(actorV),
  confirmedAt: v.optional(v.number()),
  statusChangedAt: v.number(),
  publicReasonCode: v.optional(v.string()),
  origin: v.union(v.literal("manual"), v.literal("request_answer"), v.literal("fixture")),
  isSimulated: v.boolean(),
  createdAt: v.number(),
})
  .index("by_room_list_key_version", ["roomId", "listKey", "itemKey", "version"])
  .index("by_room_list_status", ["roomId", "listKey", "status"]),
```

- `itemKey` 格式：`^[A-Z][A-Z0-9_]{1,31}$`（在 mutation 中校验），便于在候选键与模板中引用。
- draft 只有作者席位可读；confirmed 全体成员可读；superseded/withdrawn 留作历史，全体可读（它们曾经公开）。

## 3.10 `constraintRevisions`（每个约束版本一行，不可变）

```ts
constraintRevisions: defineTable({
  roomId: v.id("rooms"),
  version: v.number(),
  cause: v.union(v.literal("room_created"), v.literal("brief_confirmed"),
                 v.literal("list_changed"), v.literal("ledger_changed"), v.literal("execution"),
                 v.literal("scenario_upgraded")),        // 插件规则版本升级（3.24）
  actor: actorV,
  causeSeatId: v.optional(v.id("seats")),
  publicReasonCode: v.optional(v.string()),
  changedRuleFieldKeys: v.array(v.string()),  // 只有字段名，没有值；他方投影时进一步隐藏未披露字段名
  inForce: v.object({                         // 本版本生效的全部约束来源，可重放规则视图
    briefVersionIds: v.array(v.id("briefVersions")),
    listItemIds: v.array(v.id("listItems")),
    ledgerSeq: v.number(),
  }),
  refs: v.object({
    briefVersionId: v.optional(v.id("briefVersions")),
    listItemIds: v.optional(v.array(v.id("listItems"))),
    commitmentId: v.optional(v.id("commitments")),
    executionId: v.optional(v.id("executions")),
    requestId: v.optional(v.id("humanRequests")),
  }),
  createdAt: v.number(),
}).index("by_room_version", ["roomId", "version"]),
```

- 只经 `bumpConstraints` 写入（I-7）。`inForce` 让任一版本的规则视图可被完整重建（核心 6 的"从事件追溯每个结果怎么来的"）。
- 记录本身不含任何值；值在对应的简报版本、清单项、台账条目中，读取时按披露投影。

## 3.11 `commitments`（金额台账）

```ts
commitments: defineTable({
  roomId: v.id("rooms"),
  seq: v.number(),                    // 来自 rooms.ledgerSeq + 1
  kind: v.union(v.literal("baseline"), v.literal("execution")),
  amountCents: v.number(),            // > 0
  label: v.string(),                  // 基线由 finance 填写；执行为 "CO-1"
  executionId: v.optional(v.id("executions")),
  enteredBy: actorV,
  status: v.union(v.literal("active"), v.literal("voided")),
  voidedAt: v.optional(v.number()),
  voidReason: v.optional(v.string()),
  voidedByUserId: v.optional(v.id("users")),
  isSimulated: v.boolean(),
  createdAt: v.number(),
})
  .index("by_room_seq", ["roomId", "seq"])
  .index("by_room_status", ["roomId", "status"])
  .index("by_execution", ["executionId"]),
```

- 已承诺金额 = `by_room_status(roomId, "active")` 求和；不在任何地方另存计数器（F02.3）。
- 基线只能在房间首次执行前作废（`BASELINE_LOCKED`）；执行条目永不作废（v1 无冲销）。
- 场景 `ledger === null` 时该表对该房间不写入。

## 3.12 简报与清单相关的派生读模型（不存储）

| 读模型 | 来源 | 返回给谁 |
| --- | --- | --- |
| `myBrief` | 本席位 `briefDrafts` + 最新 `briefVersions` | 本人 |
| `briefStatuses` | 每席位最新版本的 `{version, confirmedAt}` | 全体成员 |
| `sharedFacts` | 他方最新版本中 `disclosures` 覆盖查看者的字段值、共享说明、派生事实 | 查看者 |
| `disclosurePreview` | 本人草稿的披露设置 → 每个他方角色将看到的内容 | 本人 |
| `listView` | 某清单 confirmed 当前版本（+ 作者看到自己的 draft） | 全体成员 |
