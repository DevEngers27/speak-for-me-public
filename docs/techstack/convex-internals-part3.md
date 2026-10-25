# Convex 内部选型（第 3/3 部分：否决理由、风险与退出、如何验证、来源）

> 分片清单见 `convex-internals.md`。

## §5 否决理由

| 候选 | 否决理由 |
| --- | --- |
| A3 `@convex-dev/workflow` | ①引入第二份状态（工作流日志），`runs` 变镜像，一致性需额外证明；②handler 必须确定性，"增删或重排步骤会以 determinism violation 失败"（`RL:_convex-dev_workflow.md:851-855`），v1 协议与规则频繁迭代，每次部署都要排空在途实例；③`awaitEvent` 无增量价值——等人审批/取舍本来就是状态行；④单次执行步骤 I/O 1 MB、日志 8 MiB，含私密上下文的回合输入会挤占额度。保留用途：将来"带 sleep 的多步后台流水线"（如第二场景的履约提醒）可单独用它，不迁移协商 run。 |
| A4 `@convex-dev/action-retrier` | 只解决重试；与 SDK `maxRetries` 相乘（RL-DD D3）；不提供并发上限；README 要求被重试的 action 幂等，而 Claude 调用每次计费、输出不同；发布稀疏（0.3.1 于 2026-06-25）。 |
| A2 workpool（v1 不装） | v1 规模下 `maxParallelism` 无需求；`onComplete` 在平台中断时是否必达仍待验证（04 待验证 #15），看门狗不能删；保留为升级路径（§4.1）。 |
| B1 纯自有计数 | 全局日计数热点需自写分片；缺少每用户节流。 |
| B2 全部放进 rate-limiter | 每 run 调用数与每房间日上限是 run 状态机与审计的一部分（UI 显示 reasonCode、可按索引追溯），放进组件表会让业务真相分散到不可直接查询的组件表。 |
| B4 helpers `server/rateLimit` | README 已指向组件；非组件实现需在应用 schema 加表。 |
| D2 纯手写 requireMember | 漏写无法被机器发现；与 D1 相比没有简化。 |
| D3 zod4 桥接 | 两套 validator 系统并存于函数边界；`z.transform/intersection/custom` 退化为 `v.any()`；`returns` 剥离多余字段而非报错，掩盖披露投影错误；客户端类型来源改变。 |
| D4 RLS | 只能表达行级，不能表达字段级披露；默认 allow；内部函数绕过；每文档规则放大读集与 OCC 冲突。 |
| D5 Triggers | 隐式写入破坏单一写入口与可审计性；与"每条唯一性不变量只有一个写入口"冲突（04 §1 含义 4）。 |
| E2 aggregate | 第二份真相源，需在每个写入点同步，漏一处静默错账；与 IE-DD D7"commitments 是唯一真相源"冲突；v1 每房间 < 100 行，无性能收益；其依赖精确锁定 `convex-helpers 0.1.128`，会与应用锁定的版本形成重复安装风险。 |
| E3 计数字段 | IE-DD D7 已否决（F02.3）：多一个必须同步的派生值，且是写热点。 |
| F2 helpers migrations | README 明确推荐改用组件；需要在应用 schema 加状态表。 |
| F3 手写迁移 | 断点续跑、状态查询、dryRun 都要自写，组件已提供且代价小。 |
| G2 crons 组件 | 动态注册的 cron 是运行时状态，本系统所有定时任务都是静态的；多一个依赖（cron-parser）。 |

## §6 风险与退出策略

