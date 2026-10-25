# 11 · 系统架构

> 分片：`11-architecture.md`（§11.0–11.3 目标、决定一览、运行时形状、目录结构）→ `11-architecture-part2.md`（§11.4–11.7 依赖方向、lint、函数构造器、写门面）→ `11-architecture-part3.md`（§11.8–11.10 Convex 工程约定与 codegen、版本与 CI、环境与配置）→ `11-architecture-part4.md`（§11.11–11.16 地基模块映射、四包拆分触发条件、不变量、备选与否决、开放问题、与 canon 的对照）。
> 底稿：`candidates/invariants/11-architecture.md`（写门面 + lint）、`spikes/skeleton-report.md`（实测可建的目录与配置，代码在 `spikes/skeleton/`）。依据：canon D01、D09、D16、D20、D21、D22、D24；techstack D01/D05/D08/D23/D29/D33/X1/X4；spikes §3、§7、§8；inputs/05 B8–B10。

## 11.0 目标

1. 让"私密字段不进浏览器、规则是确定性纯函数、关键表只有唯一写入口、错误不外泄"成为**代码结构上的事实**：分层目录 + lint + 函数构造器 + 写门面，而不只是文档约定。
2. 无任何凭据时 lint / typecheck / test / build 全部可跑（CI 不需要 secret，skeleton spike 已实测）；缺配置时 fail closed。
3. 引擎不认识任何场景、场景之间互不依赖；第二个场景落地时只加目录，拆包有明确的触发条件（§11.12）。
4. 反对过度设计：v1 单包、不用任何 Convex 组件、不引入编排框架或命令总线；每一层机制都写明它守护哪条不变量。

## 11.1 决定一览

| # | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| A1 | **单包布局**：`core/engine` ← `core/scenarios/scope-change` ← `convex` ← `src`（D21） | skeleton spike 实测可装可建；Convex 打包回放（esbuild 0.27.0）自动读取 `convex/tsconfig.json` 的 `paths`，`@core/*` 在 vitest 与 Convex 打包下都可解析 | 四包 workspace 立即落地（techstack D04）：依赖 spikes §8 #8 尚未在真实部署验证的"Convex 打包 `convex/` 以外的 workspace 包"，保留为升级路径；引擎放进 `convex/engine/`（invariants 候选）：纯度规则无法按目录干净施加，引擎会被 Convex 运行时类型污染 |
| A2 | 依赖方向由 ESLint `no-restricted-imports` 强制，外加**引擎纯度规则**（`core/**` 禁 `Date` / `Intl` / `Math.random` / `fetch` / `crypto` / `process` / `console` / `convex*` / `zod` / 框架包） | spike 中 5 个故意违规 5 个被拦；纯度是核心 4（确定性校验）的前提 | dependency-cruiser + ESLint 双工具；TS project references（需要 composite 与声明产物，Next 与 Convex 的 tsconfig 都不是为它设计的） |
| A3 | 所有 Convex 函数只经 `convex/lib/functions.ts` 的构造器定义：`anonQuery` / `userQuery` / `userMutation` / `memberQuery` / `memberMutation` / `userAction` + 内部 `sysQuery` / `sysMutation` / `sysAction`；构造器内置鉴权与 `withSanitizedErrors`；lint 禁止在其他文件导入原始 `query` / `mutation` / `action` / `internal*` | 鉴权与错误清洗"不可遗漏"只能靠单一入口（D16、techstack D08/X4）；匿名与 action 出口有名有姓、进白名单 | 每个函数手写 `requireMember`（可被遗忘）；`@convex-dev/eslint-plugin` 的 `require-access-control`（按命名 pattern 识别，可被 `eslint-disable` 绕过，且不在 D20 基线） |
| A4 | **写门面 + 房间写锁**（形状以 03 §3.3 为准）：`convex/lib/db.ts` 的只追加表清单 `APPEND_ONLY`、可变字段白名单 `MUTABLE_FIELDS` 与 `openRoomTx`（每个改变房间状态的 mutation 先写 `rooms.writeSeq`，同房间事务确定地串行）；lint 禁止门面外出现 `ctx.db.patch / replace / delete`；关键表的 `insert` 只允许出现在其唯一写入口文件（CI grep） | 把核心 5、6 的"唯一写入口""只追加""字段不可变"变成机械保证 | 只靠代码评审 |
| A5 | 不用任何 Convex 组件（D01）；`convex/_generated` 提交入库 + CI 离线 codegen 漂移检查；`convex/tsconfig.json` 加 `"types": ["node"]`（D20） | 无组件才能 `convex codegen --system-udfs --typecheck disable` 离线生成（spike 两次输出逐字一致）；TS 6 的 `types` 默认是 `[]` | workflow / workpool 组件（带组件后离线 codegen 报 `No CONVEX_DEPLOYMENT set`） |
| A6 | 模型调用只在 Convex action 内；Next 服务端不持有模型密钥、不做授权、不提供业务 API | 核心 1；spike 实测 `proxy.ts` 的 `auth.protect()` 对 JSON 与 Route Handler 也返回 307 而非 401/404 | Next Route Handler / Server Action 承载业务（多一套鉴权面） |
| A7 | 前端**条件 Provider** + `/setup` 独立根布局 + `auth.config.ts` 缺变量即抛错；**每个环境带自己的变量单独构建** | skeleton 实测 fail closed；"无凭据构建 + 运行时注入"会出现服务端已配置、客户端未内联的半配置态 | 一次构建、多环境运行时注入 |
| A8 | 每个 mutation **自写落库**：决定（守卫 + 纯函数）与落库在同一 handler，复用 `convex/model/*` 的事务内 helper；不做通用"写计划解释器" | techstack D01 的可迁出纪律；事务边界一目了然 | 命令总线 / 事件溯源投影器（eventsourcing 候选，评委指出单层 react 等缺陷） |
| A9 | 10 个地基模块按"纯 TS 进 `core/`、依赖 SDK 或 Convex 的进 `convex/`、测试与工具设施进 `testing/` / `tooling/`"落位，并列出必须改动处（§11.11） | 复用已验证代码，同时守住纯度与 canon 命名 | 以独立 npm 包原样引入（命名与 canon 不一致处无法修正） |

