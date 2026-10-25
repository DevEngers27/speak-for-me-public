# 04 平台约束与推荐模式（第 4/7 部分）

> 分片清单见 part1。本文件：§3 Clerk 7.9.20 + convex/react-clerk + Next 16 proxy。

## §3 Clerk 与 Convex 的组合

### 3.1 客户端：`ConvexProviderWithClerk` 与 `useAuth`

- `ConvexProviderWithClerk({ client, useAuth })` 必须放在已配置的 `ClerkProvider` 内，`useAuth` 传 Clerk 的 hook；内部包了一层 `ConvexProviderWithAuth`（源码 `CVX:react-clerk/ConvexProviderWithClerk.tsx:30-58`）。
- 取 token 的两种模式（同文件 `:74-90`）：
  - 若 Clerk 会话 token 的 `aud === "convex"`（Clerk 侧开启了原生 Convex 集成），直接 `getToken({ skipCache })` 取会话 token；
  - 否则用名为 `convex` 的 JWT 模板：`getToken({ template: "convex", skipCache })`。
  - 取 token 抛错时返回 `null`，等价于未登录。
- `orgId`、`orgRole`、`sessionId` 变化会重建 token 获取函数并触发 `setAuth()`（`:96`）；`isLoading = !isLoaded`，`isAuthenticated = isSignedIn ?? false`。
- 原仓库写法：`"use client"` 组件里 `useState(() => new ConvexReactClient(url))`，外层在 `layout.tsx` 中按配置有条件地包 `ClerkProvider` 与该组件（`ORIG:src/components/providers.tsx`、`ORIG:src/app/layout.tsx`）。注意原 layout 在密钥缺失时退化为"不带认证"渲染，属于开发便利、对生产是"放行"的；新设计需明确缺配置时的行为。

### 3.2 Convex 侧配置：issuer 与 applicationID

- `auth.config.ts` 中 OIDC provider 的 `domain` 是 Clerk 的 issuer（Frontend API URL），`applicationID` 必须出现在 JWT 的 `aud` 中（源码 `CVX:server/authentication.ts:30-40`）。原仓库：`{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN, applicationID: "convex" }`，变量缺失则抛错（`ORIG:convex/auth.config.ts`）。
- 该变量要配在 **Convex 部署**的环境变量里（`npx convex env set`），而不只是 Next 的 `.env.local`；1.47 起推送失败时 CLI 会打印缺失变量的 `env set` 命令（`NM:convex/CHANGELOG.md` 1.47）。
- Clerk 控制台用"原生 Convex 集成"还是"JWT 模板 convex"：两种都被客户端代码支持；具体选哪种及控制台步骤：待验证（实现时以 Clerk 与 Convex 当前文档为准）。

### 3.3 服务端取身份（Next 侧）

- `@clerk/nextjs/server` 导出 `auth`、`currentUser`、`clerkMiddleware`、`createRouteMatcher`、`clerkClient`、`verifyToken`、`getAuth`（`CLK:server/index.d.ts:4-22`）。
- 在 Server Component / Route Handler / Server Action 中：`const { userId, getToken } = await auth()`；`getToken({ template?: string })`：给模板名返回该模板签发的 JWT，不给返回原始会话 token（`NM:.pnpm/@clerk+shared@4.41.1_*/node_modules/@clerk/shared/dist/types/ssr.d.ts:12-32`）。
- 把该 token 传给 `convex/nextjs` 的 `preloadQuery` / `fetchQuery` / `fetchMutation` / `fetchAction`（第三参数 `{ token }`），它们默认读 `NEXT_PUBLIC_CONVEX_URL`（源码 `CVX:nextjs/index.ts:11-13, 59-90, 102-183`）。
- 真正的授权在 Convex 函数里用 `ctx.auth.getUserIdentity()` 完成；Next 服务端只转发 token，不应自行判断房间角色。

### 3.4 组织（Organizations）与多会话

