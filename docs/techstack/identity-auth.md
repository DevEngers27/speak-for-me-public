# 技术子决策：身份与权限（Clerk 7.9 × Convex 1.48 × Next 16）

> 作者：技术选型代理（身份与权限）。日期 2026-10-24。栈已定，本文只做栈内子决策。
> 引用缩写沿用 inputs/04：`NM:` = `/Users/zhennn/cal-hack-2026-main/node_modules/`；`CVX:` = `NM:convex/src/`；`CLK:` = `NM:@clerk/nextjs/dist/types/`；`CBE:` = `NM:.pnpm/@clerk+backend@3.26.2_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/@clerk/backend/dist/`。来源编号 [S1]… 见文末。

## 0. 结论先行（一页）

| 子问题 | 决定 |
| --- | --- |
| 房间成员建模 | **只用 Convex 应用层表**：`users`、`roomMembers`、`roomInvites`。不启用 Clerk Organizations。 |
| 邀请流程 | **应用内邀请链接**：Convex 存 `tokenHash` + `expiresAt` + 绑定角色席位 + 可选 `invitedEmail`；明文只在创建时返回一次。Clerk Invitations 只作为"准入应用"的运维手段（生产若开 Invite-only），永不承载房间或角色。 |
| 角色存放 | **只在 Convex**（`roomMembers.role`）。不写 `publicMetadata`/`privateMetadata`，不放进 session token。 |
| Token 与字段 | 用 **Clerk 原生 Convex 集成**（session token `aud = "convex"`），不建 `convex` JWT 模板。只额外映射 `name`、`email`（必要时 `email_verified`）三个展示/绑定用 claim；不放任何授权数据。 |
| 内部用户主键 | `identity.tokenIdentifier`（`iss`+`sub`，全局唯一）；`subject`（Clerk `user_…`）只作对账字段。 |
| 多会话 | **不启用**（Clerk 需在 Dashboard 手动开启，未开即单会话）。三方测试用不同浏览器 profile / Playwright 独立 BrowserContext。不做单浏览器角色切换器。 |
| 测试 | 单测/集成：`convex-test` 的 `t.withIdentity(...)`，不碰 Clerk。E2E：Playwright + `@clerk/testing` 2.2.x，`clerkSetup()` + `clerk.signIn({ page, emailAddress })`，三个 `+clerk_test` 测试用户，只在 Clerk 开发实例上跑。 |
| 实例 | 开发：Clerk dev 实例（`pk_test_`，`*.clerk.accounts.dev`，test mode 开，Open 注册）配每人的 Convex dev deployment；生产：独立 Clerk prod 实例（`pk_live_`，自有域名 + DNS）配 Convex prod deployment。两边用户 ID 不互通，数据不跨环境搬。 |
| Next 16 组合 | `src/proxy.ts` 只放 `export default clerkMiddleware()` + 官方 matcher；**不用 `createRouteMatcher`（7.9.20 已标 deprecated）**，不在 proxy 里做路由授权。页面/布局用 `await auth.protect()` 做"必须登录"的乐观检查；真正授权全部在 Convex 函数里 `requireMember`。客户端用 Convex 的 `<Authenticated>`/`useConvexAuth()` 判断"后端已接受 token"。开发期设 `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=1` 关掉 keyless 自动实例。 |

## 1. 需求与约束（引自任务书与 inputs）

### 1.1 来自任务书 §3 核心不变量的硬要求

- **私密委托（§3.1）**：私密简报只对本人及其代理可见 → 授权必须按"房间 × 用户 × 角色"在服务端判断，判断依据必须是**同一事务里可读到的数据**，否则会出现"已被移出房间仍能读"的窗口。
- **人批准具体版本（§3.3）**：审批人身份必须可审计、稳定（不能因换显示名或换邮箱而漂移），并与房间角色一一对应。
- **代码负责校验（§3.4）**：权限是确定性代码，不信任客户端传入的 userId / role（inputs/02 F07.x："业务函数不接受 userId 或 role 参数"）。
- **历史不可篡改（§3.6）**：成员加入、角色授予、邀请发出/接受/撤销都要进事件流；如果角色真相源在 Clerk，Convex 事件流就无法完整追溯。
- **不伪造（§3.8）**：测试/演示账号、seed 出来的房间要可识别。

### 1.2 来自设计输入的已知威胁与约束

