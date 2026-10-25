# 03 · Convex schema v1（part3）：身份与房间、简报与披露

> 分片清单见 `03-schema.md` 顶部。每张表后列：唯一写者、默认披露类（07 §7.9 定稿）、承载的不变量（00-invariants 编号）。

## 3.5 身份与房间

### users

```ts
users: defineTable({
  tokenIdentifier: v.string(),     // identity.tokenIdentifier（"<issuer>|<subject>"），全局唯一；永不进 DTO / 日志
  displayName: v.string(),         // 取自 claim `name`，取不到则让用户填写；≤ 80；REDACTABLE
  isTestAccount: v.boolean(),      // issuer 属于 dev 实例或 seed 显式置位（techstack D20）
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_tokenIdentifier", ["tokenIdentifier"]),
```

- 唯一写者 `users.ensureViewer`（userMutation，名以 12 为准）：按索引先查后插，claim 变化时 patch。不经 `openRoomTx`（全局行）；并发首登的重复行依赖 OCC 对 `by_tokenIdentifier` 区间读的冲突（V3）；万一出现重复，`getViewer` 的 `.unique()` 抛错 → 失败关闭，`ops.auditUsers` 报警合并（不影响房间不变量：成员按 userId 去重）。
- 不存邮箱：`invites.listMine` 直接读 identity 的 `email` 与构造器注入的 `ctx.viewer.emailVerified`（Convex `UserIdentity.emailVerified`，缺失按假；不读原始 claim 名；PII 最小化）。
- 披露类：`system`（`displayName` 经 `members.displayName` 快照展示）。不变量：INV-17。

### rooms

```ts
rooms: defineTable({
  scenarioKey: v.literal("scope_change"),     // v1 唯一场景；第二场景改为联合
  scenarioVersion: v.number(),                // 建房钉住（规则、模板、任务派生的版本）
  title: v.string(),                          // ≤ 120；只给人看：不进代理上下文、不进事件 payload
  timeZone: v.string(),                       // IANA；建房校验，之后无写路径
  localDate: v.string(),                      // 房间时区的"今天"；只由 rooms.create 与 clock.rollLocalDate 写（D22）
  status: v.union(v.literal("setup"), v.literal("open"), v.literal("executed"), v.literal("closed")),
  constraintsVersion: v.number(),             // setup 期 0；打开时 → 1（04 M2）；只由 constraints.bump 写
  nextProposalVersion: v.number(),            // 建房 1；只由 insertProposal 写
  nextRunNo: v.number(),                      // 建房 1；只由 startRunTx 写
  writeSeq: v.number(),                       // 房间写锁；只由 openRoomTx 写
  currentRunId: v.optional(v.id("runs")),     // 最新 run（任何状态）；只由 startRunTx 写
  executionId: v.optional(v.id("executions")),// v1 至多一个（D04）；只由 executeIfComplete 写
  followsExecutionId: v.optional(v.id("executions")), // rooms.startFollowUp 建的房间指向旧执行；每个 execution 至多一个后续房间（by_followsExecutionId 先查后插）
  testFaultPlan: v.optional(v.array(v.object({ roundNo: v.number(), role: roleV, attemptNo: v.number(), fault: testFaultV }))),
                                              // 仅 dev / preview / test：seed.* 写入的故障注入计划（10 §10.18.2）；唯一写入口是 seed.*
                                              // （assertTier 且 ALLOW_FAULT_INJECTION），生产永不写入；保留存储计划以便在真实调度 / 看门狗路径上复现；披露类 system
  createdBy: v.id("users"),
  provenance: provenanceV,
  createdAt: v.number(),
  openedAt: v.optional(v.number()),
  executedAt: v.optional(v.number()),
  closedAt: v.optional(v.number()),
}).index("by_createdBy", ["createdBy"])       // 每用户建房节流（techstack X2）+ "我建的房间"
  .index("by_status", ["status"])             // clock / reconcile / 请求过期巡检只列 open 房间
  .index("by_followsExecutionId", ["followsExecutionId"]), // rooms.startFollowUp 的"每个执行至多一个后续房间"（先查后插 + 旧房间写锁）
```

