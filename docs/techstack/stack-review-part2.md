# 整体栈复核与退出策略（第 2/4 部分）

> 本文件：§3 评估维度、§4 推荐与理由、§5 否决理由。来源编号 S1–S16 见 part4 §8。

## 3. 评估维度

### 3.1 关键需求逐条对比（R1–R8）

评分：●强　◐可做但要额外工程　○弱或有结构性风险。

| 要求 | A Convex | B Supabase | C 自建 Postgres |
| --- | --- | --- | --- |
| R1 事务与 OCC | ◐ 多表原子写天然具备，OCC 冲突自动重试（PC-1 §1.3）。**没有唯一约束**，唯一性只能靠单一写入口 mutation 里按索引先查后写，并依赖 OCC 把并发插入判为冲突（PC-2 §1.6，并发行为待验证）。事务上限：扫描 32,000 文档、写 16,000 文档、16 MiB（S4），本系统单次执行远低于此。 | ● 原生 UNIQUE + `INSERT … ON CONFLICT DO NOTHING`，幂等键最直接。但 PostgREST 一次请求一个事务，多表执行要写成 plpgsql 函数（RPC），业务规则被分到 SQL 与 TS 两种语言；改用 service role 直连则绕过 RLS，权限又回到应用代码。 | ● 原生 UNIQUE、`SELECT … FOR UPDATE`、SERIALIZABLE。代价是应用层要处理 40001 重试，事务边界要自己划。 |
| R2 三窗口同步 | ● 任意 query 自动订阅、依赖变化即推送；每方订阅自己的投影 query。单客户端多订阅是否保证同一快照：文档宣称如此，待验证（V2）。 | ◐/○ Postgres Changes 按订阅者逐条做 RLS、单线程处理以保证顺序；吞吐取决于订阅者数而非写入量；超过约 3,000 并发订阅者时官方建议改用 Broadcast（S7）。本系统规模远小于此，但投影问题见 R4。常见做法是"变化信号 + RPC 重新拉投影"。 | ○ 全部自建：outbox/LISTEN-NOTIFY → SSE 推失效信号 → TanStack Query 重新拉。tRPC v11 支持 SSE 订阅，但示例用进程内 EventEmitter，多实例需要另配 pub/sub（S12）。 |
| R3 调度与 action | ● `runAfter(0)` 与状态迁移同事务；被调度的 mutation 恰好一次（PC-1 §1.5）；action 最多执行一次，不重试，watchdog 自建（PC-3 §2.2 已比较）。默认运行时 action 30 分钟、Node 10 分钟（S4）。 | ◐ 队列消息可与业务写同事务（Postgres 的优势）；但执行者若是 Edge Function，墙钟 150/400 秒、CPU 2 秒（S9），Opus 5.5 high effort 回合可能超时（回合耗时待验证，PC-7 待验证 #5）；放在 Next Route Handler 则受 Vercel 300/800 秒限制（S13）。 | ◐ pg-boss / graphile-worker 很成熟，outbox 同事务写；但需要一个常驻 worker 宿主（又多一个部署件）。 |
| R4 权限投影 | ● 投影就是 query 代码，可直接调用引擎纯函数 `project(viewerSeat, doc)`；读路径与推送路径是同一个函数。风险只在"写错 query"，可用隐私金丝雀测试覆盖（V3）。 | ○ RLS 只管行；列级披露要拆表（私密简报独立成表、仅本人可读）或用视图 / SECURITY DEFINER 函数。Postgres Changes 不支持视图，所选列必须对订阅角色可读，`DELETE` 不受 RLS 约束（S7）。等于有两条要同时守住的投影路径。 | ◐ 投影写在 tRPC procedure（TS），与 A 相同；推送只发"某房间已变"的信号，不带数据，避免第二路径。 |
| R5 历史与全序 | ● 1.48 的 `v.commitTs()` 提供按提交顺序递增的字段（PC-2 §1.6）。 | ◐ 序列值在插入时分配，不等于提交顺序；需要串行化事件写入（例如每房间行锁）或借助逻辑复制位点。 | ◐ 同 B。 |
| R6 本地测试 | ◐ 纯函数用 vitest；convex-test 0.0.65 做状态机/权限测试但**不模拟并发**；并发测试可针对 `npx convex dev --local` 启动的本地后端（CLI 会下载 convex-local-backend 二进制，`CVX:cli/lib/localDeployment/download.ts:251-277`）或云 dev 部署。本地后端是否与云端 OCC 行为一致：待验证。 | ● `supabase start`（Docker）起完整本地栈；pgTAP 测 RLS；真并发。 | ● testcontainers 起真实 Postgres，并发、唯一约束都能本地真测。 |
| R7 托管成本 | ◐ 免费档：100 万次函数调用、0.5 GB 存储、20 GB·小时 action；Pro $25/开发者/月，含 2,500 万次调用、50 GB、250 GB·小时（S5）。流式导出、每日备份、日志流仅 Pro。部件：Next 宿主 + Convex + Clerk。 | ◐ Pro 从 $25/月/组织起，含 $10 计算额度；免费项目闲置 1 周会暂停（S8）。部件数与 A 相同。 | ○ 数据库 + worker + 实时 + Next，至少四个计费 / 运维面。 |
| R8 锁定与退出 | ◐ 客户端库 Apache-2.0（`NM:convex/package.json`）；后端 FSL-1.1-Apache-2.0，每个版本发布满两年转 Apache-2.0，除"竞争性使用"外均允许，含内部使用（S2）；可自托管（S3）；`npx convex export` 导出 ZIP（`CVX:cli/convexExport.ts`）。函数 API、调度、订阅是 Convex 专有。 | ● 数据就是 Postgres，可 `pg_dump` 带走；RLS/Realtime/Edge Functions 是平台特有部分。 | ● 锁定最低，构建成本最高。 |

