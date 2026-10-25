# Spike 报告：Next 16 + Convex + Clerk 新仓库骨架

目录：`/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/spikes/skeleton/`（下称 SK）。未做任何真实 Claude 调用，未读取任何密钥；只用了自造的假值（`pk_test_` 编码 `example.clerk.accounts.dev$`、`sk_test_SKELETONSECRETMARKER…`、`https://fake-skeleton-123.convex.cloud`）在 localhost 上测试。

## 1. 目的

验证一个干净的 Next.js 16.4.3 + Convex 1.48.0 + Clerk 7.9.20 + TypeScript 6.0.3 仓库骨架：按 engine / scenarios / app 分层，lint、typecheck、vitest + convex-test、build 在**无任何凭据**时全部通过；缺配置时 fail closed；`proxy.ts` 用 `auth.protect()` 保护 `/rooms`；CI 不需要 secret。

## 2. 做了什么

- 安装：`npx --yes pnpm@11.25.0 install`（9.6s），再 `pnpm add -D vite@8.3.5`。版本：next 16.4.3、react 19.3.1、convex 1.48.0、@clerk/nextjs 7.9.20、zod 4.6.7、typescript 6.0.3、eslint 9.39.5 + eslint-config-next 16.4.3、vitest 5.0.5、convex-test 0.0.65、@edge-runtime/vm 5.0.0、vite 8.3.5。pnpm 11 自动把太新的包写进 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（17 条）。
- 离线 codegen：`convex codegen --system-udfs --typecheck disable`（隐藏参数，走 `doCodegen`，不需要部署）。
- 目录结构：

```
core/engine/                 纯 TS：ScenarioPlugin 契约、defineScenario（不依赖任何框架）
core/scenarios/scope-change/ 首个场景插件，只依赖 core/engine
convex/schema.ts             组合 engineTables + scopeChangeTables
convex/auth.config.ts        CLERK_JWT_ISSUER_DOMAIN 缺失即抛错（fail closed）
convex/engine/{auth,health,tables}.ts   requireIdentity、ping/whoami、users 占位表
convex/scenarios/scopeChange/tables.ts  场景表占位（约定 scopeChange_ 前缀）
convex/test.setup.ts         convex-test 模块表（文件名两个点 → 不会被部署）
convex/_generated/           提交入库，CI 检查漂移
src/app/{layout,page,rooms/page,setup/page}.tsx
src/components/providers.tsx ConvexClientProvider + BackendGate（条件 Provider）
src/lib/config.ts            server-only，返回 configured / unconfigured(missing[])
src/proxy.ts                 /rooms(.*) → auth.protect()；无 Clerk 配置时重定向 /setup
eslint.config.mjs            分层规则（no-restricted-imports）
vitest.config.ts             两个 project：convex（edge-runtime）与 core（node）
.github/workflows/ci.yml     install → codegen 漂移检查 → lint → typecheck → test → build
```

- 分层依赖方向：`core ← convex`、`core ← src`、`src → @convex/_generated/{api,dataModel}`（只允许这两个）。别名：根 tsconfig `@/*`、`@core/*`、`@convex/*`；`convex/tsconfig.json` 声明 `@core/*`。
- 条件 Provider：服务端 layout 只在三项变量齐全时渲染 `<ClerkProvider publishableKey>` → `<ConvexClientProvider>`；否则不创建 `ConvexReactClient`，显示缺失变量名横幅；使用 Convex hook 的组件包在 `BackendGate` 里。

## 3. 实测结果（原样摘录）

### 3.1 无凭据环境（`env -i PATH HOME`）下 lint / typecheck / test / build

```
################ pnpm lint
$ eslint --max-warnings=0 .
exit=0
################ pnpm typecheck
$ tsc --noEmit -p tsconfig.json && tsc --noEmit -p convex/tsconfig.json
exit=0
################ pnpm test
$ vitest run
 ✓  core  core/engine/plugin.test.ts (2 tests) 1ms
 ✓  convex  convex/engine/health.test.ts (3 tests) 10ms
 Test Files  2 passed (2)
      Tests  5 passed (5)
exit=0
################ pnpm build
$ next build
▲ Next.js 16.4.3 (Turbopack)
✓ Compiled successfully in 971ms
  Running TypeScript ...
  Finished TypeScript in 817ms ...
Route (app)
┌ ƒ /
├ ƒ /_not-found
├ ƒ /rooms
└ ƒ /setup
ƒ Proxy (Middleware)
exit=0
```