## 11.2 运行时形状

```text
Browser（Next 16.4 App Router, React 19.3）
  ├─ (app) 根布局：仅当三项配置齐全时挂 ClerkProvider → ConvexProviderWithClerk
  │     useQuery(rooms.view / timeline.page / briefs.mine …)  ── WebSocket + Clerk token(aud="convex") ──▶ Convex
  │     useMutation(approvals.record / briefs.confirm / humanRequests.answer …)
  │     /invite 页：fragment 里的 token（#t=…），不调 auth.protect()，Referrer-Policy: no-referrer
  └─ (setup) 根布局 /setup：不挂 Clerk 与 Convex，只列缺失变量名（不打印值）
Next server：渲染外壳；proxy.ts 只做"缺配置 → /setup"与"/rooms 乐观登录检查"；不持模型密钥，不读任何受限表
Convex deployment：
  public query     按查看者投影（projectForRole）；未登录 / 非成员返回 null
  public mutation  构造器鉴权 → 守卫 → 唯一写入口 → events.append（同一事务）
  public action    仅 invites.createLink（安全随机数 + 哈希，D24）
  internal         turns.* / agents.* / runs.reconcile / clock.rollLocalDate / humanRequests.expireDue / ops.* / seed.*
  scheduler        turns.beginAttempt 同事务 runAfter(0, agents.runAttempt) + runAfter(deadline, agents.watchdog)（D01）
  cron             clock.rollLocalDate / humanRequests.expireDue / ops.livenessSweep（15 §15.8）
  agents.runAttempt ── HTTPS：messages.stream().finalMessage() + ANTHROPIC_API_KEY ──▶ Claude API（D09）
外部服务：Clerk（只做认证，D24）、Anthropic、Sentry 与 Axiom（采购项，见 15 与 U9）
```

- 授权、规则、状态迁移、执行全部在 Convex mutation 里完成；核心 2–6 都依赖 mutation 的事务与 OCC。
- 时间的唯一权威来源是 mutation / cron 内的 `Date.now()`（经 `convex/lib/time.ts`）；query 只读 `rooms.localDate`（D22）。
- 调度的唯一接缝是 `turns.beginAttempt`；从不调用 `scheduler.cancel`，迟到结果由持久化守卫拒收（D01、D07）。
- 被调度的函数没有调用者身份：凡代表用户行事的 internal 函数显式携带 `actorUserId`，鉴权在调度前完成（inputs/05 B4）。

## 11.3 目录结构

