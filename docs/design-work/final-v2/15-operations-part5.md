# 15 · 运维（part5）：采购、事故、验证、不变量、备选、开放问题、canon 对照

## 15.12 采购项与无 Pro 退路（U9）

设计按"已采购"写；每一项都给出不采购时的退路（techstack X5、D28 / D31 / D32）。

| 采购项 | 用途 | 默认 | 不采购时的退路 | 退路的代价 |
| --- | --- | --- | --- | --- |
| Convex Pro（$25 / 开发者 / 月） | log streams、exception reporting、周期备份、预览部署 14 天保留 | prod 上线前采购 | 异常只走 `withSanitizedErrors` → `opsLog` + `ops.livenessSweep` 告警计数；备份改 CI 定时 `npx convex export --prod`（非 Pro 能否导出待验证）；预览部署 5 天回收 | 无平台级异常聚合与长期日志；备份依赖 CI |
| Vercel Pro（$20 / 席位 / 月）+ 自有域名 | 商用托管（Hobby 限非商业个人用途）；Clerk 生产实例要求自有域名与 DNS（`*.vercel.app` 不行） | 采购；在预览阶段就配好 prod 实例的 DNS（含 CAA） | 托管退路 Netlify（同一构建命令，deploy key 按 deploy context 分值）；**域名没有退路** | Netlify 同样有商用计费；proxy.ts 在 Netlify 上的行为需重验 |
| Axiom（Personal 免费层起步） | prod 日志流目的地、告警 | 只接 prod | Sentry + `opsLog` + cron 告警（§15.6.4） | 缺函数耗时、OCC、调度延迟等平台指标；少一个第三方数据处理方 |
| Anthropic 组织（可选） | `cost_report` 对账 | 可选 | 只做估算，不对账 | 无法发现重试计费等偏差 |
| Sentry（免费层起步） | Next 侧错误追踪 | 采用 | — | — |

每接入一个第三方（Axiom、Sentry）就多一个数据处理方，§15.6.5 的金丝雀扫描必须覆盖它；任一扫描命中即在 dashboard 一键关闭该集成，修复后再开。

## 15.13 事故手册

| 事故 | 现象 | 处置 |
| --- | --- | --- |
| 模型额度耗尽 / 密钥失效 | `agent_failed` 请求激增；Console 通知；401 / 429 | 修复额度或密钥（§15.10）→ `live-smoke` → 受影响 run 的失败方点 Retry（`runs.retryTurn`）或创建者重开 run |
| 成本异常 | `spend_deferred` 告警；Console 通知 | `AGENTS_ENABLED=false`（紧急止血）→ `pnpm ops metrics` 按房间定位 → 必要时下调 `DAILY_MAX` / `RUN_MAX` 并部署 |
| 模型 400 风暴 | `attempt_failed` 中 `error` 激增 | 多为请求形状或 schema 问题：回滚上一个后端 SHA；重跑 SDK 类型契约与 schema 快照测试 |
| 卡住的 run | `stuck_run` 告警 | `ops.livenessSweep` 已兜底；按日志中的 `runId` / `attemptId` 排查代码缺陷，补 16 的回归用例 |
| 部署打断在途回合 | 发布记录中有超时未排空的 attemptId | 看门狗判 `error` → `agent_failed` → 失败方 Retry；核对 `ops.livenessSweep` 返回的 `scheduled` 数 |
| 隐私疑似泄露 | 金丝雀扫描命中、用户报告 | 先 `ops.setDraining(true)` 阻止新回合；关闭可能外传的集成（Axiom / Sentry）；定位来源（模板 / 投影 / 日志 / 错误参数）；修复后补跑 16 的隐私全套；按需告知受影响房间 |
| Clerk 不可用 | 登录失败；Convex 查询拿不到 token | 无需处理数据；界面显示登录不可用；恢复后自动重连 |
| Convex 不可用 / 维护 | 前端连接中断 | 在途 mutation 由客户端重发并去重；在途 action 失败由看门狗与 reconcile 接手 |
| 误操作数据 | 对账检查器或用户报告 | §15.11 break-glass 手册 |

## 15.14 上线前验证清单（U11：实现第 1 周分配给各章实现者，结果写入验证记录附录）

