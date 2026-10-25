# 反驳审查：身份与权限（identity-auth.md）

> 审查人：技术选型代理（反驳）。日期 2026-10-24。被审文档：`techstack/identity-auth.md`。
> 缩写：`NM:` = `/Users/zhennn/cal-hack-2026-main/node_modules/`；`CBE:` = `NM:.pnpm/@clerk+backend@3.26.2_.../node_modules/@clerk/backend/dist/`；`SHR:` = `NM:.pnpm/@clerk+shared@4.41.1_.../node_modules/@clerk/shared/dist/`。网页访问日期均为 2026-10-24。

## 0. 结论

**verdict：accept_with_changes。** 主干决定（成员/角色只在 Convex、Clerk 原生 Convex 集成、`tokenIdentifier` 为主键、proxy 只挂 `clerkMiddleware()`、不用 Organizations/publicMetadata/多会话）全部站得住，16 条待验证声明里 13 条完全成立、3 条有措辞或细节错误，没有一条推翻结论。需要改的是四处会在上线或首次联调时咬人的地方：**生产 Invite-only 与房间邀请流程冲突（r01）**、**邀请 token 放在 URL 路径里会经 Clerk 登录跳转泄露给第三方（r02）**、**`email_verified` 其实有文档化的 shortcode，邮箱绑定应 fail-closed 而不是降级（r03）**、**缺 key 时 `clerkMiddleware` 直接抛错，`/setup` 诊断页和"显示未配置"按现设计跑不到（r04）**。

## 1. 声明逐条核对

| # | 声明 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | `@clerk/nextjs` 7.9.20 MIT、peer next `^16.1.0-0`、react `~19.3.0-0`、10-23 发布、latest | 成立 | `NM:@clerk/nextjs/package.json`；`npm view`：`time["7.9.20"]=2026-10-23T16:26:36Z`，`dist-tags.latest=7.9.20`。peer 实为更宽的并集：next `^15.2.8 … ^16.0.10 \|\| ^16.1.0-0`，react `^18 \|\| ~19.0.3 \|\| ~19.1.4 \|\| ~19.2.3 \|\| ~19.3.0-0`；依赖 `@clerk/react ^6.18.1`、`@clerk/backend ^3.26.2` |
| 2 | `convex` 1.48.0 Apache-2.0、peer 含 `@clerk/react ^6.4.3`、10-22 发布 | 成立 | `npm view`：`2026-10-22T23:32:49Z`；该 peer 在 `peerDependenciesMeta` 中为 optional；pnpm 实际解析为 `convex@1.48.0_@clerk+react@6.18.1`（`NM:.pnpm/` 目录名） |
| 3 | `createRouteMatcher` 标 `@deprecated`、下一大版本移除 | 成立 | `NM:@clerk/nextjs/dist/types/server/routeMatcher.d.ts:16-23`；clerk.com clerk-middleware 页另说明"调用时打印运行时弃用警告" |
| 4 | Next 16 用 `proxy.ts`，≤15 用 `middleware.ts` | 成立（措辞） | 页面原意："If you're using Next.js ≤15, name your file `middleware.ts` instead of `proxy.ts`"；代码不变只改文件名。`NM:@clerk/nextjs/dist/esm/server/fs/middleware-location.js` 在 Next≥16 同时识别 `middleware`/`proxy` |
| 5 | `ConvexProviderWithClerk` 的 `aud` 分支、异常返回 null、`[orgId, orgRole, sessionId]` 依赖 | 成立 | `NM:convex/src/react-clerk/ConvexProviderWithClerk.tsx:75-96`（`aud` 分支在 76-80 行，文中写 77-82，差一行，无碍） |
| 6 | Core 3（2026-03-03）移除 `SignedIn/SignedOut/Protect`，改用 `Show` | 成立 | `NM:@clerk/nextjs/dist/types/removedControlComponents.d.ts:6,26`；`index.d.ts:24-25`；`npm view`：7.0.0 发布于 2026-03-03T21:27Z。该文件注释含面向代理的安装指示，本审查同样只当数据，未执行 |
| 7 | `NEXT_PUBLIC_CLERK_KEYLESS_DISABLED` 关闭 keyless；`canUseKeyless` 公式 | 成立 | `NM:@clerk/nextjs/dist/esm/utils/feature-flags.js:4`、`esm/server/constants.js:26`；`isTruthy` 接受 `"1"`/`"true"`（`SHR:underscore.js:95-106`）；`isDevelopmentEnvironment` 即 `NODE_ENV==="development"`，`isAutomatedEnvironment` 检查 `CI`、`GITHUB_ACTIONS` 等 16 个变量（`SHR:_chunks/runtimeEnvironment-CTVGzENl.mjs`）→ **CI 中本就不会启用 keyless**，该变量只对本地 `next dev` 有意义 |
| 8 | Invitations 应用级、已存在邮箱默认报错、`expiresInDays` 默认 30、元数据落 `User.publicMetadata` | 成立 | `CBE:api/endpoints/InvitationApi.d.ts:14-21,79`；另注 `revokeInvitation` "doesn't prevent the user from signing up if they follow the sign up flow"（:93） |
| 9 | 自定义 claim 约 1.2KB、每 60s 刷新 | 成立 | clerk.com/docs/guides/sessions/customize-session-tokens |
| 10 | Organizations 免费 MRO dev 50 / prod 100；每标签页一个 active org | 成立 | clerk.com/docs/guides/organizations/overview（"each tab independently maintains its own Active Organization"；cookie 为全局单例） |
| 11 | 多会话只能在 Dashboard 开启，未开即单会话 | 前半成立，后半仍是推断 | session-options 页："Dashboard-only and can't be changed via the CLI or Backend API"；未写默认值。决策不依赖默认值（文中本就要求保持关闭），把"确认开关为关"放进验证步骤即可 |
| 12 | `+clerk_test`、`424242`、dev 默认 test mode、生产 "highly discouraged" | 成立 | clerk.com/docs/guides/development/testing/test-emails-and-phones |
| 13 | `@clerk/testing` 2.2.50 MIT、peer、`signIn({page,emailAddress})`、需 `CLERK_SECRET_KEY`、project 式 setup | 成立，附两处小错 | `npm view`（2026-10-23T16:25Z，peer 均 optional）；test-helpers 页："bypasses all verification steps, including email verification and multi-factor authentication"；playwright overview："called in a project-based setup, not a function-based globalSetup"。**小错**：(a) 文中 §4.3 第 4 条说"`clerkSetup` 要求开启 Email/Password"，文档原话是 demo 仓库的测试需要，不是 `clerkSetup` 本身的要求；(b) §4.5 写 `clerk.signOut({ sessionId })`，实际签名是 `clerk.signOut({ page, signOutOptions: { sessionId } })` |
| 14 | `convex-test` 0.0.65、peer `convex ^1.43.0`、Apache-2.0 | 成立 | `npm view`（2026-10-23T18:56Z） |
| 15 | 生产必须自有域名 + DNS、自备 OAuth | 成立，有代码层例外 | deployment/production 页（DNS 最长 48h、可用 FAPI proxy 替代 CNAME）。但 `SHR:proxy.mjs:33-64` 与 `NM:@clerk/nextjs/dist/esm/server/clerkMiddleware.js:61-65` 显示：`pk_live_` 且主机名以 `.vercel.app` 结尾时自动启用 `/__clerk` FAPI 代理（`CLERK_DISABLE_AUTO_PROXY` 可关）。见 r10 |
| 16 | `UserIdentity` 的 `name/email/emailVerified` ← `name/email/email_verified`；`tokenIdentifier = sub+iss` | 成立 | `NM:convex/src/server/authentication.ts:100-167` |
| 17 | 未验证三项 | 部分可结 | **`email_verified` shortcode**：clerk.com/docs/guides/sessions/jwt-templates 列出 `{{user.email_verified}}`（示例 `"{{user.email_verified \|\| user.phone_number_verified}}"`）；session token 页未单列，需在 dev 实例 Sessions 页实测一次。**Invite-only 是否收费**：restricting-access 页只写 allowlist/blocklist 生产需付费，三种注册模式未标价——仍未验证。**dev 用户上限**：未查 |