- 自选角色与一人多角：知道 roomId 就能选 finance 加入；一人插三条成员就能独自满足"三方批准"（inputs/02 F07.9）。→ 唯一性：`(roomId, role)` 至多一人；`(roomId, userId)` 至多一个角色；同一用户不能占多个必需审批席位。
- Convex 索引无唯一约束，只能"单一写入口 mutation 内先查后写 + OCC"（inputs/04 要点 3）。
- `ctx.auth.getUserIdentity()` 只保证 `tokenIdentifier` 与 `issuer`（inputs/04 要点 6；`CVX:server/authentication.ts:100-122`）。
- `ConvexProviderWithClerk` 在 `orgId`/`orgRole`/`sessionId` 变化时重建取 token 函数；取 token 抛错被吞掉返回 `null`（`CVX:react-clerk/ConvexProviderWithClerk.tsx:74-98`）。
- Next 16 的 proxy 运行时固定 nodejs，只适合乐观检查（inputs/04 §3.5）。
- 缺配置必须 fail-closed，不能退化成"未认证也能读写"（inputs/04 §3 含义第 4 条；inputs/01 P-28）。
- 真实身份模式下不做单浏览器角色切换器（inputs/02 F13.3；inputs/03 RA-U13 否决 "Preview as"）。

### 1.3 本决策要回答的问题

成员建模、邀请、角色存放、token 字段、多会话、测试账号与 testing tokens、实例划分、`convex/react-clerk` 与 `proxy.ts` 的组合。

## 2. 候选方案表

### 2.1 房间成员与角色

| 编号 | 方案 | 描述 |
| --- | --- | --- |
| M1 | **Convex 应用层表（推荐）** | `users`（按 `tokenIdentifier` 唯一）、`roomMembers {roomId, userId, role, displayName, joinedAt, status}`、`roomInvites`。授权在 Convex 函数内查表。 |
| M2 | 一房间一个 Clerk Organization | 建房时用 Backend API 建 org，三方以 org member 身份加入，自定义 org 角色 `org:customer/provider/finance`；Convex 读 token 里的 org claim 授权。 |
| M3 | 角色写 Clerk `publicMetadata` | `user.publicMetadata.rooms = { [roomId]: role }`，映射进 session token，Convex 读 claim。 |
| M4 | 混合：Convex 为真相源，镜像到 Clerk org/metadata | 写 Convex 后再异步同步到 Clerk，供 Clerk UI 组件使用。 |

### 2.2 邀请

| 编号 | 方案 | 描述 |
| --- | --- | --- |
| I1 | **应用内邀请链接（推荐）** | `createInvite` 生成 32 字节随机 token，只存 SHA-256 哈希；链接 `/invite/<token>`；单次使用、默认 72h 过期、绑定 `role` 席位、可选绑定 `invitedEmail`；`acceptInvite` 在一个 mutation 内完成全部检查与写入。 |
| I2 | Clerk Invitations（应用级） | `clerkClient.invitations.createInvitation({ emailAddress, publicMetadata, redirectUrl, expiresInDays })`。它是"注册进本应用"的邀请：对已存在的邮箱默认报错，元数据落到 `User.publicMetadata`（`CBE:api/endpoints/InvitationApi.d.ts:9-30, 76-89`）。不是房间级。 |
| I3 | Clerk Organization Invitations | 依附 M2，org 级邮件邀请，带 org 角色。 |
| I4 | 房间码（短码人工输入） | 原 inputs/02 F03.2 的明文 `code`；可猜测性与泄露面比 I1 大。 |

### 2.3 Token 获取方式

| 编号 | 方案 | 描述 |
| --- | --- | --- |
| T1 | **原生 Convex 集成（推荐）** | Clerk Dashboard 激活 Convex 集成，session token 预映射 `aud`；`ConvexProviderWithClerk` 检测 `sessionClaims.aud === "convex"` 后直接 `getToken()`（`CVX:react-clerk/ConvexProviderWithClerk.tsx:77-82`）[S3][S4]。 |
| T2 | `convex` JWT 模板 | 旧方式；客户端回退分支 `getToken({ template: "convex" })`（同文件 `:83-88`）。多一次模板签发、多一处配置。 |

### 2.4 多会话

| 编号 | 方案 | 描述 |
| --- | --- | --- |
| S1 | **单会话（推荐，Clerk 默认未开启多会话）** | 一个浏览器 profile 一个账号。 |
| S2 | 多会话 | Dashboard → Sessions → Multi-session handling（只能在 Dashboard 改）[S7]；需 `<MultisessionAppSupport>` 包裹强制重挂载（`CLK:client-boundary/controlComponents.d.ts:2`）。 |

### 2.5 路由保护