（完整日志：SK/final-check.log、SK/build.log）

### 3.2 运行时探针（`next start -p 3917` + curl）

无凭据构建、无运行时变量：
```
== GET /            200   "Running without a backend. See /setup."  + 横幅 "Backend not configured (...)"
== GET /rooms       307 -> http://localhost:3917/setup?missing=clerk
== GET /rooms/abc   307 -> http://localhost:3917/setup?missing=clerk
```
**同一份无凭据构建**、只在运行时注入假 Clerk key：
```
== GET /rooms       307 -> https://example.accounts.dev/sign-in?redirect_url=http%3A%2F%2Flocalhost%3A3917%2Frooms
== GET /setup       ... Status: unconfigured NEXT_PUBLIC_CONVEX_URL   （服务端读到了运行时的 NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY）
```
带假值完整构建（三项齐全）：
```
## secret marker in client static chunks:  0
## convex url in client static chunks:     0
== GET /                          200  "Connecting to Convex..."   secret in HTML: 0
== GET /rooms (document)          307 -> https://example.clerk.accounts.dev/v1/client/handshake?...&__clerk_hs_reason=dev-browser-missing
== GET /rooms (Accept json, Sec-Fetch-Dest empty)  307 -> https://example.accounts.dev/sign-in?redirect_url=...
```
临时加一个受保护的 Route Handler `/api/probe`（测完已删除）：
```
== GET /api/probe (fetch, JSON)   307 -> https://example.accounts.dev/sign-in?redirect_url=...%2Fapi%2Fprobe
```
原因：`@clerk/nextjs/dist/esm/server/protect.js:87-97` 的 `isPageRequest` 还包含 `isPagePathAvailable()`（读 Next 的 static store 里的 `page`），在 Next 16 proxy 中对这些请求成立，于是一律重定向而非 404。

### 3.3 其他

- convex-test：按 Convex 文档写 `import.meta.glob("./**/!(*.*.*)*.*s")` 时，**Vite 8.3.5 返回空数组**，报 `Could not find the "_generated" directory`。改成数组 + 取反模式后通过（键为 `./_generated/api.js`、`./engine/health.ts` 等）。
- TypeScript 6.0.3：convex/tsconfig 按 Convex 模板（没有 `types`）时报 `convex/auth.config.ts(7,16): error TS2591: Cannot find name 'process'`；TS 6 的 `types` 默认是 `[]`，加 `"types": ["node"]` 后通过。
- 离线 codegen 连续跑两次，`diff -r` 无差异（确定性），可用于 CI 漂移检查。
- 带连字符目录 `convex/scenarios/scope-change/probe.ts`：codegen 生成 `"scenarios/scope-change/probe"`，`api.scenarios["scope-change"].probe.probe` 能通过 tsc。
- Convex 打包回放（SK/spike-probes/convex-bundle.mjs，复刻 `convex/src/bundler/debugBundle.ts` 的 esbuild 0.27.0 参数；Convex 不传 `tsconfig` 选项）：`errors: 0`，inputs 包含 `core/engine/index.ts`、`core/scenarios/scope-change/index.ts`，说明 esbuild 会自动读 `convex/tsconfig.json` 的 `paths`。
- 分层 lint 反例：在 core 引 `convex/server`、`react`，在 src 引 `@convex/engine/auth`、`../../convex/_generated/api`，在 convex 引 `@/lib/config`，共 5 个 error，全部被拦截。
- Clerk 开发实例会打印遥测提示；`.env.example` 与 CI 已设置 `CLERK_TELEMETRY_DISABLED=1`。

## 4. 对设计的结论

