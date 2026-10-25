# 11 系统架构

## 11.1 运行时视图

```text
Browser (Next.js client components)
  ├─ Clerk (sign-in, session) ──JWT──┐
  └─ ConvexReactClient (WebSocket) ──┴─> Convex deployment
                                          ├─ public queries/mutations   convex/<module>.ts
                                          │     └─ engine adapters      convex/engine/*  ── engine core (pure) engine/*
                                          │                                           └── scenario plugins scenarios/<key>/index.ts
                                          ├─ scheduler ─> internal actions  convex/runtime/agents.ts ──HTTPS──> Anthropic API
                                          ├─ crons                          convex/crons.ts
                                          └─ database (17 tables, 03)
Next.js server (RSC, proxy.ts)
  └─ optional preloadQuery(api..., { token }) → props to client (already projected by Convex)
```

- 浏览器从不接触模型密钥、私密上下文或未投影数据；Next 服务端只转发 Clerk token，不做授权判断（04 平台约束 3.3）。
- 所有业务写入都是 Convex mutation；唯一的外部 I/O（Anthropic）只在 internal action 中，由 mutation 调度（10）。
- 没有第二个数据库、向量库、代理框架、Python 服务或消息队列（P-21、AR-25）。

## 11.2 模块边界

| 层 | 目录 | 职责 | 允许依赖 |
| --- | --- | --- | --- |
| 引擎纯核心 | `engine/` | 类型、规则视图投影、引擎检查、签核判定、状态迁移表、阶段派生、协议 schema、决议策略、规范化键、模板分发、可行性分析 | `zod`、`convex/values`（仅类型与校验器） |
| 场景插件（服务端） | `scenarios/<key>/`（不含 `ui/`） | 06 的 `ScenarioPlugin`：声明、纯函数、模板、校验器、fixture、stub | `engine/` |
| 场景 UI 片段 | `scenarios/<key>/ui/` | 06 第 6.11 节的 `ScenarioUi` | `react`、`engine/` 的 DTO 类型 |
| 组合层 | `scenarios/registry.ts`、`scenarios/ui-registry.tsx`、`convex/schema.ts` | 注册场景、组合载荷校验器 | 场景插件 |
| 引擎 Convex 适配 | `convex/engine/` | 鉴权、表定义、读写 helper（`bumpConstraints`、`insertProposal`、`executeIfComplete`…）、投影 | `engine/`、`convex/server`、组合层 |
| 公共 API | `convex/*.ts` | 12 中的 query/mutation/action（薄：参数校验 → 适配层） | `convex/engine/`、`convex/runtime/` |
| 代理运行时 | `convex/runtime/` | 回合调度、上下文组装、模型调用、看门狗 | `convex/engine/`、`engine/`、`@anthropic-ai/sdk` |
| 运维 | `convex/ops/` | seed、指标、清理、升级、重放（internal，只经 CLI） | `convex/engine/` |
| 应用 | `src/app/`、`src/components/` | 路由、引擎通用组件、角色工作台 | `convex/_generated/api`、`scenarios/ui-registry`、`engine/` 类型 |

依赖方向：`app → (api 类型, ui-registry) ; convex/* → convex/engine → engine ; scenarios → engine`。**引擎从不导入场景**；场景从不导入 `convex/`。

## 11.3 目录结构

```text
speak-for-me/
  engine/                     ruleView.ts projection.ts evaluate.ts feasibility.ts signoff.ts state.ts
                              phase.ts protocol.ts negotiationPolicy.ts canonical.ts render.ts scenario.ts money.ts dates.ts
  scenarios/
    registry.ts  ui-registry.tsx
    scope-change/
      index.ts roles.ts fields.ts lists.ts candidates.ts checks.ts tradeoffs.ts records.ts
      templates.ts agent.ts stub.ts validators.ts fixtures/standard.ts
      ui/ BriefFieldsForm.tsx ScopeListEditor.tsx QuoteListEditor.tsx TermsView.tsx FinanceBudgetPanel.tsx
  convex/
    schema.ts auth.config.ts crons.ts _generated/
    engine/   tables.ts validators.ts authz.ts ruleView.ts constraints.ts briefs.ts lists.ts ledger.ts
              proposals.ts decisions.ts execution.ts requests.ts runs.ts events.ts projection.ts
    runtime/  agents.ts model.ts schema.ts turnInput.ts turns.ts modelConfig.ts pricing.ts
    ops/      seed.ts metrics.ts maintenance.ts
    users.ts rooms.ts invites.ts briefs.ts lists.ts ledger.ts proposals.ts decisions.ts
    requests.ts negotiation.ts history.ts records.ts health.ts
  src/
    app/      见 13
    components/  ProposalCard SignoffPanel RunProgress RequestCard Timeline CandidateExplorer ...
    lib/      convex-provider.tsx format.ts
    proxy.ts
  tests/      unit/ convex/ e2e/ concurrency/ evals/
  scripts/    try-agent.ts concurrency-approve.ts scan-canaries.ts env-check.ts
```

