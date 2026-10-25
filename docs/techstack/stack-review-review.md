# 反驳评审：整体栈复核与退出策略（stack-review）

> 评审对象：`techstack/stack-review.md` 及 part2–part4。评审日期 2026-10-24。
> 缩写沿用原文：`NM:` = `/Users/zhennn/cal-hack-2026-main/node_modules/`，`CVX:` = `NM:convex/src/`。

## 0. 结论

**verdict：accept_with_changes。** 推荐（维持 A，A′ 作 L0、Postgres 作 L1，加可迁出纪律）站得住。14 组待验证声明中，版本、许可证、限额、定价、CLI 行号全部核实，两条"待验证"已可结案（见 §2）。没有推翻结论的错误。需要修改的是：`commitTs` "全序"说法不完整（同一事务内并列）；漏了 SDK 1.x 和所有锁定版本都只有几天的成熟度风险；L0 路径忽略了导入为 Beta、调度状态不随导出迁移；另有 4 处引用与来源不符。

## 1. 逐条核对

| # | 声明 | 结果 | 证据（2026-10-24） |
| --- | --- | --- | --- |
| 1 | 已装版本/许可证/peer | **属实** | `NM:convex/package.json` 1.48.0 Apache-2.0，peer react `^18.0.0 \|\| ^19.0.0-0 \|\| ^19.0.0`；next 16.4.3 MIT；react 19.3.1；@clerk/nextjs 7.9.20 MIT，peer next `…\|\|^16.0.10\|\|^16.1.0-0`、react `…\|\|~19.3.0-0`；@anthropic-ai/sdk 1.1.0 Apache-2.0，peer zod `^3.25.0 \|\| ^4.0.0`；zod 4.6.7。`npm view @anthropic-ai/sdk version` 是 1.3.0 |
| 2 | Convex 后端 FSL-1.1-Apache-2.0 | **属实** | LICENSE.md："effective on the second anniversary of the date we make the Software available"；Permitted Purpose 指除 Competing Use 外的任何用途，明确列出 internal use |
| 3 | 可自托管，SQLite 默认，可用 Postgres/MySQL，支持全部免费档功能 | **属实** | self-hosted/README.md："supports all the free-tier features of the cloud-hosted product" |
| 4 | action 30/10 分钟；事务 32,000/16,000/16 MiB；文档 1 MiB | **属实，但有遗漏** | docs.convex.dev/production/state/limits。遗漏项见 r05：query/mutation 用户代码 1 秒；每事务读索引区间 4,096 个；各计划的并发档位 |
| 5 | Pro $25/开发者/月，含 25M 调用、50 GB、250 GB·h；流式导出、日志流、每日备份仅 Pro+ | **属实**（命名有偏差） | convex.dev/pricing：计划名是 "Professional"；"Free & Starter" 共用一列；Business 每月最低 $2,500 |
| 6 | ZIP 每表一个目录，内含 `documents.jsonl`；import 有 append/replace/replace-all | **属实，但不完整** | `CVX:cli/lib/command.ts:485-518`；`convexImport.ts:101-108`。默认模式是 `requireEmpty`，原文没写 |
| 7 | `--local` 会下载 convex-local-backend | **属实** | `CVX:cli/lib/localDeployment/download.ts:255-277`，从 `github.com/convex/convex-backend/releases` 下载。OCC 是否一致见 §2 |
| 8 | Supabase Postgres Changes：逐订阅者做 RLS、单线程、DELETE 不受 RLS、约 3,000 订阅者 | **属实**；"不支持视图"**来源不支持** | 原文："authorizes every event against each subscriber"、"RLS policies are not applied to `DELETE` statements"。页面没有提到视图（r04） |
| 9 | Edge Function 150/400 秒、CPU 2 秒；Supabase Pro $25；免费项目闲置 1 周暂停 | **属实，但有遗漏** | 页面还写了：request idle timeout 150 秒，超时返回 504，付费档也一样（r07）。Pro 含 $10 计算额度；闲置 7 天暂停 |
| 10 | Clerk JWT 模板集成自 2025-04-01 起弃用 | **属实** | supabase.com/docs/guides/auth/third-party/clerk；新方式要求 session token 带 `role: authenticated` |
| 11 | 各包 npm 版本 | **属实** | `npm view`：supabase-js 2.118.0、ssr 0.12.7、drizzle-orm 0.45.4、prisma latest=8.0.0-rc.27/prev=7.10.1、@trpc/server 11.19.0（peer ts >=5.7.2）、pg-boss 12.38.0、graphile-worker 0.18.0、@rocicorp/zero 1.11.3、convex-test 0.0.65（peer convex ^1.43.0） |
| 12 | Vercel：Hobby 300 秒；Pro 默认 300、最长 800，1800 为 Beta | **属实** | vercel.com/docs/functions/limitations（last_updated 2026-08-24） |
| 13 | Clerk Hobby 免费 5 万 MRU，Pro $25/月 | **属实** | clerk.com/pricing：5 万 MRU 按每个 app 计；Pro 按年付为 $20/月 |
| 14a | 同一客户端的多个订阅是同一快照 | **已核实（协议层）** | `CVX:browser/sync/remote_query_set.ts:24-40`：整个查询集只有一个 `StateVersion{querySet, ts, identity}`，每个 Transition 把全部查询从 `startVersion` 原子推进到 `endVersion`，起点不符就抛错。只覆盖同一个客户端，三个窗口之间仍然是各自的时间戳 |
| 14b | 自托管用 Postgres 存储时是内部格式 | **已核实：是内部格式** | convex-backend `crates/postgres/src/sql.rs`：`documents(id BYTEA, ts BIGINT, table_id BYTEA, json_value BYTEA, deleted, prev_ts)`，是所有表共用的 MVCC 日志，另有 `indexes` 表。不能直接作为 L1 目标库查询，原文的判断成立 |

