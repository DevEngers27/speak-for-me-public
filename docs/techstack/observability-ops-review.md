# 反驳评审：可观测性与运维（part 1/2）

> 评审代理，2026-10-24。分片：本文件为 §0 结论与 §1 逐条核对；observability-ops-review-part2.md 为 §2 问题详述与修改建议、§3 主动检查。核对方式：`npm view`、`npm pack` 后读 `@sentry/core` 类型与实现（临时解包读取后已删除，可用 `npm pack @sentry/core@11.6.0` 复现）、`/Users/zhennn/cal-hack-2026-main/node_modules`（下称 NM）、官方文档 WebFetch、本机 `node -e`（Node 24.21.0）。

## 0. 结论

**verdict：accept_with_changes。** 大方向成立：Vercel + Convex log streams → Axiom + Sentry（两端）+ `modelCalls` 作账本 + Convex 环境变量作开关 + 零停机轮换手册，与任务书核心不冲突，且多数平台事实核对无误。但有两处直接违反核心 1（私密委托）的漏洞必须先改：Sentry `dataCollection` 配置没写全（`httpHeaders`、`databaseQueryData` 等仍是默认开启）；以及未捕获异常的 `error_message` + 堆栈会原样进入 Axiom 与 Sentry，而 V8 的 `JSON.parse` 报错会带出模型原文片段。另有一处会让 staging 发布直接失败的平台陷阱，以及一处过度设计。

| id | 严重度 | 一句话 |
| --- | --- | --- |
| r01 | high | Sentry `dataCollection` 只写了一部分；未写的键按 v11 默认值全开（请求/响应头、DB 查询数据、GraphQL、队列参数） |
| r02 | high | 未捕获异常的消息与堆栈经 `function_execution.error_message` 和 exception reporting 外传；`JSON.parse` 报错会带出模型原文；统一错误包装器只写在降级方案 R1 里 |
| r03 | medium | 示例配置里的 `enableLogs` 在 v11 已删除（类型检查报错）；console 面包屑现由 `consoleIntegration` 产生；`tracesSampleRate: 0` 并不等于关闭追踪 |
| r04 | medium | staging 若走 Vercel 自定义环境，`VERCEL_ENV=preview`，Convex CLI 见到 prod 型 deploy key 会直接中止发布 |
| r05 | medium | 四层环境 + staging 独立 Convex 项目对 v1 偏重；隔离理由（deploy key、用量上限、集成）本来就是按部署设置的 |
| r06 | low | "dashboard 只保留约 1000 次调用日志"当前文档不支持该数字 |
| r07 | low | 来源修正：Vercel Pro 价格已有官方来源；"仅 Clerk Admin 可管理 secret key"在所引页面找不到 |
| r08 | low | Admin API 的前置条件与局限没写：个人账号不能建 Admin key；`cost_report` 不含 Priority Tier、只能按 workspace 分组 |
| r09 | low | log streams 主题清单不全；`function_execution` 不含参数值（可关闭该待验证项），但含 `usage.function_args_bytes` 与完整堆栈 |
| r10 | low | 更简单的选项未列出：v1 先不接 Axiom（只用 Sentry、自有表与看门狗 cron），减少一个数据处理方 |

## 1. 逐条核对待验证声明

