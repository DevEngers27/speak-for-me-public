# 04 平台约束与推荐模式（第 7/7 部分）

> 分片清单见 part1。本文件：§5 Next.js 16.4 + React 19；待验证总表。

## §5 Next.js 16.4 + React 19.3

### 5.1 Server / Client 组件边界

- App Router 默认是 Server Component；文件顶部 `"use client"` 声明边界，**该文件导入的所有模块及其直接渲染的组件都进入客户端包**；作为 `children` 或 props 传入的 Server Component 不进入客户端模块图（文档 `NXD:01-getting-started/05-server-and-client-components.md:142-182`）。
- 从 Server Component 传给 Client Component 的 props 必须可被 React 序列化（同文件 `:298`），并且会出现在 RSC payload 中（`:113-117`）——即对浏览器可见。
- Convex 的 React hooks（`useQuery`、`useMutation`、`usePaginatedQuery`、`useConvexAuth`、`usePreloadedQuery`）只能在 Client Component 中使用；`ConvexReactClient` 在客户端 provider 里只创建一次（原仓库用 `useState(() => new ConvexReactClient(url))`，`ORIG:src/components/providers.tsx`）。
- 组合方式：
  - 纯客户端订阅：页面壳是 Server Component，交互区是 Client Component 内的 `useQuery`；加载中为 `undefined`。
  - 服务端预取 + 客户端续订：Server Component 中 `await auth()` 取 token → `preloadQuery(api.x.y, args, { token })` → 把 `Preloaded` 传给 Client Component → `usePreloadedQuery(preloaded)` 接续实时订阅（`CVX:nextjs/index.ts:17-41, 102-116`；`CVX:react/hydration.tsx:42`）。预取结果会序列化进 HTML/RSC payload，所以与普通 query 一样只能返回调用者有权看的字段。
  - 服务端写入：Server Action / Route Handler 中 `fetchMutation(api.x.y, args, { token })`（`CVX:nextjs/index.ts:160`）。但多数写入直接在客户端 `useMutation` 即可，鉴权都在 Convex 内。
- 乐观更新：`useMutation(...).withOptimisticUpdate(...)`（`CVX:react/client.ts:93, 116`）。对审批、执行这类必须以服务端结果为准的操作不宜使用。
- 带用户 token 的页面是动态渲染；原仓库在根 layout 上 `export const dynamic = "force-dynamic"`（`ORIG:src/app/layout.tsx`）。Next 16 的 `cacheComponents`（PPR）是可选项，原仓库未开启（`ORIG:next.config.ts`；`NXD:02-guides/upgrading/version-16.md:568-575`）；开启后与认证数据的配合见 `NXD:02-guides/authentication-with-cache-components.md`，细节待验证。建议不缓存任何用户相关数据。

### 5.2 `server-only`

- `import "server-only"` 让被客户端误导入的模块在构建时报错；Next 内部处理这两个标记包，安装 npm 包是可选的（只为过 lint），Next 自带类型声明（`05-server-and-client-components.md:558-604`）。原仓库在 `src/lib/config.ts` 中使用。
- Convex 函数运行在 Convex 部署里，不在 Next 里；`server-only` 对 Convex 代码无意义。Claude 密钥（`ANTHROPIC_API_KEY`）只配置在 Convex 环境变量中，Next 侧不需要也不应持有。

### 5.3 环境变量公开规则

- 只有 `NEXT_PUBLIC_` 前缀的变量进入浏览器包，并且在 `next build` 时**内联为常量**，构建后不再随环境变化；动态读取（`process.env[name]`、解构后再读）不会被内联；其他变量只在 Node 服务端可用（文档 `NXD:02-guides/environment-variables.md:156-198`）。客户端引用无前缀变量会被替换为空字符串（`05-server-and-client-components.md:558`）。
- 本系统的变量归属（建议）：Next 浏览器可见 `NEXT_PUBLIC_CONVEX_URL`、`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`；Next 服务端 `CLERK_SECRET_KEY`；Convex 部署 `CLERK_JWT_ISSUER_DOMAIN`、`ANTHROPIC_API_KEY`、模型与 effort 配置。