- 本系统的"角色"是**每个房间内**的业务角色（customer / provider / finance），属于应用数据，应存在 Convex 的成员表里；Clerk Organizations 的角色/权限是组织级的，`auth.protect({ role })` / `has({ permission })` 校验的是 Clerk 会话 claims（`CLK:server/protect.d.ts`），与房间角色不是一回事。引入 Clerk 组织会产生第二个权限真相源，首个场景不需要。
- 多会话：`sessionId` 变化会触发 Convex 重新认证（3.1）；若启用，前端必须在切换用户时清空依赖身份的状态。首个场景建议不启用；Clerk 控制台默认值：待验证。

### 3.5 Next 16 的 `proxy.ts`（原 middleware）

- Next 16 把 Middleware 改名为 Proxy，功能不变；文件为项目根或 `src/` 下的 `proxy.ts`（与 `app` 同级），每个项目只能有一个；可默认导出或具名导出 `proxy`；用 `config.matcher` 限定路径（文档 `NXD:01-getting-started/16-proxy.md`）。
- **proxy 的运行时固定为 `nodejs`，不可配置，不支持 edge**；需要 edge 只能继续用已弃用的 `middleware` 文件名；`skipMiddlewareUrlNormalize` 等配置项改名为 `skipProxyUrlNormalize`（`NXD:02-guides/upgrading/version-16.md:596-621`）。
- 官方定位：proxy 适合"乐观检查"（如基于权限的重定向），**不应作为完整的会话管理或授权方案**，也不适合慢速数据获取（`16-proxy.md:29`）。
- `clerkMiddleware()` 可以直接作为 proxy 的默认导出或被包一层（原仓库在缺密钥时直接 `NextResponse.next()` 放行，`ORIG:src/proxy.ts`）。签名支持 `clerkMiddleware((auth, req, event) => ..., options)`，选项含 `debug`、`contentSecurityPolicy`、`frontendApiProxy`（`CLK:server/clerkMiddleware.d.ts`）。
- `auth.protect()` 行为（`CLK:app-router/server/auth.d.ts:28-47`）：

| 已认证 | 已授权 | 结果 |
| --- | --- | --- |
| 是 | 是 | 返回 Auth 对象 |
| 是 | 否 | 404 |
| 否 | — | 文档请求重定向到登录页；非文档请求（API）返回 404 |

- 常见写法：`const isProtected = createRouteMatcher(["/rooms(.*)"])`，在 handler 中 `if (isProtected(req)) await auth.protect()`；7.9.20 中的精确签名以类型为准（`createRouteMatcher` 导出见 `CLK:server/index.d.ts:4`）。
- 版本兼容：@clerk/nextjs 7.9.20 的 peer 为 `next ^15.2.8 || … || ^16.0.10 || ^16.1.0-0`，16.4.3 满足（`NM:@clerk/nextjs/package.json`）。

## §3 对设计的直接含义

1. 认证（你是谁）由 Clerk + Convex `auth.config.ts` 完成；授权（你在这个房间能做什么）完全在 Convex 函数里按成员表判断。proxy 的 `auth.protect()` 只做页面级"必须登录"的乐观检查。
2. 内部用户主键建议映射自 `identity.tokenIdentifier`（全局唯一），`subject`（Clerk userId）作展示与对账字段；首次访问时由 mutation 幂等地 upsert `users` 行（按索引查重）。
3. 不使用 Clerk Organizations 表达房间角色；不启用多会话（或明确处理切换）。
4. 缺少 Clerk/Convex 配置时的行为需要明确：开发环境可以显示"未配置"页面，但不能出现"未认证也能读写"的路径——Convex 侧 `getUserIdentity()` 为 `null` 时一律拒绝。
5. 服务端渲染需要数据时，用 `auth().getToken(...)` + `convex/nextjs` 的 `preloadQuery(..., { token })`，客户端用 `usePreloadedQuery` 接续订阅（见 part7 §5）。
6. Convex 部署与 Next 部署各自持有自己的环境变量；`CLERK_JWT_ISSUER_DOMAIN` 属于 Convex，`CLERK_SECRET_KEY` 属于 Next 服务端，`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 与 `NEXT_PUBLIC_CONVEX_URL` 会被内联进浏览器包。