| 编号 | 方案 | 描述 |
| --- | --- | --- |
| P1 | **proxy 只挂 `clerkMiddleware()`，页面内 `auth.protect()`，Convex 内授权（推荐）** | 符合 Clerk 当前迁移指南 [S9] 与 Next 16 对 proxy 的定位。 |
| P2 | proxy 里 `createRouteMatcher` + `auth.protect()` | inputs/04 §3.5 提到的写法；**7.9.20 类型已标 `@deprecated`，下一大版本移除**（`CLK:server/routeMatcher.d.ts:16-23`）。 |

## 3. 评估维度

评分：好 / 中 / 差。"核心不变量影响"指对任务书 §3 的 1/3/4/6 条。

| 维度 | M1 应用层表 | M2 一房间一 Org | M3 publicMetadata | M4 混合镜像 |
| --- | --- | --- | --- | --- |
| 成熟度 | 好：普通 Convex 表 + 索引，`requireMember` 是 Convex 官方推荐的授权模式 | 中：Organizations 成熟，但"每房间一个 org"不是它的设计用途（面向 B2B 租户）[S8] | 中：功能成熟，用途不对口 | 差：要自建同步与补偿 |
| 与 Next 16 / React 19 / Convex 1.48 兼容 | 好：与栈无耦合 | 中：active org 每标签页一个，cookie 全局，后台请求可能带错 org [S8]；`orgId` 变化会触发 Convex `setAuth` 重连（`ConvexProviderWithClerk.tsx:96`） | 中：claim 最多滞后 60s（token 每 60s 刷新）[S6] | 差：两边都要兼容 |
| 许可证 | 无新增依赖 | Clerk 服务条款 + MRO 计费：免费版 dev 50 / prod 100 个 MRO [S8] | 无新增 | 同 M2 |
| 维护活跃度 | — | Clerk 活跃（@clerk/nextjs 7.9.20 发布于 2026-10-23）[S11] | 同左 | 同左 |
| 学习成本 | 低 | 中：org 角色/权限、active org、OrganizationSwitcher | 低 | 高 |
| 迁移成本（将来换 IdP） | 低：只依赖 `tokenIdentifier` | 高：成员关系锁在 Clerk | 中 | 高 |
| 对核心不变量的影响 | **正面**：授权与成员变更在同一 Convex 事务、同一事件流内（§3.1、§3.6） | **负面**：第二个权限真相源；移除成员到 token 失效之间有窗口；成员事件不在 Convex 历史里 | **负面**：同 M2，且自定义 claim 总预算仅约 1.2KB，房间多了 cookie 设不上导致整站不可用 [S6] | 负面：一致性问题被放大 |

| 维度 | I1 应用内链接 | I2 Clerk Invitations | I3 Org Invitations | I4 明文短码 |
| --- | --- | --- | --- | --- |
| 房间/角色级 | 是 | 否（应用级，元数据落 `publicMetadata`） | 是（需 M2） | 是 |
| 已注册用户可用 | 是 | 否：已存在邮箱默认报错（`InvitationApi.d.ts`） | 是 | 是 |
| 单次、过期、撤销 | 自建，`acceptInvite` 单 mutation 守 | Clerk 提供（`expiresInDays` 默认 30，`revokeInvitation`） | Clerk 提供 | 自建 |
| 泄露面 | 只存哈希；可选邮箱绑定 | 邮件经 Clerk 发出 | 同左 | 明文存库，可猜测 |
| 事件可追溯 | 完整（同事务写 `events`） | 需 webhook 回写 | 需 webhook | 完整 |

Token 方式：T1 与 T2 都被 `convex@1.48.0` 客户端支持；T1 少一份模板配置，是 Clerk 与 Convex 当前文档的默认路径 [S3][S4]，选 T1。路由保护：P2 依赖已弃用 API 且有路径规范化绕过前科（GHSA-vqx2-fgx2-5wq9）[S9]，选 P1。

## 4. 推荐与理由

### 4.1 数据形状（交给 02/03 定稿，这里给出身份相关最小集）