| # | 风险 | 可能性 / 影响 | 缓解 | 退出策略 |
| --- | --- | --- | --- | --- |
| R1 | **版本新鲜度**：convex 1.48.0 于 2026-10-22 发布（距今 2 天），convex-helpers 0.1.129（3 天）、convex-test 0.0.65（1 天）都早于 testing-ops 设计的"安装取 ≥ 2 周版本"纪律 | 中 / 中 | convex 版本由任务书拍板，记为已知例外；convex-helpers 锁 0.1.128（2026-10-08）；rate-limiter 0.4.2（2026-10-10，恰满 14 天）；convex-test 在实现开始当天取满 2 周的最新版，下限 0.0.63 | 若 1.48 出现回归：降到 1.47.x 需放弃 `v.commitTs`、mutation 内 `runQuery`（1.48 新增，04 要点 7），设计须在 03-schema 标注这些点 |
| R2 | 组件均为 0.x，API 可能变 | 中 / 低 | 所有组件调用集中在 `convex/lib/rateLimiter.ts`、`convex/migrations.ts`；精确锁定版本；升级前跑 L1 + L2 | rate-limiter → 换回自有计数表（调用点签名不变）；migrations → 手写分页迁移 |
| R3 | customFunctions 的参数消费/透传语义与预期不符，或与 `returns`、`internal*` 组合出类型问题 | 低 / 中 | 实现第一周写 3 个样例函数 + L1 测试 | 退回手写 `requireMember()`，lint 改为"公开函数首行必须调用"规则 |
| R4 | rate-limiter 拒绝与业务写入同事务的顺序错误，导致"已拒绝却消耗了别的桶"或"已失败却未记录" | 中 / 低 | §4.2 顺序规则；L1 用例覆盖"拒绝即整体回滚" | — |
| R5 | rate-limiter 的分片随机选片导致"总量未满但被拒" | 中 / 低 | 每片容量 ≥ 5（README 建议 5–10）；日上限 2000/8 片 = 250 | 降低分片数或改 B1 |
| R6 | 自建链的看门狗/重试代码缺陷 | 中 / 中 | L1 假时钟覆盖 RL-DD E 系列边界；`sweepStuckTurns` 兜底 | 切 workpool（§4.1 触发条件），只改 `scheduleAttempt` |
| R7 | convex-test 与真实运行时差异（Edge Runtime mock、无 OCC、无限额）造成"测试绿、线上错" | 高 / 中 | 测试名带 `[serial]`；并发结论只引用 L2；L2 进入合并前闸门的子集 | — |
| R8 | crons 在 dev/preview 部署也会运行，可能对 seed 数据产生意外写 | 中 / 低 | cron 目标函数首行读部署层级开关；巡检只读+告警 | 删除 cron 条目即停用 |
| R9 | 迁移改写只追加表的历史语义 | 低 / 高 | 规则：只追加表只允许加派生字段；迁移 PR 必须附 dryRun 输出 | 迁移前 `npx convex export` 快照 |

## §7 如何验证（可执行步骤）

在 scratchpad 新建一次性项目（不碰两个源仓库），每步结论回填到 10-agent-runtime / 16-testing / 18-decisions：

1. **依赖解析**：`pnpm add convex@1.48.0 convex-helpers@0.1.128 @convex-dev/rate-limiter@0.4.2 zod@4.6.7` 与 `pnpm add -D convex-test@<≥0.0.63> vitest@4 @edge-runtime/vm@5.0.0 typescript@6.0.3`；预期无 peer 警告。`pnpm why convex-helpers` 应只出现一个版本。
2. **组件安装**：`convex/convex.config.ts` 写 `defineApp()` + `app.use(rateLimiter)`；`npx convex dev --once` 成功生成 `components.rateLimiter`。
3. **customFunctions 语义**：写 `memberQuery` 与一个用它的 `rooms.view`；L1 断言：无身份 → 抛 UNAUTHENTICATED；非成员 → FORBIDDEN；成员 → handler 能读到 `ctx.member` 与 `args.roomId`（验证 R3 与 §4.3 的"待验证"）。
4. **returns 严格性**：`rooms.view` 故意多返回一个字段，L1 断言抛出返回值校验错误（frontend-ia 待验证 #2 同题）。
5. **rate-limiter 事务性**：L1 中先 `limit(startRunPerUser)` 再 `throw`，再次 `check` 应显示未消耗；连续调用超过 capacity 后得到 `ok: false` 与 `retryAfter`；并验证 `ok: false` 时是否消耗（预期不消耗，待验证）。组件注册用 `@convex-dev/rate-limiter/test` 导出。
6. **调度链**：`vi.useFakeTimers()` → startRun → `t.finishAllScheduledFunctions(vi.runAllTimers)`；stub 模型返回后 run 进入下一 step；让 stub 永不返回 → watchdog 把回合判 failed；完成后迟到提交被 G0 拒收。
7. **L2 并发**：对云端 dev 部署用 `ConvexHttpClient` 并行 5 次 `approvals.decide`（同一最后一票），断言 `executions` 1 行、`commitments` 新增 1 行；并行 50 次 `startRun`（同一用户），断言成功数 ≤ capacity。
8. **限额实测**：在 dev 部署对 `getCommittedCents` 调 `ctx.meta.getTransactionMetrics()`，记录读文档数与字节；确认 action 上限（默认运行时 30 分钟、Node 10 分钟）是否与文档一致。
9. **crons**：部署后在 Dashboard 的 Schedules/Crons 页确认四个 cron 已登记；对 `sweepStuckTurns` 的目标函数在 L1 中直接调用测试（convex-test 不支持 cron）。
10. **migrations 演练**（prod 前一次）：加一个可选字段 → 定义迁移 → `npx convex run migrations:run '{fn: "migrations:xxx", dryRun: true}'` → 正式跑 → 收窄 schema 推送成功。

