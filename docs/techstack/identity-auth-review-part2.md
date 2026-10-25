# 反驳审查：身份与权限（续）

> 接 `techstack/identity-auth-review.md` §0–§2。

## 3. 问题清单

| id | 严重度 | 问题 | 建议 |
| --- | --- | --- | --- |
| r01 | medium | **生产默认 Invite-only 与房间邀请流程冲突。** 房间 owner 给一个从未注册过的人发 I1 链接；restricted 模式下此人没有 Clerk invitation ticket 就无法注册，链接实际失效，只能等运维再发一封 Clerk Invitation——每个新参与方都多一道人工准入，且收费与否未验证。文中 §6 自己也承认"Open 也安全：房间访问只靠 I1"。 | 生产默认 **Open + Clerk 内置 bot 防护**；把 Invite-only 降为"运营可选开关"。若坚持限制注册，则 `roomInvites.create` 在带 `invitedEmail` 时由 Next 服务端（非 Convex）调用 `invitations.createInvitation({ ignoreExisting: true, redirectUrl: 邀请页 })`，并写清两封邀请的关系 |
| r02 | medium | **邀请 token 放在路径 `/invite/<token>` 会多处泄露。** (1) proxy/托管平台访问日志与浏览器历史；(2) 文中要求每个 `page.tsx` 调 `auth.protect()`，未登录者访问邀请页时被重定向到 Clerk 登录页，完整 URL 进 `redirect_url` 查询参数，被送到 Clerk 托管页面（第三方）与其日志；(3) Referer。"只存哈希"挡不住这些。 | token 放 **fragment**：`/invite#t=<token>`，浏览器不发给服务器；邀请页**不**调 `auth.protect()`，客户端读 fragment 存入 `sessionStorage` 后清掉地址栏，再引导登录，回来后直接调 Convex `roomInvites.accept`；邀请页设 `Referrer-Policy: no-referrer`。验证步骤加一条：登录跳转后的 URL 不含 token |
| r03 | medium | **`email_verified` 不是"待验证"，可以拿到；现在的降级会悄悄削弱邮箱绑定。** `{{user.email_verified}}` 已在 Clerk JWT templates 文档出现，Convex 会映射成 `identity.emailVerified`（`authentication.ts:164-167`）。文中 §6 的退路"拿不到就只当防误转发"意味着邮箱绑定的安全含义取决于一项配置是否漏做，且无人察觉。 | Claims 加 `"email_verified": "{{user.email_verified}}"`（dev 实例实测一次）；`accept` 在 `invitedEmail` 存在时要求 `identity.emailVerified === true`，否则返回 `EMAIL_UNVERIFIED`（fail-closed）；`/setup` 显示该 claim 是否存在 |
| r04 | medium | **缺 key 时的 fail-closed 路径与 Clerk 实际行为不符。** `clerkMiddleware` 对 publishable/secret key 做 `assertKey`，缺失即抛错（`NM:@clerk/nextjs/dist/esm/server/clerkMiddleware.js:50-57`），`ClerkProvider` 同理。于是被 matcher 覆盖的每个请求都是 500，到不了 `/setup` 诊断页，也到不了 `REQUIRE_AUTH=1` 的 503 逻辑；§7 第 9 步期望"显示未配置"不会发生。 | `proxy.ts` 先判 `isClerkConfigured()`，不满足时返回 503 或 rewrite 到 `/setup`，满足才委托 `clerkMiddleware()`；`/setup` 放进**独立根布局的 route group**（不包 `ClerkProvider`/`ConvexProviderWithClerk`），只读环境变量与 Convex `health` 公共查询。`NEXT_PUBLIC_CLERK_KEYLESS_DISABLED` 写明"仅本地 dev 需要，CI 已自动禁用" |
| r05 | low | **测试工具链缺依赖与版本策略。** `convex-test` 需要 `vitest` + `@edge-runtime/vm` 且 `environment: "edge-runtime"`（docs.convex.dev/testing/convex-test）；`@playwright/test` 未列入；`convex-test` 为 0.0.x。文档未声称 `convex-test` 模拟 OCC，文中把并发测试放到真实 deployment 是对的。 | 在 §4.6/§8 列出 `vitest`、`@edge-runtime/vm`、`@playwright/test` 并精确锁 `convex-test@0.0.65`；并发抢席位可改用 Convex local backend（同页指向 `/testing/convex-backend`），不必占用共享 dev deployment |
| r06 | low | **每个 `page.tsx` 都 `auth.protect()` 偏重。** 授权全在 Convex，页面不在服务端渲染私密数据（`preloadQuery` 也由 Convex 鉴权），页面级检查只是体验层；与 r02 叠加还会把邀请页挡在登录前。 | `(app)/layout.tsx` 一处 `auth.protect()` + 客户端 `<Unauthenticated>` 跳转即可；只在调用 `preloadQuery`/服务端取数的页面额外检查；邀请页、`/setup` 显式豁免 |
| r07 | low | **`ensureViewer` 的时序与陈旧。** 其他函数"查不到 users 行即拒绝"，首次登录时 `rooms.view` 可能早于 `ensureViewer` 完成而报错；`name`/`email` 只在插入时写，之后在 Clerk 改名/换主邮箱不会同步。 | 提供 `viewer` 查询返回 `null` 表示"未建档"，UI 据此调用 `ensureViewer` 并在完成前不挂载业务查询；`ensureViewer` 发现 token 中 `name`/`email` 变化时 patch 并写事件；房间内展示仍用加入时快照 |
| r08 | low | **`isTestAccount` 依据 `+clerk_test` 子地址不可靠。** 生产 test mode 关闭后它只是普通子地址，真实用户可误标；dev 实例里不带它的手工账号又漏标。 | 改为：`identity.issuer` 属于 dev 实例（`*.clerk.accounts.dev`）或由 seed/内部函数显式置位；`+clerk_test` 仅作辅助 |
| r09 | low | **忽略了更简单的邀请方案。** 三方大多是已知邮箱：只建"邮箱定向邀请"（`invitedEmail` 必填，无 token），对方登录后按已验证邮箱列出待处理邀请并接受——没有秘密链接要保管、泄露或重发，r02 整类问题消失。 | 以邮箱定向为默认，I1 链接作为"不知道对方邮箱"时的备选；两者共用同一个 `accept` 写入口与唯一性检查。依赖 r03 |
| r10 | low（PLAUSIBLE） | **Clerk 7.9 对 `.vercel.app` 生产主机自动启用 FAPI 代理**（`SHR:proxy.mjs:33-64`；`clerkMiddleware.js:61-65`），文中实例表未提。若托管在 Vercel 且未绑自有域名，需确认 session token 的 `iss` 是否仍等于 Convex 的 `CLERK_JWT_ISSUER_DOMAIN`，否则 Convex 全部判未认证。 | 实例表补一行"托管平台与 FAPI 代理"；上线前解码一次生产 token 核对 `iss`；不需要时设 `CLERK_DISABLE_AUTO_PROXY=1` |
| r11 | low | **引用与措辞小错**：GHSA 定性（见 §2）；"`clerkSetup` 要求 Email/Password"（实为 demo 仓库要求）；`clerk.signOut({ sessionId })` 签名；Convex 文档 `docs.convex.dev/auth/clerk` 只说"激活 Convex integration"，未提 `aud` 或 JWT 模板，T1/T2 的判断依据应只引 Clerk 页与 `ConvexProviderWithClerk.tsx`。 | 按上述逐条改正文字，不影响决定 |

