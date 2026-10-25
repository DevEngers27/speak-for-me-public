# 11 系统架构

## 1. 运行时形状

```text
Browser (Next.js App Router, React 19)
  ├─ ClerkProvider ─ sign-in ─> Clerk
  └─ ConvexProviderWithClerk ─ WebSocket + Clerk token ─> Convex deployment
        public query      rooms.workspace / events.list / briefs.mine / turns.mine …  (按查看者投影)
        public mutation   briefs.confirm / decisions.record / requests.answer / runs.* …  (鉴权 + 守卫 + 事件)
        public action     invites.create / briefs.extractDraft                          (需要真随机数或模型)
        internal          agents.context.build / executeTurn / commit.* / ops.*         (调度器、CLI)
        scheduler ──> internal action executeTurn ──HTTPS + ANTHROPIC_API_KEY──> Claude API
        cron      ──> ops.auditRooms（每日）
Next server: 只渲染外壳、转发 Clerk token（可选 preloadQuery）；不持有模型密钥，不做授权。
```
- 授权、规则、状态迁移、执行全部在 Convex mutation 中（8 条不可动摇核心中的第 2–6 条都依赖事务）。Next 侧没有业务 API；`proxy.ts` 只把未登录用户重定向到登录页。
- 模型调用只在 Convex action 中；浏览器永远拿不到密钥与私密上下文（AR-02）。

## 2. 模块与依赖方向

```text
convex/engine/        纯领域核心（不 import Convex 运行时以外的 server 函数）：
  values.ts             字面量集合、assertCents、isoDate、todayIn
  db.ts                 写门面（APPEND_ONLY、MUTABLE_FIELDS）
  auth.ts               requireViewer / requireParticipant / requireRoomOwner
  constraints.ts        commitBriefVersion、bumpConstraints、onConstraintsChanged、loadRuleInputs
  runs.ts               startRun、transitionRun、RUN_TRANSITIONS、scheduleTurn、settleStep、cancelLiveTurns
  decisions.ts          latestDecision、approvalState、executeIfReady
  requests.ts           openRequests、closeRequest、applyOption
  events.ts             emitEvent、EVENT_SPECS
  projection/           projectWorkspace 等（07 §6）
  llm/                  client、request、jsonSchema、usage、price（只依赖 SDK 与 zod）
convex/scenarios/
  registry.ts           scenarioKey + version → ScenarioModule
  scopeChange/          validators、codes、rules（evaluate/enumerate/tradeoffs/derive）、agentSchemas、prompt、stub、templates、fixtures
convex/*.ts             函数层（12）：只做参数校验 → 调 engine → 返回投影；每个文件一个领域
convex/agents/          executeTurn（action）、commit（internal mutation）、context（internal query）
convex/ops/             seed、audit、metrics、purge（internal）
convex/crons.ts         每日 auditRooms
src/                    Next 应用（13）；只 import convex/_generated/api、场景 templates 与 values（纯模块）
tests/                  vitest：unit（纯函数）、convex（convex-test）、privacy、e2e（Playwright）、concurrency（脚本）
```
依赖规则（ESLint `import/no-restricted-paths` 强制）：
1. `engine/**` 不 import `scenarios/**` 的具体模块，只通过 `registry.ts` 取接口实现；
2. `scenarios/**` 只 import `engine/values.ts` 与类型；
3. `src/**` 不 import `convex/engine/**`（除 values、templates 的纯模块）与任何 internal 函数；
4. `convex/` 内不使用 `@/` 别名，一律相对路径（F03.15，Convex 打包器对根 tsconfig paths 的处理待验证）。

为什么不拆成 workspace 包：引擎与场景都必须被 Convex 打包器打进函数包，放在 `convex/` 下的目录 + lint 边界即可达到同样的隔离，少一层构建配置。第二个场景出现后再评估（17）。

## 3. 守护不变量的工程手段（在代码层面而非文档层面）

| 手段 | 守护 |
| --- | --- |
| `db.ts` 写门面 + 禁止 `ctx.db.patch/replace/delete` 的 lint 规则 | PR-1、DE-1、EV-1、ID-5 等只追加/字段白名单 |
| 每个公共函数声明 `args` 与 `returns`；`returns` 只引用 projection DTO validator | BR-3、BR-4 |
| 公共函数参数禁止出现 `userId`、`roleKey`、`participantId`（自定义 lint：扫描 `args` 对象字段名；目标实体 id 如 `proposalId` 允许） | ID-1 |
| `convex/agents/**` 禁止 `console.*` 接收 context/response 变量（lint）；全局 `no-console` 只允许结构化 `log.info({ runId, … })` helper | 07 §10 |
| `RUN_TRANSITIONS` + `assertTransition`；`transitionRun` 是 `runs.status` 的唯一写者（门面白名单之外再加 grep 测试） | RN-2 |
| 编译期断言字面量集合与 validator 一致 | 类型单一来源（03 §1） |
| `ops.auditRoom` 每日 cron + 测试中每个用例结束后调用 | 02 part3 §7 列出的不变量 |

## 4. 环境与配置

| 变量 | 所在 | 用途 | 缺失时 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | Next（构建期内联） | Convex 客户端 | 页面显示 "Backend not configured"，不渲染数据组件 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next（构建期内联） | Clerk 前端 | 同上 |
| `CLERK_SECRET_KEY` | Next 服务端 | Clerk 中间件 | 托管环境 `REQUIRE_AUTH=1` 时返回 503 |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | `auth.config.ts` | 推送失败（fail-closed） |
| `ANTHROPIC_API_KEY` | Convex | 模型调用 | 强制 `AGENT_MODE = stub` |
| `AGENT_MODE`（llm / stub）、`AGENTS_ENABLED` | Convex | 10 §6 | 默认 stub、false |
| `ROOM_CREATION_POLICY`、`ROOM_CREATOR_ALLOWLIST` | Convex | 07 §2 | 默认 any_signed_in |
| `DEPLOYMENT_KIND`（dev / staging / prod） | Convex | 限制 `ops.purgeSimulatedRoom` 等 | 视为 prod（最严格） |

`isConfigured()` 对 key 做格式校验（pk_/sk_ 前缀、同为 test 或同为 live；Convex URL 为 https 且是 `.convex.cloud` 或 localhost），不合格视为未配置（F11.3）。环境检查脚本只报告变量是否存在，不打印值（P-26）。

## 5. Convex 工程约定

- `convex/tsconfig.json` 存在（否则 CLI 跳过函数类型检查）；统一用 `_generated/server` 的类型化构造器，不用 `queryGeneric`。
- 生成代码 `_generated/` 入库，CI 无部署凭据时也能 typecheck（F11.2）。
- 函数文件命名按领域（`rooms.ts`、`briefs.ts`…）；`"use node"` 只在确有必要时用于 `agents/executeTurn.ts`。
- 表名在前的新 db API 签名（`ctx.db.get("rooms", id)`，inputs/04 §1.1）。

## 6. 技术选型回顾

Next.js + Convex + Clerk + `@anthropic-ai/sdk` 已拍板。本设计不引入：Convex workflow/agent/workpool 组件（10 §1）、convex-helpers、向量库、第二数据库、Python 服务、代理框架（P-21）。引入的开发依赖：vitest、convex-test、@edge-runtime/vm、Playwright、fast-check（性质测试）。每个新依赖锁精确版本并提交 lockfile。