- 函数路径约定：`convex/briefs.ts` 中的 `confirm` 即 `api.briefs.confirm`；`convex/runtime/turns.ts` 中的 `completeTurn` 即 `internal.runtime.turns.completeTurn`（本文其他章节简写为 `runtime.completeTurn`）。
- `convex/` 内一律相对路径导入（不用 `@/` 别名，F03.15）；导入 `../engine`、`../scenarios` 等仓库内其他目录的代码由 Convex 打包器跟随（待验证，首个 spike 确认；不行则把 `engine/` 与 `scenarios/` 移到 `convex/` 下的非函数目录）。
- 不做 pnpm workspace 多包：边界用目录 + lint 强制即可，避免 Convex 打包器解析 workspace 包的不确定性（ADR-01 附注）。

## 11.4 依赖规则（lint 强制）

用 `dependency-cruiser`（或等价工具）在 CI 中检查：

1. `engine/**` 不得导入 `scenarios/**`、`convex/**`、`react`、`@anthropic-ai/sdk`。
2. `scenarios/*/!(ui)/**` 不得导入 `react`、`convex/server`、`convex/**`、`src/**`。
3. `src/**` 不得导入 `convex/engine/**`、`convex/runtime/**`（只能用 `convex/_generated/api` 与 DTO 类型）。
4. 只有 `convex/engine/constraints.ts` 可以写 `constraintsVersion`；只有 03 第 3.22 节列出的模块可以 `patch("rooms")`。
5. `convex/engine/execution.ts` 不得导入任何 action、HTTP 客户端或 SDK（I-22）。
6. `convex/runtime/**` 禁止日志输出 prompt/brief/notes/text 类变量（07 第 7.8 节）。

## 11.5 环境与配置

| 变量 | 所在 | 公开？ | 用途 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Next（构建期内联） | 是 | Convex 客户端 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next（构建期内联） | 是 | Clerk 前端 |
| `CLERK_SECRET_KEY` | Next 服务端 | 否 | Clerk 服务端（proxy、`auth()`） |
| `REQUIRE_AUTH` | Next 服务端 | 否 | 托管环境缺配置时返回 503 而不是放行 |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | 否 | `auth.config.ts`，缺失即推送失败 |
| `ANTHROPIC_API_KEY` | Convex | 否 | 仅需要真实调用的部署 |
| `AGENT_MODE` | Convex | 否 | `live` / `stub`；生产强制 `live` |
| `AGENTS_ENABLED` | Convex | 否 | 全局开关 |
| `AGENT_MODEL_NEGOTIATION`、`AGENT_MODEL_EXTRACTION` | Convex | 否 | 白名单内覆盖默认模型 |
| `ADMIN_TOKEN_IDENTIFIERS` | Convex | 否 | `health.config` 与 `/admin` 页面 |
| `ROOM_CREATOR_ALLOWLIST` | Convex | 否 | 可选：限制建房者 |
| `CONVEX_DEPLOY_KEY` | CI / 托管平台 | 否 | 部署 |

缺关键配置时**拒绝启动或拒绝推送**（P-28），而不是降级成无鉴权。环境拓扑与密钥纪律见 15。

## 11.6 技术基线

Next.js 16（App Router，`proxy.ts`）+ React 19；Convex 1.48；`@clerk/nextjs` 7；`@anthropic-ai/sdk` 1.x；Zod 4；TypeScript 严格模式；Node 24 LTS；pnpm 并提交 lockfile；新依赖选用已发布一段时间的精确版本（15）。版本以 inputs/04 的基线为准，实现时再确认。
