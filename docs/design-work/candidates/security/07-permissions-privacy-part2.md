# 07 权限、隐私与威胁模型（part2：威胁 T-13–T-25、残余风险、认证与授权、角色授予）

## 7.4 威胁清单（下半）

| 编号 | 威胁与具体路径 | 防线 | 测试 |
| --- | --- | --- | --- |
| T-13 | 重复执行：双击批准；两名审批人几乎同时投出最后一票；断线重连时客户端重发 mutation；模型/调度重试 | 执行只发生在"最后一票"的 `decisions.decide` mutation 内部，没有其他执行入口；事务内守卫 `run.status === "awaiting_approval"` 与 `room.currentProposalId === proposalId`；`operationKey = exec:{proposalId}:{cv}` 按索引查重，命中即返回已有 changeOrderId；两次并发调用读写同一 run 文档，OCC 让后者重试时看到 `executed`（08） | TC-EXE-01（convex-test 顺序调用）、TC-EXE-02（真实 dev 部署并发脚本）、TC-EXE-03（E2E 双击） |
| T-14 | 模型发明价格、条目、日期，或"声明"一个合计 | 模型只能输出服务端生成的 `candidateId`；条款（条目、延后项、交付方式、日期、价格）由 `deriveTerms(candidate, catalogVersion, customerRequest)` 计算；执行时用当前约束快照重算；目录只来自 provider 已发布的不可变版本（05、06） | TC-RULE-01–08、TC-INJ-05（stub 返回未知 candidateId/多余字段被拒） |
| T-15 | 过期结果覆盖新状态：约束变更后迟到的回合结果写入；旧 run 的回合在新 run 上落库；看门狗与正常完成同时发生 | `completeTurn` 守卫：`turn.status === "running"`、`run.status === "running"`、`room.currentRunId === run._id`、`room.constraintsVersion === turn.constraintsVersion`、`turn.round === run.round`；不满足则只记录 `rejected_stale` 与用量；看门狗与完成都经同一状态迁移表，OCC 保证只有一个生效（10） | TC-RUN-01–05 |
| T-16 | 内部能力外露：seed/reset、`completeTurn`、`buildAgentContext` 被客户端调用 | 被调度与运维函数一律 `internal*`；seed/purge 只经 CLI；`purgeRoom` 还要求部署环境变量 `ALLOW_PURGE=1` 且房间 `isSimulated`；public 函数清单做快照测试，新增 public 函数必须改快照（12） | TC-AUTH-09 |
| T-17 | 成本滥用：反复触发重谈、建大量房间 | 建房受 `ROOM_CREATION` 策略控制；每 run 调用上限、每房间每日上限、每用户每日"请求重谈"上限，计数与触发在同一 mutation；`AGENTS_ENABLED=false` 总开关；模型供应商 workspace 花费上限（10、15） | TC-OPS-02 |
| T-18 | 邀请令牌泄露或暴力尝试 | 令牌 256 位随机、只存哈希、72 小时过期、一次性、房主可撤销；接受者显示名对全房间可见，错人占席立即可见；`peek` 只返回房间标题、角色名、邀请人显示名 | TC-AUTH-10 |
| T-19 | 模拟数据或预置结果被当成真实 | `isSimulated` 贯穿 rooms、briefVersions、catalogVersions、proposals、agentTurns（stub）、changeOrders；界面徽章；不提供"录制回放"；seed 只走与生产相同的写入路径并停在激活点，不伪造任何人的决定（14、15） | TC-OPS-03 |
| T-20 | 配置失效开放：proxy 缺 key 放行、issuer 缺失、格式错误 key 让全站 500 | `auth.config.ts` 缺 `CLERK_JWT_ISSUER_DOMAIN` 即抛错（推送失败）；托管环境 `REQUIRE_AUTH=1` 时 proxy 缺配置返回 503；key 格式预检；无论 UI 状态如何，Convex 函数在 identity 为 null 时一律拒绝（11、15） | TC-OPS-04 |
| T-21 | 历史篡改：patch/delete 提案、决定、简报版本、事件 | 不可变表（proposals、decisions、briefVersions、catalogVersions、constraintSnapshots、changeOrders、commitments、events、agentNotes）只有 insert 路径；静态测试扫描源码中对这些表的 `db.patch/replace/delete` 必须为零（seed purge 除外，且受环境变量保护） | TC-VER-06 |
| T-22 | 约束变更与最后一票的竞态：finance 降预算的同时 customer 投最后一票 | 两个 mutation 都读写 room 文档，OCC 串行化；若降预算先提交，`decide` 因 cv 不等返回 `STALE_VIEW`；若执行先提交，降预算按新已承诺额校验 `CAP_BELOW_COMMITTED`（09） | TC-VER-07（真实部署竞态脚本） |
| T-23 | 模型提供方处理私密上下文（P-11） | 残余风险：只发送本角色视图；不发送原始粘贴文本以外的他方数据；产品隐私说明如实写"授权的私密上下文会发送给模型提供方"；提供方保留与训练政策：待验证并写入隐私说明 | 文档评审 |
| T-24 | 被注入或判断失误的代理给出误导性建议 | 残余风险：界面先展示代码检查结果与确切条款，代理建议放在次要位置并标注"仅供参考"；批准按钮只依赖代码检查；代理建议永不写入 decisions（05、13） | TC-INJ-03 |
| T-25 | 导出文件公式注入 | v1 只提供打印视图，不提供 CSV；若将来提供，单元格以 `= + - @ \t \r` 开头时加 `'` 前缀（17） | — |