```ts
users: defineTable({
  tokenIdentifier: v.string(),          // 主键语义；iss + sub
  clerkUserId: v.string(),              // identity.subject，对账用
  displayName: v.string(),              // 首次取 identity.name，缺省让用户填
  email: v.optional(v.string()),        // identity.email，小写；仅用于邀请绑定与展示给本人
  isTestAccount: v.boolean(),           // +clerk_test 邮箱或 seed 账号 → true（§3.8）
  createdAt: v.number(),
}).index("by_token", ["tokenIdentifier"]),

roomMembers: defineTable({
  roomId: v.id("rooms"), userId: v.id("users"),
  role: v.string(),                     // 场景插件声明的角色键，如 "customer" | "provider" | "finance"
  displayName: v.string(),              // 加入时快照
  status: v.union(v.literal("active"), v.literal("removed")),
  joinedAt: v.number(), inviteId: v.optional(v.id("roomInvites")),
}).index("by_room_role", ["roomId", "role"])
  .index("by_room_user", ["roomId", "userId"])
  .index("by_user", ["userId"]),

roomInvites: defineTable({
  roomId: v.id("rooms"), role: v.string(),
  tokenHash: v.string(),                // sha256(base64url(32 随机字节))
  invitedEmail: v.optional(v.string()), // 设了就要求 identity.email 相等
  createdBy: v.id("users"), createdAt: v.number(), expiresAt: v.number(),
  acceptedBy: v.optional(v.id("users")), acceptedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
}).index("by_token_hash", ["tokenHash"]).index("by_room", ["roomId"]),
```

注：`role` 用 `v.string()` 而非字面量联合，是为了让第二个场景插件声明自己的角色键（任务书 §2 范围）；合法性由场景插件的角色表在代码里校验。

### 4.2 关键流程

- **`users.ensureViewer`（mutation，幂等）**：`getUserIdentity()` 为 null → `ConvexError({code:"UNAUTHENTICATED"})`；按 `by_token` `.unique()` 查，没有就插。客户端在 `<Authenticated>` 首次挂载时调用。所有其它函数用 `getViewer(ctx)` 只读查找，查不到即拒绝（不在 query 里隐式插入）。
- **`rooms.create`**：创建者成为房间 owner 并**选择自己的角色**（同一事务写 `roomMembers`）；为其余必需角色各生成一个邀请，明文链接只在返回值里出现一次。
- **`roomInvites.accept({ token })`（单 mutation）**：哈希 → `by_token_hash` 查 → 检查未撤销、未接受、未过期 → 若 `invitedEmail` 存在则比较 `identity.email`（小写）→ `by_room_role` 确认该角色无 active 成员 → `by_room_user` 确认该用户在本房间无 active 成员（**一人一角**）→ 插 `roomMembers`、回写 `acceptedBy/acceptedAt`、写 `member_joined` 事件。任一步失败返回 `ConvexError({code})`，不泄露房间信息。OCC 保证两人并发抢同一席位只有一个成功。
- **授权**：每个公共函数以 `requireMember(ctx, roomId)` 或 `requireRole(ctx, roomId, role)` 开头；不接受 `userId`/`role` 参数。被调度的内部函数不依赖身份，显式传 `actorUserId`（inputs/04 §1 含义第 7 条）。
- **移除成员**：只把 `status` 改为 `removed` 并写事件，不删行（§3.6）；已有审批的处理交给 08。

### 4.3 Clerk 控制台配置（每个实例各做一次）

1. 激活 Convex 集成（`dashboard.clerk.com/apps/setup/convex`），拿到 Frontend API URL [S4]。
2. Sessions → Claims 在预映射的 `aud` 之外只加：`"name": "{{user.full_name}}"`、`"email": "{{user.primary_email_address}}"`；`email_verified` 的 shortcode 待验证。总增量远小于 1.2KB 预算 [S6]。**不加任何房间/角色/组织 claim。**
3. Organizations 保持关闭；Multi-session handling 保持关闭。
4. 认证方式：Email address + 密码 + 邮箱验证码（E2E 的 `clerkSetup` 要求开启 Email/Password [S10]）；社交登录推迟（生产需自备 OAuth 凭据）[S12]。
5. 注册模式：dev 实例 Open；prod 实例默认 **Invite-only（`restricted`）**，由运维用 Clerk Invitations 准入账号，房间成员仍走 I1（是否收费：待验证）[S13]。

Convex 侧：`convex/auth.config.ts` → `{ providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }] }`，变量缺失推送失败（fail-closed）。注：Clerk 文档示例把同一个值叫 `CLERK_FRONTEND_API_URL` [S4]，Convex 文档叫 `CLERK_JWT_ISSUER_DOMAIN` [S3]；名字是我们自选的，统一用后者以与 inputs/04 一致。

### 4.4 Next 16 组合方式

```ts
// src/proxy.ts —— 只让 Clerk 工作，不做路由授权
import { clerkMiddleware } from "@clerk/nextjs/server";
export default clerkMiddleware();
export const config = { matcher: [ /* 照抄 Clerk 文档的三条：跳过静态资源 / 总是 (api|trpc) / 总是 __clerk */ ] };
```