## §8 来源列表（访问日期均为 2026-10-24）

| 事实 | 来源 |
| --- | --- |
| 已装版本 convex 1.48.0、react 19.3.1、next 16.4.3、zod 4.6.7、typescript 6.0.3、@clerk/nextjs 7.9.20、@anthropic-ai/sdk 1.1.0 | `NM:<pkg>/package.json` |
| 各包版本、peer、依赖、许可证、发布时间 | `npm view <pkg> version license peerDependencies dependencies time`（输出存于 `scratchpad/techstack-npmview.txt`）；convex-helpers/rate-limiter 的可选 peer：`npm view <pkg> peerDependenciesMeta` |
| 组件均导出 `./test` 子路径；convex-helpers 导出 `server/customFunctions`、`server/zod4`、`server/rowLevelSecurity`、`server/triggers` | `npm view <pkg> exports` |
| customFunctions、RLS、Zod、Triggers、旧 retries/migrations/rateLimit 指向组件 | `npm view convex-helpers readme`（README 39-116、154-219、328-436、1068-1203 行） |
| zod4 桥接的导出、退化为 `v.any()` 的类型、returns 先 Zod 解析 | https://raw.githubusercontent.com/get-convex/convex-helpers/main/packages/convex-helpers/server/zod4.ts |
| rate-limiter 事务性、fail closed、分片、异步模式最终一致、`start`、`reserve` | `npm view @convex-dev/rate-limiter readme`（46-54、123-134、260-330 行） |
| aggregate 需同步每个写入、读依赖与冲突 | `npm view @convex-dev/aggregate readme`（270-285、550-640 行） |
| migrations 在线分批、续跑、dryRun | `npm view @convex-dev/migrations readme`（28-49、200-296 行） |
| workpool `onComplete` 语义、取消竞态、直接取消视为失败 | `npm view @convex-dev/workpool readme`（14-15、74-76、133-170 行） |
| workflow 确定性、1 MB / 8 MiB、改代码失败 | `npm view @convex-dev/workflow readme`（101、144-146、834-855 行） |
| convex-test API、Vitest 环境、局限（不支持 cron、不强制限额） | https://docs.convex.dev/testing/convex-test |
| convex-test 0.0.55–0.0.65 变更 | https://raw.githubusercontent.com/get-convex/convex-test/main/CHANGELOG.md |
| 本地开源 backend 测试的能力与局限 | https://docs.convex.dev/testing/convex-backend |
| 平台限额（action 30/10 分钟、事务 32k/16k 文档、16 MiB、1 MiB 文档等） | https://docs.convex.dev/production/state/limits |
| cron API（`Crons.interval/hourly/daily`） | `NM:convex/dist/esm-types/server/cron.d.ts:178-222` |
| scheduler 语义、唯一性、组件不支持 `"use node"` | inputs/04 part1–part3（含其文件级引用） |
| 编排、调用上限、承诺求和的既有设计 | `design/deepdives/run-lifecycle.md` D1/D1a/D3/D4/D7；`design/deepdives/idempotent-execution.md` D7 |
