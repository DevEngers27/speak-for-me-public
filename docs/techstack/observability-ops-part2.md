# 技术选型：可观测性与运维（part 2/3）

> 本文件：§4 推荐与理由（O1–O8 的具体做法）、§5 否决理由。结论表见 part1 §0。

## 4. 推荐与理由

### O1 托管：Vercel，生产发布由 CI 编排

- 做法：Vercel Git 集成只负责 PR 预览；`vercel.json` 用 `git.deploymentEnabled: { "main": false }` 关掉 main 的自动生产部署（语法见来源 S12）。staging 与 prod 由 GitHub Actions 用 Vercel CLI 预构建发布，这样"排空 → 部署 Convex 与前端 → `ops.configHealth` → 恢复 `AGENTS_ENABLED`"（testing-ops §4.6）是一个工作流里的连续步骤，不会被平台自动部署抢先。
- 构建命令：`npx convex deploy --cmd "pnpm build" --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`（Convex 官方 Vercel / Netlify 指南的形态，S4、S5；选项见 `NM:convex/src/cli/lib/command.ts:376-383`）。前端与后端同一次发布，`NEXT_PUBLIC_CONVEX_URL` 由 CLI 注入，杜绝"前端指向别的部署"。
- `CONVEX_DEPLOY_KEY` 在 Vercel 中按环境作用域区分：Preview 作用域放 preview deploy key，Production 作用域放 prod deploy key（S4）。staging 的 key 只在 GitHub `staging` environment 里。
- 理由：proxy.ts 固定 Node 运行时，Vercel 原生支持；Convex CLI 用 `VERCEL_ENV !== "production"` 判断非生产、用 `VERCEL_GIT_COMMIT_REF` 命名预览部署（`NM:convex/src/cli/lib/envvars.ts:523-552`），零配置。
- 计划：任何带商业目的的部署都要 Vercel Pro（Hobby 限非商业个人用途，S13）。
- 约束：不使用 Vercel 专有存储与开关（Edge Config、KV、Flags），保证可平移到 Netlify（part3 退出策略）。

### O2 环境分离

| 层 | Convex | Vercel | Clerk | Anthropic | Sentry `environment` | 日志 |
| --- | --- | --- | --- | --- | --- | --- |
| `dev` | 项目 `sfm` 下每人一个 dev 部署（`npx convex dev`） | 本地 `next dev` | dev 实例 | workspace `sfm-dev`，个人 key，低上限；缺省 `AGENT_MODE=stub` | `dev`（可关闭上报） | dashboard / `npx convex logs` |
| `preview` | 项目 `sfm` 的预览部署（每分支一个，免费计划 5 天、Pro 14 天自动回收，S6） | Preview 环境 | dev 实例 | **不设 key**，强制 stub | `preview` | dashboard |
| `staging` | **独立项目 `sfm-staging`** 的生产型部署 | CI 发布（Vercel 自定义环境或单独项目：待验证） | dev 实例 | `sfm-dev` 的 staging key，中等上限 | `staging` | log stream → Axiom 数据集 `sfm-staging` |
| `prod` | 项目 `sfm` 的 prod 部署 | Production 环境，自有域名 | **prod 实例**（必须自有域名，S10） | workspace `sfm-prod`，独立上限 | `production` | log stream → Axiom 数据集 `sfm-prod` |

- 预览部署的环境变量用项目级默认值预置：`npx convex env default set --type preview DEPLOYMENT_TIER preview` 等（`NM:convex/src/cli/envDefault.ts:45-70`）。默认值只对**新建**部署生效（S7），所以改默认值后要用 `--preview-create` 重建预览。
- staging 独立成项目的理由：deploy key、用量上限（`npx convex deployment usage-limits`）、日志流与异常上报配置都按部署/项目设置，独立项目可避免 staging 的 key 误推 prod。同项目 `--type prod` 的第二个部署也可行（`NM:convex/src/cli/deploymentCreate.ts`），但隔离边界弱，留作备选。
- 部署数上限：免费 40、Pro 300，预览部署计入（S3、S6）。
- 不变量：`DEPLOYMENT_TIER` 必填；危险的内部函数（seed 假身份、purge、devProbe）入口 `assertTier`（testing-ops TD-7）。

