# 03 Convex schema v1（part1）：约定、身份与房间

> 分片：part1 约定、共享 validator、身份与房间（users、rooms、participants、invites、systemState）；part2 简报、目录、约束版本、提案、审批决定、执行与场景记录；part3 运行时表（runs、turns、modelCalls）、人工请求、事件、用量、抽取任务；part4 唯一性落点、不变量落点。
> 文件：`convex/schema.ts` 组合引擎表与场景表；字面量与 validator 在 `convex/engine/literals.ts`、`convex/lib/validators.ts`；场景 validator 在 `convex/scenarios/scopeChange/validators.ts`。

## 3.1 约定

1. **单一来源**：每个枚举先写成 `as const` 字面量数组（如 `RUN_STATUSES`），再由 `literalsV(RUN_STATUSES)` 生成 Convex validator；Zod 侧（只用于模型 I/O 与场景表单校验）用 `z.enum(RUN_STATUSES)`。加一条编译期断言 `type _ = Assert<Equal<Infer<typeof runStatusV>, (typeof RUN_STATUSES)[number]>>`，防止漂移（F03.13）。
2. **Convex `v` 管存储与函数参数**，`Infer` 导出 TS 类型；Zod 只管模型输入输出与场景结构化字段的范围校验。`v.*` 不表达范围、长度、格式（inputs/04 §1.8），这些由 `assert*` 函数在每个写入口校验。
3. **金额**：`v.number()` 存整数美分；所有写入口调用 `assertCents(n)`：`Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000`。v1 不支持负金额。
4. **日期**：`YYYY-MM-DD` 字符串；`assertCalendarDate(s)` 校验真实日历日（拒绝 2026-02-30，RA-B10），通过后按字典序比较。时间戳一律 `v.number()` 毫秒。
5. **身份引用**：一律 `v.id("users")`；`users.tokenIdentifier` 是外部身份的唯一映射（inputs/04 §1.7）。业务函数从不接受 userId / roleKey 参数。
6. **不可变表**：`briefVersions`、`catalogItems`、`constraintVersions`、`proposals`、`decisions`、`executions`、`changeOrders`、`commitments`、`events` 只插入、永不 patch / delete（核心 6）。代码审查清单 + 16 的 IM-* 用例（对这些表的 `db.patch` / `db.replace` / `db.delete` 调用做静态扫描）。
7. **私密数字不进入共享文档**：凡是会被多个角色读取的文档（proposals、events 的 room 受众行、runs 的候选快照），不得存放只对部分角色可见的数值（预算上限、已承诺额、余量、私密截止日）。这些数值只存在于其所有者可读的表（简报版本、约束快照）中，由查询时的投影按查看者计算（07）。
8. **索引命名**：`by_<字段>_and_<字段>`，包含全部字段（inputs/04 §1.6）。查询只用 `withIndex`，不用 `.filter` 扫描；`.collect()` 只用于有明确上界的结果集（每房间的参与者、某 run 的 turn 等）。

## 3.2 共享 validator

```ts
// convex/lib/validators.ts（节选）
export const roomStatusV   = literalsV(["open", "closed"] as const);
export const agentModeV    = literalsV(["live", "stub"] as const);
export const approvalKindV = literalsV(["terms", "budget"] as const);
export const audienceV = v.union(                      // 简报字段披露与事件受众共用
  v.object({ kind: v.literal("private") }),
  v.object({ kind: v.literal("roles"), roleKeys: v.array(v.string()) }),
  v.object({ kind: v.literal("room") }),
);
export const eventAudienceV = v.union(
  v.object({ kind: v.literal("room") }),
  v.object({ kind: v.literal("roles"), roleKeys: v.array(v.string()) }),
  v.object({ kind: v.literal("participant"), participantId: v.id("participants") }),
);
export const paramV = v.union(v.string(), v.number(), v.boolean(), v.array(v.string()));
export const checkV = v.object({            // 只存结果码，不存数值（3.1 第 7 条）
  checkId: v.string(), ok: v.boolean(), reasonCode: v.string(),
});
```

## 3.3 身份与房间

### users —— 外部身份到内部主键的映射

```ts
users: defineTable({
  tokenIdentifier: v.string(),       // identity.tokenIdentifier（iss + sub），唯一
  subject: v.string(),               // Clerk user id，仅展示与对账
  issuer: v.string(),
  displayName: v.string(),           // 首次登录取 identity.name，取不到让用户填写
  createdAt: v.number(),
}).index("by_tokenIdentifier", ["tokenIdentifier"]),
```

