# 11 系统架构

## 11.1 运行时形状

```text
 浏览器（三个独立身份）                Next.js 16（App Router，Node）              Convex 1.48（数据库 + 函数 + 调度 + 订阅）
 ┌────────────────────┐   Clerk 会话   ┌──────────────────────────┐               ┌───────────────────────────────────────────────┐
 │ React 19 客户端组件 │──────────────▶│ proxy.ts：乐观登录检查    │               │ public query：投影后的读模型（rooms.workspace…） │
 │ useQuery / useMutation│◀─ 实时推送 ─┤ Server Components：外壳   │               │ public mutation：鉴权 → 守卫 → 事务写入 → 调度   │
 │ ConvexProviderWithClerk│           │ （可选 preloadQuery）     │               │ internal mutation：claim / record / apply / watchdog │
 └─────────┬──────────┘               └──────────────────────────┘               │ internal action：executeAttempt ──▶ Claude API   │
           │  WebSocket（Convex token）                                          │ scheduler：runAfter（attempt、watchdog、apply）   │
           └────────────────────────────────────────────────────────────────────▶│ crons：sweepStuckRuns                             │
                                                                                 └───────────────────────────────────────────────┘
```

- 所有业务状态在 Convex；Next 不持有密钥（除 `CLERK_SECRET_KEY`）、不做授权、不调用模型（inputs/04 §5.2）。
- 实时性来自 Convex 订阅：三个窗口订阅同一个 `rooms.workspace`，一次提交、一次推送（AC-G6）。不做 token 级流式（inputs/04 §4.9）。
- 唯一的外部依赖调用是 Claude API，只发生在 `executeAttempt` / 抽取 action 中。

## 11.2 模块边界与依赖方向

```text
convex/engine/         纯 TS（只依赖 zod）：literals、validate、money/dates、stateMachines、protocol（Zod）、retryPolicy、
                       classify（响应 / 错误分类）、jsonSchema、promptRender、rules（引擎检查）、templates 渲染器、pricing、runtimeConfig
        ▲
convex/scenarios/<key>/ 纯 TS：场景插件（validators、rules、candidates、planner、templates、prompts、stub、fixtures）
        ▲
convex/lib/            依赖 Convex 类型的 helper：auth、projection、bumpConstraints、runs（startRunTx…）、proposals、execution、events、usage
        ▲
convex/*.ts            Convex 函数模块（12）：只做参数校验、调用 lib、返回投影结果
convex/model/          Anthropic SDK 适配（只被 action 导入）

src/（Next）           只导入 convex/_generated/api 与 convex/engine 中的纯格式化 / 校验函数（即时反馈）
```

规则：
1. 依赖只能自下而上；`convex/engine` 不得导入 Convex 或场景；场景不得导入 `convex/lib`。由 ESLint `import/no-restricted-paths` 强制。
2. `convex/` 内一律相对导入，不用 `@/` 别名（Convex 打包器是否解析根 tsconfig paths 未确认，直接避开，F03.15）。Next 侧在自己的 tsconfig 里定义 `@engine/*` → `convex/engine/*`，只供 Next 使用。
3. 模型调用拆成纯模块：`renderTurnRequest`（纯）、`callClaude`（SDK 薄封装）、`classifyResponse` / `classifyError`（纯）。可以用 `node --env-file-if-exists=.env.local scripts/try-turn.ts` 在 Convex 之外对 fixture 调试一次回合（F10.9）。
4. 单一仓库、单一 package（pnpm），不拆 monorepo 包：Convex 需要把引擎与场景一起打包，拆包只增加构建配置。场景插件的边界由目录与 lint 规则保证。

## 11.3 目录结构

