# 12 · 后端函数目录（part2）：users / health、rooms 写入、invites

> 条目格式：**args / returns**（Convex validator）→ **守卫**（按顺序，第一个失败者决定错误码）→ **读 / 写**（表）→ **幂等** → **失败码**。共用 validator（`roleV`、`provenanceV`、`termsV` …）在 `convex/lib/validators.ts`（03 §3.4）。数据层 helper 名取自 03 §3.13。

## 12.5 users 与 health

#### `users.viewer` · userQuery（未建档时例外地执行 handler）
- **args** `{}`；**returns** `v.union(v.null(), v.object({ status: v.literal("unprovisioned") }), v.object({ status: v.literal("ready"), userId: v.id("users"), displayName: v.string(), emailVerified: v.boolean() }))`
- **读** `users.by_tokenIdentifier`；`emailVerified` 取构造器注入的 `ctx.viewer.emailVerified`（11 §11.6：仅当 Convex `UserIdentity.emailVerified === true` 时为真，缺失按假；JWT 模板里的 claim 名是 `email_verified`，代码不直接读 claim；`users` 不存邮箱，03 §3.5）。前端拿到 `unprovisioned` 时先调 `users.ensureViewer`，建档完成前不挂任何业务 query（techstack D23）；所有查询在 `useConvexAuth().isAuthenticated` 为真之前 `skip`（D19）。

#### `users.ensureViewer` · userMutation（`provision: true`）
- **args** `{}`；**returns** `v.object({ userId: v.id("users"), changed: v.boolean() })`
- **守卫** 有身份（`auth.unauthenticated`）。
- **写** `users`（唯一写者，03 §3.13.2）：按 `tokenIdentifier` 先查后插；已存在且 claim 变化时 patch `displayName` / `isTestAccount` / `updatedAt`。`displayName` 取 claim `name`（NFC、trim、≤ 80 码点）；取不到时写 `"Member"`，由用户在资料页修改。`isTestAccount` 按 issuer 属于 Clerk dev 实例判定（techstack D20）。不经 `openRoomTx`（全局行），不写事件。
- **幂等** 自然幂等；并发的首次登录由 OCC 对 `by_tokenIdentifier` 区间读的冲突串行化；万一出现重复行，`.unique()` 失败关闭并由 `ops.auditUsers` 报告（03 §3.14）。

#### `health.ping` · anonQuery
- **args** `{}`；**returns** `v.object({ ok: v.literal(true) })`。不读任何表；供 `/setup` 页与发布后冒烟确认部署可达。白名单内唯一的匿名函数。

## 12.6 rooms（写入；查询见 part5）

#### `rooms.create` · userMutation · 节流 `room_create`
- **args** `{ title: v.string(), scenarioKey: v.literal("scope_change"), timeZone: v.string(), myRole: roleV }`；**returns** `v.object({ roomId: v.id("rooms") })`
- **守卫** ① `title`：NFC、trim 后 1–120 码点、无控制字符与 `<` `>`（`input.invalid{field:"title"}`）；② `scenarioKey` 已在 `convex/scenarios/registry.ts` 注册，钉住当前 `scenarioVersion`；③ `timeZone` 是有效 IANA 名（`Intl.DateTimeFormat` 校验，V-D2 待验证；不通过 `input.invalid{field:"timeZone"}`）；④ 节流 `room_create`。
- **写** `rooms`（`status: "setup"`、`constraintsVersion: 0`（打开时由 `openIfReady` 变为 1，04 M2）、`localDate = todayInTimeZone(nowMs, timeZone)`、`nextProposalVersion: 1`、`nextRunNo: 1`、`writeSeq: 0`、`createdBy`、`provenance: "live"`）；`members`（`addMember(tx, { via: "creator", role: myRole })`）；`events`：`room_created`、`member_joined{role}`。
- **幂等** 非幂等（每次新房间）；前端提交后禁用按钮。**失败码** `auth.unauthenticated`、`auth.user_not_provisioned`、`input.invalid`、`run.rate_limited`。
- 房间标题只给成员看：不进任何代理上下文、不进事件 payload（D13：唯一进入他方上下文的人写字符串是目录 `title`）。

#### `rooms.close` · memberMutation · `creatorOnly`
- **args** `{ roomId: v.id("rooms") }`；**returns** `v.object({ status: v.union(v.literal("closed"), v.literal("unchanged")) })`
- **守卫** ① 创建者（`auth.not_creator`）；② `room.status === "closed"` → 返回 `unchanged`；③ `openRoomTx(allow: ["setup", "open"])`（`executed` → `run.invalid_state{guard:"room_status"}`）。
- **写** 当前非终态 run → `canceled`（`endedReason: "room_closed"`），其 `active` 提案 → `superseded`，非终态 turn → `stale`，open 请求 → `superseded`（`closedReason: "room_closed"`）；`rooms.status → "closed"`、`closedAt`；`events`：`run_ended`（如有）、`room_closed`。未接受的邀请不改行：`invites.accept` 要求房间 `setup`，随房间关闭自然失效（04 M4）。在途 attempt 不取消，其提交被守卫 G1 拒收（D07）。
- **幂等** 自然幂等。**失败码** `auth.not_member`、`auth.not_creator`、`run.invalid_state`。没有任何 `humanRequest` 选项映射到本函数（D15）。

