# 03 Convex schema v1（事件溯源候选）· part1：事件日志

> 本文件分三片：part1（本文件）事件表信封与载荷；`03-schema-part2.md` 投影表与普通表；`03-schema-part3.md` EVENT_META、哈希链、唯一性落点、演进与重建。
> 类型约定：Convex `v` 管存储与函数参数（`Infer` 导出类型）；Zod 只管模型 I/O（05）。金额 `v.number()` + `assertCents`；日期 `YYYY-MM-DD` 字符串 + `assertIsoDate`。

## 1. 决定

| # | 决定 | 理由 | 备选与否决原因 |
| --- | --- | --- | --- |
| S-1 | `events` 用**表级判别联合**：公共信封字段 + 每种 `type` 一个对象形状 | schema 层就能校验"某类型事件必须有哪些载荷字段"；投影代码可以穷举 switch | `payload: v.any()`：失去形状校验；`payload: v.union(...)` 不与 type 绑定：可写出 type 与载荷不匹配的事件 |
| S-2 | 顺序用房间内 `seq`（无间隙整数），不用 `_creationTime`，也不用 `v.commitTs()` | 每房间串行写；`seq` 可读、可当分页游标、可在同一 mutation 内立刻使用（commitTs 在同一 mutation 内是占位符，inputs/04 §1.6） | `commitTs`：只有跨房间全局排序才需要，v1 没有（17 列为扩展点） |
| S-3 | 每个事件带 `prevHash`/`hash`（SHA-256 链） | Convex 没有 WORM 表，dashboard 与有 bug 的代码都能改行；哈希链让任何改动可被 `audit.verifyRoom` 发现 | 不做链：无法证明"未被改过"；外部公证：v1 过度 |
| S-4 | `audience` 在写入时落库（由类型常量决定） | 历史事件的可见性决定被记录为事实；以后改常量不会追溯性地公开旧事件 | 读取时按类型常量推导：改代码会改变历史可见性 |
| S-5 | 载荷含私密字段（如预算金额），但 `events` 行**永不原样返回客户端** | 一条日志才能完整追溯；披露在 `renderEvent(viewer)` 中逐字段决定（07 §5） | 私密载荷拆到另一张表：两处写入、追溯要拼接，且仍需同样的过滤 |

## 2. 信封字段

```ts
// convex/engine/events/envelope.ts
export const roleV = v.union(v.literal("customer"), v.literal("provider"), v.literal("finance"));
export const audienceV = v.union(
  v.literal("room"), v.literal("buyers"),               // buyers = customer + finance
  v.literal("customer"), v.literal("provider"), v.literal("finance"),
);
export const actorV = v.union(
  v.object({ kind: v.literal("user"), userId: v.id("users"), role: v.optional(roleV) }),
  v.object({ kind: v.literal("agent"), role: roleV, runNo: v.number(), turnSeq: v.number() }),
  v.object({ kind: v.literal("rule"), rule: v.string() }),      // 确定性规则/反应器
  v.object({ kind: v.literal("system"), reason: v.string() }),  // seed、watchdog、迁移
);
const envelope = {
  roomId: v.id("rooms"),
  seq: v.number(),                 // 1,2,3… 房间内无间隙
  v: v.number(),                   // 该 type 的载荷 schema 版本（upcast 用）
  at: v.number(),                  // mutation 内 Date.now()（Convex 在 mutation 内冻结时间）
  actor: actorV,
  audience: audienceV,
  commandId: v.optional(v.string()),   // 客户端提交去重键（非安全用途）
  causationSeq: v.optional(v.number()),// 同命令内由哪条事件触发
  correlation: v.optional(v.string()), // 如 "run:3"、"req:2"
  simulated: v.boolean(),
  requestId: v.optional(v.string()),   // ctx.meta.getRequestMetadata().requestId
  prevHash: v.string(),
  hash: v.string(),
};
```

## 3. 事件类型与载荷（v=1）