### O3 日志：Convex log streams → Axiom

- 接入：Convex dashboard → Deployment Settings → Integrations 配置 Axiom（每个部署分别配置，事件带 `deployment_name`，S1）。应用代码不装任何日志 SDK。
- 使用的主题：`console`（`opsLog` 输出的单行 JSON）、`function_execution`（耗时、状态、OCC 信息、`run_reason`）、`audit_log`（部署与配置变更，即开关变更的审计）、`scheduler_stats`（`lag_seconds`）、`concurrency_stats`（S1）。
- 纪律（沿用 testing-ops §4.4 与 F07.8）：业务代码只调 `opsLog(event, fields)`，`fields` 类型上只允许 `Id`、枚举、数字、布尔、ISO 时间；ESLint 禁止 `convex/` 下裸 `console.*`。原因：`console` 主题会把输出原样送到 Axiom。
- `function_execution` 事件含错误消息（字段集以 S1 为准，是否含函数参数：待验证）→ 抛出的错误消息不得带数值或自由文本（`ConvexError({ code })`）。
- 地位：日志流是尽力投递，可能丢、可能重（S1）。它只用于排障与告警，**不是**审计与计量的事实来源（核心 6、8）。
- Next 侧：Next 服务端几乎不做业务（授权与数据都在 Convex），v1 只用 Vercel 自带运行时日志，不配 Vercel log drain、不装 `@axiomhq/nextjs`。
- 告警（Axiom monitors）：`function_execution` 错误率、`scheduler_stats.lag_seconds` 持续升高、`opsLog` 中 `watchdog_failed` / `invalid_output` 计数、`audit_log` 中生产环境变量变更（任何一次都通知）。

### O4 错误追踪：Sentry（两端）

- Next 侧：`@sentry/nextjs`，安装时固定一个发布满 2 周的 11.x 精确版本（今天是 11.6.0，发布于 2026-10-08；最新 11.9.0 发布于 2026-10-23，不满足）。文件：`instrumentation-client.ts`、`sentry.server.config.ts`、`sentry.edge.config.ts`、`instrumentation.ts`（导出 `onRequestError`）、`app/global-error.tsx`、`next.config.ts` 用 `withSentryConfig` 包裹（S11）。
- **隐私收紧（必须）**：v11 把 `sendDefaultPii` 换成 `dataCollection`，且未设置时默认采集更多：`userInfo`、`cookies`、HTTP 头与正文、URL 查询参数、`stackFrameVariables`（栈帧局部变量）都默认开启（S14、S15）。栈帧变量会把服务端组件里持有的私密字段带出去，直接违反核心 1。配置：

```ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_DEPLOYMENT_TIER,
  dataCollection: {
    userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false,
    stackFrameVariables: false, genAI: { inputs: false, outputs: false },
  }, // 键名以安装版本的类型为准：待验证
  enableLogs: false,          // 不把 console 送 Sentry Logs
  tracesSampleRate: 0,        // v1 不做性能追踪
  beforeBreadcrumb: (b) => (b.category === "console" ? null : b),
});
```

  不启用 Session Replay（不加 `replayIntegration()`）。`tunnelRoute` 可选；若启用，必须把该路径排除出 proxy matcher（S11）。Sentry 项目侧再开服务端 Data Scrubber 与"清除 IP"。
- Convex 侧：dashboard Integrations 填 Sentry DSN，Sentry 项目平台设为 Node.js（S2）。Convex 自动附带 `func`、`func_type`、`func_runtime`、`request_id`、`server_name`、`environment`、`user`（= `tokenIdentifier`，不可覆盖）标签（S2）。`tokenIdentifier` 是假名化 ID，可接受，写进隐私说明。
- `ConvexError`（预期业务错误）是否也被上报：待验证；若上报，用 Sentry 入站过滤按错误类型丢弃，避免噪声。
- source map：`SENTRY_AUTH_TOKEN` 只放 Vercel 构建环境与 CI，不进运行时（S11）。

### O5 用量与成本