## 4. 与任务书核心的一致性

- §3.1/§3.4/§3.6：M1 + 单一写入口 + 事件流，方向正确；OCC 依赖"同一 mutation 读过 `by_room_role`/`by_room_user` 索引区间"，文中写法满足。
- §3.8：`isTestAccount` 有意图，判定依据需按 r08 改。
- 无过度设计的大项；`/setup` 诊断页有用，但须按 r04 放到不依赖 Clerk 的树里。页面级 `auth.protect()`（r06）是唯一明显的冗余。

## 5. 来源

- npm registry（`npm view … time/peerDependencies/license/dist-tags`，2026-10-24）：`@clerk/nextjs`、`convex`、`@clerk/testing`、`convex-test`、`@clerk/react@6.18.1`
- 本地：`NM:@clerk/nextjs/package.json`；`NM:@clerk/nextjs/dist/types/{server/routeMatcher.d.ts,removedControlComponents.d.ts,index.d.ts,client-boundary/controlComponents.d.ts}`；`NM:@clerk/nextjs/dist/esm/{utils/feature-flags.js,server/constants.js,server/clerkMiddleware.js,server/fs/middleware-location.js}`；`SHR:{underscore.js,proxy.mjs,_chunks/runtimeEnvironment-CTVGzENl.mjs}`；`CBE:api/endpoints/InvitationApi.d.ts`；`NM:convex/src/react-clerk/ConvexProviderWithClerk.tsx`；`NM:convex/src/server/authentication.ts`；`/Users/zhennn/cal-hack-2026-main/package.json`
- https://clerk.com/docs/reference/nextjs/clerk-middleware
- https://clerk.com/docs/guides/sessions/customize-session-tokens
- https://clerk.com/docs/guides/sessions/jwt-templates
- https://clerk.com/docs/guides/development/integrations/databases/convex
- https://clerk.com/docs/guides/organizations/overview
- https://clerk.com/docs/guides/secure/session-options
- https://clerk.com/docs/guides/secure/restricting-access
- https://clerk.com/docs/guides/development/testing/test-emails-and-phones
- https://clerk.com/docs/guides/development/testing/playwright/overview ；…/playwright/test-helpers
- https://clerk.com/docs/guides/development/deployment/production
- https://docs.convex.dev/auth/clerk ；https://docs.convex.dev/testing/convex-test
- https://github.com/advisories/GHSA-vqx2-fgx2-5wq9