- `app/layout.tsx`（Server Component）：`<ClerkProvider>` 包住 `"use client"` 的 `<ConvexClientProvider>`（内部 `useState(() => new ConvexReactClient(url))` + `<ConvexProviderWithClerk client useAuth={useAuth}>`）。顺序必须是 Clerk 在外 [S3][S4]。
- `app/(app)/layout.tsx` **和**每个 `page.tsx`：`await auth.protect()`（只布局不够，Clerk 迁移指南明确要求页面也查）[S9]。这只是"必须登录"的体验层检查。
- 需要服务端预取的页面：`const { getToken } = await auth(); const token = await getToken();`（T1 下默认 session token 即 Convex token，无需 template）→ `preloadQuery(api.rooms.view, { roomId }, { token })` → 客户端 `usePreloadedQuery`。
- 客户端 UI 判断"已登录"用 Convex 的 `<Authenticated>/<Unauthenticated>/<AuthLoading>` 与 `useConvexAuth()`，不用 Clerk 的 `<Show when="signed-in">`：Clerk 已登录不代表 Convex 已接受 token [S4]。Clerk 7（Core 3，2026-03-03）已移除 `<SignedIn>/<SignedOut>/<Protect>`，导出的是会报错的占位（`CLK:removedControlComponents.d.ts`）。
- 不用 Server Actions 写业务数据；写操作一律浏览器 → Convex mutation（授权只有一处）。
- 开发与 CI 设置 `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=1`：否则缺 key 时 Clerk 在开发环境自动创建临时 keyless 实例（`NM:@clerk/nextjs/dist/esm/utils/feature-flags.js:4`，`esm/server/constants.js:26`），会出现"能登录但 Convex 永远未认证"的混淆态。
- `/setup` 诊断页：显示 `useConvexAuth().isAuthenticated`、`health.viewer` 结果、publishable key 解码出的 FAPI 主机名 vs Convex 配置的 issuer（inputs/02 F13.4）。

### 4.5 多会话与"三个人在一台机器上"

- 不启用多会话。演示与手工测试：三个浏览器 profile（或一个普通窗口 + 两个隐私窗口/不同浏览器）。E2E：三个 Playwright `BrowserContext`，各自 `storageState`。
- 前端仍要按"身份可能变化"编码：依赖身份的客户端状态以 `viewer._id` 作 key；登出后 `ConvexReactClient` 的订阅由 `clearAuth` 失效，页面回到 `<Unauthenticated>`。
- 若将来要开：加 `<MultisessionAppSupport>`（session 变化强制整树重挂载）；`ConvexProviderWithClerk` 已在 `sessionId` 变化时重建 `fetchAccessToken` 并 `setAuth`；`clerk.signOut({ sessionId })` 可用于测试 [S10b]。
- 不提供"Preview as"角色切换器（inputs/03 RA-U13 否决）。

### 4.6 测试账号与 testing tokens

| 层 | 做法 |
| --- | --- |
| 纯函数 | 授权判定写成纯函数 `canPerform(memberRole, action, roomState)`，直接单测。 |
| Convex 函数 | `convex-test`（0.0.65，peer `convex ^1.43.0`，Apache-2.0）[S14]：`t.withIdentity({ tokenIdentifier, subject, issuer, name, email })` 模拟三方与陌生人；覆盖"未认证拒绝""自选角色拒绝""一人两角拒绝""过期/已用/撤销邀请拒绝""邮箱不符拒绝"。并发抢席位需在真实 dev deployment 上测（convex-test 不模拟并发，inputs/04 要点 3）。 |
| E2E | `@clerk/testing` 2.2.50（MIT，peer `@playwright/test ^1`，发布于 2026-10-23）[S11]。project 式 global setup 里 `clerkSetup()` 取 testing token（绕过 bot 检测）[S10]；每个用例 `clerk.signIn({ page, emailAddress })`（服务端 sign-in token，跳过邮箱验证与 MFA，需 `CLERK_SECRET_KEY`）[S10b]。 |
| 测试用户 | 每个 Clerk dev 实例 3 个：`customer+clerk_test@<域>`、`provider+clerk_test@…`、`finance+clerk_test@…`，验证码固定 `424242`，dev 实例 test mode 默认开启 [S5]。由幂等脚本 `scripts/e2e-users.ts` 用 Backend API 按邮箱查后建。`users.isTestAccount` 依据 `+clerk_test` 置真，UI 显示"测试账号"徽章（§3.8）。 |
| Seed | `seed.demoRoom({ emails })`（internal，只经 CLI）只建房间与**绑定邮箱的邀请**，不直接写成员；E2E 以三个账号分别接受邀请，顺带覆盖真实加入流程，也免去预先获知 `tokenIdentifier`。 |
| 生产 | 不在 prod 跑 E2E；prod 关闭 test mode（Clerk 称在生产开启"highly discouraged"）[S5]。testing token 虽然在 prod 也可用 [S2]，本项目不用。 |