- **没有**任何预算、约束快照、阶段、`currentProposalId` 字段：预算在 finance 简报（SC-02）；阶段派生（02 §5）；当前提案是 `runs.currentProposalId`（当前 run 的属性，D06 沿用提案时提案的 `runId` 与当前 run 不同，08 §8.3.2）。
- "每房间至多一个非终态 run"：`currentRunId` 指向最新 run，`startRunTx` 先断言它为空或已终态（04）。
- 披露类：`title` / `status` / `constraintsVersion` / `localDate` / `scenario*` / `provenance` 为 `room`；`writeSeq`、`createdBy`（DTO 给 `isCreator`）、`next*` 为 `system`。不变量：INV-24、INV-33、INV-36、INV-45、INV-52、INV-67、INV-77。

### members

```ts
members: defineTable({
  roomId: v.id("rooms"),
  userId: v.id("users"),
  role: roleV,                                // 写后不变
  displayName: v.string(),                    // 加入时快照；≤ 80；REDACTABLE；不进任何代理上下文
  joinedVia: v.union(v.literal("creator"), v.literal("invite"), v.literal("follow_up")),
  inviteId: v.optional(v.id("invites")),      // joinedVia === "invite" 时必有
  joinedAt: v.number(),
}).index("by_room_user", ["roomId", "userId"])
  .index("by_room_role", ["roomId", "role"])
  .index("by_user", ["userId"]),              // rooms.listMine
```

- 唯一插入 helper `addMember(tx, { userId, role, via, inviteId? })`，只被 `rooms.create`（creator 席）、`invites.accept`（含链接形态的 internal 写入口）、`rooms.startFollowUp`（新房间预分配同三位成员）调用；同事务先查 `by_room_role`（非空 → `invite.seat_taken`，12 §12.4 的码名）与 `by_room_user`（非空 → `invite.already_member`），再插入；房间写锁保证并发下只成功一个。seed 以 `--identity` 走 `invites.accept`，不直插（spikes §1：直插重复行会让 `.unique()` 永久失败关闭）。
- 判定代码对 `holders.length !== 1` 一律"不算齐"（08 §8.3.4），读取用 `take(2)` 而不是 `.unique()`（idempotent-execution review r08）。
- 披露类：`role` / `displayName` / `joinedAt` 为 `room`；`userId` / `inviteId` 为 `system`（DTO 给 `memberId`）。不变量：INV-15、INV-16。

### invites

```ts
invites: defineTable({
  roomId: v.id("rooms"),
  role: roleV,
  mode: v.union(v.literal("email"), v.literal("link")),
  invitedEmail: v.optional(v.string()),       // mode=email 必有：小写 + NFC，≤ 254；REDACTABLE
  tokenHash: v.optional(v.string()),          // mode=link 必有：SHA-256 hex，action 内生成；明文不入库
  status: v.union(v.literal("open"), v.literal("accepted"), v.literal("superseded")),
  expiresAt: v.number(),                      // createdAt + 72h；过期在 accept 时比较，不写状态
  createdBy: v.id("users"),
  acceptedBy: v.optional(v.id("users")),
  acceptedAt: v.optional(v.number()),
  createdAt: v.number(),
}).index("by_room_role", ["roomId", "role"])          // 新邀请把同角色 open 行置 superseded
  .index("by_email_status", ["invitedEmail", "status"]) // invites.listMine
  .index("by_tokenHash", ["tokenHash"]),               // 链接接受
```

- 写者：`invites.create`（邮箱形态）与 `invites.insertLink`（sysMutation，链接形态，由 v1 唯一公开 action `invites.createLink` 调用；名以 12 为准，07 §7.6 已同名）插入；`invites.accept` / 链接接受的 internal 写入口置 `accepted`。`mode` 与两个可选字段的互斥由 handler 断言。
- 披露类：`creator`（`invitedEmail` 另对被邀请人本人可见）；`tokenHash` 为 `system`。不变量：INV-16。

## 3.6 简报与披露

### briefs（只追加版本）

