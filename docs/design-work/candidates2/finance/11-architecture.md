# 11 系统架构

## 1. 组件

```text
Browser (Next 16 App Router, React 19, Client Components)
   │ Clerk session → ConvexProviderWithClerk（token aud "convex"）
   ▼
Convex deployment
   ├─ public query/mutation：鉴权 + 投影 + 守卫（convex/api/*）
   ├─ engine（纯 TS + Convex helpers）：auth、constraints、ledger、signatures、state、projection、events
   ├─ scenarios/scopeChange：目录规则、候选、模板、fixture
   ├─ agents：runTurn(action) / completeTurn / failTurn / watchdog / context.build
   └─ scheduler：runAfter(0) 启动回合、runAfter(120s) 看门狗、runAt(validUntil) 报价到期
   ▼
Anthropic API（仅 agents/callModel.ts 调用）
```

没有出站集成（核心 7）。Next 服务端不持有 Anthropic key，不直接写数据。

## 2. 目录结构

```text
convex/
  schema.ts  auth.config.ts
  lib/validators.ts                 # v.* 共享 validator
  engine/
    rules/ money.ts dates.ts ledger.ts pricing.ts validate.ts candidates.ts contentKey.ts signatures.ts tasks.ts reasonCodes.ts   # 纯函数
    auth.ts constraints.ts state.ts projection.ts events.ts ledgerDb.ts runs.ts proposals.ts execute.ts requests.ts
    scenario.ts                     # ScenarioPlugin 接口与注册表
  scenarios/scopeChange/ plugin.ts templates.ts fixtures.ts
  api/ rooms.ts invites.ts briefs.ts catalog.ts budget.ts runs.ts decisions.ts requests.ts changeOrders.ts tasks.ts events.ts users.ts
  agents/ runTurn.ts complete.ts context.ts callModel.ts agentOutput.ts stub.ts watchdog.ts
  seed.ts
src/
  app/ (signed-in)/rooms/... 页面
  components/ room/ ledger/ proposal/ brief/ requests/
  lib/ format.ts（相对导入 convex/engine/rules/money.ts）
tests/ unit/ convex/ concurrency/ e2e/
```

## 3. 依赖方向

`app(src) → convex/_generated/api`（只调函数）；`convex/api → engine → engine/rules`；`engine → scenario 接口`；`scenarios → engine/rules`（复用纯函数）；`agents → engine`。`engine/rules` 不依赖 Convex 运行时（只依赖 `ConvexError` 类型可换成自定义错误后在边界转换——实现时二选一，倾向纯模块抛 `RuleError`，api 层转 `ConvexError`）。不使用 `@/` 别名于 `convex/`。

## 4. 为什么不拆 monorepo 包

engine 与 scenario 的边界用目录与 ESLint `no-restricted-imports` 约束即可；第二个场景出现前拆包是过度设计（ADR-14）。

## 5. 环境与配置

| 变量 | 所在 | 用途 |
| --- | --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | auth.config；缺失即部署失败 |
| `ANTHROPIC_API_KEY` | Convex | 仅 agents |
| `AGENT_MODE` (`live`/`stub`) | Convex | stub 模式 |
| `AGENTS_ENABLED` | Convex | 总开关 |
| `AGENT_MODEL`、`AGENT_EFFORT` | Convex | 默认 `claude-opus-5-5`、`medium`；白名单校验 |
| `ROOM_CREATOR_ALLOWLIST` | Convex | 建房允许名单 |
| `NEXT_PUBLIC_CONVEX_URL`、`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next（构建期内联） | 客户端 |
| `CLERK_SECRET_KEY` | Next 服务端 | proxy / SSR |

每个环境（dev / preview / prod）分别构建；dev 与 prod 用不同 Anthropic workspace。
