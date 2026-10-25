# 技术选型：可观测性与运维（part 3/3）

> 本文件：§6 风险与退出策略、§7 如何验证（可执行步骤）、§8 来源列表。

## 6. 风险与退出策略

| # | 风险 | 影响 | 缓解 | 退出策略 |
| --- | --- | --- | --- | --- |
| R1 | 不买 Convex Pro | 没有 log streams、exception reporting；预览部署只保留 5 天 | 业务可观测性本就在自有表（`events`、`modelCalls`、`opsLog`）里，不依赖 Pro | 降级：staging / prod 加一个 `opsErrors` 只追加表（统一错误包装器写入）+ 每小时 cron 汇总到 `opsLog`；平台日志只看 dashboard。Next 侧 Sentry 不受影响 |
| R2 | 第三方成为私密数据泄露面（Axiom、Sentry） | 违反核心 1 | `opsLog` 类型白名单、ESLint 禁裸 `console`、Sentry `dataCollection` 全部收紧、`stackFrameVariables: false`、不开 Replay；金丝雀扫描扩展到 Axiom 与 Sentry（§7 V6、V7） | 任一扫描命中即停掉该集成（dashboard 一键关闭），先修再开 |
| R3 | Sentry v11 是新大版本（11.0.0 发布于 2026-09-23），默认采集更多 | 配置遗漏就外传 | 精确版本锁定；`dataCollection` 显式写全；PR 中 diff 审查 Sentry 配置 | v10 线仍在维护（10.76.2 发布于 2026-10-08），可回落；`dataCollection` 自 10.57.0 起可用（S14） |
| R4 | 日志流尽力投递、可丢可重 | 告警漏报、计数偏差 | 告警阈值按比例不按绝对数；计量只信 `modelCalls` | 不需要退出：设计上从未把它当事实来源 |
| R5 | Vercel 锁定 | 迁移成本 | 不用 Vercel 专有 API；构建命令是平台无关的 `npx convex deploy --cmd` | 迁 Netlify：同一构建命令，`CONVEX_DEPLOY_KEY` 改为按 deploy context 分值（S5），Convex CLI 用 `CONTEXT` 判断非生产 |
| R6 | Axiom 锁定 | 告警与查询要重写 | 只存可再生的日志；告警规则数量保持个位数 | 在 Convex dashboard 把目的地换成 Datadog / PostHog / Webhook，代码零改动 |
| R7 | Clerk 生产实例必须自有域名 | 上线被域名与 DNS（含 CAA 记录）阻塞 | 提前采购域名并在 staging 期就配好 prod 实例 DNS | 无替代：Clerk 是已定栈 |
| R8 | 部署打断在途 action | 回合卡在 running | 发布工作流先排空（`AGENTS_ENABLED=false` → 等 `activeTurnCount=0`）；看门狗兜底 | — |
| R9 | 环境变量改动对在途/新调用的生效时机未知 | 总开关延迟生效 | run 开始时快照；排空步骤轮询实际计数而不是假设立即生效 | 若延迟不可接受，`AGENTS_ENABLED` 改为 `opsFlags` 表中的单一文档 |
| R10 | 预览部署是 beta、计入部署数上限（免费 40 / Pro 300） | PR 多时创建失败 | `--preview-create` 只在同仓库 PR 上跑；合并即由平台回收 | 退回 testing-ops 的"本地部署"方案 |
| R11 | convex 1.48.0 发布于 2026-10-22（距今 2 天） | 不满足"≥2 周"版本纪律；运维 CLI（`usage-limits`、`deployment token`）行为可能有缺陷 | 本文依赖的 CLI 命令都有 dashboard 等价操作 | 交"整体栈复核"决定是否回落 1.47.x；本文方案不依赖 1.48 独有能力（`usage-limits` 若 1.47 无，则改在 dashboard 设置） |
| R12 | Anthropic 花费上限通过 API 设置仍是早期预览 | 只能手工在 Console 设 | 写进上线清单，季度复核 | — |

## 7. 如何验证（可执行步骤）

每步产出一条记录（日期、部署名、结果），写进 15-operations 的验证附录。