## 2. 兼容性 / 许可证 / 活跃度

- 已装：`next 16.4.3`、`react 19.3.1`、`@clerk/nextjs 7.9.20`、`convex 1.48.0`、`zod 4.6.7`、Node `v24.21.0`（`package.json` engines `>=24.19.0 <25`）。全部落在各自 peer/engines 内：Clerk `node >=20.9.0`，convex `node >=20.0.0`。Zod 4 与身份层无交集（Convex 用 `v`，Clerk 自带校验）。
- 风险点：Clerk 对 React 用 **tilde** 范围（`~19.3.0-0`），React 19.4 发布后要等 Clerk 新版才在 peer 内——升级策略里应写明"React 小版本跟随 Clerk"。
- 许可证：`@clerk/nextjs`/`@clerk/testing` MIT，`convex`/`convex-test` Apache-2.0，均可商用；Clerk 服务本身按其条款与 MAU/MRO 计费。
- 活跃度（12 个月内）：`@clerk/nextjs` 7.9.19→7.9.20 间隔 2 天，canary 每日；`convex` 1.45→1.48 约每月一个小版本；`convex-test` 半年内 16 个版本（0.0.50→0.0.65），活跃但仍是 0.0.x，API 不承诺稳定，须精确锁版本。
- 安全：GHSA-vqx2-fgx2-5wq9 真实存在（CVE-2026-41248，Critical 9.1，2026-04-15 发布），`@clerk/nextjs` 7.x 在 7.2.1 修复，7.9.20 不受影响。但公告描述是"crafted requests 可绕过 `createRouteMatcher`"（CWE-436/863），**没有说是路径规范化**——文中 §3、§5 的定性应改为公告原意。

## 3–5. 问题清单、核心一致性、来源

见 `techstack/identity-auth-review-part2.md`（r01–r11）。