```text
speak-for-me/
├─ convex/
│  ├─ schema.ts  auth.config.ts  crons.ts  convex.config.ts（若需要声明环境变量，语法待验证）
│  ├─ engine/ …               （见 11.2）
│  ├─ scenarios/index.ts       SCENARIOS 注册表
│  ├─ scenarios/scopeChange/ …
│  ├─ lib/ …
│  ├─ model/anthropic.ts
│  ├─ users.ts rooms.ts invites.ts briefs.ts catalog.ts ledger.ts runs.ts proposals.ts decisions.ts
│  ├─ requests.ts events.ts results.ts tasks.ts usage.ts health.ts extraction.ts
│  ├─ agentRuntime.ts agentActions.ts extractionActions.ts ops.ts seed.ts
│  └─ _generated/             （入库：CI 无凭据无法 codegen，F11.2）
├─ src/
│  ├─ proxy.ts
│  ├─ app/（layout、(public)/、rooms/、rooms/[roomId]/…、join/[token]/、setup/）
│  ├─ components/（workspace/、brief/、approval/、results/、common/）
│  └─ lib/（convexClient.tsx、clerkConfig.ts、format.ts 再导出）
├─ tests/（unit/、convex/、concurrency/、e2e/、eval/）
├─ scripts/（try-turn.ts、concurrency-approve.ts、log-scan.ts、env-check.ts）
└─ docs/（本设计）
```

## 11.4 环境与配置

| 变量 | 所在 | 必需 | 缺失时 |
| --- | --- | --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | 是 | `auth.config.ts` 抛错，推送失败（fail-closed） |
| `ANTHROPIC_API_KEY` | Convex | live 模式是 | 启动检查失败；不静默改用 stub |
| `AGENT_MODE` | Convex | 否（默认 live；开发设 stub） | — |
| `AGENT_MODEL` | Convex | 否（默认 `claude-opus-5-5`，必须在白名单） | 不在白名单 → 启动检查失败 |
| `AGENTS_ENABLED` | Convex | 否（默认 true） | — |
| `AGENT_DAILY_CALL_LIMIT` | Convex | 否（默认 2,000） | — |
| `ROOM_CREATION_POLICY`、`ROOM_CREATOR_TOKEN_IDENTIFIERS` | Convex | 生产是 | allowlist 为空 → 无人可建房（fail-closed） |
| `ALLOW_FAULT_INJECTION` | Convex | 否（默认 false；生产必须 false） | — |
| `PRICE_TABLE_OVERRIDE`、`SCHEMA_NULL_STYLE`、`CANDIDATE_ENUM_IN_SCHEMA` | Convex | 否 | 用代码默认值 |
| `NEXT_PUBLIC_CONVEX_URL`、`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next（构建期内联） | 是 | proxy 返回 503 页面 "Backend not configured" |
| `CLERK_SECRET_KEY` | Next 服务端 | 是 | 同上 |
| `REQUIRE_AUTH` | Next | 托管环境设 1 | 缺 key 时 503 而不是放行（T-11） |
| `CONVEX_DEPLOY_KEY` | CI / 托管平台 | 部署时 | — |

"启动检查"：`ops.checkConfig`（internal query）由部署脚本在 `convex deploy` 之后立即调用，检查上表 Convex 侧的组合是否合法（例如生产环境 `ALLOW_FAULT_INJECTION` 必须为 false、live 模式必须有密钥）；失败则部署流水线失败并回滚到上一个版本。Next 侧的 `isClerkConfigured()` 做格式校验（07 T-11）。

## 11.5 依赖

运行时依赖（精确版本，取 inputs/04 的基线）：`convex@1.48.0`、`@clerk/nextjs@7.9.20`、`next@16.4.3`、`react@19.3.1`、`react-dom@19.3.1`、`@anthropic-ai/sdk@1.1.0`、`zod@4.6.7`。开发依赖：`typescript@6.0.3`、`vitest`、`convex-test@0.0.65`、`@edge-runtime/vm`、`@playwright/test`、`eslint` 及 import 规则插件（版本在实现时选择已发布两周以上的精确版本）。Node ≥ 24.19，pnpm，lockfile 入库。

**不引入**：任何 Convex 组件（ADR-01）、Vercel AI SDK、代理框架、向量库、第二个数据库、Python 服务（P-21）。每个新增依赖都需要在 18 中有一行理由。

## 11.6 运行时选择

代理 action 放在 Convex 默认运行时（显式传 `apiKey`，SDK 可在浏览器式打包下工作，inputs/04 §1.2）。若实测失败（V2），只把 `executeAttempt` 与抽取 action 移到 `convex/agentActionsNode.ts`（`"use node"`，该文件只能定义 action），其余文件不变——两阶段写回让 action 与 mutation 天然分属不同文件，迁移无需重构。