### 4.7 开发实例 vs 生产实例

| 项 | Clerk dev 实例 | Clerk prod 实例 |
| --- | --- | --- |
| 配对的 Convex deployment | 每个开发者的 dev deployment、preview deployment | 唯一的 prod deployment |
| key / issuer | `pk_test_`/`sk_test_`；`https://<slug>.clerk.accounts.dev` | `pk_live_`/`sk_live_`；`https://clerk.<自有域名>` [S3][S4] |
| 域名 | 无需 | 必须自有域名 + DNS（CNAME，最长 48h 传播），不能加 CNAME 时用 Frontend API proxy [S12] |
| test mode / 注册 | 开 / Open | 关 / Invite-only |
| OAuth | 共享凭据 | 必须自备 [S12] |

- 同一个人在两个实例里 `sub` 不同、`iss` 不同 → `tokenIdentifier` 不同；`users` 行按 deployment 各自生成，不做跨环境数据迁移（inputs/02 F11.4）。
- `isClerkConfigured()`：`pk_`/`sk_` 前缀齐全且同为 test 或同为 live；托管环境 `REQUIRE_AUTH=1` 时缺配置返回 503（inputs/02 F11.3）。

## 5. 否决理由

- **M2 一房间一 Organization**：(1) 第二个权限真相源，违背"授权由 Convex 确定性代码完成"；(2) 成员移除到 token 刷新之间最多约 60s 窗口 [S6]，而 Convex 表的移除在下一次函数调用即生效；(3) active org 是每标签页一个、cookie 全局一个，三方工作台或同一用户在多个房间时会带错 org [S8]；(4) org 角色在应用级统一定义，无法表达"角色键由场景插件声明"；(5) 免费额度按 MRO 计（prod 100），每房间一个 org 会把房间数变成计费单位 [S8]；(6) 成员事件不在 Convex 事件流里，破坏 §3.6 可追溯。
- **M3 角色放 publicMetadata**：同 M2 的 (1)(2)(6)；且自定义 claim 预算约 1.2KB，超出则 cookie 写不进、整站失效 [S6]；写入要在 Convex action 里持有 Clerk secret key，扩大密钥面。
- **M4 混合镜像**：没有任何需求需要 Clerk 侧看到房间角色（我们不用 `OrganizationSwitcher` 等 UI），却要承担同步与补偿。
- **I2 Clerk Invitations 承载房间邀请**：它是应用级注册邀请，已注册用户默认报错，元数据落 `publicMetadata`（回到 M3 的问题）。保留其"准入应用"用途。
- **I3 Org Invitations**：依附 M2。
- **I4 明文短码**：明文入库、可猜测；I1 只存哈希且可绑定邮箱。
- **T2 JWT 模板**：功能等价但多一份配置、多一种失败模式；客户端代码已自动识别 T1。
- **P2 `createRouteMatcher`**：已弃用；路径匹配与 Next 路由规范化不一致曾导致绕过 [S9]；Server Functions 按 ID 调用，路径匹配覆盖不到。
- **S2 多会话**：收益只是一台机器演示三方，成本是身份切换时的状态清理与审计混淆；用多个浏览器 profile 即可。

## 6. 风险与退出策略