**被证实**
1. 这套版本组合可以干净安装，无凭据时 lint / typecheck / test / build 全过。
2. 没有部署也能生成 `convex/_generated`（`codegen --system-udfs`，仅适用于不含组件的应用），输出确定，所以「生成代码入库 + CI 漂移检查」可行。
3. 条件 Provider：未配置时不挂载 ConvexReactClient；配置后 SSR 不建 WebSocket（`react/client.ts:385-391` 的懒加载 `sync`），页面显示加载态。
4. `proxy.ts` 的 `createRouteMatcher(["/rooms(.*)"])` + `auth.protect()` 生效：未登录访问 /rooms 会被重定向。未配置 Clerk 时重定向到 /setup（fail closed），比原仓库直接放行更严格。
5. `CLERK_SECRET_KEY` 不会进入客户端 chunk 或 HTML。
6. convex-test 0.0.65 的 `withIdentity`、未认证时抛 `ConvexError` 都可以离线测。`requireIdentity` 能 fail closed。
7. Convex 函数可以通过 `@core/*` 别名引用无框架的 core 代码（vitest 与 esbuild 回放都验证了），engine / scenarios / app 三层能用 eslint 强制约束。
8. 带连字符的 Convex 目录能通过 codegen 和类型检查。

**被证伪 / 需修正**
1. 04 第 3.5 节说「非文档请求（API）返回 404」：在 Next 16.4.3 + Clerk 7.9.20 的 proxy 里，JSON 请求和 Route Handler 也得到 307 重定向。API 路由不能依赖 proxy 返回 401/404，要在 handler 里自己 `auth()` 并返回 401（实际授权本来就在 Convex 里做）。
2. Convex 文档里的 convex-test glob（extglob）在 Vite 8 下不能用。
3. Convex 生成的 tsconfig 模板在 TS 6 下不能直接用，必须加 `"types": ["node"]`。
4. 「NEXT_PUBLIC_ 变量一律在构建期内联」不完全准确：构建时没定义的 `NEXT_PUBLIC_*`，服务端代码（proxy、Server Component）会在运行时读取。所以「无凭据构建 + 运行时注入」会造成服务端已配置、客户端 bundle 未内联的混合状态。骨架通过「服务端把 publishableKey 作为 prop 传下去」规避了这一点，但 15-operations 仍应规定「每个环境带变量单独构建」。

**无法离线验证**
1. 真实 Convex 部署是否接受连字符模块路径（服务端校验），以及真实 `convex dev` 推送时的打包结果（只做了 esbuild 回放）。
2. Clerk 真实登录后 Convex `aud=convex` 的 token 流程（原生集成还是 JWT 模板）、`whoami` 端到端。
3. `auth.config.ts` 缺变量时推送失败的实际报错形态。
4. CI workflow 在 GitHub 上实际运行（actions/checkout@v7、setup-node@v7 沿用原仓库的版本号）。
5. `pnpm dev` 下的 HMR、Turbopack 开发模式行为（只验证了 build/start）。

**建议**
- convex/ 下目录用 camelCase（`scenarios/scopeChange`），避免 `api.scenarios["scope-change"]` 的写法和服务端校验风险；core/ 下用 kebab-case。
- 场景表名约定 `scopeChange_*` 前缀，在 `schema.ts` 里组合。
- 每个 Convex 函数先 `requireIdentity`，再做成员 / 角色检查；proxy 只做乐观检查。

## 5. 可直接复用的代码清单（均在 SK 下）

- `package.json`（scripts：lint / typecheck 双项目 / test / check / convex:codegen:offline）、`pnpm-workspace.yaml`、`.npmrc`、`.node-version`
- `tsconfig.json`、`convex/tsconfig.json`（含 `types: ["node"]` 与 `@core/*`）
- `eslint.config.mjs`（分层规则）
- `vitest.config.ts`、`convex/test.setup.ts`（Vite 8 可用的 glob）、`convex/engine/health.test.ts`
- `convex/auth.config.ts`、`convex/engine/auth.ts`（requireIdentity）、`convex/schema.ts` 组合模式
- `src/proxy.ts`、`src/lib/config.ts`、`src/lib/clerk-env.ts`、`src/components/providers.tsx`、`src/app/layout.tsx`
- `.github/workflows/ci.yml`、`.env.example`、`scripts/check-env.mjs`、`README.md`
- `spike-probes/convex-bundle.mjs`（仅 spike 用：离线回放 Convex 打包参数）