| # | 声明 | 结果 | 证据（读取日期均为 2026-10-24） |
| --- | --- | --- | --- |
| 1 | Log streams：Axiom/Datadog/PostHog/Webhook，需 Pro，尽力投递，主题含 console 等 5 个 | **成立**，主题不全（r09） | docs.convex.dev/production/integrations/log-streams：原文为 "best-effort delivery guarantee"，事件可能重复；主题还有 `verification`、`current_storage_usage`、`storage_api_bandwidth`、`ai_gateway_usage`；Webhook 用 HMAC-SHA256，签名放在 `x-webhook-signature` 头 |
| 2 | Exception reporting：Sentry/PostHog/Datadog，需 Pro，`user` = `tokenIdentifier`，不可覆盖 | **成立** | docs.convex.dev/production/integrations/exception-reporting："exception reporting is only available to Pro users"；Sentry 标签 "cannot be overridden"；Datadog 经 Sentry SDK 协议接入；Sentry 项目平台设为 Node.js |
| 3 | Pro $25/开发者/月；部署上限 40/300；所有计划都有预览部署 | **成立** | convex.dev/pricing；log streaming 与 exception reporting 在 Professional 及以上提供 |
| 4 | 预览部署 beta，5 天回收，Pro 及以上 14 天 | **成立** | docs.convex.dev/production/hosting/preview-deployments；"Every deployment you create counts towards the deployment limit" |
| 5 | 默认值只对新部署生效；函数集合与 cron 只在部署时确定；512 个变量，单值 8 KiB | **成立** | docs.convex.dev/production/environment-variables；另有总量 512 KiB、变量名 256 字符的上限。改值后多久对在途/新调用生效，文档没写（R9、V10 保留） |
| 6 | CLI 用 `VERCEL_ENV`、`CONTEXT`、分支 ≠ main 判断非生产；预览名取自 `VERCEL_GIT_COMMIT_REF` 等 | **成立** | NM/convex/src/cli/lib/envvars.ts:525-565（`gitBranchFromEnvironment`、`isNonProdBuildEnvironment`）；Netlify 分支取 `HEAD`；deploy.ts:172-176 依次用 `--preview-create`、`--preview-name`、分支名 |
| 7 | 1.48.0 有 `deployment token create/delete`、`env default set --type`、`usage-limits`（warning/disable）、`logs --history --jsonl` | **成立** | NM/convex/src/cli/deploymentTokenCreate.ts:29、deploymentTokenDelete.ts:26、envDefault.ts:30、usageLimits.ts:127（"`warning` only notifies; `disable` pauses the deployment"）、lib/command.ts:578、587 |
| 8 | convex 1.48.0 发布于 2026-10-22T23:32Z | **成立** | `npm view convex time`：2026-10-22T23:32:49.067Z（1.47.0 为 2026-10-15，同样不满两周） |
| 9 | `@sentry/nextjs` 11.9.0/11.6.0/11.0.0 的日期、peer、MIT | **成立** | `npm view`：11.9.0 发布于 10-23，11.6.0 于 10-08，11.0.0 于 09-23；peer `next ^14.0 \|\| ^15.0.0-rc.0 \|\| ^16.0.0-0`；MIT。11.7.0 发布于 10-12，不满两周，所以 11.6.0 确实是满足纪律的最新版。engines `node >=20.19 <22 \|\| >=22.12 <23 \|\| >=23.2`，覆盖 Node 24；`@sentry/react` 的 peer `react 19.x` 覆盖 19.3 |
| 10 | v11 移除 `sendDefaultPii`，改用 `dataCollection`，未设置时全采集 | **成立**，但备忘录的配置不全（r01） | docs.sentry.io/platforms/javascript/migration/v10-to-v11/："In v11, an unset `dataCollection` collects everything by default"；默认值以 `@sentry/core@11.6.0` build/esm/utils/data-collection/resolveDataCollectionOptions.js 的 `DEFAULTS` 为准 |
| 10b | （R3）`dataCollection` 自 10.57.0 起可用 | **成立** | `@sentry/core@10.57.0` 含 types/datacollection.d.ts；options.d.ts:350 把 `sendDefaultPii` 标为 deprecated |
| 11 | OpenNext 1.20.13 peer；Node Middleware 未支持；proxy.ts 是否可用 | peer 与"Node Middleware 未支持"**成立**；proxy.ts **仍未验证** | `npm view`：peer `next >=15.5.28 <16 \|\| >=16.4.1`，发布于 2026-10-21，MIT；opennext.js.org/cloudflare 写 Node Middleware "not yet supported"，全文没提 proxy。否决 Cloudflare 的结论不受影响，但应写成"高度可能不可用，未验证" |
| 12 | Next 16 `proxy.ts` 运行时固定为 nodejs | **成立** | NM/next/dist/docs/01-app/02-guides/upgrading/version-16.md:600："The `proxy` runtime is `nodejs`, and it cannot be configured." |
| 13 | Clerk 生产实例需自有域名，不能用 `*.vercel.app` | **成立** | clerk.com/docs/guides/development/deployment/vercel："you cannot use a `*.vercel.app` domain for production" |
| 14 | Clerk 多把 secret key 并存、零停机轮换；publishable key 无需轮换 | **成立**；"仅 Admin 可操作"**未找到**（r07） | clerk.com/docs/guides/secure/rotate-api-keys：7 步流程，删除前先看 Last used |
| 15 | `git.deploymentEnabled` 可按分支关闭自动部署 | **成立** | vercel.com/docs/project-configuration/git-configuration（页面 last_updated 2026-08-25）：对象的键为分支名（支持 minimatch），未列出的分支默认 `true` |
| 16 | Hobby 仅限非商业；Pro 约 $20（第三方来源） | **成立，且已有官方来源** | vercel.com/pricing：Hobby "for personal, non-commercial use"；Pro Developer seat $20/月，含 $20 用量额度 |
| 17 | Axiom Personal：500 GB/月加载计算，保留 30 天 | **成立** | axiom.co/pricing；另有 25 GB 存储、10 GB-hours/月查询计算；页面没写商用限制 |
| 18 | `cost_report`/`usage_report` 需要 Admin key | **成立**，有遗漏（r08） | SK:shared/cost-optimization.md:37-44；SK:shared/admin-api.md:13-20（"Regular (non-admin) API keys do not work on any of these endpoints"） |
| 19 | dashboard 只保留约 1000 次调用日志 | **数字不成立** | docs.convex.dev/functions/debugging 只写 "only preserves a limited number of logs"，且日志 "can be erased at any time"；没给数字 |
| 20 | `ConvexError` 是否被 exception reporting 上报 | **仍未验证** | 文档只写覆盖 "errors from your Convex function executions"；V9 保留 |
| 21 | `function_execution` 是否含函数参数 | **不含参数值**（关闭该待验证项） | log-streams 文档：只有 `usage.function_args_bytes`；但 `error_message` 含错误消息与完整堆栈（见 r02） |

