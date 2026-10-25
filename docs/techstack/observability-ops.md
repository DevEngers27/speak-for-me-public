# 技术选型：可观测性与运维（part 1/3）

> 子决策代理产出，日期 2026-10-24。栈已定（Next.js 16.4.3 App Router + Convex 1.48.0 + Clerk 7.9.20 + @anthropic-ai/sdk 1.1.0），本文只在栈内做运维子决策。
> 分片：本文件 = 结论、需求与约束、候选方案表、评估维度；`observability-ops-part2.md` = 推荐细节与理由、否决理由；`observability-ops-part3.md` = 风险与退出、验证步骤、来源列表。
> 与 `design/deepdives/testing-ops*.md`（测试与运维专题）对齐：环境层级、`opsLog`、`modelCalls`、`AGENTS_ENABLED` 排空流程沿用其定义，本文补上它留空的"托管平台、日志去向、错误追踪、密钥轮换"四项选型。

## 0. 结论（先读这一节）

| # | 子决策 | 推荐 | 一句话理由 |
| --- | --- | --- | --- |
| O1 | 托管平台 | **Vercel**（商用需 Pro；Hobby 限非商业） | Next 16 一方支持；Convex CLI 原生识别 `VERCEL_ENV` 与分支名做预览部署；proxy.ts 固定 Node 运行时在 Vercel 上无适配风险 |
| O2 | 环境分离 | 四层：个人 `dev` / 每 PR `preview` / 共享 `staging` / `prod`；Convex 两个项目（`sfm` 含 dev+preview+prod，`sfm-staging` 独立）；Clerk 两个实例；Anthropic 两个 workspace | 部署 key、用量上限、日志流按层隔离；preview 不持有 Anthropic key（强制 stub） |
| O3 | 日志去向 | **Convex log streams → Axiom**（仅 staging / prod）；dev / preview 只用 dashboard 与 `npx convex logs` | 应用代码零 SDK；Axiom 免费层 30 天保留足够 v1；换目的地只改 dashboard 配置 |
| O4 | 错误追踪 | **Sentry**：Next 侧 `@sentry/nextjs` 11.x（固定到发布 ≥2 周的版本，今天为 11.6.0）；Convex 侧用平台内置 exception reporting 指向 Sentry | 两端同一工具；Convex 内置集成无需在函数里装 SDK |
| O5 | 用量与成本 | 事实来源 = Convex 只追加表 `modelCalls`；成本读时按代码内带 `asOf` 的价目表估算；展示 v1 用 internalQuery + CLI，平台指标看 Axiom；每周与 Anthropic `cost_report` 对账 | 不在第三方存业务事实；日志流是尽力投递，不能当账本 |
| O6 | 功能开关 | **Convex 环境变量**（经单一 `config.ts` 解析与白名单），run 开始时快照；不引入开关 SaaS、不建开关表 | v1 只需全局开关；变更由 Convex audit_log 留痕；不在每个事务里读热点文档 |
| O7 | 密钥管理与轮换 | 密码管理器为主副本；每个密钥只放在使用它的一处（Convex env / Vercel env / GitHub env）；"先加新、再部署、后删旧"的零停机轮换，90 天例行 + 泄露即轮换 | Clerk、Convex deploy key、Anthropic key 都支持多把并存 |
| O8 | 前置条件 | **Convex Pro**（log streams 与 exception reporting 均为 Pro 功能）；**自有域名**（Clerk 生产实例不接受 `*.vercel.app`） | 两项都是上线前必须采购的东西，写进 18-decisions |

## 1. 需求与约束（引用任务书核心与平台硬约束）

### 1.1 来自任务书第 3 节核心不变量

| 核心 | 对运维的要求 |
| --- | --- |
| 1 私密委托 | 日志、错误事件、第三方遥测里不得出现私密简报、预算数字、模型原文。每接入一个第三方（Axiom、Sentry）就多一个数据处理方，金丝雀扫描必须覆盖它 |
| 4 代码负责校验 | 开关不能绕过校验；`AGENT_MODEL` 走代码白名单（F10.10） |
| 5 执行幂等且原子 | 部署会打断在途 action，发布必须先排空（F15.4、testing-ops TD-11） |
| 6 历史不可篡改 | 可追溯性靠 `events` / `modelCalls` 表，不靠日志正文；日志流只是旁路观测 |
| 7 执行边界 | 运维工具只读业务数据；不提供生产 reset |
| 8 不伪造 | 成本只写"估算"并带价目表 `asOf`；用量不能事后估算（F10.15） |

### 1.2 平台硬约束（inputs/04 与本次核实）