| # | 验证什么 | 步骤 | 通过标准 |
| --- | --- | --- | --- |
| V1 | Vercel + Convex 预览链路 | 新建 Convex 项目 `sfm` 与 Vercel 项目；Vercel Preview 作用域设 preview deploy key；构建命令 `npx convex deploy --cmd "pnpm build" --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --preview-run seed:e2eRoom`；开一个 PR | Convex dashboard 出现以分支名命名的预览部署；预览页面的 `NEXT_PUBLIC_CONVEX_URL` 指向该预览部署；种子房间带 `isSimulated` |
| V2 | main 不自动发生产 | `vercel.json` 加 `git.deploymentEnabled: { "main": false }`，推一次 main | Vercel 不产生 Production 部署；release 工作流手动触发后才产生 |
| V3 | proxy.ts 在 Vercel 上生效 | 部署含 `clerkMiddleware` 的 `proxy.ts`；未登录访问 `/rooms/x` 与请求一个 API 路由 | 页面重定向登录；API 返回 404（inputs/04 §3.5 的 `auth.protect()` 行为表） |
| V4 | 预览部署拿到默认环境变量 | `npx convex env default set --type preview DEPLOYMENT_TIER preview`、`AGENT_MODE stub`、`CLERK_JWT_ISSUER_DOMAIN …`；推 PR 触发 `--preview-create` | 新预览部署中 `ops.configHealth` 返回三项均存在；`ANTHROPIC_API_KEY` 缺失且回合走 stub |
| V5 | Log streams → Axiom | staging 部署 dashboard 配 Axiom；调一个会 `opsLog` 的函数；在 Axiom 查 `deployment_name` 等于 staging 的事件 | 1 分钟内看到 `verification`、`console`、`function_execution` 三类事件 |
| V6 | 日志零泄露 | staging 跑完整金丝雀 fixture（testing-ops part4 §3.8）；在 Axiom 用 APL 搜金丝雀字符串与数值金丝雀的所有格式变体；同时 `npx convex logs --history 1000 --jsonl` 交给 `canary-scan` | 两处都零命中 |
| V7 | Sentry 零泄露 | Next 服务端组件与 Convex mutation 各故意抛一个错误（错误路径上的局部变量里放金丝雀）；在 Sentry 事件 JSON 中搜金丝雀、cookie、IP | 零命中；事件里没有 `vars`、请求正文、cookie；`user` 只有 `tokenIdentifier`（Convex 侧） |
| V8 | `dataCollection` 键名 | 安装锁定版本后 `grep -n "dataCollection" node_modules/@sentry/core/build/types/types-hoist/options.d.ts`（路径以实际为准）并 `pnpm typecheck` | 配置中每个键都在类型里，类型检查通过 |
| V9 | `ConvexError` 是否上报 Sentry | 在 staging 抛 `ConvexError({ code: "OVER_BUDGET" })` 与普通 `Error` | 记录两者是否出现在 Sentry；若前者出现，配置入站过滤并复测 |
| V10 | 开关生效时机 | staging 上 `npx convex env set AGENTS_ENABLED false` 后立刻每秒发起一次 `startRun`，持续 60 秒 | 记录从设置到首次 `agents_disabled` 的秒数；写进排空步骤的等待参数 |
| V11 | 开关变更有审计 | V10 之后在 Axiom 查 `audit_log` 主题 | 能看到该环境变量变更事件（只含变量名，不含值；若含值则需在 Axiom 侧遮蔽：待验证） |
| V12 | deploy key 轮换 | `npx convex deployment token create ci-rotated-2026-10 --deployment prod` → 更新 Vercel 与 GitHub → 触发 release → `npx convex deployment token delete <旧名>` → 用旧 key 再发布一次 | 新 key 发布成功；旧 key 发布失败 |
| V13 | Clerk secret 轮换 | Clerk dev 实例新增 secret key → 更新 Vercel Preview 作用域 → 重新部署预览 → 删除旧 key | 预览站登录与服务端 `auth()` 正常；删除后无 401 |
| V14 | Anthropic key 轮换 | Console 新建 key → `npx convex env set ANTHROPIC_API_KEY`（交互输入）→ `npx convex run devProbe:runtimeSmoke` → 停用旧 key | 冒烟返回 `stop_reason: end_turn` 与非零 `usage`；Sentry / Axiom 无 401 |
| V15 | 成本对账 | 一周后用 Admin key 调 `GET /v1/organizations/cost_report`（按 workspace、model 分组）与 `ops/metrics:spendEstimate` 比较 | 偏差写入记录；偏差 >10% 时检查价目表 `asOf` 与 SDK 内部重试计费（inputs/04 待验证 #10） |
| V16 | 用量上限 | `npx convex deployment usage-limits set --metric functionCalls --window day --type warning --limit <n> --prod`，再 `npx convex deployment usage-limits list --prod` | 列表中出现该条；dev 部署设 `disable` 类型并人为触发，部署被暂停 |
| V17 | Netlify 退路演练（可选） | 同仓库在 Netlify 建站，构建命令不变，`CONVEX_DEPLOY_KEY` 按 deploy context 分值 | 预览与生产构建都成功，proxy.ts 行为与 V3 一致 |

## 8. 来源列表（读取日期均为 2026-10-24）