- 事实来源：`modelCalls`（只追加，每次 Claude 调用一行：`model`、`effort`、`inputTokens`、`cacheCreationInputTokens`、`cacheReadInputTokens`、`outputTokens`、`thinkingTokens`、`stopReason`、`requestId`、`latencyMs`、`attempt`、`errorCode`），字段以 run-lifecycle / 10-agent-runtime 为准（inputs/04 §4.8、F10.15）。
- 成本：不落库；`estimateCostMicros(usage, model)` 读时按代码常量价目表（带 `asOf`）换算并标 `estimate: true`；未知模型返回 `null`（testing-ops part3）。
- 展示 v1：`convex/ops/metrics.ts` 的 internalQuery（p50/p95 延迟、token 分项、缓存命中率、失效率、`spendEstimate`、`activeTurnCount`，全部带样本量 `n`），经 `npx convex run` 或 dashboard 函数运行器查看。平台层指标（函数耗时、调度延迟、OCC）看 Axiom。后续若需要非工程人员查看，再加 `/ops` 只读页，用 `OPS_ADMIN_TOKEN_IDENTIFIERS` 授权。
- 便利副本：`opsLog("model_call", { model, effort, inputTokens, …, latencyMs })` 让 Axiom 能画趋势图；明确标为非权威。
- 对账：每周用 Anthropic Admin API `GET /v1/organizations/cost_report`（按 workspace / model 的日成本）与 `spendEstimate` 比对（SK:`shared/cost-optimization.md:40-41`）。Admin key（`sk-ant-admin…`）只在组织管理员本机或受保护的 CI environment 中，**不进 Convex**（SK:`shared/admin-api.md`）。
- 护栏三层（F15.2、testing-ops TD-12）：Anthropic workspace 花费上限（dev / prod 分开，≥3 倍余量，S16）；Convex `usage-limits` 的 `warning`（prod）与 `disable`（dev / preview）；应用内每房间调用上限 + `AGENTS_ENABLED`。
- 扩展点：`modelCalls` 超过有界 `take(N)` 能覆盖的量时，加每日汇总表（cron 写入），或评估 `@convex-dev/aggregate`；v1 不做。

### O6 功能开关：Convex 环境变量

- 清单：`AGENTS_ENABLED`（总开关）、`AGENT_MODE`（`live | stub`）、`AGENT_MODEL` / `AGENT_EFFORT`（白名单）、`DEPLOYMENT_TIER`、`ALLOW_DEMO_SEED`（testing-ops §4.2）。
- 读取：只在 `convex/lib/config.ts` 用 Zod 解析一次，非法值 → 回合 `failed`（`config_invalid`），不调用模型。`AGENT_MODE` / 模型 / effort 在 run 开始时快照进 run 行（run-lifecycle D5），中途改变量不影响在途 run。
- 禁止：按环境变量条件导出函数或 cron（可调用函数集合只在部署时确定，S7）；在 Next 侧做任何开关（`NEXT_PUBLIC_` 是构建期常量，且 Next 不是强制点）。
- 审计：变更通过 `npx convex env set` 或 dashboard，进入 Convex audit_log（History 页），经日志流进 Axiom 并告警。
- 何时改用表：出现按房间/按用户灰度、或需要非工程人员在界面切换时，引入 `opsFlags` 表（internalMutation 写入并写 `events`），并评估热点文档的 OCC 影响。

### O7 密钥管理与轮换