Claude 成本对三者相同且占大头：默认模型 `claude-opus-5-5` 输入 $4 / 输出 $20 每百万 token（PC-5，来自 claude-api 技能）。平台费在首个场景的规模下是次要项，不构成换栈理由。

### 3.2 通用维度

| 维度 | A Convex | B Supabase | C 自建 |
| --- | --- | --- | --- |
| 成熟度 | convex 1.x 稳定线，1.48.0 发布于 2026-10-22（npm `time.modified`）；官方组件仍是 0.x（PC-3） | supabase-js 2.x 长期稳定（2.118.0）；@supabase/ssr 仍 0.x（0.12.7） | Postgres 最成熟；drizzle-orm 仍 0.x（0.45.4）；Prisma 的 npm `latest` 标签当前指向 8.0.0-rc.27，稳定线是 7.10.1（`npm view prisma dist-tags`），选型时要锁版本 |
| 与 Next 16 / React 19 / Convex 1.48 的兼容 | convex 1.48.0 peer `react ^18 \|\| ^19`；@clerk/nextjs 7.9.20 peer `next … \|\| ^16.0.10 \|\| ^16.1.0-0`、`react ~19.3.0-0`，与 next 16.4.3、react 19.3.1 匹配（`NM:*/package.json`）；`ConvexProviderWithClerk` 已在包内（PC-4 §3.1） | supabase-js 与框架无关；@supabase/ssr 面向 Next 的 cookie 会话；Clerk 走 Supabase 第三方认证，JWT 模板方式自 2025-04-01 起已弃用（S10） | tRPC 11.19.0 peer `typescript >=5.7.2`（TS 6.0.3 满足）；Next 16 的 `proxy.ts` 固定 Node 运行时（PC-4 §3.5） |
| 许可证 | 客户端 Apache-2.0；后端 FSL-1.1-Apache-2.0；Next MIT；Clerk SDK MIT；Anthropic SDK Apache-2.0 | supabase-js / ssr / CLI MIT（npm）；平台服务器组件许可证未逐一核对（待验证） | drizzle Apache-2.0、tRPC MIT、pg-boss MIT、graphile-worker MIT |
| 维护活跃度（npm `time.modified`） | convex 2026-10-22；convex-test 2026-10-23；convex-helpers 2026-10-21 | supabase-js 2026-10-22；CLI 2026-10-23 | drizzle 2026-10-21；tRPC 2026-10-17；pg-boss 2026-10-13；graphile-worker 2026-09-08 |
| 学习成本 | 低到中：TS 函数 + validator；要理解 OCC、action 最多执行一次、无唯一约束 | 中到高：SQL、RLS 策略、plpgsql、Realtime 授权模型、Edge Functions（Deno） | 高：自己设计事务边界、队列、实时、部署拓扑 |
| 迁移成本（从现状出发） | 0：新仓库尚无代码，而 inputs/04 与 deepdives 已按 Convex 原语展开（单写入口、`runAfter(0)`、watchdog、`commitTs`） | 中：重写 03 schema、04 守卫落点、07 RLS 矩阵、10 运行时、12 API | 高：B 的全部，加上实时与队列的基础设施设计 |
| 对核心不变量的影响 | §3-1：投影单路径，有利。§3-5：唯一性靠纪律，需并发测试兜底。§3-6：`commitTs` 全序，有利 | §3-5 最强（数据库约束）；§3-1 风险最高（两条投影路径 + 列级披露） | §3-5 强；§3-1 可做好，但要自行保证推送不带数据 |

