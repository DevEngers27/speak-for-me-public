# 07 · 权限、隐私与威胁模型（part3：认证与授权、成员与邀请、错误码）

> 分片列表见 `07-permissions-privacy.md` 顶部。

## 7.5 认证与授权

### 7.5.1 认证链（你是谁）

1. 浏览器经 Clerk 登录；`ConvexProviderWithClerk` 取 session token（原生集成，`aud = "convex"`，claim 含 `name`、`email`、`email_verified`）。
2. `convex/auth.config.ts` 读取 `CLERK_JWT_ISSUER_DOMAIN`，缺失即抛错 → 推送失败（fail-closed）；`applicationID: "convex"`。
3. Convex 函数内 `ctx.auth.getUserIdentity()`：query / mutation / action 未认证时返回 `null`；保证存在的字段只有 `tokenIdentifier` 与 `issuer`（convex `server/authentication.ts` 已核实）。
4. `users` 表以 `tokenIdentifier` 为唯一键（索引 `by_tokenIdentifier`）；用户行由 `users.ensureViewer`（userMutation，名称以 12 为准）幂等创建，claim 变化时 patch。其他表一律引用 `v.id("users")`，`tokenIdentifier` 永不进入任何 DTO。

### 7.5.2 Next 层：只做体验，不做防线

| 位置 | 行为 | 依据 |
| --- | --- | --- |
| `src/proxy.ts` | 先判 `isClerkConfigured()`：不满足 → 页面请求 rewrite 到 `/setup`，其他请求 503；满足才进入 `clerkMiddleware()` | techstack D23；skeleton spike（未配置时 `/rooms` → 307 `/setup?missing=clerk`） |
| 页面保护 | `proxy.ts` 在 `clerkMiddleware` 内对 `/rooms(.*)` 调 `auth.protect()`（11 §11.10 的 proxy 写法：对每个请求执行，未配置 Clerk 时能先于 Clerk 重定向到 `/setup`）；`(app)/layout.tsx` 再调一次 `auth.protect()` 只作客户端导航的乐观跳转兜底；`/invite` 与 `/setup` 豁免 | 同上；13 FE-D14 同此 |
| Route Handler（v1 只有无业务数据的 `/api/health`） | **自己** `const { userId } = await auth()`，为空即 `Response.json({ code: 'auth.unauthenticated' }, { status: 401 })`；不得依赖 proxy，因为 spike 实测 `auth.protect()` 对 JSON fetch 与 `/api/*` 返回 **307 到登录页**而不是 404 / 401 | inputs/05 B9；spikes §3 证伪 inputs/04 §3.5 |
| `/invite` 页 | 不调 `auth.protect()`；响应头 `Referrer-Policy: no-referrer`；链接 token 只在 URL fragment（`/invite#t=…`），服务端与 Clerk 托管页都看不到 | canon D24 |
| 客户端查询 | `useConvexAuth().isAuthenticated` 为真之前一律 `skip`；不做乐观更新 | canon D19 |
| 预取 | `preloadQuery` / `fetchQuery` 只调用与客户端相同的投影 query；结果以 `_valueJSON` 进入 RSC 负载，等同发给浏览器 | convex `nextjs/index.ts`（review #13） |

真正的授权只发生在 Convex 函数内。即使 proxy 配置缺失放行、或有人绕过 Next 直接用 Convex 客户端调用，结论不变（威胁 T-20，测试 TC-AUTH-01/02 不经 Next 直接调用）。

### 7.5.3 Convex 构造器（你在这个房间能做什么）

所有公开函数只能用以下构造器定义（ESLint 规则禁止在 `convex/` 业务模块直接 import `query` / `mutation`；构造器内置 `withSanitizedErrors`，见 §7.19）：

```ts
// convex/lib/functions.ts（构造器基于 convex-helpers customQuery / customMutation，版本见 11）
type Viewer = { userId: Id<"users"> };
type Member = Viewer & { room: Doc<"rooms">; role: RoleKey; memberId: Id<"members">; isCreator: boolean };

async function getViewer(ctx: QueryCtx): Promise<Viewer | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await ctx.db.query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  return user ? { userId: user._id } : null;
}
async function getMember(ctx: QueryCtx, roomId: Id<"rooms">): Promise<Member | null> {
  const viewer = await getViewer(ctx);
  if (!viewer) return null;
  const room = await ctx.db.get(roomId);
  if (!room) return null;
  const m = await ctx.db.query("members")
    .withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", viewer.userId))
    .unique();
  return m ? { ...viewer, room, role: m.role, memberId: m._id, isCreator: room.createdBy === viewer.userId } : null;
}
```

