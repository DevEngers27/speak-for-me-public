# 07 权限与隐私（part1）：认证与授权、席位授予、动作 × 角色矩阵

> 本章分 3 片：part1（本文件）7.1–7.3；part2 7.4 字段 × 角色披露矩阵与检查投影、7.5 按查看者裁剪的读模型、7.6 有界推断披露；part3 7.7 代理上下文组装与对他方可见文本、7.8 事件可见性与日志/错误纪律、7.9 威胁模型、7.10 数据保留与模型提供方。

## 7.1 认证 ≠ 授权

| 层 | 负责 | 实现 | 失败时 |
| --- | --- | --- | --- |
| 认证（你是谁） | Clerk 会话 → Convex 验证 JWT | `ClerkProvider` + `ConvexProviderWithClerk({useAuth})`；`convex/auth.config.ts` `{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN, applicationID: "convex" }`，变量缺失即抛错（推送失败，fail-closed） | `getUserIdentity()` 返回 null |
| 页面级乐观检查 | 未登录访问 `/rooms(.*)`、`/invite(.*)` 跳转登录 | Next 16 `proxy.ts`：`clerkMiddleware` + `createRouteMatcher` + `auth.protect()`；缺 Clerk 配置时在托管环境返回 503（不放行） | 跳转或 404；**不是授权** |
| 授权（你能做什么） | 每个 Convex 公共函数自己判断 | `convex/engine/authz.ts`：`requireViewer`、`requireSeat`、`requireCapability`、`requireOwner`、`requireRequestTarget` | query 返回 null；mutation 抛 `ConvexError({code})` |

约定：
1. 业务函数不接受 `userId`、`roleKey`、`seatId` 来表达"我是谁"（I-1）；席位由 `(roomId, 当前用户)` 查 `seats.by_room_user` 得到。
2. query 未认证或非成员时返回 `null`（不暴露房间是否存在）；mutation 抛 `UNAUTHENTICATED` / `NOT_A_MEMBER`。
3. internal 函数与被调度函数不带用户身份（04 平台约束 1.7）；需要操作者时由已完成授权的 mutation 显式传入 `actor`。
4. 房间角色是应用数据，不使用 Clerk Organizations（04 平台约束 3.4）；不启用 Clerk 多会话（同一浏览器换账号即重新认证，前端清空依赖身份的状态）。

```ts
// convex/engine/authz.ts（签名）
export async function requireViewer(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">>;          // mutation 用：缺失抛 UNAUTHENTICATED
export async function viewerOrNull(ctx: QueryCtx): Promise<Doc<"users"> | null>;                  // query 用
export async function requireSeat(ctx: MutationCtx, roomId: Id<"rooms">):
  Promise<{ user: Doc<"users">; room: Doc<"rooms">; seat: Doc<"seats">; plugin: ScenarioPlugin<any> }>;
export async function seatOrNull(ctx: QueryCtx, roomId: Id<"rooms">): Promise<SeatCtx | null>;
export function requireCapability(c: SeatCtx, cap: Capability): void;   // ROLE_NOT_PERMITTED
export function requireOwner(c: SeatCtx): void;                         // ROLE_NOT_PERMITTED
export function assertRoomOpen(room: Doc<"rooms">): void;              // ROOM_CLOSED
```

## 7.2 席位授予与房主

| 规则 | 说明 |
| --- | --- |
| 建房 | 任何登录用户可建房并选择自己的角色；可选环境变量 `ROOM_CREATOR_ALLOWLIST`（tokenIdentifier 列表）在生产限制建房者；每用户每 24 小时最多 10 个房间（按 `rooms.by_owner` 计数） |
| 角色由邀请决定 | 邀请绑定席位；接受者不能自选角色（F07.9：知道 roomId 不能自封 finance） |
| 一人一席 | 同一用户在同一房间至多一个席位，所以"三方都批准"必然是三个不同的人（I-2、I-3） |
| 房主权限 | 邀请、撤销邀请、修改标题与共享目标、关闭房间；**不带来任何签核权或对他方私密数据的访问** |
| 邀请令牌 | 32 字节随机、只存 SHA-256、7 天过期、单次使用；链接形如 `/invite/<token>`，令牌不进入日志与事件 |
| 接受时的披露基线 | 接受页展示该角色的 `joinDisclosure`（场景声明）：哪些派生结论对全体可见、哪些字段默认披露给谁；点击 "Join" 即同意（记录在 `seats.joinedAt`） |
| v1 不支持 | 移除成员、换人、一席多人、转移房主（17） |

