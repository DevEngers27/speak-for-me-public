# 07 权限与隐私（事件溯源候选）· part1：身份、成员、矩阵

> 分两片：part1（本文件）认证/授权、成员授予、字段×角色、动作×角色；`07-permissions-privacy-part2.md` 事件可见性、代理上下文、公共文本、日志与错误、威胁模型。

## 1. 认证 vs 授权

| 层 | 做什么 | 不做什么 |
| --- | --- | --- |
| Clerk + `auth.config.ts` | 证明"你是谁"：`identity.tokenIdentifier` | 不表达房间角色（不用 Clerk Organizations，inputs/04 §3.4） |
| Next `proxy.ts` | 乐观检查：`/rooms(.*)` 未登录跳转登录页；缺配置时 `REQUIRE_AUTH=1` 返回 503（不放行） | 不是授权方案（inputs/04 §3.5） |
| Convex 函数 | 全部授权：`getViewer → requireMember → requireRole`，身份只从 `ctx.auth` 推导 | 业务函数**不接受** userId / role 参数 |
| 被调度函数 | 不依赖调度者身份；`actor` 由调度前的 mutation 写入参数 | internal 函数不暴露给客户端，鉴权落在公共入口 |

```ts
// convex/engine/auth.ts
export async function getViewer(ctx): Promise<Doc<"users"> | null> {
  const id = await ctx.auth.getUserIdentity(); if (!id) return null;
  return ctx.db.query("users").withIndex("by_token", q => q.eq("tokenIdentifier", id.tokenIdentifier)).unique();
}
export async function requireMember(ctx, roomId) {      // mutation 中未认证/非成员抛错；query 中返回 null
  const user = await getViewer(ctx); if (!user) throw new ConvexError({ code: "NOT_AUTHENTICATED" });
  const m = await ctx.db.query("members").withIndex("by_room_user", q => q.eq("roomId", roomId).eq("userId", user._id)).unique();
  if (!m) throw new ConvexError({ code: "NOT_MEMBER" });
  return { user, member: m, role: m.role };
}
export const requireRole = async (ctx, roomId, roles: Role[]) => { const v = await requireMember(ctx, roomId);
  if (!roles.includes(v.role)) throw new ConvexError({ code: "FORBIDDEN_ROLE" }); return v; };
```

约定：query 未认证或非成员返回 `null`（不抛），mutation 抛 `ConvexError({code})`。

## 2. 成员与角色授予

- `rooms.create` 为三个角色各生成一个 32 字节随机令牌，库里只存 `sha256(token)` 与 `expiresAt`（默认 7 天），明文只在返回值里给 owner 一次。owner 本人也通过接受邀请占一个角色（或不占）。
- `invites.accept({token})` 的 plan（单一写入口，流头 OCC 串行化）：令牌存在、未过期、未接受、未撤销；该角色在房间内无人；该用户在房间内尚无席位 → 事件 `member_joined`，同事务把邀请行标记 accepted。
- 一人一角色、一角色一人（v1；开放问题 Q13）。房主身份不带来审批权或读权。
- v1 不提供移除成员、转让角色（17）。
- 预算可见性裁决（开放决定 1）：**买方/卖方划分**——finance 与 customer 同属采购方，可见预算数字；provider 永不可见。provider 只能得到 `EXCEEDS_FINANCE_LIMIT` 这一结论，这是有意接受的最小披露。

## 3. 字段 × 角色披露矩阵

R = 可读，W = 可写（经哪个命令），— = 不可见。"共享"指本人在简报中逐项勾选的 `shareableFacts`。

| 字段 | customer | provider | finance | 写入命令 |
| --- | --- | --- | --- | --- |
| room.title / goal / status / constraintsVersion | R | R | R | owner：`rooms.create` |
| members（角色、显示名） | R | R | R | `invites.accept` |
| 邀请令牌明文 | 创建时 owner 一次 | 同左 | 同左 | — |
| customer 简报：requiredItemKeys、deadline | RW | 若共享 R | R（买方） | customer：`briefs.confirm` |
| customer 简报：desiredItemKeys、deferrableItemKeys | RW | 若共享 R | R | 同上 |
| customer 简报：preferredDate、notes | RW | — | — | 同上 |
| provider 简报：earliestStartDate、notes | — | RW | — | provider：`briefs.confirm` |
| finance 简报：approvalNote、notes | — | — | RW | finance：`briefs.confirm` |
| 他方简报状态（版本号、确认时间） | R | R | R | — |
| 目录项（title、价格、lead days） | R | RW | R | provider：`catalog.confirmItem`（确认时提示 "Visible to everyone in the room"） |
| budget.totalCents | R | — | RW | finance：`budget.update` |
| committedCents、headroomCents、shortfallCents | R | — | R | 派生 |
| 提案条款、金额（本次变更额）、交付日 | R | R | R | 代码生成 |
| 提案阻断原因 | 原始 code + 数字 | 投影后 code，无数字 | 原始 code + 数字 | 派生 |
| 决定（谁对哪版做了什么） | R | R | R | 本人：`approvals.decide` |
| 决定 note（自由文本） | 仅本人 | 仅本人 | 仅本人 | 同上 |
| 代理 rationale / clarify question | 仅本方 | 仅本方 | 仅本方 | 系统 |
| 回合遥测（token、延迟、模型） | 本方回合 | 本方回合 | 本方回合 | 系统 |
| 人工请求：存在与目标角色 | R | R | R | 系统 |
| 人工请求：选项与数额 | 目标为 customer 时 R；raise_budget 数额 R（买方） | 仅当目标为 provider | 目标为 finance 时 R；choose_candidate R | 系统；回答：目标角色 |
| 变更单：条款、金额、交付日、任务 | R | R | R | 系统 |
| 变更单：committedBefore/After、totalBudgetCents | R | — | R | 系统 |

决定 note 只给本人：它是自由文本，按核心 1，对他方可见的内容必须经模板；他方只看到 reasonCode。

## 4. 动作 × 角色矩阵

| 命令 | customer | provider | finance | owner 额外 | 非成员 |
| --- | --- | --- | --- | --- | --- |
| rooms.create | — | — | — | 允许名单用户 | 允许名单用户 |
| invites.reissue | — | — | — | ✓ | ✗ |
| invites.accept | 持令牌 | 持令牌 | 持令牌 | — | 持令牌 |
| briefs.saveDraft / confirm（本角色） | ✓ | ✓ | ✓ | — | ✗ |
| catalog.confirmItem / withdrawItem | ✗ | ✓ | ✗ | — | ✗ |
| budget.update | ✗ | ✗ | ✓ | — | ✗ |
| runs.start / retryTurn | ✓ | ✓ | ✓ | — | ✗ |
| approvals.decide | ✓（terms） | ✓（terms） | ✓（budget） | 无额外权 | ✗ |
| requests.answer | 目标为本角色时 | 同左 | 同左 | — | ✗ |
| tasks.complete | ✗ | ✓ | ✗ | — | ✗ |
| rooms.close | ✗ | ✗ | ✗ | ✓ | ✗ |
| 所有 query | 成员 | 成员 | 成员 | — | null |

任何改变硬约束的命令（confirmItem、withdrawItem、budget.update、customer 改硬字段的 briefs.confirm）都由 plan 产生带 `constraintsVersionAfter` 的事件（09）。