- 只有 `NEXT_PUBLIC_` 变量进浏览器，且构建期内联 → 每个环境单独构建（inputs/04 §5.3）。
- `proxy.ts` 运行时固定为 `nodejs`（inputs/04 §3.5）→ 托管平台必须支持 Node 运行时的 proxy/middleware。
- `ANTHROPIC_API_KEY`、`CLERK_JWT_ISSUER_DOMAIN` 属于 Convex 部署环境变量；`CLERK_SECRET_KEY` 属于 Next 服务端（inputs/04 §3 含义 6）。
- Convex 环境变量：每部署最多 512 个、单值 8 KiB；项目级默认值只在新建部署时生效，不影响已存在的部署；可调用的函数集合与 cron 只在部署时确定（docs.convex.dev/production/environment-variables，2026-10-24 读取）。
- Convex dashboard 日志只保留最近约 1000 次函数调用的日志，维护时可能被清空（Convex 官方 debugging 文档与员工回复，见来源 S9）→ 不能把 dashboard 当长期日志。
- Log streams 与 exception reporting 都要求 Convex Pro（S1、S2、S3）。
- 被调度 action 至多一次、部署会打断在途 action（inputs/04 §1.5）。

### 1.3 来自审查发现（inputs/02 part12 F15.*、part7 F07.8）

- 代理 action 不 `console.log` prompt、brief、模型原文，只记 id、枚举、数字（F07.8）。
- 开发与生产分 key、分 workspace，各设花费上限，留 ≥3 倍余量；`AGENTS_ENABLED` 总开关；每房间调用上限（F15.2、F10.5）。
- 上线前在日志里搜金丝雀与预算数字应零命中；评审/生产用 `convex deploy` 出来的部署（隐藏非 ConvexError 消息）（F15.3）。
- `CONVEX_DEPLOY_KEY` 只放托管平台与 CI；环境检查只报存在性（F15.4）。

## 2. 候选方案表

| 子决策 | 候选 | 版本 / 计划（2026-10-24） | 许可证 | 备注 |
| --- | --- | --- | --- | --- |
| 托管 | **Vercel** | 平台；Pro 约 $20/用户/月（第三方来源，待官方确认） | 商业服务 | Convex 官方 Vercel 指南；`VERCEL_ENV` 区分 prod/preview |
| 托管 | Netlify | `@netlify/plugin-nextjs` 5.16.4（2026-10-20 发布） | MIT | Convex 官方 Netlify 指南；按 deploy context 区分 key |
| 托管 | Cloudflare Workers | `@opennextjs/cloudflare` 1.20.13（2026-10-21），peer `next >=16.4.1`、`wrangler ^4.148.0` | MIT | 官方文档写 "Node Middleware … not yet supported"；Worker 压缩后 3 MiB（免费）/ 10 MiB（付费） |
| 日志 | **Convex log streams → Axiom** | Convex Pro；Axiom Personal 免费：500 GB/月加载计算、30 天保留 | 服务 | 无应用 SDK |
| 日志 | Convex log streams → Datadog | Convex Pro + Datadog 计费 | 服务 | 同样无应用 SDK；成本与学习曲线高 |
| 日志 | Convex log streams → PostHog / Webhook | Convex Pro | 服务 | Webhook 需自建接收端（HMAC-SHA256 签名） |
| 日志 | 仅 Convex dashboard + `npx convex logs` | 任意计划 | — | 只有最近约 1000 次调用、无告警、无查询 |
| 错误 | **Sentry**（Next：`@sentry/nextjs`；Convex：内置集成） | `@sentry/nextjs` 11.9.0 最新（2026-10-23），11.6.0（2026-10-08）；peer `next ^14 \|\| ^15 \|\| ^16.0.0-0`；11.0.0 于 2026-09-23 发布 | SDK MIT | Convex 侧需 Pro |
| 错误 | PostHog Error Tracking | `posthog-js` 1.438.21；Convex 内置支持 | `Apache-2.0 AND MIT` | 同时带产品分析与回放，数据面更大 |
| 错误 | Datadog Error Tracking | `@datadog/browser-rum` 7.16.1；Convex 侧经 Sentry SDK 协议接入 | Apache-2.0 | 与 Datadog 日志绑定才划算 |
| 错误 | 自建：`opsErrors` 表 + cron | — | — | Convex Free 也可用；无堆栈聚合、无前端覆盖 |
| 用量展示 | **Convex 表 + internalQuery + CLI**（v1），后续加 `/ops` 只读页 | — | — | 与 testing-ops §4.4 指标表一致 |
| 用量展示 | 把 token 写进 Axiom 作为账本 | — | — | 日志流尽力投递、可丢可重 |
| 开关 | **Convex 环境变量** | 内置 | — | `npx convex env set` |
| 开关 | Convex 表 `opsFlags` | 内置 | — | 响应式、可写事件；每事务读一次热点文档 |
| 开关 | Vercel Flags SDK（`flags` 4.3.1）/ Edge Config（1.5.1） | — | MIT / Apache-2.0 | 运行在 Next 侧，而开关必须在 Convex 侧强制 |
| 开关 | LaunchDarkly 等 SaaS | — | 商业 | v1 无灰度需求 |
| 密钥 | **密码管理器 + 各平台原生 env 存储 + 零停机轮换手册** | — | — | 不引入新组件 |
| 密钥 | Doppler / Infisical / Vault 统一同步 | — | 各异 | 多一个高价值攻击面与同步链路 |