## 7.3 动作 × 角色矩阵（scope_change，由插件 `capabilities` 生成）

图例：✓ 允许；本人 = 只能作用于自己的席位/草稿；目标 = 请求的目标席位；被指派 = 任务的 assignee；投影 = 返回内容按查看者裁剪。

| 函数（12） | customer | provider | finance | 额外条件 |
| --- | --- | --- | --- | --- |
| `rooms.create` | 任何登录用户 | ← | ← | 白名单（若配置）、建房频率 |
| `rooms.listMine`、`rooms.workspace` | 投影 | 投影 | 投影 | 成员 |
| `rooms.updateInfo`、`rooms.close`、`invites.create`、`invites.revoke` | 房主 | 房主 | 房主 | 房主可以是任一角色 |
| `invites.preview`、`invites.accept` | 任何登录用户（持令牌） | ← | ← | 令牌有效 |
| `briefs.myDraft`、`briefs.myVersions`、`briefs.saveDraft`、`briefs.previewConfirm`、`briefs.confirm`、`briefs.quickUpdate` | 本人 | 本人 | 本人 | G-OPEN（写） |
| `briefs.extractDraft` | 本人 | 本人 | 本人 | 每用户每日 20 次；代理可用 |
| `lists.view` | ✓ | ✓ | ✓ | draft 只有作者可见 |
| `lists.saveDraft`、`lists.discardDraft`、`lists.previewConfirm`、`lists.confirm`、`lists.withdraw`（scope） | ✓ | — | — | `list.author:scope` |
| 同上（quote） | — | ✓ | — | `list.author:quote` |
| `ledger.view` | 若 `committedCents` 披露给 customer | 若披露给 provider | ✓ | 投影 |
| `ledger.addBaseline`、`ledger.voidBaseline` | — | — | ✓ | `ledger.manage` |
| `proposals.history`、`proposals.get`、`proposals.compare` | 投影 | 投影 | 投影 | 成员 |
| `proposals.candidates`（候选浏览器） | 本人作用域 | 本人作用域 | — | `proposal.author` |
| `proposals.proposeCandidate` | ✓ | ✓ | — | `proposal.author`；被阻断尝试每约束版本每席位 ≤ 10 次 |
| `decisions.record` | ✓（terms） | ✓（terms） | ✓（budget） | 席位在提案 `requiredSignoffs` 中 |
| `requests.answer`、`requests.decline` | 目标 | 目标 | 目标 | G-REQ |
| `negotiation.requestRun`、`negotiation.retryRun`、`negotiation.cancelRun` | ✓ | ✓ | ✓ | 每房间每小时合计 ≤ 10 次 |
| `history.timeline`、`history.constraints` | 投影 | 投影 | 投影 | 成员 |
| `history.myAgentNotes` | 本人 | 本人 | 本人 | 只返回本席位回合 |
| `records.view` | 投影 | 投影 | 投影 | 成员 |
| `records.updateTask` | 被指派 | 被指派 | 被指派 | scope_change 任务都派给 provider |
| `health.viewer` | 任何登录用户 | ← | ← | 只返回本人 tokenIdentifier |
| `health.config`、`ops.*` | — | — | — | 仅 `ADMIN_TOKEN_IDENTIFIERS` 或 CLI |

矩阵在代码中由 `engine/authz.ts#capabilityFor(functionName)` 与插件 `RoleSpec.capabilities` 生成；16 对每个公共函数做"未认证 / 非成员 / 错角色 / 非目标"四类负面测试。