## 4. 推荐与理由

**决定：维持方案 A。不推荐整体换栈；把 A′（自托管）作为 L0 退路，把"Postgres + Drizzle"作为 L1 退路；从第一天起执行 part3 §6.1 的可迁出纪律。**

理由按核心不变量排序：

1. **§3-1 私密委托**是最难补救的失败（泄露不可撤回）。A 的投影路径只有一条，并且就是 TS 代码，能和引擎披露函数共用、能被金丝雀测试穷举；B 在实时层引入了第二条由 RLS 和列权限共同决定的路径。
2. **§3-5 原子幂等**：A 的弱点（无唯一约束）是可以工程化补齐的，B/C 在这一项更强。补齐办法：每条唯一性不变量指定索引和唯一写入口；ESLint 禁止其他模块对这些表 `insert`；并发脚本在本地后端和云 dev 上实测（V1）。
3. **§3-2 / §3-4 代理只建议、代码负责校验**：依赖"迟到结果被拒绝"。A 的 `runAfter(0)` + 提交 mutation 校验版本，是平台推荐模式（PC-3 §2 含义 1），无需额外部件。
4. **反对过度设计**（BRIEF §6）：A 的托管件数最少；C 至少多出 worker 和实时两项运维面。
5. **退出成本可控**：自托管提供同代码退路；领域纯函数化后，L1 迁移的重写面限定在适配层（part3 §6.2）。

开放问题（交 18-decisions）：Pro 计划是否从首个生产环境起开通（备份与流式导出只在 Pro）；是否需要 SQL 报表需求（如有，用流式导出接数据仓库，而不是换主库）。

## 5. 否决理由

| 被否决项 | 主要原因 | 什么情况下会重新考虑 |
| --- | --- | --- |
| B Supabase | ①列级披露与 Postgres Changes 的组合让 §3-1 有两条投影路径，`DELETE` 不受 RLS 约束、视图不能订阅（S7）；②多表执行要写成 plpgsql RPC，规则分散在 SQL 与 TS 两处，违背"确定性代码集中可测"（§3-4）；③Edge Function 墙钟 400 秒 / CPU 2 秒（S9）不适合长回合，改放 Next 又受 Vercel 时长约束（S13）；④现有设计输入已按 Convex 原语展开，换栈要重写一半设计文档 | 需要以 SQL 为主的报表和外部 BI 直连主库；或组织层面要求数据留在自管 Postgres |
| C 自建 Postgres 栈 | ①实时、队列、worker 全部自建，至少多两个部署件；②tRPC SSE 多实例要另配 pub/sub（S12）；③学习与构建成本最高，而首个场景的规模用不上它的灵活性 | 作为 L1 退出落点保留；当 Convex 条款、价格或合规不可接受时启用 |
| D 同步引擎（Zero 等） | 客户端缓存数据的模型与"私密字段永不下发"之间的关系需要专门论证；本轮未深评 | 若将来需要离线或本地优先体验 |
| A′ 作为首选（直接自托管） | 运维成本：自管后端、面板、数据库、admin key、升级；社区资料称 CLI 对自托管支持有限（S11，二手来源）；官方说明自托管支持"全部免费档功能"，云端"为规模优化"（S3） | 云端条款或数据驻留不可接受、但又不想重写时（L0 退出） |