## 3. 评估维度

### 3.1 托管平台

| 维度 | Vercel | Netlify | Cloudflare（OpenNext） |
| --- | --- | --- | --- |
| 成熟度 | Next 的一方平台 | 成熟；Next 运行时经 `@netlify/plugin-nextjs` 适配 | 适配层 1.x，持续追 Next 版本 |
| 与 Next 16 / proxy.ts | 原生 | 插件声明支持 Next 16（插件无 next peer，具体 16.4 特性覆盖：待验证） | **Node Middleware 未支持**；Next 16 proxy 固定 Node 运行时 → 高风险（是否覆盖 proxy.ts：待验证） |
| 与 Convex 1.48 | CLI 识别 `VERCEL`、`VERCEL_GIT_COMMIT_REF`、`VERCEL_ENV`（`NM:convex/src/cli/lib/envvars.ts:432-565`） | 识别 `NETLIFY`、`CONTEXT` | 识别 `CF_PAGES` / `WORKERS_CI`，但"非生产"只靠"分支 ≠ main"启发式（同文件 `:557-564`） |
| Clerk | 生产实例需自有域名，`*.vercel.app` 只能用 dev 实例 | 同理需自有域名（Clerk 生产要求 DNS 记录） | 同理 |
| 维护活跃度 | 高 | 插件 2026-10-20 有发布 | 适配器 2026-10-21 有发布 |
| 学习成本 | 低 | 低 | 中（wrangler、Worker 尺寸、Node 兼容） |
| 迁移成本 | 我们不用 Vercel 专有 API（不用 Edge Config / KV / Flags）→ 可平移 | 平移目标 | — |
| 对核心不变量 | 无 | 无 | proxy 不可用会让"页面级登录乐观检查"失效（授权仍在 Convex，不破坏核心 1，但破坏体验与防扫描） |

### 3.2 日志与错误追踪

| 维度 | Log streams → Axiom | → Datadog | 仅 dashboard | Sentry | PostHog |
| --- | --- | --- | --- | --- | --- |
| 成熟度 | Convex 官方目的地之一 | 官方目的地之一 | — | 业界标准 | 错误追踪较新 |
| 兼容 Next 16 / React 19 / Convex 1.48 | 不进应用代码，兼容性无关 | 同左 | — | `@sentry/nextjs` peer 覆盖 `^16.0.0-0`；手册提到 Next 16 `proxy.ts`；Convex 侧为平台功能 | Convex 内置；React peer `>=16.8` |
| 许可证 | 服务 | 服务 | — | SDK MIT（自托管服务端为 FSL，不采用自托管） | `Apache-2.0 AND MIT` |
| 维护活跃度 | — | — | — | 11.x 每周发布 | 高频发布 |
| 学习成本 | APL 查询，低 | 高 | 零 | 低 | 低 |
| 迁移成本 | 改 dashboard 目的地即可 | 同左 | — | Next 侧一个包与 4 个配置文件；Convex 侧改 DSN | 同左 |
| 对核心不变量 | 新增数据处理方 → 只能收到 `opsLog` 白名单字段；需扫描 | 同左 | 无外传 | 默认会采集 IP、请求信息、console 面包屑 → 必须收紧配置（part2 O4） | 带回放与分析，默认采集面更大 |

### 3.3 开关与密钥

| 维度 | 环境变量 | `opsFlags` 表 | Flags SDK / SaaS |
| --- | --- | --- | --- |
| 强制点 | Convex 函数内，与业务同一处 | 同左 | Next 侧，Convex 无法信任 |
| 审计 | Convex audit_log（dashboard History，可经日志流到 Axiom） | 可写 `events` | 供应商审计 |
| OCC 影响 | 无 | 每个读它的 mutation 把该文档纳入读集，改开关会让并发事务冲突重试 | 无 |
| 生效时机 | 对新调用生效的确切时机：待验证 | 事务内立即一致 | 依供应商 |
| 结论 | v1 采用 | 有按房间/按用户灰度需求时再引入 | 否决 |