### 5.4 proxy 与运行时

见 part4 3.5：`proxy.ts` 固定 Node 运行时，只做乐观的登录检查。

## §5 对设计的直接含义

1. 13-frontend 的页面结构：Server Component 做外壳与（可选的）预取，所有实时数据在 Client Component 中通过 Convex 订阅获得；角色工作台是 Client Component。
2. "不得把私密字段发到浏览器再隐藏"在 Next 侧的落点：Server Component 传给 Client Component 的 props、`preloadQuery` 的结果、`useQuery` 的结果，三者都必须来自已按角色裁剪过的 Convex query。
3. 前端不持有任何密钥；Claude 调用只发生在 Convex action 中。
4. 审批、执行等操作不做乐观更新，以服务端提交结果和订阅回推为准。
5. 构建期内联意味着每个环境（dev / preview / prod）要分别构建，`NEXT_PUBLIC_CONVEX_URL` 指向对应的 Convex 部署。

---

## 待验证总表

实现开始前应逐条用最小实验确认，并把结论回填到 10-agent-runtime / 15-operations / 18-decisions。

| # | 事项 | 影响的设计 | 建议的验证方式 |
| --- | --- | --- | --- |
| 1 | Convex action 最长运行时间、mutation/query 的读写与时长限额、单文档大小 | 超时配置、批量写入、事件载荷大小 | 查 limits 文档；`ctx.meta.getTransactionMetrics()` 实测 |
| 2 | OCC 持续冲突时的重试次数与报错形态；索引区间读是否在并发插入时触发冲突 | 唯一性与幂等方案 | 真实 dev 部署上并行发起同键 mutation |
| 3 | 在 action 中调度的函数是否随 action 失败撤销；被调度函数是否带调度者身份 | 重试链、`actorUserId` 传参 | 小实验 |
| 4 | `@anthropic-ai/sdk` 1.1.0 在 Convex 默认运行时的打包与长请求行为 | 是否需要 `"use node"` | 部署一个最小 action 调一次 API |
| 5 | Opus 5.5 典型回合耗时（`medium` / `high`） | SDK `timeout`、watchdog 期限 | 10 次实测取 P95 |
| 6 | API 对根级 `anyOf`、`type` 数组、可选属性、`enum`/`const` 的接受情况 | 输出 schema 形态 | 用 `count_tokens` 或一次真实请求探测 |
| 7 | `beta.messages` 上 `fallbacks` 与 `output_config.format` 能否同用；回退后结构化输出是否仍受约束 | 是否开启回退 | 小实验 |
| 8 | Haiku 5.5 是否拒绝强制 `tool_choice` | 若某路由用 Haiku | 小实验 |
| 9 | `model_context_window_exceeded` 的触发条件 | stop_reason 分支 | 查文档 |
| 10 | SDK 内部重试的失败尝试是否计费 | 成本记录 | 查定价/错误码文档 |
| 11 | API key 所属账户是否在 2026-08-31 之后创建（保留思考强制） | 是否允许改写历史 | 查控制台 |
| 12 | 各模型在本账户等级下的速率限制 | 并发上限、workpool 并行度 | 查控制台 |
| 13 | Clerk 侧用原生 Convex 集成还是 `convex` JWT 模板；多会话默认值 | 认证配置步骤 | 按当前 Clerk/Convex 文档配置一次 |
| 14 | convex-test 0.0.65 的 API 名称（身份模拟、调度推进、组件注册）与局限 | 16-testing | 安装后读其类型与文档 |
| 15 | 各组件 `onComplete` 的严格语义、平台中断时的上报方式 | 若采用组件 | 读组件源码 / 实验 |
| 16 | `convex.config.ts` 声明环境变量的语法；无部署时能否 codegen | 11-architecture、15-operations | 读 Convex 文档 |
| 17 | Next 16 `cacheComponents` 与认证数据的配合 | 若开启 PPR | 读 `NXD:02-guides/authentication-with-cache-components.md` |