#### `rooms.startFollowUp` · memberMutation（房间由 `executionId` 解析）· 节流 `room_create`
- **args** `{ executionId: v.id("executions") }`；**returns** `v.object({ roomId: v.id("rooms"), created: v.boolean() })`
- **守卫** ① 调用者是旧房间任一成员（`auth.not_member`；04 / 07 一致）；② 旧 `room.status === "executed"`（`run.invalid_state{guard:"room_status"}`；旧房间以 `openRoomTx(allow: ["executed"])` 打开，只更新写锁）；③ 已有 `followsExecutionId = executionId` 的房间 → 返回 `{ roomId: 既有, created: false }`（读 `rooms.by_followsExecutionId`，03 §3.5；双击 / 并发由旧房间写锁串行，只建一个；不计节流）；④ 节流。
- **写**（D04）新 `rooms`（`status: "setup"`、同 `scenarioKey` / `scenarioVersion` / `timeZone`、标题为旧标题截断后加模板后缀 ` · follow-up`、`followsExecutionId`、`createdBy` = 调用者、`provenance = inheritProvenance(旧房间, followedExecution)`（03 §3.3.3：旧执行非 `live` 时后续房间也不是 `live`））；`members`：`addMember(via: "follow_up")` 为旧房间三位成员预分配同角色席位（无需重新邀请）；`catalogItems`：`appendCatalogRow` 只把旧房间中 **`itemKey ∉ followedExecution.terms.itemKeys`** 的当前已确认行（modifier 可复制）复制为新房间的 `status: "draft", revision: 0, editNo: 0`（provider 需重新确认，03 §3.7）；已执行的条目不复制、在新房间只读显示 "Delivered in CO-{n}"（数据来自 `rooms.view.followUpOf`，§12.17）——否则 stub / 模型的默认路径（provider stub 选"条目数最多"的候选、customer / finance stub 在硬约束满足时建议接受）会把已执行范围再提一次、再承诺一次（invariants-06）；provider 若确实要再卖同一项，须用新的 itemKey 显式确认（新范围，由人决定）——`catalog.confirm` 在后续房间拒绝重用已交付的 itemKey（§12.12 守卫 ④），`briefs.confirm` 的必需项也只能取本房间确认过的键（§12.9 守卫 ⑤），所以已交付键在新房间既不能上架、也不能被要求；新房间 `events`：`room_created`、三条 `member_joined`；旧房间 `events`：`follow_up_started{followUpRoomId}`。**不写**简报与台账：三方简报重新确认；finance 的基线在新房间的 `rooms.view` 中预填旧执行的 `committedAfterCents`（只给 finance），必须由 finance 经 `ledger.recordBaseline` 确认才写入。
- **读** `executions`、旧 `rooms`、`members.by_room_role`、`catalogItems.by_room_item`。
- **幂等** 派生键幂等（每个执行至多一个后续房间）。**失败码** `auth.not_member`、`run.invalid_state`、`run.rate_limited`。

## 12.7 invites

两种形态共用一个接受入口（D24、03 §3.5）：默认邮箱定向（`mode: "email"`，`invitedEmail` 必填、无 token）；不知道邮箱时用单次链接（`mode: "link"`，只存 `tokenHash`，token 放 URL fragment `/invite#t=…`）。`status ∈ open | accepted | superseded`；有效期 72 小时，过期在接受时比较、不写状态；只能在房间 `setup` 阶段创建与接受。

#### `invites.create` · memberMutation · `creatorOnly`
- **args** `{ roomId: v.id("rooms"), role: roleV, invitedEmail: v.string() }`；**returns** `v.object({ inviteId: v.id("invites"), expiresAt: v.number() })`
- **守卫** ① 创建者；② `openRoomTx(allow: ["setup"])`（`run.invalid_state{guard:"room_status"}`）；③ `members.by_room_role` 该角色无人（`invite.seat_taken`）；④ `invitedEmail` NFC + 小写，≤ 254 字符且形如邮箱（`input.invalid{field:"invitedEmail"}`）。
- **写** 同角色既有 `open` 邀请 → `superseded`；`invites` 插入（`mode: "email"`、`role`、`invitedEmail`、`status: "open"`、`expiresAt = nowMs + 72h`、`createdBy`）；`events`：`invite_created{role, mode}`（payload 不含邮箱）。v1 不发邮件（通知列入 17），创建者自行告知对方登录查看。
- **幂等** 非幂等（每次一条新邀请并取代旧的，重复调用无害）。**失败码** `auth.not_creator`、`run.invalid_state`、`invite.seat_taken`、`input.invalid`。

