# 11 架构

## 1. 模块与依赖方向

```
apps/web (Next 16)  ──>  convex/ (Convex 函数，薄层)  ──>  packages/engine  <──  packages/scenarios/*
        └──────────────>  packages/scenarios/*/ui (仅 UI slot 组件)          (插件只依赖 engine 的类型)
```

| 模块 | 内容 | 可依赖 | 禁止 |
| --- | --- | --- | --- |
| `packages/engine` | 纯 TS：Snapshot 类型、ScenarioPlugin 接口、`evaluate`、`state.ts`、`approvalSetComplete`、protocol（输出 schema 构造）、`model.ts`（SDK 调用）、模板渲染器 | zod、@anthropic-ai/sdk | convex 服务端 API、任何场景词（lint） |
| `packages/scenarios/software-change` | 插件实现、fixtures、模板、`viewValidator`、`ui/` slot 组件 | engine 类型、zod、convex/values（仅 validator） | 引擎内部实现、数据库 |
| `packages/scenarios/event-budget` | 第二插件（v1 只做到契约测试通过，不上线） | 同上 | 同上 |
| `convex/` | schema、鉴权 helper、公共/内部函数、`buildSnapshot`、`bumpConstraints`、插件注册表 `convex/scenarios.ts` | engine、scenarios（相对路径导入，不用 `@/`） | 业务规则内联（规则一律调 engine/插件） |
| `apps/web` | 页面、Clerk、Convex provider、引擎通用组件、按 slot 渲染插件 UI | convex `_generated/api`、scenarios/*/ui | 直接 import 插件的规则函数或私密类型 |

插件注册是**编译期静态**的：`convex/scenarios.ts` 导出 `const PLUGINS = { software_change: softwareChangeV1 } as const`；`event_budget` 只在测试注册表中。v1 不做运行时插件加载（反对过度设计）。

## 2. 目录结构

```
speak-for-me/
  apps/web/src/app/{(public),rooms/[roomId]/{page,brief,outcome}}/…
  apps/web/src/components/engine/…        # ProposalCard, DecisionPanel, Timeline, RequestCard, RunProgress
  convex/{schema.ts, auth.config.ts, scenarios.ts}
  convex/lib/{auth.ts, validators.ts, snapshot.ts, constraints.ts, proposals.ts, events.ts, cents.ts}
  convex/{users,rooms,invites,briefs,catalog,ledger,runs,turns,agentTurns,agentContext,decisions,requests,events,seed,ops}.ts
  packages/engine/src/{plugin.ts, snapshot.ts, evaluate.ts, state.ts, approvals.ts, protocol.ts, model.ts, templates.ts}
  packages/scenarios/software-change/src/{index.ts, schemas.ts, derive.ts, checks.ts, enumerate.ts, tradeoffs.ts, execution.ts, templates.ts, project.ts, agent.ts, fixtures.ts, ui/*}
  packages/scenarios/event-budget/src/…
  scripts/{try-agent.ts, concurrency-check.ts, privacy-scan.ts}
```
模型调用放 `convex/agentTurns.ts`（默认运行时，显式 `apiKey`）；若真实推送证明 SDK 需要 Node，则该文件加 `"use node"` 且只含 action（待验证 #4）。

## 3. 环境与配置

| 变量 | 归属 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL`、`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next（构建期内联） | 每个环境分别构建 |
| `CLERK_SECRET_KEY` | Next 服务端 | — |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | 缺失即推送失败 |
| `ANTHROPIC_API_KEY` | Convex（仅需要真实调用的部署） | dev/prod 不同 key 与 workspace |
| `AGENT_MODE`（model/stub）、`AGENTS_ENABLED`、`AGENT_MODEL`、`AGENT_EFFORT` | Convex | 模型白名单校验 |
| `ROOM_CREATORS`（tokenIdentifier 列表，可空=任何登录用户） | Convex | 谁能建房 |
| `OPS_ADMINS` | Convex | 运维 query 白名单 |

`isClerkConfigured()`（无 server-only）做格式校验（pk_/sk_ 同为 test 或 live；Convex URL 为 `.convex.cloud` 或 localhost），供 proxy 与 `/setup` 共用。
