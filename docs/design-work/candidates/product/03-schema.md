# 03 Convex schema v1（part1）：约定、共享校验器、身份与房间

> 本章分 5 片：part1（本文件）约定、共享校验器、users/rooms/seats/invites；part2 简报、清单、约束修订、台账；part3 提案、签核、执行、任务；part4 run、回合、人工请求、事件；part5 唯一性与不变量落点、rooms 字段写入口、scope_change 载荷校验器、演进规则。

## 3.1 约定

1. 表定义在 `convex/engine/tables.ts` 的工厂 `engineTables(P)` 中，`P` 是组合层传入的场景载荷校验器（06 第 6.14 节）。引擎表名固定，场景不新增表。
2. 金额：`v.number()` 存整数美分，所有入口调用 `assertCents`（06 第 6.8 节）。不用 `v.int64()`：安全整数范围足够，且避免 bigint 在前后端的序列化差异（F03.13）。
3. 日期：`v.string()` 存 `YYYY-MM-DD`，入口 `isIsoCalendarDate`；时间戳：`v.number()` 毫秒。
4. 外键一律 `v.id("table")`；身份一律 `v.id("users")`，不存裸 Clerk subject（I-1）。
5. 枚举用 `v.union(v.literal(...))`，在 `convex/engine/validators.ts` 定义一次并导出类型（`Infer`）；Zod 只用于模型输入输出（05），两处的枚举用编译期断言保持一致。
6. 索引名包含全部字段（`by_room_list_key_version`）。Convex 没有唯一约束，"唯一"写在 part5 的落点表里。
7. `.collect()` 只用于有明确上界的集合（一个房间的席位、一个提案的签核、一个房间的已确认清单项）；事件与历史用 `paginate`。
8. 长度上限在 mutation 内断言（`v.string()` 不表达长度）：title ≤ 120、goal ≤ 2,000、notes ≤ 4,000、sharedNote ≤ 500、changeReason ≤ 300、decision note ≤ 500、rationale ≤ 1,200。

## 3.2 共享校验器（`convex/engine/validators.ts`）

```ts
import { v } from "convex/values";

export const actorV = v.union(
  v.object({ kind: v.literal("user"), userId: v.id("users"), seatId: v.optional(v.id("seats")) }),
  v.object({ kind: v.literal("agent"), seatId: v.id("seats"), runId: v.id("runs"), turnId: v.id("turns") }),
  v.object({ kind: v.literal("system") }),
);

// 披露对象：本席位简报的某字段、本席位拥有的派生事实、共享说明
export const ownFieldRefV = v.union(
  v.object({ kind: v.literal("brief"), fieldKey: v.string() }),
  v.object({ kind: v.literal("derived"), factKey: v.string() }),
  v.object({ kind: v.literal("shared_note") }),
);
export const audienceV = v.union(
  v.object({ kind: v.literal("room") }),
  v.object({ kind: v.literal("roles"), roleKeys: v.array(v.string()) }),
);
export const disclosureV = v.object({ ref: ownFieldRefV, audience: audienceV });

// 事件受众（按席位而非角色，写入时确定）
export const eventAudienceV = v.union(
  v.object({ kind: v.literal("room") }),
  v.object({ kind: v.literal("seats"), seatIds: v.array(v.id("seats")) }),
);

export const usageV = v.object({
  inputTokens: v.number(), cacheCreationInputTokens: v.number(),
  cacheReadInputTokens: v.number(), outputTokens: v.number(), thinkingTokens: v.number(),
});
```

没有 `shared_note` 的披露项时，共享说明不对任何人可见（默认私密直到勾选）。

## 3.3 `users`

```ts
users: defineTable({
  tokenIdentifier: v.string(),        // iss + sub，全局唯一（04 平台约束 1.7）
  issuer: v.string(),
  subject: v.string(),                // Clerk user id，仅用于对账与展示
  displayName: v.string(),            // 取 identity.name，缺失时由用户在首次进入时填写
  email: v.optional(v.string()),      // 仅本人可见；是否由 Clerk JWT 提供待验证
  createdAt: v.number(),
  lastSeenAt: v.number(),
}).index("by_token", ["tokenIdentifier"]),
```

