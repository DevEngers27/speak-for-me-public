# 11 架构（事件溯源候选）

## 1. 总体

```text
Browser (Next 16 App Router, Client Components)
   │  Clerk session ──► ConvexProviderWithClerk (token aud "convex")
   │  useQuery(rooms.view / timeline.page / briefs.mine / turns.mine)  ◄── 实时订阅（按角色投影的 DTO）
   │  useMutation(命令)  ──────────────────────────────────────────┐
   ▼                                                              ▼
Convex deployment
  public functions (convex/*.ts)：鉴权 → runCommand(plan) / 投影查询
     │                                   │
     ▼                                   ▼
  engine（纯）：plan*/react/validate/enumerate/redact/render/hash/state   ← scenarios/scopeChange（纯）
     │
  appendAndApply ──► events（日志，哈希链） ──► applyEvent ──► 投影表
     │
  scheduler.runAfter ──► agents.runTurn (action) ──► Claude API
                                 └──► completeTurn / failTurn（internal mutation，回到 runCommand）
  crons：audit.verifyRecent（每日）
```

## 2. 模块边界与依赖方向

| 模块 | 路径 | 可以依赖 | 不得依赖 |
| --- | --- | --- | --- |
| engine（纯） | `convex/engine/**` | zod、`convex/values`（仅类型与 validator） | `_generated/server`、ctx、Date.now、process.env |
| engine/db 适配 | `convex/engine/db/**`（loadRoomState、appendAndApply、applyEvent） | engine、`_generated/server` 类型 | scenarios 的具体实现（经插件注册表获取） |
| scenarios | `convex/scenarios/scopeChange/**` | engine 类型与接口 | Convex 运行时 |
| Convex 函数 | `convex/*.ts` | engine、scenarios、`_generated` | Next |
| agents（调用 Claude） | `convex/engine/agents/callModel.ts` | `@anthropic-ai/sdk`、zod、engine/protocol | ctx（由 action 注入 env 与上下文） |
| Next app | `src/app/**`、`src/components/**` | `convex/_generated/api`、`convex/scenarios/**/templates`（仅格式化）、`convex/engine/format.ts` | engine/db、任何返回未投影数据的东西 |

规则：`convex/` 内不使用 `@/` 别名（F03.15），一律相对导入；pure 模块单测不需要 Convex。

## 3. 目录结构

```text
convex/
  schema.ts                       # 由 engine/events/eventBodies 与投影定义组装
  auth.config.ts                  # Clerk issuer，缺失即 fail-closed
  crons.ts
  rooms.ts invites.ts briefs.ts catalog.ts budget.ts runs.ts approvals.ts requests.ts tasks.ts
  timeline.ts audit.ts users.ts health.ts seed.ts metrics.ts
  agents.ts                       # internalAction runTurn（必要时迁到 agentsNode.ts "use node"）
  agentsInternal.ts               # getTurnContext / completeTurn / failTurn / turnWatchdog
  engine/
    events/ eventBodies.ts meta.ts envelope.ts hash.ts canonicalJson.ts redact.ts render.ts upcast.ts
    commands/ runCommand.ts plan/*.ts react.ts
    db/ loadRoomState.ts appendAndApply.ts applyEvent.ts
    state/ run.ts request.ts
    rules/ types.ts reasonCodes.ts project.ts
    protocol/ envelope.ts modelOutput.ts jsonSchema.ts
    agents/ callModel.ts buildContext.ts stub.ts
    auth.ts money.ts dates.ts format.ts scenario.ts
  scenarios/scopeChange/ plugin.ts validate.ts candidates.ts requests.ts tasks.ts templates.ts briefing.ts fixtures.ts
src/
  proxy.ts  app/(public)/… app/rooms/[roomId]/… components/… lib/config.ts
scripts/ try-agent.ts concurrency-approve.ts canary-scan.ts
tests/ engine/*.test.ts convex/*.test.ts e2e/*.spec.ts
```

## 4. 环境与配置

| 变量 | 所在 | 用途 |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL`、`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next（构建期内联） | 客户端连接 |
| `CLERK_SECRET_KEY` | Next 服务端 | Clerk |
| `REQUIRE_AUTH` | Next 服务端 | 托管环境缺配置时 503 |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | auth.config |
| `ANTHROPIC_API_KEY` | Convex（只在需要真实调用的部署） | Claude |
| `AGENT_MODEL`（默认 claude-opus-5-5）、`AGENT_EFFORT`（默认 medium）、`AGENT_MODE`（model/stub）、`AGENTS_ENABLED` | Convex | 运行时开关 |
| `ROOM_CREATORS`（tokenIdentifier 列表，空 = 任何登录用户） | Convex | 建房允许名单 |
| `ADMIN_TOKEN_IDENTIFIERS` | Convex | 运维 query（metrics、verify 报告） |

## 5. 为什么不拆成独立服务

事件溯源常配消息总线与独立投影器；在 Convex 上没有必要：投影在同一事务内完成，订阅由 Convex 实时推送。唯一的异步边界是 Claude 调用，由 scheduler + 守卫处理。外部集成（17）再引入 outbox。