| 风险 | 影响 | 缓解 / 退出 |
| --- | --- | --- |
| Clerk 原生集成的 session token 中 `name`/`email` 依赖 Claims 配置，漏配则 `identity.email` 为空 | 邮箱绑定邀请全部失败 | `acceptInvite` 遇到 `invitedEmail` 而 identity 无 email 时返回 `EMAIL_CLAIM_MISSING`；`/setup` 显示 claim 是否存在；E2E 覆盖 |
| `email` 未必已验证（`email_verified` shortcode 待验证） | 理论上可用未验证邮箱冒领绑定邀请 | Clerk 实例要求注册时验证邮箱（默认行为，待验证）；拿不到 `email_verified` 时，邮箱绑定只视为"防误转发"，安全边界仍是单次 token |
| `createRouteMatcher` 下一大版本移除、Clerk 8 再改 API | 升级时 proxy 断 | 现在就不用它；proxy 只有一行 `clerkMiddleware()` |
| Clerk 文档与 Convex 文档在 env 名、middleware/proxy 上不同步 | 新人照抄出错 | 本文与 15-operations 统一：`CLERK_JWT_ISSUER_DOMAIN`、`src/proxy.ts` |
| prod Invite-only 是否需付费方案未确认 | 上线时被迫改 Open | Open 也安全：房间访问只靠 I1；Invite-only 只是减少陌生注册 |
| keyless 模式在本地意外启用 | 登录成功但 Convex 未认证 | `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=1` 进 `.env.example` |
| `ConvexProviderWithClerk` 吞掉取 token 异常 | 静默"未登录" | `/setup` 诊断 + 客户端 `error.tsx` |
| **退出 Clerk** | 换 IdP | 应用只依赖 `ctx.auth.getUserIdentity()` 的 `tokenIdentifier`/`name`/`email` 与 `auth.config.ts`；换 IdP = 改 provider 配置 + 前端 provider 组件 + 一次 `users` 映射迁移（旧 `tokenIdentifier` → 新，按已验证邮箱匹配）。成员、角色、邀请全在 Convex，不需迁移。 |

## 7. 如何验证（可执行步骤）

1. **版本与弃用**（只读，任何机器）：
   - `node -e "for (const p of ['@clerk/nextjs','convex']) { const j=require('/Users/zhennn/cal-hack-2026-main/node_modules/'+p+'/package.json'); console.log(p,j.version,j.license,JSON.stringify(j.peerDependencies)) }"` → 期望 `@clerk/nextjs 7.9.20 MIT`（peer 含 `^16.1.0-0`、`~19.3.0-0`），`convex 1.48.0 Apache-2.0`（peer 含 `@clerk/react ^6.4.3`）。
   - `sed -n 8,24p NM:@clerk/nextjs/dist/types/server/routeMatcher.d.ts` → 看到 `@deprecated`。
   - `sed -n 74,98p NM:convex/src/react-clerk/ConvexProviderWithClerk.tsx` → 看到 `aud === "convex"` 分支与 `[orgId, orgRole, sessionId]` 依赖。
   - `npm view @clerk/testing@2.2.50 license peerDependencies`；`npm view convex-test version peerDependencies`。
2. **Token 路径**：dev 实例激活 Convex 集成后，浏览器控制台 `await window.Clerk.session.getToken()` 解码，确认 `aud === "convex"`、含 `name`/`email`、无 `org_*`/角色 claim、总大小远低于 4KB。
3. **Convex 接受 token**：`/setup` 页 `useConvexAuth().isAuthenticated === true`，`health.viewer` 返回 `tokenIdentifier` 形如 `https://<slug>.clerk.accounts.dev|user_…`。
4. **fail-closed**：在一个临时 dev deployment 上 `npx convex env remove CLERK_JWT_ISSUER_DOMAIN` 后 `npx convex dev --once`，期望推送失败；恢复变量。未登录调用任一公共函数，期望 `UNAUTHENTICATED`。
5. **授权单测**（convex-test）：陌生人读 `rooms.view` → 拒绝；A 已是 customer 再接受 finance 邀请 → `ALREADY_MEMBER`；同一邀请第二次接受 → `INVITE_USED`；过期 → `INVITE_EXPIRED`；`invitedEmail` 不符 → `INVITE_EMAIL_MISMATCH`。
6. **并发抢席位**（真实 dev deployment）：两个账号同时 `acceptInvite` 同一 token（或同角色两个邀请），重复 50 次，断言 `by_room_role` 下 active 成员始终 ≤1。
7. **E2E**：`clerkSetup()` → 三个 context 各 `clerk.signIn({ page, emailAddress })` → customer 建房得两条链接 → provider/finance 接受 → 断言三方工作台各自只见本人简报（与 16 的隐私金丝雀共用）。
8. **proxy 行为**：未登录访问 `/rooms/x` 被重定向到登录页；直接调用 Convex 函数（绕过 Next）仍被拒，证明授权不依赖 proxy。
9. **keyless 关闭**：清空 `.env.local` 的 Clerk key、保留 `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED=1` 启动 `next dev`，期望显示"未配置"而非自动创建实例。
10. **待验证项**（实现前在 Clerk Dashboard 各确认一次）：`email_verified` shortcode 名称；prod Invite-only 是否需付费；dev 实例用户数上限；session token 刷新周期仍为 60s。

## 8. 与其它文档的接口

