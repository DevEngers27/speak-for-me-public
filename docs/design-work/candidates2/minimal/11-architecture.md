# 11 系统架构

## 1. 总览

```text
Browser (Next App Router, Client Components)
   │  Clerk session → ConvexProviderWithClerk（JWT aud=convex）
   ▼
Convex deployment
   ├─ public functions (rooms/seats/briefs/runs/approvals/requests/tasks/health)
   │     └─ engine helpers  ── scenario plugin (scopeChange)
   ├─ internal agents.* ── scheduler ── runTurn(action) ──► Anthropic API (claude-opus-5-5)
   └─ tables (10)
Next server: 只做外壳、登录跳转（proxy.ts 乐观检查）、可选 preloadQuery（带 token）
```

## 2. 模块边界与依赖方向

| 层 | 目录 | 可以依赖 | 不可依赖 |
| --- | --- | --- | --- |
| 引擎纯模块 | `convex/engine/`（state、derive、context、model、render、cents、dates、scenario 接口） | zod、@anthropic-ai/sdk、`convex/values` 类型 | 任何具体场景、`_generated` |
| 场景插件 | `convex/scenarios/<key>/` | 引擎接口类型、zod、`convex/values` | `_generated`、引擎 Convex 函数 |
| Convex 函数 | `convex/*.ts` | 引擎、场景注册表、`_generated` | Next |
| 前端 | `app/`、`components/` | `convex/_generated/api`、场景 `templates`/`disclosure` 中**不含私密数据**的常量 | 场景 fixtures、prompts |

依赖方向：app → convex functions → engine ← scenarios（场景实现引擎接口，引擎经 registry 取场景）。

## 3. 目录结构（新仓库）

```text
app/(public)/page.tsx, sign-in/, setup/
app/rooms/page.tsx, rooms/[roomId]/{page,brief,results}/page.tsx, join/[token]/page.tsx
components/{workbench,brief-form,proposal-card,approval-panel,request-card,timeline,results}/
convex/schema.ts, auth.config.ts, health.ts, rooms.ts, seats.ts, briefs.ts, runs.ts,
       approvals.ts, requests.ts, tasks.ts, agents.ts, seed.ts, ops.ts
convex/engine/*.ts
convex/scenarios/registry.ts, registry.validators.ts, scopeChange/*
scripts/try-agent.ts, scripts/concurrency-check.ts
tests/unit/*, tests/convex/*, tests/e2e/*
proxy.ts
```

## 4. 环境与配置

| 变量 | 所在 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL`、`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next（构建期内联） | 每个环境单独构建 |
| `CLERK_SECRET_KEY` | Next 服务端 | — |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | 缺失 fail-closed |
| `ANTHROPIC_API_KEY` | Convex（仅需要真实调用的部署） | 其余部署用 stub |
| `AGENT_MODE`（model/stub）、`AGENTS_ENABLED`、`AGENT_MODEL`、`AGENT_EFFORT` | Convex | 模型白名单校验 |
| `ALLOWED_CREATORS` | Convex | 可创建房间的 tokenIdentifier 列表（空 = 全部登录用户） |

- `isClerkConfigured()`（无 server-only 依赖）做格式校验：pk_/sk_ 同为 test 或 live；Convex URL 为 https `.convex.cloud` 或 localhost。未配置时页面显示 "Backend not configured. See /setup."，不存在未认证读写路径。
- `convex/` 内只用相对导入；`_generated` 入库（CI 无凭据无法 codegen）。

## 5. 为什么这样分

- 引擎/场景分离让第二个场景只加目录与联合成员；引擎纯模块可以脱离 Convex 单测。
- 不引入 Convex 组件（workflow/workpool/agent）：本系统的编排是"一个在途回合 + 守卫"，自建代码量小于适配组件的约束（ADR-03）。