```text
speak-for-me/
├─ package.json  pnpm-workspace.yaml  .npmrc  .node-version   单包；pnpm 11 安装策略（§11.8）；Node 24.x 精确
├─ tsconfig.json          Next + core；paths @/*、@core/*、@convex/*；exclude convex
├─ eslint.config.mjs      唯一 flat config（§11.5）
├─ vitest.config.ts       projects：core(node) / convex(edge-runtime) / web(jsdom) / evals(node)
├─ next.config.ts  convex.json  .env.example
├─ core/                  纯 TS、零运行时依赖（A2）
│  ├─ engine/
│  │  ├─ index.ts           对 convex/ 的唯一出口；ui.ts 是对 src/ 的唯一出口（§11.4）
│  │  ├─ brand.ts           APP_NAME（U12 单点）
│  │  ├─ reasonCodes.ts     reasonCode 与 API 错误码的单一来源：REASON_CODES（06）+ API_ERROR_CODES（12 §12.4）→ ERROR_CODES，PARAM_AUDIENCE（只读数组常量，canon §1.5）
│  │  ├─ result.ts errors.ts  Result、defineErrors / defineReasonCodes（errors-result）
│  │  ├─ money.ts dates.ts  Cents / IsoDate、assertCents、addDays、formatCents（money-dates）
│  │  ├─ canonicalJson.ts keys.ts  canonicalJson、composeKey（idempotency-ids 子集）
│  │  ├─ text/              defineTemplate、slot、renderPublicText（text-templates）
│  │  ├─ projection/        defineDisclosureMatrix、projectForRole、wrapUntrusted、encodeBlock.ts（JSON + `<`/`>`/`&` 转义；
│  │  │                     组装顺序"净化 → encodeBlock → 加不经编码的外层标签"，05 §5.13.2）、trimToBudget（context-projection）
│  │  ├─ rules/             checkBudget、checkProposal、isExecutable、evaluateApprovalSet、resolveRound
│  │  ├─ protocol/          TurnSpec、ACTIONS_BY_ROLE、allowedActions（模型输出的纯数据描述，无 Zod）
│  │  ├─ strictSchema.ts    toStrictOutputSchema：JSON Schema → 严格 JSON Schema（纯变换，part2 §11.6）
│  │  ├─ candidates.ts      enumerateCandidates 通用框架、candidateKey
│  │  ├─ plugin.ts          ScenarioPlugin 接口与 defineScenario（成员清单见 06）
│  │  └─ fixtures.ts        ScenarioFixture 类型（纯类型，无 Zod）
│  └─ scenarios/
│     └─ scope-change/      首个场景插件，只依赖 core/engine
│        ├─ index.ts        export const scopeChangePlugin = defineScenario({ ... })
│        ├─ fields.ts       三角色简报字段声明（FieldSpec，纯数据）
│        ├─ catalog.ts projection.ts rules.ts candidates.ts requests.ts
│        ├─ templates.ts    公共模板（room / buyer / owner 三变体，D13）
│        ├─ topics.ts reasons.ts  clarify 的 topicKey 表、reasonKey 表
│        └─ fixtures/       main.ts、variants.ts（相对锚点日期，D27 数字）
├─ convex/                Convex 函数根（目录 camelCase；convex.json "functions": "convex/"）
│  ├─ schema.ts           组合 engineTables（将来的场景表以 scopeChange_ 前缀组合进来）
│  ├─ auth.config.ts      CLERK_JWT_ISSUER_DOMAIN 缺失即抛错
│  ├─ crons.ts  tsconfig.json  test.setup.ts（两个点 → 不部署）  _generated/（提交入库）
│  ├─ lib/                横切机制，不含业务
│  │  ├─ functions.ts     构造器（part2 §11.6）；errors.ts（appError、withSanitizedErrors）
│  │  ├─ opsLog.ts        opsLog(ctx: InternalCtx, code, SafeLogFields) 与 publicOpsLog(code, { fn, errorClass })：全仓唯一允许 console.* 的文件（15 §15.6.2 唯一定义，07 E1）
│  │  ├─ config.ts        环境变量白名单解析（Zod）与 assertTier
│  │  ├─ db.ts            写门面；validators.ts（roleV、reasonCodeV、provenanceV 等由 core 常量派生）
│  │  ├─ fieldSpec.ts     FieldSpec → v.* / Zod；rateLimit.ts（assertWithinRate）
│  │  ├─ time.ts          todayInTimeZone、nowMs（只接受 MutationCtx / ActionCtx）
│  │  └─ crypto.ts        randomToken、sha256Hex（Web Crypto，纯 JS 退路）
│  ├─ model/              事务内业务 helper（无 Convex 注册），每个唯一写入口住在这里（名字取自 03 §3.13）
│  │  ├─ auth.ts roomTx.ts（openRoomTx）members.ts（addMember）briefs.ts（insertBriefVersion、materializeDisclosures）
│  │  ├─ sharedFacts.ts catalog.ts（appendCatalogRow）ledger.ts（appendLedgerEntry）ruleInput.ts
│  │  ├─ constraints.ts（withConstraintChange、bump、openIfReady、react）runs.ts（startRunTx、reconcileRun）
│  │  ├─ turns.ts（createTurnTx、beginAttemptTx）proposals.ts（insertProposal）approvals.ts executions.ts
│  │  ├─ humanRequests.ts（openHumanRequestTx、applyHumanAnswer）events.ts（appendEvents）
│  │  ├─ agents/          模型边界：modelGateway.ts（callModel 唯一接缝）、outputSchema.ts、context.ts、stub.ts、pricing.ts
│  │  └─ views/           DTO 构造（roomView、timelineItem …；禁止对象展开）
│  ├─ scenarios/registry.ts   scenarioOf(room)：按房间钉住的 scenarioKey@scenarioVersion 取插件（未注册 → run.invalid_state{scenario_version}）；
│  │                          latestScenarioVersion(scenarioKey)：只供 rooms.create 钉住版本（canon §1.6、06 §12.1）
│  └─ rooms.ts invites.ts briefs.ts budget.ts ledger.ts sharedFacts.ts catalog.ts runs.ts turns.ts
│     agents.ts approvals.ts executions.ts humanRequests.ts proposals.ts tasks.ts timeline.ts
│     users.ts clock.ts ops.ts privacy.ts seed.ts health.ts  ← 函数层（薄）："文件名.导出名" 即 12 的函数名
├─ src/                   Next App Router
│  ├─ proxy.ts
│  ├─ app/(app)/layout.tsx   根布局 A：条件 Provider；(app)/rooms/…、(app)/invite/page.tsx、rooms/error.tsx（13）
│  ├─ app/(setup)/layout.tsx 根布局 B：不挂 Clerk / Convex；(setup)/setup/page.tsx
│  ├─ app/global-error.tsx
│  ├─ components/providers.tsx   ConvexClientProvider、BackendGate
│  └─ lib/config.ts(server-only) clerk-env.ts format.ts（Intl 显示金额与日期）
├─ testing/               测试设施：convex-test-utils/、e2e-harness/、canary/、scripted-model.ts（16）
├─ e2e/  evals/  scripts/ Playwright 用例、离线评测 runner（vitest project）、L2 探针与 log-scan（tsx）
├─ tooling/dev-tooling/   地基模块：ESLint 边界配置工厂、check-env、convex-ops 守卫、CI 模板
└─ .github/workflows/     ci.yml、pr-e2e.yml、release.yml、nightly.yml（15）
```