| 构造器 | 入口检查（顺序固定） | query 失败时 | mutation 失败时 |
| --- | --- | --- | --- |
| `anonQuery` | 无；必须附审查注释并登记白名单快照（v1 白名单只有不含任何房间数据的 `health.ping`，11 §11.2 / 12 §12.5） | — | — |
| `userQuery` / `userMutation` | identity 存在 → users 行存在 | `null` | `auth.unauthenticated` / `auth.user_not_provisioned` |
| `memberQuery` / `memberMutation`（args 必含 `roomId`，或由对象 id 解析房间） | 同上 → `members.by_room_user` 命中 | `null`（与房间不存在逐字节相同） | `auth.not_member`（不区分"不存在"与"非成员"） |
| `requireRole(member, roles)`（构造器选项 `roles`） | `member.role ∈ roles` | `null` | `auth.role_forbidden` |
| `requireCreator(member)`（构造器选项 `creatorOnly`） | `member.isCreator` | — | `auth.not_creator` |

约定：

1. 公开函数参数里没有 `userId`、`role`、`memberId`、`actorUserId`；"我"永远由服务端推导。涉及他人的参数只有不可伪造的对象 id（`proposalId`、`requestId`、`inviteId`），函数内校验该对象属于该房间（否则 `auth.not_member`）。public 函数快照测试（TC-AUTH-06）对出现这些参数名的公开函数直接失败。
2. 不存在接受私密表 id 的公开读函数：`briefs`、`humanRequests`、`turns`、`attempts`、`ledgerEntries` 只能经按 `(roomId, viewer.role)` 走索引的读函数访问（`briefs.mine`、本方代理记录查询、`rooms.view` 内的受控投影）。
3. 可执行状态守卫（`room.status`、`run.status`、`expected*`）一律在 mutation 内重读，不信任客户端展示过的状态。

### 7.5.4 被调度函数与 `actorUserId`

- spike 实测：被调度的 mutation 与 action 内 `getUserIdentity()` 为 `null`，即使调度者已登录（inputs/05 B4；生产行为待验证，spikes §8 #3，设计不依赖）。
- 规则：所有 internal mutation / action 由 `internalMutationWithActor` / `internalActionWithActor` 构造，参数显式含 `actorUserId: v.id("users")`（系统触发的 cron 用 `actorUserId: null` 并在事件中记 `actor: { kind: "system" }`）；该值只能由已鉴权的公开 mutation 或 cron 写入调度参数。
- `actorUserId` 只用于**归属**（事件 actor、约束修订的 `actorUserId`、节流计数），**不是授权来源**：代理回合的角色一律从 `turns.role` 记录推导（`buildAgentContext` 的入参是 `attemptId`），不接受角色参数。
- 内部函数入口做一次廉价的纵深校验 `assertActorIsMember(roomId, actorUserId)`（v1 无换人，正常路径恒真；将来支持换人时，旧成员的在途调度因此失效）。
- 静态测试：`convex/` 中 internal 函数体内出现 `ctx.auth.getUserIdentity` 即失败（TC-AUTH-10）。

### 7.5.5 creator（建房人）的附加权限

creator 同时占有一个角色席位；额外权限只有：`rooms.close`、`invites.create` / `invites.createLink`、`runs.requestRenegotiation`（run 处于 `pending_approval` / `needs_input`，canon C40）、`runs.cancel`。`rooms.startFollowUp` 对旧房间任一成员开放（每个执行至多一个后续房间，按 `followsExecutionId` 幂等，12 §12.6）。creator **没有**任何审批、回答他人请求、修改他人简报或指定审批人的能力；必需审批角色由场景快照到 `proposal.requiredApprovals`（TC-AUTH-08）。

## 7.6 成员、席位与邀请