唯一入口 `getOrCreateUser(ctx)`（在 `users.ensure` 与所有需要写入的 public mutation 开头调用）：按索引 `.unique()` 查，查不到再插。不存 email（不需要；减少个人数据）。

### rooms

```ts
rooms: defineTable({
  scenarioKey: v.string(),           // "scope_change"
  scenarioVersion: v.number(),       // 创建时固定
  title: v.string(), goal: v.string(),   // 共享事实，全体参与者可见；goal 不进入规则（Q12）
  timeZone: v.string(),              // IANA，例如 "America/Los_Angeles"；"今天"按它计算
  currency: v.literal("USD"),        // v1 只支持 USD；字段保留以便扩展
  status: roomStatusV,
  createdBy: v.id("users"),
  constraintsVersion: v.number(),    // 只由 bumpConstraints 修改（I3）
  proposalSeq: v.number(),           // 只由 insertProposal 修改；提案 version = ++proposalSeq（I2）
  runSeq: v.number(),                // 只由 startRunTx 修改
  currentRunId: v.optional(v.id("runs")),          // 只由 startRunTx / supersedeRunTx 修改
  currentProposalId: v.optional(v.id("proposals")),// 只由 insertProposal 修改
  agentMode: agentModeV,             // 创建时取 AGENT_MODE
  isSimulated: v.boolean(),          // 种子房间为 true，界面常驻横幅
  fixtureKey: v.optional(v.string()),
  modelCallLimit: v.optional(v.number()),          // 覆盖 MAX_MODEL_CALLS_PER_ROOM，仅运维可改
  testFaultPlan: v.optional(v.array(faultPlanEntryV)),   // 仅非生产 seed 可写（10 part6）
  createdAt: v.number(), closedAt: v.optional(v.number()),
}).index("by_createdBy", ["createdBy"])
  .index("by_fixtureKey", ["fixtureKey"]),
```

房间上**没有**预算、已承诺额、run 状态、提案状态（原方案 DM-01 的问题全部移走）。`rooms` 是几乎所有守卫都会读的文档，所以刻意不放任何高频计数器（10 part4 §10.10）。

### participants —— 房间里的角色席位

```ts
participants: defineTable({
  roomId: v.id("rooms"),
  roleKey: v.string(),               // 场景声明的角色键；写入时校验属于场景
  userId: v.id("users"),
  displayName: v.string(),           // 加入时快照
  status: v.literal("active"),       // v1 不支持移除；字段为将来的 removed 预留
  joinedAt: v.number(),
}).index("by_room_and_roleKey", ["roomId", "roleKey"])
  .index("by_room_and_userId", ["roomId", "userId"])
  .index("by_userId", ["userId"]),
```

首个场景：每个角色恰好一人，一人只能占一个角色（F02.6、F07.9），由 `invites.accept` 与 `rooms.create` 在同一 mutation 内按两个索引先查后插保证。没有 `approvalRequired` 字段：谁必须批准由场景声明、在提案创建时快照（08 §8.2）。

### invites

```ts
invites: defineTable({
  roomId: v.id("rooms"),
  roleKey: v.string(),
  tokenHash: v.string(),             // SHA-256(明文令牌) 的 hex；明文只在创建时返回给创建者一次
  createdBy: v.id("users"),
  status: literalsV(["open", "accepted", "revoked"] as const),
  expiresAt: v.number(),             // 默认创建后 7 天；expired 为读取时派生
  acceptedBy: v.optional(v.id("users")),
  acceptedAt: v.optional(v.number()),
  createdAt: v.number(),
}).index("by_tokenHash", ["tokenHash"])
  .index("by_room_and_roleKey", ["roomId", "roleKey"]),
```

令牌在 `invites.create`（public action）中用 `crypto.getRandomValues` 生成 32 字节随机数、`crypto.subtle.digest` 求哈希（action 运行时的 Web Crypto 可用性待验证；不放在 mutation 里是因为 mutation 的随机数为确定性播种，不宜用于安全令牌），再调用 internal mutation `invites.storeInvite` 落库。

### systemState —— 部署级开关

```ts
systemState: defineTable({
  key: v.literal("agents"),
  circuit: literalsV(["closed", "open"] as const),
  reasonCode: v.optional(v.string()),          // MODEL_AUTH / MODEL_QUOTA / MODEL_NOT_FOUND
  openedAt: v.optional(v.number()),
  openedByAttemptId: v.optional(v.id("modelCalls")),
  modelVerifiedAt: v.optional(v.number()),     // ops.checkModelAccess 成功时间
}).index("by_key", ["key"]),
```

只有一行；不存在时视为 closed。写入只发生在熔断打开（apply / watchdog）与运维重置时，读多写极少，不构成热点。
