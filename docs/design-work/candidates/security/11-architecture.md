# 11 系统架构

## 11.1 运行时视图

```text
浏览器（Next.js 客户端组件）
  ├─ Clerk（登录、会话）
  └─ ConvexReactClient + ConvexProviderWithClerk ──WebSocket──┐
Next.js 服务端（App Router 外壳、proxy.ts 乐观登录跳转、可选 preloadQuery）      │
                                                             ▼
Convex 部署（唯一可信边界）
  public query/mutation/action ── lib/access（身份→席位→能力）── projections（DTO）
  helpers：constraints / runtime / execution / events / roleView
  internal：agentRuntime（action + mutation）、admin、requests.expire
  数据表（一表一受众，07 §7.11）
  scheduler：runTurn、turnWatchdog、requests.expire
        │ 只带本角色视图
        ▼
Anthropic Messages API（claude-opus-5-5，结构化输出）
```

模块与它解决的问题：

| 模块 | 解决什么 | 若去掉会怎样 |
| --- | --- | --- |
| `packages/engine` | 场景无关的纯逻辑：枚举与迁移表、披露与投影、派生状态、协议 schema 与解释、输入校验、模板框架 | 引擎逻辑散落在 Convex 函数中，无法脱离 Convex 单测，也无法容纳第二个场景 |
| `packages/scenario-scope-change` | 首场景的字段、校验器、规则、候选、放宽、模板、fixture | 场景规则写进引擎，违背"引擎 + 插件"决定 |
| `packages/agent-claude` | 唯一依赖 `@anthropic-ai/sdk` 的模块：请求构造、`callModel`、错误分类、用量映射 | 模型细节渗入运行时；无法用脚本单独调试；多模型扩展无落点 |
| `convex/` | 鉴权、读写、调度、事务；调用上面三个包 | — |
| `apps/web` | 页面与交互；只依赖 Convex 生成的 API 类型与引擎的展示 helper | — |

## 11.2 目录结构

```text
/                                pnpm workspace 根；锁定 lockfile；Node 与 pnpm 版本固定
  apps/web/                      Next.js 16 App Router
    src/app/                     页面（13 章）
    src/components/              客户端组件
    src/proxy.ts                 clerkMiddleware：受保护路由 auth.protect()；托管环境缺配置 → 503
  convex/                        Convex 函数（convex.json 指向此目录）
    schema.ts
    users.ts rooms.ts invites.ts briefs.ts catalog.ts budget.ts proposals.ts decisions.ts
    requests.ts runs.ts agents.ts events.ts results.ts tasks.ts health.ts
    agentRuntime.ts admin.ts
    lib/  access.ts constraints.ts runtime.ts execution.ts roleView.ts events.ts
          projections/*.ts validators.ts log.ts counters.ts
    scenarios/registry.ts        汇总场景插件与校验器联合
    auth.config.ts
  packages/engine/src/
  packages/scenario-scope-change/src/
  packages/agent-claude/src/
  tests/e2e/                     Playwright（三身份）
  scripts/                       try-agent.ts、concurrency-decide.ts、canary-scan.ts、env-check.ts
```

`convex/` 内只用相对路径与 workspace 包名导入，不用 `@/` 别名（F03.15）。workspace 包被 Convex 打包器正常打包的行为：待验证（首个实现任务的最小实验）；若不行，退路是把三个包作为 `convex/` 下的相对目录。

## 11.3 依赖方向与强制

```text
apps/web ──> convex/_generated（类型）、packages/engine（展示 helper、校验）、scenario（表单描述、标签）
convex   ──> packages/engine、packages/scenario-scope-change、packages/agent-claude
scenario ──> packages/engine
agent-claude ──> packages/engine（协议类型）、@anthropic-ai/sdk
engine   ──> zod、convex/values（仅类型与 validator 构造）
```

- 禁止：engine 依赖 scenario；任何包依赖 `convex/` 运行时代码；`apps/web` 依赖 `agent-claude` 或 `convex/lib`。用 ESLint `import/no-restricted-paths`（或 dependency-cruiser）在 CI 中强制。
- `apps/web` 永远拿不到模型密钥，也不导入任何会读取 `process.env.ANTHROPIC_API_KEY` 的模块。
- `convex/` 下 ESLint 规则：`no-console`（`lib/log.ts` 例外）；禁止在 `projections/` 之外从 public 函数返回 `Doc<…>`（自定义规则或评审清单）；禁止对不可变表调用 `db.patch/replace/delete`（静态测试 TC-VER-06）。

## 11.4 环境与配置

| 变量 | 所在位置 | 用途 | 缺失时 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Next（构建期内联） | Convex 客户端地址 | 托管环境 503；开发环境显示 "Backend not configured. See /setup." |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next（内联） | Clerk 前端 | 同上 |
| `CLERK_SECRET_KEY` | Next 服务端 | Clerk 服务端 | 同上 |
| `REQUIRE_AUTH` | Next 服务端 | 托管环境设为 `1`，任何缺配置都 503（fail-closed） | 视为未设置（仅开发） |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | `auth.config.ts` 的 issuer | `auth.config.ts` 抛错，推送失败 |
| `ANTHROPIC_API_KEY` | Convex（只在需要真实调用的部署） | 模型调用 | `AGENT_MODE` 必须为 `stub`，否则 `CONFIG_ERROR` |
| `AGENT_MODE` | Convex | `live` / `stub` | 默认 `stub` |
| `AGENT_MODEL` | Convex | 白名单内模型 | 默认 `claude-opus-5-5` |
| `AGENTS_ENABLED` | Convex | 总开关 | 默认 `true` |
| `ROOM_CREATION` | Convex | `open` / `allowlist` | 默认 `allowlist` |
| `ALLOW_PURGE` | Convex | 允许 `admin.purgeRoom` | 默认不允许 |
| `CONVEX_DEPLOY_KEY` | CI/托管平台 | 部署 | — |

格式预检（`isClerkConfigured()`，不含 server-only 依赖，proxy 与配置模块共用）：publishable/secret key 前缀为 `pk_`/`sk_` 且同为 test 或同为 live；Convex URL 为 https 且以 `.convex.cloud` 结尾或为 localhost；不合格视为未配置（避免格式错误的 key 让全站 500，F11.3）。

## 11.5 运行时选择

- Convex 函数默认 isolate 运行时；`agentRuntime.runTurn` 与 `invites.issue`、`briefs.extractDraft` 先在默认运行时实现（显式传 `apiKey`），若 V-1/V-6 实验失败，再把这三个 action 移到 `"use node"` 文件（该文件只能有 action，相关 internal mutation 留在原文件）。
- 代理 action 不放 `convex/actions/` 目录（F10.9 的提示，行为待验证，直接避开）。
- Next：页面外壳为 Server Component；所有实时数据在 Client Component 中经 `useQuery` 订阅；审批类操作不做乐观更新。不开启 `cacheComponents`，不缓存任何用户相关数据。