主动补查：
- convex-test 0.0.65 支持 `commitTs` 和 `getSnapshotTs`（tarball 中 `dist/index.js:197-210, 625-628, 973, 2051`）。
- Convex Node action 默认跑 Node 24，支持 22 和 24（docs.convex.dev/functions/runtimes），与 `package.json` 里的 `engines.node >=24.19 <25` 一致。自托管时忽略 `convex.json` 的 nodeVersion，改读 `.nvmrc`。
- 维护活跃度：所有候选包最近 6 周内都有发布（graphile-worker 和 @supabase/ssr 最近一次是 2026-09-08），没有停更的。

## 2. 可以结案的"待验证"

- **V2 的快照部分**：单客户端的一致性由协议保证（见 14a）。V2 只需测三个窗口的翻转延迟，"同一窗口新旧混合"那条通过标准可以删掉，或降为回归断言。
- **§6.3-3**：内部格式已确认（见 14b），把"待验证"改为"已验证"，并附上 `sql.rs` 作来源。
- **本地后端与云端 OCC**：本地后端二进制和自托管后端出自同一个 convex-backend 仓库（`download.ts:274-276`），OCC 判定逻辑是同一份代码。差异在于单机 SQLite 和不同的并发时序。V1 仍要以云 dev 部署的结果为准，本地只作快速反馈。

## 3. 问题清单

### r01（medium）`commitTs` 不是严格全序
同一事务里插入的所有文档拿到同一个提交时间戳。validator 的说明是 "assigned from the transaction's commit timestamp"，而且 "Accepts any int64 value"（`CVX:values/validator.ts:213-222`）。所以：①一个 mutation 写多条事件时会出现并列，R5 的"全序"和 §6.1-5"按原值排序，历史顺序可保持"在 Postgres 里不成立，并列行的顺序是任意的；②这个字段可以被代码写入任意 int64，全序要靠纪律保证。
**修改**：事件表加 `seq`（事务内从 0 递增），游标用 `(commitTs, seq)`，在 Postgres 里建成 `UNIQUE(commit_ts, seq)`。把"事件只能经单一入口写 `db.vars.commitTs`"加进 K1 的 lint 清单。

### r02（medium）漏了版本成熟度风险
`npm view <pkg> time`：@anthropic-ai/sdk 1.0.0 发布于 2026-10-21，3 天内连发 1.0.0、1.1.0、1.2.0、1.3.0。next 16.4.3 发布于 10-23，@clerk/nextjs 7.9.20 发布于 10-23，convex 1.48.0 发布于 10-22，而 R5 依赖的 `v.commitTs()` 是 1.48 才有的新能力。原文 §3.2"成熟度"一行完全没提 SDK，也没有说锁 1.1.0 还是升到 1.3.0。PC-5 里的实测结论（`zodOutputFormat` 降级、`parse()` 抛错、`anthropic-version` 头）都只针对 1.1.0。
**修改**：在风险表加一项"新发版本"：所有核心包精确锁版本（现在的 `package.json` 已经锁了）；升级 SDK 前重跑 PC-5 的结构化输出和参数 400 用例；V8 加一步"`npm view <pkg> time` 记录发布日期"。不改栈。

