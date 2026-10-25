# 03 · Convex schema v1（part6）：运行时三层（续）——attempts、rawOutputs

> 分片清单见 `03-schema.md` 顶部。runs / turns 见 part5。

### attempts（用量账本）

```ts
attempts: defineTable({
  roomId: v.id("rooms"),
  runId: v.id("runs"),
  turnId: v.id("turns"),
  attemptNo: v.number(),                      // = turn.currentAttemptNo + 1；(turnId, attemptNo) 唯一
  role: roleV,                                // 冗余自 turn，便于按角色聚合
  origin: v.union(v.literal("turn_start"), v.literal("auto_retry"), v.literal("retry_turn")),
  status: v.union(v.literal("running"), v.literal("completed"), v.literal("invalid_output"),
    v.literal("timeout"), v.literal("error"), v.literal("refused"), v.literal("stale")),
  provenance: provenanceV,                    // live / stub（= run.agentMode），再与房间继承
  model: v.string(),                          // "claude-opus-5-5" 或 "stub:v1"
  effort: v.string(),                         // modelGateway 白名单内的值（v1 "medium"）
  maxTokens: v.number(),                      // v1 16000（canon D09）
  schemaVersion: v.optional(v.string()),      // = turnSpecKey(spec)（05 §5.4.1）；action 构造 schema 后随提交写入
  protocolVersion: v.string(),                // PROTOCOL_VERSION（05）
  promptVersion: v.string(),                  // PROMPT_VERSION（05 §5.13.3）
  reservedDay: v.string(),                    // 预留所在的 UTC 日（跨午夜结算回原日期行，10 §10.12.2）
  retryNote: v.optional(v.string()),          // 上一 attempt 的 reasonCode，供 RETRY_NOTES 渲染（10 §10.5.1）
  actionFnId: v.optional(v.string()),         // agents.runAttempt 的调度 id
  watchdogFnId: v.optional(v.string()),       // agents.watchdog 的调度 id（每个 attempt 自有，canon D07）
  watchdogArmCount: v.number(),               // 重登记次数 ≤ 3（04 §4.5.3）
  deadlineAt: v.number(),                     // 看门狗到期时刻，随重登记更新
  reservedMicroUsd: v.number(),               // 调度前预留额（按 maxTokens 与价目表估算）
  usage: v.optional(usageV),                  // ↓ 用量字段：写一次（含迟到结果补记）
  stopReason: v.optional(v.string()),
  stopCategory: v.optional(v.union(v.string(), v.null())),   // stop_details.category 运行时按 string|null（inputs/05 A6）
  requestId: v.optional(v.string()),          // msg._request_id
  messageId: v.optional(v.string()),
  responseModel: v.optional(v.string()),      // msg.model（开启回退时可能不同，D09 默认关）
  latencyMs: v.optional(v.number()),
  costMicroUsd: v.optional(v.number()),       // 结算时按带 asOf 的价目表估算，界面标 "estimate"
  priceTableAsOf: v.optional(v.string()),
  lateUsage: v.boolean(),                     // 守卫拒收或已终态后补记的用量
  errorCode: v.optional(v.string()),          // reasonCode（output.* / action.* / run.*）或 10 §10.15 的 AttemptErrorCode，无原文
  issuePaths: v.optional(v.array(v.string())),// Zod issue 路径，未知段替换为 "*"，截断（privacy review r15）
  staleGuard: v.optional(v.union(v.literal("G1"), v.literal("G2"), v.literal("G3"))), // 守卫拒收的原因（10 §10.7.2）
  httpStatus: v.optional(v.number()),         // SDK 错误的 HTTP 状态（分类用，10 §10.15）
  retryAfterMs: v.optional(v.number()),       // 429 的 retry-after（退避用）
  rationaleTruncated: v.optional(v.boolean()),// rationale > 1,200 码点被截断（05 §5.5.2）
  move: v.optional(agentMoveV),               // 通过 strict 解析的 move（含被语义校验拒绝的），self
  outputBytes: v.optional(v.number()),        // 没有 outputSha256：mutation 内无 crypto，原文已在 rawOutputs
  rawOutputRef: v.optional(v.id("rawOutputs")),// 模型原文只在内部表（canon D16）
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
}).index("by_turn", ["turnId", "attemptNo"])  // canon 指定；G0 与"当前 attempt"
  .index("by_run", ["runId"])                 // run 级上限复核、对账
  .index("by_status_deadline", ["status", "deadlineAt"]) // 卡住的 running attempt 告警；activeAttemptCount
  .index("by_room", ["roomId"]),              // 房间用量汇总（+ _creationTime 区间）
```

- 唯一插入者 `turns.beginAttempt`（canon D01 唯一调度接缝）：同事务插入 attempt、`run.attemptCount + 1`、`run.reservedMicroUsd += reserved`、`spendCounters` 预留，并登记 `actionFnId` 与 `watchdogFnId`；上限或排空时不建行（04 §4.5.1）。
- **每次模型调用恰一行**，包括 stub（`usage` 全 0、`model: "stub:v1"`）、守卫拒收（`stale`，用量照记）、G0 情形（attempt 已终态：只补用量字段，`lateUsage: true`，不改 status）。成本结算：`turns.complete / fail` 同事务 `reserved → spent`；看门狗判 `timeout` 时把预留按已花费结算，若迟到结果带回 `usage` 则按实际重算并差额回补（10）。v1 没有非回合调用（简报抽取列入 17，canon D26），因此不需要 `turnId` 可选的通用账本。
- `effort` 用 `v.string()` 而非字面量联合：取值由 `modelGateway` 运行时白名单把关（inputs/05 A4：类型挡不住会 400 的写法），存储只记录事实。
- 披露类：`status` / `attemptNo` / `usage` / `latencyMs` / `move` / `errorCode` / `issuePaths` / `stop*` / `model` / `effort` / `staleGuard` / `retryNote` 为 `self(role)`（他方对 attempt 一无所知：防止从 token 数推断他方简报长度，也防止从失败痕迹反推 `agent_failed` 的 kind / toRole，privacy-disclosure 5.5、privacy-06）；`requestId` / `messageId` / `*FnId` / `httpStatus` / `retryAfterMs` / `rawOutputRef` / `reservedDay` / 美元字段为 `system`（运维汇总只给总额）。不变量：INV-13、INV-40、INV-42、INV-69 – INV-72。

### rawOutputs（内部表，无任何 query 暴露）

```ts
rawOutputs: defineTable({
  attemptId: v.id("attempts"),
  roomId: v.id("rooms"),
  text: v.string(),                           // 模型返回的原始文本（≤ 64 KiB，超出截断并记 truncated）
  truncated: v.boolean(),
  createdAt: v.number(),
  expiresAt: v.number(),                      // dev 30 天、prod 7 天（15 定），ops.purgeRawOutputs 删除
}).index("by_attempt", ["attemptId"])
  .index("by_expiresAt", ["expiresAt"]),
```

- 只由 `turns.complete / fail` 写、只由 `ops.purgeRawOutputs`（cron）删；没有任何公开或 internal query 返回 `text`，排障只经 dashboard 直读（techstack D19：完整请求不存，可由事件、`promptVersion`、快照确定性重建）。
- 金丝雀扫描覆盖本表（它可能含模型复述的任何内容）；不在 `REDACTABLE_FIELDS`（到期即删）。