| 密钥 | 唯一存放处 | 可读者 | 轮换做法（零停机） | 周期 |
| --- | --- | --- | --- | --- |
| `ANTHROPIC_API_KEY`（每层一把） | 对应 Convex 部署 env | 部署 admin | Console 新建 key → `npx convex env set`（交互输入，值不进 shell 历史；交互方式待验证）→ `runtime_smoke` → Console 停用旧 key → 看 Sentry/Axiom 无 401 | 90 天 / 泄露即换 |
| `CLERK_SECRET_KEY`（dev / prod 实例） | Vercel env（Production / Preview 分作用域，标记为敏感） | Vercel 管理员 | Clerk 支持多把 secret key 并存：新增 → 更新 Vercel → 重新部署 → 删除旧 key（S17）；仅 Clerk Admin 角色可操作 | 90 天 |
| `CONVEX_DEPLOY_KEY`（preview / staging / prod） | Vercel env + GitHub environment secret | CI | `npx convex deployment token create <name> --deployment prod` → 更新 Vercel 与 GitHub → 发布一次 → `npx convex deployment token delete`（`NM:convex/src/cli/deploymentTokenCreate.ts`）；preview key 在项目设置页生成（S4） | 90 天 |
| `SENTRY_AUTH_TOKEN` | Vercel 构建环境、CI | CI | Sentry 新建组织 token → 替换 → 撤销旧 | 180 天 |
| Axiom ingest token | Convex dashboard 集成配置 | 部署 admin | Axiom 新建 → 改集成 → 撤销旧 | 180 天 |
| Anthropic Admin key | 管理员密码管理器 | 组织管理员 | Console | 按需 |
| `E2E_*` 测试账号凭据 | GitHub environment secret | CI | Clerk dev 实例中重置 | 随人员变动 |

- 公开值（不需轮换）：`NEXT_PUBLIC_CONVEX_URL`、`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`（S17）、Sentry DSN、`CLERK_JWT_ISSUER_DOMAIN`。
- 主副本放团队密码管理器；不进仓库、不进聊天（F15.4）。CI 日志里不运行会打印值的命令（`npx convex env list` 对人类会打印值；1.47+ 在识别到 AI 代理时只列名字，inputs/04 §1.10）。
- 人员离开：当天轮换其可读的全部密钥，并从 Convex 团队、Vercel 团队、Clerk、Anthropic workspace 移除。

### O8 采购前置条件

1. Convex Pro（$25/开发者/月，S3）：log streams、exception reporting、预览部署 14 天保留。没有 Pro 时降级方案见 part3 R1。
2. 自有域名：Clerk 生产实例要求 DNS 记录，`*.vercel.app` 不行（S4、S10）。
3. Vercel Pro（商业用途）、Axiom Personal（免费即可起步）、Sentry（免费层起步，配额待评估）。

## 5. 否决理由

| 备选 | 否决原因 |
| --- | --- |
| Cloudflare Workers（OpenNext） | 官方写明 Node Middleware 尚不支持，而 Next 16 proxy 固定 Node 运行时；Worker 压缩后 3/10 MiB 上限需持续盯包体积（Sentry、Clerk 都会增大）；Convex CLI 对 Cloudflare 的非生产判定只是"分支 ≠ main"。收益（边缘性能）对本系统无意义：数据与逻辑都在 Convex |
| Netlify 作首选 | 可行且是退路；落选只因 Vercel 对 Next 16 新特性零适配层，团队学习成本最低 |
| Datadog（日志 + 错误） | 功能最全但成本与配置复杂度远超 v1 需要；Convex 侧同样只是换个目的地，以后可迁 |
| 仅 dashboard 日志 | 只有最近约 1000 次调用、维护时会清空、无查询无告警（S9）；dev / preview 可接受，staging / prod 不行 |
| Webhook 自建接收 | 要写 HMAC 校验、存储、查询——等于自建 Axiom |
| PostHog（错误 + 日志 + 分析） | 一站式但默认带产品分析与会话回放，扩大私密数据外流面；我们不需要产品分析 |
| 自建 `opsErrors` 表作主方案 | 无堆栈聚合、无前端覆盖、无去重通知；只作为没有 Pro 时的降级 |
| 把 token 用量放 Axiom 作账本 | 日志流可丢可重（S1）；违反核心 8 |
| `opsFlags` 表（v1） | 每个 mutation 读同一文档会放大 OCC；v1 只有全局开关，环境变量足够 |
| Vercel Flags / Edge Config / LaunchDarkly | 强制点在 Next 或客户端，而开关必须在 Convex 函数内强制；且引入平台锁定 |
| Doppler / Infisical / Vault | 再加一个能读全部密钥的系统和同步链路；三个平台的原生 env 存储已够用 |
| `@sentry/nextjs` 11.9.0（最新） | 发布仅 1 天，不满足"≥2 周"的版本纪律 |