## 7.5 残余风险（明确接受并告知用户）

1. **每个提案泄露"是否满足对方约束"这一位**（T-09）。这是协作本身的代价：没有它，人无法知道为何不能批准。finance 与 customer 在确认简报时勾选 `inherentDisclosuresAck`，界面原文："Other parties will learn whether a proposal fits your private limits, never the limits themselves."
2. **人工请求的存在与目标角色公开**："Waiting on a finance decision"。内容只对目标可见。
3. **"无可行组合"这一结论公开**（run 进入 `needs_human`）。
4. **控制台内部人员**可读全部数据：靠 Convex 团队成员最小化与生产访问审计（15）。
5. **模型提供方**（T-23）。
6. **代理建议被操纵**（T-24）。

## 7.6 认证与授权

- 认证（你是谁）：Clerk 会话 → `ConvexProviderWithClerk` 取 token → Convex `auth.config.ts`（OIDC，`applicationID: "convex"`）。Next 的 `proxy.ts` 只做"必须登录"的乐观跳转，不承担授权。
- 授权（你在这个房间能做什么）：完全在 Convex 函数内，依据 `participants` 表的席位角色与场景声明的能力表。

```ts
// convex/lib/access.ts（所有 public 函数的第一行调用其中之一）
export async function getViewer(ctx: QueryCtx): Promise<Viewer | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await ctx.db.query("users")
    .withIndex("by_tokenIdentifier", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  return user ? { userId: user._id } : null;      // 用户行由 users.ensureMe 创建
}
export async function getMember(ctx: QueryCtx, roomId: Id<"rooms">): Promise<Member | null> {
  const viewer = await getViewer(ctx);
  if (!viewer) return null;
  const room = await ctx.db.get("rooms", roomId);
  if (!room) return null;
  const seat = await ctx.db.query("participants")
    .withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", viewer.userId))
    .unique();
  return seat ? { ...viewer, room, participant: seat, roleKey: seat.roleKey } : null;
}
export async function requireMember(ctx: MutationCtx, roomId: Id<"rooms">): Promise<Member> {
  const m = await getMember(ctx, roomId);
  if (!m) throw new ConvexError({ code: "NOT_FOUND" });   // 不区分"不存在"与"非成员"
  return m;
}
export async function requireCapability(ctx: MutationCtx, roomId: Id<"rooms">, cap: Capability) {
  const m = await requireMember(ctx, roomId);
  if (!capabilitiesOf(m.room, m.participant).has(cap)) throw new ConvexError({ code: "FORBIDDEN_ROLE" });
  return m;
}
```

约定：
1. query 未认证或非成员返回 `null`（前端渲染"无权访问"），mutation 抛 `ConvexError`。
2. 业务函数参数里没有 `userId`、`roleKey`、`participantId`（"我"永远由服务端推导）；涉及他人的参数只有不可伪造的对象 id（如 `proposalId`），且函数内校验该对象属于调用者的房间。
3. internal 函数信任参数；被调度的函数不依赖调度者身份（是否继承：待验证，设计上不依赖），需要行动者时显式传 `actorParticipantId`，且该值只能由已鉴权的 mutation 写入调度参数。
4. 能力（`Capability`）是引擎词汇：`room.close`、`invite.manage`、`brief.confirmSelf`、`catalog.publish`、`budget.update`、`decision.make`、`request.answer`、`run.retry`、`run.renegotiate`、`task.update`。角色到能力的映射由场景声明（7.12），房主能力（`room.close`、`invite.manage`）由引擎按 `rooms.ownerUserId` 附加。

## 7.7 席位与邀请：角色如何被授予

| 步骤 | 函数 | 关键检查 |
| --- | --- | --- |
| 1 建房 | `rooms.create`（mutation） | `users.canCreateRooms` 或 `ROOM_CREATION=open`；按场景 `roles[]` 一次性插入全部席位（`status: "open"`），创建者绑定到自选席位；不存在"之后再加席位"的入口 |
| 2 发邀请 | `invites.issue`（action）→ `internal.invites.store` | action 用 `crypto.getRandomValues` 生成 32 字节令牌并计算 SHA-256（默认运行时可用性：待验证，不可用则放入 `"use node"` 文件）；internal mutation 复核调用者是房主、席位为 open、房间未关闭，撤销该席位旧的 open 邀请，存 `tokenHash` 与 `expiresAt = now + 72h`；明文只返回给房主一次 |
| 3 预览 | `invites.peek`（query） | 只返回 `{ roomTitle, roleLabel, inviterDisplayName }`；令牌无效、过期、已用一律 `null` |
| 4 接受 | `invites.accept`（mutation） | 同一事务内：令牌哈希命中且 `open`、未过期；席位仍 `open`；该用户在本房间没有任何席位；房间未关闭；然后绑定席位、标记邀请 `accepted`、写 `seat_filled` 事件 |
| 5 撤销 | `invites.revoke`（mutation） | 仅房主、仅 `open` 状态 |

不变量：每个 `(roomId, roleKey)` 恰好一个席位（建房时一次性插入，之后无插入路径）；每个 `(roomId, userId)` 至多一个席位（`accept` 与 `create` 内检查）；席位一旦绑定不可解绑（v1）。错人占席的处置是房主关闭房间、重新建房，旧房间历史保留（ADR-12）。

显示名：`users.ensureMe` 首次创建用户行时取 `identity.name`（Clerk 的 Convex JWT 是否带 name：待验证）；没有则要求用户填写；接受邀请时快照到席位，之后改名不影响历史。