| # | 验证项 | 方法 | 通过标准 | 来源 |
| --- | --- | --- | --- | --- |
| V1 | 预览链路 | 开 PR：Vercel Preview 执行 `convex deploy --cmd ... --preview-run seed:fromFixture` | 出现以分支命名的预览部署；页面 URL 指向它；种子房间带 `seeded` 徽章 | observability V1 |
| V2 | main 不自动发生产；release 工作流的预构建发布顺序 | 推 main；手动 release | 无自动 Production 部署；后端先于前端可见 | observability V2、review r17 |
| V3 | 预览默认变量生效 | 新建预览部署后调 `ops.configHealth` | `tier = preview`、`agentMode = stub`、`anthropicKeyConfigured = false`、`configValid = true` | testing-ops r09 |
| V4 | proxy 行为 | 未登录访问 `/rooms/x` 与一个 JSON 请求 | 页面重定向登录；JSON 请求也是 307（业务不依赖它） | spikes §3 |
| V5 | 恢复演练 | §15.11 全流程一次 | 对账检查器全绿 | techstack D39 |
| V6 | 日志零泄露 | `ci-dev` 跑金丝雀 fixture，按 §15.6.5 采集与扫描；prod 首周再跑一次 | 零命中；采集条目数 > 0 | observability V6、§8 #11 |
| V7 | Sentry 零泄露 | Next 服务端组件与 Convex mutation 各故意抛错（局部变量里放金丝雀） | 事件中无金丝雀、cookie、IP、`vars`、请求正文 | observability V7 |
| V8 | `dataCollection` 键名 | 安装锁定版本后 `pnpm typecheck` | `satisfies Required<DataCollection>` 通过 | review r01 |
| V9 | `ConvexError` 是否被异常上报 | staging / `ci-dev` 抛 `internal` 与普通错误 | 记录结论，写入 18 | observability V9 |
| V10 | 生产 `ConvexError` 形态与 `logLines` 是否下发 | 以三种身份订阅 `rooms.view` 并抓 WebSocket 帧 | 只见 `{ code, params }`；无私密值 | §8 #4、#11 |
| V11 | Clerk → Convex token 流程 | dev 实例登录后 `users.viewer`；生产 token 解码核对 `iss` / `aud` | `aud = "convex"`；`auth.config.ts` 缺变量时推送失败的报错形态已记录 | §8 #12 |
| V12 | 轮换演练 | §15.10 三把运行时密钥各轮换一次 | 新 key 生效，旧 key 失效，无 401 | observability V12–V14 |
| V13 | 真实 token 量与花费 | `live-smoke` 一周 | `max_tokens: 16000` 是否够用、拒绝率、`schema_mismatch` 率；据此校准 `RUN_MAX` / `DAILY_MAX` | §8 #15 |
| V14 | 重试计费与对账 | 一周后 `cost_report` vs `spendEstimate` | 偏差 ≤ 10% 或已解释 | §8 #16、observability V15 |
| V15 | 用量上限 | `npx convex deployment usage-limits set ...`；dev 设 `disable` 并人为触发 | 列表中出现；dev 部署被暂停 | observability V16 |
| V16 | CI 在 GitHub 上实际运行 | 推测试仓库 | 全部工作流绿 | §8 #18 |
| V17 | `convex export` 在当前计划可用 | 执行一次 | 得到可导入的 ZIP | techstack O9 |

## 15.15 不变量（运维层）

| # | 不变量 | 机制 |
| --- | --- | --- |
| OPS-1 | preview 永不持有 `ANTHROPIC_API_KEY`，且只能 stub | 预览默认变量；`config.ts` 组合规则 |
| OPS-2 | 每个前端构建绑定自己环境的 Convex URL，构建产物不跨环境提升 | `convex deploy --cmd ... --cmd-url-env-var-name` |
| OPS-3 | 生产没有 seed / reset；破坏性操作需要层级 + 部署名 + CLI 确认三重条件 | `assertTier`；`convex-ops` 守卫 |
| OPS-4 | 日志、Sentry、Axiom 只含白名单字段；金丝雀扫描零命中 | `opsLog` 类型；`withSanitizedErrors`；`dataCollection`；§15.6.5 |
| OPS-5 | 用量事实只来自 `attempts`；金额只以带 `asOf` 的估算写一次、不回溯；日志不是账本 | `pricing.ts`；§15.7 |
| OPS-6 | 发布先排空；排空只停泊新的 live attempt、从不杀死在途 attempt；`AGENTS_ENABLED` 只作止血 | `opsFlags.draining`；§15.5 |
| OPS-7 | 每个密钥只在一处；90 天轮换；任何脚本不打印密钥值 | §15.10；`env:check` |
| OPS-8 | 每次发布前有备份；恢复先 Backup Now、双人确认；自动化脚本无 `--replace` | §15.11；CI grep |
| OPS-9 | cron 幂等且按房间扇出；`clock` 只在时间结论翻转时递增 cv；模型原文按保留期删除 | §15.8；D22 |

## 15.16 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| 四层环境 + 独立 staging 项目（testing-ops、observability O2） | v1 隔离增量小、多一套集成与发布路径；列为扩展点并写明触发条件与形态（§15.2） |
| 用 `AGENTS_ENABLED=false` 排空（testing-ops TD-11） | 把在途多步 run 全打成失败；依赖环境变量生效时机（review r06） |
| 把 token 用量写进 Axiom 当账本 | 日志流可丢可重（核心 8） |
| 把金额当事实落库（不带价目表版本） | 价格会变；只写带 `asOf` 的估算并标 "Estimated"，token 才是事实 |
| Datadog / PostHog 一站式 | 成本与采集面过大；PostHog 默认带回放与产品分析 |
| Cloudflare Workers 托管 | Node middleware 未支持而 Next 16 proxy 固定 Node 运行时（高度可能不可用，未验证）；包体积上限 |
| 功能开关表或开关 SaaS | v1 只有全局开关；唯一的数据库标志是 `opsFlags.draining` |
| 生产 demo seed（`ALLOW_DEMO_SEED`）、seed 中间状态 | 违反 D18 与核心 8 |
| CI 中把 `npx convex logs --history` 当有限步骤 | 命令永不退出、只回放缓冲（review r07）；改后台采集 |
| CI 断言 OCC 重试次数 | insights 拒绝 deploy key，只能人工查询；改为客户端侧 `maxOverlap ≥ 2` 证据（review r08） |
| Doppler / Vault 统一密钥 | 多一个能读全部密钥的系统 |