```ts
const lineV = v.object({ itemKey: v.string(), itemVersion: v.number(), title: v.string(), priceCents: v.number() });
const termLineV = v.object({ termId: v.string(), kind: v.literal("rush_fee"), deltaCents: v.number() });
const reqApprovalV = v.object({ role: roleV, kind: v.union(v.literal("terms"), v.literal("budget")) });
const briefContentV = v.union(              // 场景插件声明，v1 只有 scope_change
  v.object({ scenario: v.literal("scope_change"), role: v.literal("customer"),
    requiredItemKeys: v.array(v.string()), desiredItemKeys: v.array(v.string()),
    deferrableItemKeys: v.array(v.string()), deadline: v.string(), preferredDate: v.optional(v.string()),
    notes: v.optional(v.string()) }),
  v.object({ scenario: v.literal("scope_change"), role: v.literal("provider"),
    earliestStartDate: v.string(), notes: v.optional(v.string()) }),
  v.object({ scenario: v.literal("scope_change"), role: v.literal("finance"),
    approvalNote: v.optional(v.string()), notes: v.optional(v.string()) }),
);
const factV = v.object({ field: v.string(), value: v.union(v.string(), v.array(v.string())) });
const optionV = v.object({ key: v.string(), effect: v.union(
  v.object({ type: v.literal("choose_candidate"), candidateId: v.string(), itemKeys: v.array(v.string()),
             deliveryDate: v.string(), amountCents: v.number() }),
  v.object({ type: v.literal("raise_budget"), newTotalCents: v.number() }),
  v.object({ type: v.literal("relax_deadline"), newDeadline: v.string() }),
  v.object({ type: v.literal("keep_as_is") }),
  v.object({ type: v.literal("cancel_change") }),
)});

export const eventBodies = [
  { type: "room_created", title: v.string(), goal: v.string(), scenarioKey: v.literal("scope_change"),
    scenarioVersion: v.number(), timeZone: v.string(), ownerUserId: v.id("users"), maxRounds: v.number() },
  { type: "member_joined", userId: v.id("users"), role: roleV, displayName: v.string() },
  { type: "catalog_item_confirmed", itemKey: v.string(), itemVersion: v.number(), title: v.string(),
    priceCents: v.number(), standardLeadDays: v.number(), rushLeadDays: v.optional(v.number()),
    taskTemplates: v.array(v.object({ title: v.string() })), constraintsVersionAfter: v.number() },
  { type: "catalog_item_withdrawn", itemKey: v.string(), lastItemVersion: v.number(), constraintsVersionAfter: v.number() },
  { type: "brief_confirmed", role: roleV, version: v.number(), content: briefContentV,
    shareableFacts: v.array(factV), hardChanged: v.boolean(), constraintsVersionAfter: v.union(v.number(), v.null()) },
  { type: "budget_changed", oldTotalCents: v.union(v.number(), v.null()), newTotalCents: v.number(),
    reason: v.string(), committedCentsAtChange: v.number(), constraintsVersionAfter: v.number() },
  { type: "baseline_commitment_recorded", amountCents: v.number(), label: v.string() },
  { type: "run_started", runNo: v.number(), trigger: v.union(v.literal("initial"), v.literal("constraints_changed"),
    v.literal("human_answer"), v.literal("manual")), constraintsVersionAtStart: v.number(), maxRounds: v.number() },
  { type: "proposal_created", runNo: v.number(), version: v.number(), round: v.number(),
    authorKind: v.union(v.literal("agent"), v.literal("rule"), v.literal("human_option")), authorRole: roleV,
    turnSeq: v.optional(v.number()), candidateId: v.string(), lines: v.array(lineV), terms: v.array(termLineV),
    deferredItemKeys: v.array(v.string()), amountCents: v.number(), deliveryDate: v.string(),
    requiredApprovals: v.array(reqApprovalV), constraintsVersion: v.number(), termsKey: v.string(),
    validation: v.object({ ok: v.boolean(), reasonCodes: v.array(v.string()) }) },
  { type: "turn_completed", runNo: v.number(), turnSeq: v.number(), role: roleV,
    action: v.union(v.literal("propose"), v.literal("counter"), v.literal("recommend_accept"), v.literal("reject"), v.literal("clarify")),
    candidateId: v.optional(v.string()), reasonCode: v.optional(v.string()), baseProposalVersion: v.optional(v.number()) },
  { type: "turn_failed", runNo: v.number(), turnSeq: v.number(), role: roleV, attempt: v.number(), errorCode: v.string(), willRetry: v.boolean() },
  { type: "turn_rejected_stale", runNo: v.number(), turnSeq: v.number(), role: roleV, staleReason: v.string() },
  { type: "run_ready_for_approval", runNo: v.number(), proposalVersion: v.number() },
  { type: "run_needs_input", runNo: v.number(), reasonCode: v.string() },
  { type: "run_resumed", runNo: v.number(), reason: v.union(v.literal("retry"), v.literal("human_rejected"), v.literal("human_answer")), round: v.number() },
  { type: "run_failed", runNo: v.number(), errorCode: v.string() },
  { type: "run_superseded", runNo: v.number(), reason: v.union(v.literal("constraints_changed"), v.literal("room_closed"), v.literal("manual_restart")) },
  { type: "decision_recorded", proposalVersion: v.number(), userId: v.id("users"), role: roleV,
    kind: v.union(v.literal("terms"), v.literal("budget")),
    decision: v.union(v.literal("approve"), v.literal("reject"), v.literal("withdraw")),
    reasonCode: v.optional(v.string()), note: v.optional(v.string()), constraintsVersion: v.number() },
  { type: "human_request_opened", requestNo: v.number(), runNo: v.number(), targetRole: roleV,
    kind: v.union(v.literal("tradeoff"), v.literal("clarify"), v.literal("budget_below_committed"), v.literal("no_feasible_option")),
    reasonCode: v.string(), options: v.array(optionV), constraintsVersion: v.number() },
  { type: "human_request_answered", requestNo: v.number(), optionKey: v.string(), answeredBy: v.id("users") },
  { type: "human_request_cancelled", requestNo: v.number(), reason: v.string() },
  { type: "execution_completed", runNo: v.number(), proposalVersion: v.number(), constraintsVersion: v.number(),
    operationId: v.string(), lines: v.array(lineV), terms: v.array(termLineV), deferredItemKeys: v.array(v.string()),
    amountCents: v.number(), deliveryDate: v.string(), committedBeforeCents: v.number(),
    committedAfterCents: v.number(), totalBudgetCents: v.number(),
    tasks: v.array(v.object({ taskKey: v.string(), itemKey: v.string(), title: v.string(), assigneeRole: v.literal("provider") })) },
  { type: "task_completed", taskKey: v.string(), completedBy: v.id("users") },
  { type: "room_closed", reason: v.string() },
] as const;

// schema.ts
events: defineTable(v.union(...eventBodies.map(({ type, ...body }) =>
    v.object({ ...envelope, type: v.literal(type), ...body }))))
  .index("by_room_seq", ["roomId", "seq"])
  .index("by_room_type_seq", ["roomId", "type", "seq"])
  .index("by_room_command", ["roomId", "commandId"])
  .index("by_room_correlation_seq", ["roomId", "correlation", "seq"]),
```

- 表级联合 + 公共字段索引：Convex 支持 `defineTable(v.union(v.object…))`，索引字段须存在于所有分支（待验证：确认 1.48 在联合表上建索引无告警）。
- `eventBodies` 用 `as const` 写成数据，便于 `EventType` 类型、穷举检查与 `EVENT_META`（audience、是否约束事件、渲染模板）共用同一份清单。
- 24 个类型。新增类型 = 加一项 + `applyEvent`/`renderEvent`/`EVENT_META` 各一分支（TS 穷举 `never` 检查强制）。