#### `invites.createLink` · userAction（唯一公开 action）
- **args** `{ roomId: v.id("rooms"), role: roleV }`；**returns** `v.object({ inviteId: v.id("invites"), token: v.string(), expiresAt: v.number() })`
- **步骤** ① `ctx.runQuery(internal.invites.authorizeLink, { roomId, role, actorUserId })`：同 `invites.create` 的守卫 ①–③，失败抛对应码；② 在 action 内生成 32 字节随机数（Web Crypto `getRandomValues`），base64url 编码为 `token`，`tokenHash = sha256Hex(token)`；③ `ctx.runMutation(internal.invites.insertLink, { roomId, role, tokenHash, actorUserId })`；④ 返回明文 `token`（只此一次），前端拼成 `/invite#t=${token}`。
- **为什么是 action**：mutation 内随机数是确定性播种的，不宜做安全令牌（D24）。代价：断线时 action 直接失败、不重发，用户重试即可——每次都生成新 token 并取代同角色旧的 open 邀请。
- **失败码** 同 `invites.create`（`input.invalid` 除外）。

#### `invites.authorizeLink` · sysQuery
- **args** `{ roomId, role, actorUserId: v.id("users") }`；**returns** `v.null()`；读 `rooms`、`members`；守卫同上，失败抛错。

#### `invites.insertLink` · sysMutation（代表用户）
- **args** `{ roomId, role, tokenHash: v.string(), actorUserId: v.id("users") }`；**returns** `v.object({ inviteId, expiresAt })`
- **守卫** 在 `openRoomTx(allow: ["setup"])` 内重新执行创建者与席位空缺检查（action 与 mutation 之间状态可能已变，inputs/04 §1.4）。**写** 同角色 open 邀请 → `superseded`；`invites` 插入（`mode: "link"`、`tokenHash`、`status: "open"`、`expiresAt`）；`events`：`invite_created{role, mode}`。

#### `invites.listMine` · userQuery
- **args** `{}`；**returns** `v.union(v.null(), v.object({ emailVerified: v.boolean(), invites: v.array(v.object({ inviteId: v.id("invites"), roomTitle: v.string(), role: roleV, invitedByDisplayName: v.string(), expiresAt: v.number() })) }))`
- **读** identity 的 `email` 与 `ctx.viewer.emailVerified`（`users` 不存邮箱）、`invites.by_email_status`（`invitedEmail = 小写后的已验证邮箱`、`status = "open"`）、`rooms`、`members`（邀请人显示名快照）。邮箱未验证时 `invites: []`。query 不读时钟：返回 `expiresAt`，前端以本地时钟淡化已过期项，接受时由 mutation 权威判定。

#### `invites.accept` · userMutation
- **args** `{ invite: v.union(v.object({ by: v.literal("email"), inviteId: v.id("invites") }), v.object({ by: v.literal("link"), token: v.string() })) }`
- **returns** `v.object({ roomId: v.id("rooms"), role: roleV, status: v.union(v.literal("joined"), v.literal("already_joined")) })`
- **守卫** ① 定位邀请：`email` 形态按 id 读取，要求 `mode === "email"`，且 `ctx.viewer.emailVerified === true`（否则 `invite.email_unverified`），且 `invitedEmail === 调用者已验证邮箱`（否则 `invite.invalid`）；`link` 形态计算 `sha256Hex(token)`（Web Crypto，不可用时用注入的纯 JS 实现，spikes §8 #6）并查 `invites.by_tokenHash`（`take(2)`，0 或 2 行 → `invite.invalid`）；② 邀请已 `accepted` 且 `acceptedBy` 是调用者 → 返回 `already_joined`；③ `status === "open"` 且 `nowMs < expiresAt`（否则 `invite.invalid`）；④ `openRoomTx(allow: ["setup"])`（`run.invalid_state{guard:"room_status"}`）；⑤ `addMember(tx, { via: "invite", inviteId })`：`by_room_role` 非空 → `invite.seat_taken`，`by_room_user` 非空 → `invite.already_member`。
- **写** `members`、`invites.status → "accepted"`、`acceptedBy`、`acceptedAt`；`events`：`member_joined{role}`；随后 `openIfReady`（09：三席满员只是就绪条件之一，房间不会因加入而单独打开）。
- **读** `invites`、`rooms`、`members.by_room_user`、`members.by_room_role`。两条成员唯一性由"单一插入 helper + 先查后写 + 房间写锁"保证（03 §3.14）。
- **幂等** 自然幂等（同一人重复接受同一邀请返回 `already_joined`）。
- **失败码** `auth.unauthenticated`、`auth.user_not_provisioned`、`invite.invalid`、`invite.email_unverified`、`invite.already_member`、`invite.seat_taken`、`run.invalid_state`。
- 一人不兼任两角色（D24、U8）：⑤ 拒绝同一用户在同一房间占第二席；`evaluateApprovalSet` 的"被选中 userId 两两不同"是第二道防线。链接形态不另设公开 action：哈希在 mutation 内用可注入实现完成（B3）。