| 步骤 | 函数 | 关键检查（同一事务内） | 写入 |
| --- | --- | --- | --- |
| 1 建房 | `rooms.create`（userMutation）`{ title, scenarioKey, timeZone, myRole }`（参数名以 12 §12.6 为准） | `scenarioKey` 已注册；`myRole` ∈ 场景角色；`title` NFC、按码点限长；`timeZone` 合法（建房后固定）；节流 `room_create` | `rooms`（`status: 'setup'`、`createdBy`、`provenance`）、creator 的 `members` 行（`addMember(via: 'creator')`）、事件 `room_created`、`member_joined{role}` |
| 2a 邮箱邀请 | `invites.create`（memberMutation，`creatorOnly`）`{ roomId, role, invitedEmail }` | `room.status === 'setup'`；`members.by_room_role` 为空（`invite.seat_taken`）；同角色 `open` 邀请置 `superseded`（03 §3.5 的状态值） | `invites`（`mode: 'email'`、`invitedEmail` 小写规范化、无 token、`expiresAt = now + 72h`）；事件 `invite_created{role}`（不含邮箱） |
| 2b 链接邀请 | `invites.createLink`（v1 唯一的公开 action）→ `internal.invites.authorizeLink` / `insertLink` | action 用 `crypto.getRandomValues` 生成 32 字节 token、算 SHA-256；internal mutation 复核 creator、`setup`、席位空缺（action 与 mutation 之间状态可能已变） | `invites`（`mode: 'link'`、只存 `tokenHash`；写入 helper 名以 12 为准 `invites.insertLink`）；明文只在 action 返回值里出现一次，前端拼成 `/invite#t=…` |
| 3 列出 | `invites.listMine`（userQuery） | `identity.emailVerified === true` 且 `invitedEmail === identity.email`；未验证时返回空列表 | 只读：`{ inviteId, roomTitle, role, invitedByDisplayName, expiresAt }` |
| 4 接受 | `invites.accept`（userMutation）`{ invite: { by: 'email', inviteId } \| { by: 'link', token } }` | 邮箱形态：`emailVerified` 为真（否则 `invite.email_unverified`）且邮箱相等（否则 `invite.invalid`）；链接形态：`sha256Hex(token)` 查 `by_tokenHash`；邀请 `open` 且 `now < expiresAt`（过期在 accept 时比较，不写状态，03 §3.5）；`room.status === 'setup'`；`members.by_room_user` 为空（`invite.already_member`）；`members.by_room_role` 为空（`invite.seat_taken`）；先查后写，OCC 保证并发下只成功一个（L2 探针 `join_same_role`） | `members`（`displayName` 快照自 claim `name`）、邀请置 `accepted`、事件 `member_joined`；末尾 `openIfReady`（04 M2） |

不变量：每个 `(roomId, role)` 至多一个 `members` 行；每个 `(roomId, userId)` 至多一个 `members` 行；用户不能自选角色（角色只来自邀请）；v1 席位一旦绑定不可解绑或更换，错人占席的处置是 creator 关闭房间、重新建房（旧房间历史保留，换人列入 17）。`displayName` 对房间成员可见，但从不进入任何代理上下文（注入面）。

## 7.7 鉴权与房间状态错误码

与 reasonCode 同一命名空间（小写点分，单一来源 `core/engine/reasonCodes.ts`，与 12 §12.4 一致）：

| code | 触发 | params（受众） |
| --- | --- | --- |
| `auth.unauthenticated` / `auth.user_not_provisioned` | 无 identity / 有 identity 无 users 行 | — |
| `auth.not_member` | 非成员访问房间、或对象不属于该房间、或对象不存在 | —（不暴露是否存在） |
| `auth.role_forbidden` / `auth.not_creator` | 角色不在允许集（含非 `toRole`、非必需审批人、非被指派角色）/ 仅 creator 可做 | — |
| `invite.invalid` | 邀请不存在 / 过期 / 已被取代（`superseded`）/ 已被使用 / 邮箱不匹配 / token 哈希不匹配（统一一个码，防探测） | — |
| `invite.email_unverified` | 邮箱定向邀请但 `ctx.viewer.emailVerified !== true`（`identity.emailVerified` 缺失按假） | — |
| `invite.seat_taken` / `invite.already_member` | 席位已占 / 本人已是成员 | `role` |
| `request.not_open` / `request.option_unknown` | 人工请求已回答 / 过期 / 被取代；`optionKey` 不在请求选项中 | — |
| `input.invalid` | 文本长度、字符集、枚举、条数上限不符 | `field` |
| `run.invalid_state` | 房间 `executed` / `closed` 时的协商类写入、run 状态不符 | `{ guard }`（房间可见值） |
| `run.rate_limited` | 五个节流桶之一超限（12 B7：`constraint_writes` 每用户每房间每小时 6 次；`soft_writes`（`briefs.updateSoft`）每用户每房间每小时 30 次；`price_writes` 每房间每 24 小时 3 批改价及其 `setCap` / customer 硬字段子桶 6 次；`run_starts` 每房间每 24 小时 6 个 run；`room_create`）或每人每提案 approve 行上限（08 S9） | `{ retryAfterMs }`（调用者本人；不说明是哪个桶、也不说明房间桶被谁用掉） |
| `disclosure.blocked` / `disclosure.needs_own_confirmation` | 披露闸门（§7.15 LP-3） | `{ field }`（调用者本人的字段） |
| `internal` | 非 `ConvexError` 异常被 `withSanitizedErrors` 吞掉 | — |

全表与其余码（`approval.*`、`version.stale_constraints`、`date.*`、`item.*`、`amount.out_of_range`、`budget.below_committed`）以 12 §12.4 为准；本章只规定它们的 params 受众（§7.11）。

`executed` 房间的例外：`tasks.markDone`（被指派人勾选任务）与 `rooms.startFollowUp` 仍允许（§7.12）。