| 编号 | 来源 | 用于 |
| --- | --- | --- |
| S1 | https://docs.convex.dev/production/integrations/log-streams | 目的地（Axiom、Datadog、PostHog、Webhook）、需 Pro、事件主题、尽力投递、HMAC 签名 |
| S2 | https://docs.convex.dev/production/integrations/exception-reporting | Sentry / PostHog / Datadog、需 Pro、自动标签（含 `user` = `tokenIdentifier`）、Node.js 平台 |
| S3 | https://www.convex.dev/pricing | Pro $25/开发者/月；log streaming、exception reporting 为 Pro；部署数 40 / 300 |
| S4 | https://docs.convex.dev/production/hosting/vercel | 构建命令、按 Production / Preview 作用域放 deploy key、`--preview-run`、Clerk 不支持 `*.vercel.app` |
| S5 | https://docs.convex.dev/production/hosting/netlify | 按 deploy context 区分 key、项目默认环境变量 |
| S6 | https://docs.convex.dev/production/hosting/preview-deployments | beta、5 天回收（Pro 等 14 天）、计入部署上限、支持的平台 |
| S7 | https://docs.convex.dev/production/environment-variables | 512 个 / 8 KiB / 512 KiB 上限；默认值只对新部署生效；函数集合与 cron 只在部署时确定 |
| S8 | https://opennext.js.org/cloudflare | Next 16 支持；"Node Middleware … not yet supported"；Worker 3 / 10 MiB |
| S9 | https://docs.convex.dev/functions/debugging 与 https://discord-questions.convex.dev/m/1247927739982549082 | dashboard 只保留最近约 1000 次调用日志、维护时可能清空（后者为社区/员工回复，较旧） |
| S10 | https://clerk.com/docs/guides/development/deployment/vercel | 生产实例需自有域名与 DNS |
| S11 | https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/ | 所需文件、`onRequestError`、`tunnelRoute` 需排除出 proxy matcher、`SENTRY_AUTH_TOKEN` |
| S12 | https://vercel.com/docs/project-configuration/git-configuration | `git.deploymentEnabled` 语法（页面更新于 2026-08-25） |
| S13 | https://vercel.com/docs/limits/fair-use-guidelines | Hobby 仅限非商业个人用途；Pro 价格来自第三方，需官方确认 |
| S14 | https://docs.sentry.io/platforms/javascript/migration/v10-to-v11/interactive/ 与 https://sentry.io/changelog/javascript-sdk-v11/ | v11 移除 `sendDefaultPii`、`dataCollection` 未设置时采集更多；10.57.0 起可用 |
| S15 | https://blog.sentry.io/datacollection-control-panel | `dataCollection` 各键及 v11 默认值（`stackFrameVariables: true` 等） |
| S16 | https://platform.claude.com/docs/en/manage-claude/workspaces | workspace 花费上限不得超过组织上限、邮件提醒 |
| S17 | https://clerk.com/docs/guides/secure/rotate-api-keys | 多把 secret key 并存的零停机轮换；publishable key 无需轮换；仅 Admin 可管理 secret key（2026-01 changelog） |
| S18 | https://axiom.co/pricing | Personal 免费：500 GB/月加载计算、30 天保留；Axiom Cloud $25/月起 |
| N1 | `npm view`（2026-10-24）：`@sentry/nextjs` 11.9.0（2026-10-23）、11.6.0（2026-10-08）、11.0.0（2026-09-23）、10.76.2（2026-10-08），peer `next ^14.0 \|\| ^15.0.0-rc.0 \|\| ^16.0.0-0`，MIT；`@opennextjs/cloudflare` 1.20.13（2026-10-21），peer `next >=15.5.28 <16 \|\| >=16.4.1`，MIT；`@netlify/plugin-nextjs` 5.16.4（2026-10-20），MIT，engines `node >=18`；`@axiomhq/nextjs` 0.4.1，MIT；`flags` 4.3.1，MIT；`@vercel/edge-config` 1.5.1，Apache-2.0；`posthog-js` 1.438.21，`Apache-2.0 AND MIT`；`@datadog/browser-rum` 7.16.1，Apache-2.0；`convex` 1.48.0 发布于 2026-10-22 | 版本、许可证、发布时间 |
| N2 | `NM:convex/src/cli/lib/envvars.ts:425-565` | CLI 对 Vercel / Netlify / Cloudflare 的识别、分支名、非生产判定 |
| N3 | `NM:convex/src/cli/deploy.ts:38-80, 170-215` | `--preview-run`、`--preview-name`、`--preview-create`、preview deploy key 要求 |
| N4 | `NM:convex/src/cli/envDefault.ts:40-80` | `npx convex env default set --type …` |
| N5 | `NM:convex/src/cli/deploymentTokenCreate.ts:17-60`、`deploymentTokenDelete.ts` | deploy key 的 CLI 创建与删除 |
| N6 | `NM:convex/src/cli/usageLimits.ts:114-400` | `usage-limits` 的 metric / window / `warning \| disable` |
| N7 | `NM:convex/src/cli/lib/command.ts:578-591` | `npx convex logs --history [n] --jsonl` |
| K1 | `SK:shared/cost-optimization.md:40-41`、`SK:shared/admin-api.md` | `usage_report` / `cost_report`、Admin key 与普通 key 互不通用 |
| D1 | `design/inputs/04-platform-constraints*.md`、`design/inputs/02-review-design-findings-part12.md`（F15.*）、`part7.md`（F07.8）、`design/deepdives/testing-ops*.md` | 平台约束、审查要求、环境与排空流程 |