- 写入口：`users.ensureMe`（mutation，按 `by_token` 先查后插，幂等）。`lastSeenAt` 最多每 10 分钟更新一次，避免热点写。
- 解决：统一身份引用（DM-19）、显示名来源（F02.6）。

## 3.4 `rooms`

```ts
rooms: defineTable({
  scenarioKey: P.scenarioKey,
  scenarioVersion: v.number(),        // 建房时的插件版本；规则语义变化时插件升版本
  title: v.string(),
  goal: v.string(),                   // 共享目标，全体成员可见，不进入规则
  timeZone: v.string(),               // IANA，例如 "America/Los_Angeles"
  currency: v.literal("USD"),
  status: v.union(v.literal("open"), v.literal("closed")),
  ownerUserId: v.id("users"),
  constraintsVersion: v.number(),     // 建房为 0
  proposalSeq: v.number(),            // 已分配的最大提案版本
  runSeq: v.number(),
  executionSeq: v.number(),           // 变更单编号 CO-n
  ledgerSeq: v.number(),              // 台账条目序号
  currentProposalId: v.optional(v.id("proposals")),
  activeRunId: v.optional(v.id("runs")),
  lastExecutionId: v.optional(v.id("executions")),
  negotiationOpen: v.boolean(),       // true：约束变化可自动开 run；执行后置 false，requestRun 置 true
  dayStamp: v.string(),               // 房间时区下的"今天"，由定时任务刷新（10 第 10.9 节）
  isSimulated: v.boolean(),
  fixtureKey: v.optional(v.string()),
  createdAt: v.number(),
  closedAt: v.optional(v.number()),
})
  .index("by_owner", ["ownerUserId"])
  .index("by_status", ["status"])
  .index("by_fixture", ["fixtureKey"]),
```

- 不含任何预算字段（GAP-01、RA-B08）。不含单一 `status` 状态机：协商进度在 `runs`，可执行性实时派生，阶段由 04 第 4.9 节派生。
- `dayStamp` 的作用：query 里用 `Date.now()` 计算日期会被结果缓存冻结（待验证），因此 query 以 `dayStamp` 为 today，mutation 以实时计算值为准；每小时任务在跨日时 patch，触发依赖日期的订阅重算。
- 热点：房间文档被多数 mutation 读写，OCC 冲突概率随并发上升；规模假设（H3）下可接受。不把高频字段（如 `lastSeenAt`）放在房间上。

## 3.5 `seats`

```ts
seats: defineTable({
  roomId: v.id("rooms"),
  roleKey: v.string(),                // 必须属于房间场景声明的角色
  status: v.union(v.literal("open"), v.literal("filled")),
  userId: v.optional(v.id("users")),
  displayName: v.optional(v.string()),// 加入时快照
  joinedAt: v.optional(v.number()),
})
  .index("by_room", ["roomId"])
  .index("by_room_role", ["roomId", "roleKey"])
  .index("by_room_user", ["roomId", "userId"])
  .index("by_user", ["userId"]),
```

- 建房时按场景角色一次性创建（v1 每角色 1 席）。签核要求不存在席位上（否决 `approvalRequired` 开关，RO-07），由场景 `RoleSpec.signoff` 声明并快照进提案。
- `filled` 后不可改回 `open`（v1 不支持换人）。

## 3.6 `invites`

```ts
invites: defineTable({
  roomId: v.id("rooms"),
  seatId: v.id("seats"),
  tokenHash: v.string(),              // SHA-256(token) 十六进制；明文只在创建响应中返回一次
  status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked")),
  createdByUserId: v.id("users"),
  createdAt: v.number(),
  expiresAt: v.number(),              // 默认 7 天；"expired" 为读时派生
  acceptedByUserId: v.optional(v.id("users")),
  acceptedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
})
  .index("by_token_hash", ["tokenHash"])
  .index("by_seat", ["seatId"]),
```

- 令牌在 action 中用 `crypto.getRandomValues` 生成 32 字节、base64url 编码，哈希后交 internal mutation 存储；mutation 中的随机数与 `crypto.subtle` 是否可用于安全用途待验证，因此生成与哈希放在 action（12）。
- 同一席位新建邀请时，同一 mutation 内把该席位旧的 pending 邀请置 `revoked`（每席位至多一个 pending）。