```ts
const customerHardV = v.object({ schemaKey: v.literal("scope_change.customer.v1"),
  requiredItemKeys: v.array(v.string()),      // 非空、去重、字典序、≤ 12；每个键必须属于本房间曾确认过的 item 键（confirmed ∪ retired，否则 item.unknown：关闭伪 itemKey 自由文本信道，07 LP-2）；已 retired 的必需项由规则报 item.required_missing(not_offered)
  deadline: v.string() });                    // IsoDate + 日期窗口
const providerHardV = v.object({ schemaKey: v.literal("scope_change.provider.v1") }); // v1 provider 硬约束只有目录（D05）
const financeHardV = v.object({ schemaKey: v.literal("scope_change.finance.v1"),
  capCents: v.number() });                    // assertCents，且 >= 当前 committedCents（D23）
const customerSoftV = v.object({ schemaKey: v.literal("scope_change.customer.v1"),
  preferredItemKeys: v.array(v.string()),     // 想要但非必需；与 requiredItemKeys 不相交；键同样须属于本房间曾确认过的 item 键
  notes: v.string() });                       // ≤ 2,000；只给本人与本方代理；REDACTABLE。v1 没有 preferredDate（14 §4）
const providerSoftV = v.object({ schemaKey: v.literal("scope_change.provider.v1"), notes: v.string() });
const financeSoftV = v.object({ schemaKey: v.literal("scope_change.finance.v1"), notes: v.string() });

briefs: defineTable({
  roomId: v.id("rooms"),
  role: roleV,
  version: v.number(),                        // (roomId, role) 内从 1 连续
  hardFields: v.union(customerHardV, providerHardV, financeHardV),
  softFields: v.union(customerSoftV, providerSoftV, financeSoftV),
  disclosures: v.record(v.string(), v.array(roleV)), // 字段 → 受众（本版本的披露决定）；空数组 = 不共享
  source: v.union(v.literal("form"), v.literal("set_cap"), v.literal("request_answer"), v.literal("soft_update")),
  humanRequestId: v.optional(v.id("humanRequests")), // source === "request_answer" 必有：追溯"cv N 由哪个取舍造成"
  confirmedBy: v.id("users"),
  confirmedAt: v.number(),
  provenance: provenanceV,
}).index("by_room_role_version", ["roomId", "role", "version"]),
```

- **只存已确认版本**，草稿只在浏览器（canon §1.1、minimal 候选"草稿是表单状态"）；"当前简报" = `by_room_role_version` 前缀 `(roomId, role)` 上 `order("desc").first()`。规则（`loadRuleInput`）、本方代理上下文、`briefs.mine` 都读当前版本；**任何他方投影都不读 briefs 行**，只读 `sharedFacts`（07 PV-05）。
- 唯一写入 helper `insertBriefVersion(tx, args)`，被 `briefs.confirm`、`budget.setCap`（复制 finance 当前版本、只替换 `capCents`）、`humanRequests.answer`（`drop_items` → customer 新 `requiredItemKeys`；`extend_deadline` → customer `deadline`；`raise_cap` → finance `capCents`）与 `briefs.updateSoft`（复制本角色最新已确认版本、只替换 `softFields.notes`，`source: "soft_update"`；只校验 notes，不调用 `materializeDisclosures`、不在 `withConstraintChange` 内，写 `brief_soft_updated` 而不写 `brief_confirmed`，12 §12.9）调用。步骤：校验（`schemaKey` 与 `role` 一致、值规则、customer 的 `requiredItemKeys` / `preferredItemKeys` 每个键 ∈ 本房间曾确认过的 item 键 confirmed ∪ retired（否则 `item.unknown`，只在 draft 行出现的键按 06 §4 报 `item.unconfirmed`；`appendSharedFact` 用同一集合，否则披露一个已 retired 的必需项会让整个确认失败，privacy-08）、`disclosures` 键 ∈ `SHAREABLE_FIELDS[role]` 且受众 ⊆ 允许受众，否则 `input.invalid`；finance `capCents < committedCents` → `budget.below_committed`，`params.minAllowedCapCents` 只给 finance）→ 与当前版本逐字段相等则返回 `unchanged`（不插行、不写事件、不计节流）→ `version = 当前 + 1` 插入 → `materializeDisclosures`；以上整体在 `withConstraintChange(cause: 'brief_confirmed' | 'human_answer')` 的 `apply` 内执行（09 §9.4：setup 期只写来源并 `openIfReady`；open 期由硬投影前后比较决定是否 bump）。
- 披露类：`hardFields` / `softFields` / `disclosures` / `source` 为 `self(role)`；`version` / `confirmedAt` / 确认状态为 `room`（07 DX-7）；`confirmedBy` / `humanRequestId` 为 `system`。不变量：INV-01、INV-02、INV-19、INV-24、INV-39。