## 15.17 开放问题

| # | 问题 | 默认 | 决策者 / 验证 |
| --- | --- | --- | --- |
| Q1 | Convex Pro、Vercel Pro + 域名、Axiom 是否采购 | 采购（退路见 §15.12） | 用户（U9） |
| Q2 | 非 Pro 计划能否 `npx convex export` | 待验证 | V17 |
| Q3 | dev 部署 deploy key 的形态（`ci-dev` 需要） | 待验证；不行则 `ci-dev` 用一个单独项目的 prod 型部署 | 实现第 1 周 |
| Q4 | 预览部署回收策略与部署数上限是否够用 | 只对同仓库 PR 创建 | V1 |
| Q5 | `cronJobs` API 的确切签名；action 最长运行时间（影响排空等待上限） | 按 Convex 文档 | 实现第 1 周 |
| Q6 | 价目表中缓存写入倍率、思考 token 在 SDK 1.1.0 usage 中的字段 | 按 §15.7 默认，标"待核对" | 实现当天复核官方定价页；V13 |
| Q7 | `ConvexError` 是否被 exception reporting 上报 | 不依赖它 | V9 |
| Q8 | `RUN_MAX` / `DAILY_MAX` 的最终值 | §15.7 默认 | V13 后校准 |
| Q9 | （已关闭）活性巡检与在途计数统一为 `ops.livenessSweep`（每 5 分钟）、`ops.activeAttemptCount`（03 / 04 / 10 / 12 已同名，12 §12.25 Q13） | — | — |
| Q10 | 模型原文保留期 | dev 30 天、prod 7 天 | 07（保留期与最小化） |
| Q11 | （已关闭）seed 的终止状态只有两种：缺省 run 1 已开始（stub）、`stopBeforeRole` 停在 `setup`（§15.9）；canon D18 现文已如此 | — | — |

## 15.18 与 canon 的对照

| canon 条目 | 本章落实 |
| --- | --- |
| D16 日志纪律 | `opsLog(ctx: InternalCtx, code, SafeLogFields)` 字段白名单；公共函数内只允许 `publicOpsLog` 的 `{ fn, code, errorClass }`（§15.6.2）；`withSanitizedErrors`；Sentry `dataCollection` 全部显式关闭；`error_message` 列入扫描面（§15.6） |
| D17 上限与排空 | 四层上限 + Console 兜底、被调度路径 `deferred`（回合记 `spend_deferred`、不写事件）、`opsFlags.draining` 排空流程（只停泊 live，stub 不受影响）、`AGENTS_ENABLED` 只作止血（§15.5、§15.7） |
| D18 seed / reset | seed 走生产 helper 链、全部 `seeded`、不预置中间状态；终止状态只有"run 1 已由第三份确认开始"（缺省）与"`stopBeforeRole` 停在 `setup`"两种，D18 原文的中间态不可达（Q11）；reset 只在 dev / preview、按部署名守卫、只删非 `live`；prod 无 reset（§15.9） |
| D20 依赖 | `minimumReleaseAge` 例外清单到期检查进 CI；SDK 升级前跑 `live-smoke` 与类型契约（§15.4） |
| D22 时间 | `clock.rollLocalDate` 每小时推进 `localDate`，结论翻转才 `bump(cause: "clock")`（§15.8） |
| D01 / D07 | 不用组件，部署前无需排空工作流实例；`ops.livenessSweep` 是 `reconcile` 的定时兜底（§15.8） |
| D09 | `MODEL_FALLBACKS` 缺省关；预览不设模型 key（§15.3） |
| D15 | `humanRequests.expireDue` 每小时处理 7 天到期（§15.8） |
| U5 | 月预算 dev $100 / prod $300 → Console 上限与 `DAILY_MAX`（§15.7） |
| U9 | 三项采购逐项给出退路（§15.12） |
| U11 | 上线前验证清单按 spikes §8 分配到实现第 1 周（§15.14） |
| must_absorb：三层环境 / `DEPLOYMENT_TIER` + `assertTier` / 预览默认变量 / 按环境构建 / 排空 / 日志白名单与 Sentry / 成本 `asOf` / 备份与 break-glass / 90 天轮换 / cron / 采购与退路 | 分别见 §15.2、§15.3、§15.4、§15.5、§15.6、§15.7、§15.11、§15.10、§15.8、§15.12 |