### r03（medium）L0 路径缺三处
①docs.convex.dev/database/import-export/import 写明 "Data import is a beta feature"，而 L0 的核心步骤就是 import；②导入/导出文档没说 `_scheduled_functions` 和 cron 状态会随快照迁移，切换时在途的 agent run 和 watchdog 调度可能丢失；③迁移后新后端写出的 `commitTs` 是否一定大于导入的旧值，文档没有保证（`CVX:server/meta.ts:166-170` 只在同一时钟内成立）。
**修改**：L0 也走 §6.3-4 的维护开关，并加一步"排空在途 run：等 `agentRuns` 没有 running 状态，或全部判为 stale"；V6 加两项断言：导入后事件游标单调，新事件排在旧事件之后；把"零业务代码改动"改写为"零业务代码改动，需要运维切换与排空步骤"。

### r04（low）引用与来源不符
- "Postgres Changes 不支持视图"标的是 S7，但 S7 页面没有这句。结论很可能对（逻辑复制只覆盖表），但要换来源或标"推论"。
- "tRPC 多实例需要 pub/sub"标的是 S12，但 S12 只给了进程内 EventEmitter 的示例，"需要 pub/sub"是作者的推论。
- §6.3-1 写"快照导出（所有计划）"，但 S5 和 S6 都没说免费档可以用；CLI 存在不等于免费档可用，应标"待验证"。
- 计划名应写 "Professional"；import 的默认模式 `requireEmpty` 要补上。

### r05（low）R7 漏了按计划划分的并发档位与执行时限
limits 页写的是：Free/Starter 固定 S16，即并发 query 16、mutation 16、默认运行时 action 64、Node action 64、**scheduled job 8**；Professional 是 S256。另外 query/mutation 用户代码限 1 秒，每事务读索引区间 4,096 个。投影 query 要在 1 秒内调用引擎纯函数；免费 dev 部署上 watchdog 和 run 共用 8 个调度并发。
**修改**：把这些限制写进 R1/R3/R7，并作为 10-agent-runtime 的输入。

### r06（low）兼容性的细节
@clerk/nextjs 7.9.20 和它依赖的 @clerk/react 6.18.1 对 react 的 peer 都是 `~19.3.0-0`。波浪号意味着 React 升到 19.4 时，必须同时升 Clerk。建议写进风险表 K9。L0 自托管需要 `.nvmrc` 固定 Node 24（见 §1 补查）。

### r07（low）Supabase 时限说得不完整
除了 400 秒墙钟，还有 150 秒请求空闲超时（返回 504），付费档也一样。同步调用 Claude 回合时，150 秒才是真正的上限。这条加强了否决 B 的理由（原文 §5③），应补进去。

### r08（low）有过度设计的倾向
§6.1-2 的"通用写计划解释器"和 K7 的"每年至少一次 L0 演练"，在一行代码都没有的阶段成本偏高。
**修改**：保留 decide/apply 分离，但每个 mutation 各写自己的落库代码，不做通用 WritePlan 解释器；V5 只在首次上生产前做一次；V6 只在 §6.4 的触发条件出现时做；每周 export 冷备份成本低，保留。

## 4. 是否与任务书冲突、有没有更简单的方案
- 和 BRIEF §2、§3 没有冲突。R4 的单一投影路径直接服务 §3-1，退出纪律没有引入新部件。
- 更简单的 L1 落点：tRPC 不是必需的。L1 可以只用 Next Route Handler / Server Actions + Drizzle + pg-boss，少一个依赖；原文写的是"tRPC/Route Handler"，建议把 Route Handler 设为默认。
- 报表需求：原文的"流式导出喂数仓，不换主库"已经是最简方案，同意。

## 5. 来源（访问日期 2026-10-24）
`NM:*/package.json`；`npm view`（版本、time、dist-tags、peer）；convex-test 0.0.65 tarball；`CVX:browser/sync/remote_query_set.ts`、`values/validator.ts`、`server/meta.ts`、`cli/lib/{command,convexImport,config}.ts`、`cli/lib/localDeployment/download.ts`；https://docs.convex.dev/production/state/limits ；https://docs.convex.dev/functions/runtimes ；https://docs.convex.dev/database/import-export/import ；https://docs.convex.dev/database/import-export/export ；https://www.convex.dev/pricing ；https://raw.githubusercontent.com/get-convex/convex-backend/main/LICENSE.md ；…/self-hosted/README.md ；…/crates/postgres/src/sql.rs ；https://supabase.com/docs/guides/realtime/postgres-changes ；…/functions/limits ；…/auth/third-party/clerk ；https://supabase.com/pricing ；https://vercel.com/docs/functions/limitations ；https://clerk.com/pricing ；https://trpc.io/docs/server/subscriptions