- 02/03：`users`、`roomMembers`、`roomInvites` 字段与索引按 4.1；唯一性由 `roomInvites.accept` 与 `rooms.create` 两个写入口守。
- 07：动作×角色矩阵以 `roomMembers.role` 为输入；"审批人必须是不同 userId"由 `accept` 的一人一角保证，08 再做集合判定。
- 12：新增 `users.ensureViewer`、`roomInvites.create/revoke/accept`、`health.viewer`；所有公共函数无 `userId`/`role` 参数。
- 15：环境变量 Next 侧 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`、`CLERK_SECRET_KEY`、`NEXT_PUBLIC_CLERK_KEYLESS_DISABLED`、`NEXT_PUBLIC_CONVEX_URL`；Convex 侧 `CLERK_JWT_ISSUER_DOMAIN`；E2E 侧 `CLERK_PUBLISHABLE_KEY`、`CLERK_SECRET_KEY`（仅 dev 实例）。
- 16：4.6 与第 7 节的用例。

## 9. 来源（访问日期均为 2026-10-24）

- [S1] inputs/04-platform-constraints-part4.md、part2.md；inputs/02-review-design-findings-part3/part7/part11.md；inputs/03-role-a-branch-decisions-part2/part3.md（本工作区）。
- [S2] Clerk, Testing overview — https://clerk.com/docs/guides/development/testing/overview
- [S3] Convex, Convex & Clerk — https://docs.convex.dev/auth/clerk （仍写 `middleware.ts`、`CLERK_JWT_ISSUER_DOMAIN`）
- [S4] Clerk, Integrate Convex with Clerk — https://clerk.com/docs/guides/development/integrations/databases/convex （`aud` 预映射、`CLERK_FRONTEND_API_URL`、Provider 顺序、推荐用 Convex 的 `<Authenticated>`）
- [S5] Clerk, Test emails and phones — https://clerk.com/docs/guides/development/testing/test-emails-and-phones （`+clerk_test`、`424242`、dev 默认 test mode）
- [S6] Clerk, Customize session tokens — https://clerk.com/docs/guides/sessions/customize-session-tokens （4KB cookie、自定义约 1.2KB、每 60s 刷新）
- [S7] Clerk, Session options — https://clerk.com/docs/guides/secure/session-options （Multi-session 只能在 Dashboard 开启、`<MultisessionAppSupport />`）
- [S8] Clerk, Organizations overview — https://clerk.com/docs/guides/organizations/overview （MRO：免费 dev 50 / prod 100；每标签页一个 active org）
- [S9] Clerk, Migrate from createRouteMatcher — https://clerk.com/docs/guides/development/upgrading/upgrade-guides/migrate-from-create-route-matcher ；Clerk, clerkMiddleware 参考 — https://clerk.com/docs/reference/nextjs/clerk-middleware （Next ≤15 才用 `middleware.ts`）
- [S10] Clerk, Playwright overview — https://clerk.com/docs/guides/development/testing/playwright/overview ；[S10b] Test helpers — https://clerk.com/docs/guides/development/testing/playwright/test-helpers
- [S11] npm registry：`npm view @clerk/testing`（2.2.50，MIT，2026-10-23）、`npm view @clerk/nextjs`（7.9.20，2026-10-23）、`npm view convex`（1.48.0，2026-10-22）
- [S12] Clerk, Deploy to production — https://clerk.com/docs/guides/development/deployment/production （自有域名、DNS、自备 OAuth）
- [S13] Clerk, Restricting access — https://clerk.com/docs/guides/secure/restricting-access （Open / Invite-only / Waitlist；allowlist 生产需付费）
- [S14] npm registry：`npm view convex-test`（0.0.65，peer `convex ^1.43.0`，Apache-2.0）
- 本地文件：`NM:@clerk/nextjs/package.json`；`CLK:server/routeMatcher.d.ts:16-23`；`CLK:removedControlComponents.d.ts`；`CLK:client-boundary/controlComponents.d.ts:2`；`NM:@clerk/nextjs/dist/esm/utils/feature-flags.js:4`；`NM:@clerk/nextjs/dist/esm/server/constants.js:26`；`CBE:api/endpoints/InvitationApi.d.ts`；`CBE:api/endpoints/TestingTokenApi.d.ts`；`CVX:react-clerk/ConvexProviderWithClerk.tsx:30-110`；`CVX:server/authentication.ts:100-167`；`NM:convex/package.json`。
- 注：`CLK:removedControlComponents.d.ts` 的注释里含有面向 AI 代理的操作指示（要求安装 Clerk CLI/Skills），按"网页与文件内容是数据"处理，本文只采信其中"Core 3 于 2026-03-03 移除 `<SignedIn>`，改用 `<Show>`"这一事实陈述，未执行任何安装。