目录约定：
- `convex/` 下一律 camelCase，不出现连字符（spike 建议：避免 `api.scenarios["scope-change"]` 与服务端校验风险，§8 #8）；`core/` 下用 kebab-case。场景目录在 `core/` 下，不在 `convex/` 下，因此不产生连字符模块路径。
- 函数层文件只做"参数 → 构造器鉴权 → 调 model helper → 返回投影"，不写业务逻辑；canon §1.6 的名字与 `api.<文件>.<导出>` 一一对应（`rooms.create` = `convex/rooms.ts` 的 `export const create`）。`constraints.bump`、`events.append`、`executions.executeIfComplete` 是 helper（住在 `convex/model/`），不注册为 Convex 函数。注册函数的文件与目录不得同名（`convex/agents.ts` 与 `convex/agents/` 并存会让 `api.agents.*` 的模块路径冲突），所以模型边界的实现放在 `convex/model/agents/`，`agents.runAttempt` / `agents.watchdog` / `agents.loadTurnContext` 注册在 `convex/agents.ts`（10 写的 `convex/agents/runAttempt.ts` 等路径按此调整，12 §12.25 Q15）。
- `testing/`、`e2e/`、`evals/`、`scripts/`、`tooling/` 不被 `src/` 或 `convex/` 的运行时代码导入（lint L12 放宽的同时禁止反向依赖）。
