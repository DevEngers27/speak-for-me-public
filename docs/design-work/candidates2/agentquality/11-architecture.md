# 11 系统架构

## 11.1 组件

```text
Browser (Next 16 App Router, Client Components)
   │  Clerk session ──► Convex JWT
   ▼
Convex deployment
   ├─ public queries/mutations   (auth helpers → role projection → returns validators)
   ├─ internal mutations         (completeTurn, beginAttempt, watchdog, bumpConstraints, seed)
   ├─ internal action runTurn    ──► Anthropic Messages API（@anthropic-ai/sdk 1.1.0）
   └─ scheduler                  (runAfter(0) turns, runAfter(deadline) watchdog)
engine/ 与 scenarios/ 是纯 TS，被 convex/、app/、evals/ 共同 import
```

## 11.2 目录结构（单仓库、单 package，不做 monorepo）

```text
engine/            # 纯 TS：不 import convex、next、react
  protocol/        # TurnSpec、JSON Schema/Zod 生成、checkDecision、agent codes
  negotiation/     # reduceRun、resolveRound、scheduling plans
  rules/           # SystemView 类型、checkBudget、contentHash、projectReasonCodes
  context/         # buildRoleView
  prompt/          # renderPrompt、协议章程
  agents/          # AgentDriver、stub、scripted、replay
  llm/             # Claude 客户端封装、parseAndCheck、usage/cost
  evals/           # EvalCase 类型、内存适配器、指标计算
  scenario.ts      # ScenarioPlugin 接口
scenarios/scope-change/   # briefs、catalog rules、enumerate、validate、templates、prompt cards、fixtures、evalCases
convex/            # schema.ts、auth.config.ts、lib/{auth,constraints,projections,store}.ts、
                   # rooms.ts、invites.ts、briefs.ts、catalog.ts、budgets.ts、runs.ts、agents.ts、
                   # decisions.ts、humanRequests.ts、events.ts、tasks.ts、seed.ts、ops.ts
app/               # Next 路由与组件（13）
evals/             # run.ts、reports/、recordings/
scripts/           # concurrency.ts（真实部署并发测试）、try-agent.ts（直接调试一个回合）
```

## 11.3 依赖方向
`scenarios → engine`；`convex → engine, scenarios`；`app → engine（仅类型与模板渲染）, convex/_generated`；`evals → engine, scenarios`。用 ESLint `no-restricted-imports` 强制：engine 不得 import convex / next / react；app 不得 import `convex/*.ts` 的实现文件。Convex 打包器是否解析 `@/` 别名待验证，统一用相对路径。

## 11.4 为什么协商核心是纯归约器
- 同一份 `reduceRun` 在 Convex mutation 与离线评测中运行，评测结果才对生产有代表性。
- Convex 层只做：鉴权、加载快照、守卫、应用 effects（插入 / patch / 调度）。effects 是封闭联合：`create_proposal | mark_proposal | set_run_status | schedule_turns | create_requests | emit_event`。

## 11.5 环境与配置

| 变量 | 位置 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL`、`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next（构建期内联） | 每个环境单独构建 |
| `CLERK_SECRET_KEY` | Next 服务端 | |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | 缺失则部署失败 |
| `ANTHROPIC_API_KEY` | Convex | dev / prod 不同 key、不同 workspace |
| `AGENT_MODE` | Convex | live / stub / replay（scripted 只在测试） |
| `AGENTS_ENABLED` | Convex | 总开关 |
| `ENABLE_FALLBACK` | Convex | 默认 false（10 §10.9） |
| `ROOM_CREATORS` | Convex | tokenIdentifier 允许名单；空 = 所有登录用户（仅 dev） |
| `ADMIN_TOKEN_IDENTIFIERS` | Convex | 可看运维汇总 |

模型 ID、effort、max_tokens、上限值是代码常量（变更走评测），不放环境变量，避免"环境不同导致行为不同而评测无从覆盖"。
