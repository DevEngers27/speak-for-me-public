# 整体栈复核与退出策略（stack-review）

> 子决策：在已定技术栈（任务书 §2）下复核"Next.js 16 App Router + Convex 1.48 + Clerk 7 + Claude（@anthropic-ai/sdk 1.x）"是否应维持，并给出将来离开 Convex 的迁移路径。日期 2026-10-24。
> 分片：本文件（结论、需求与约束、候选方案表）→ `stack-review-part2.md`（评估维度、推荐与理由、否决理由）→ `stack-review-part3.md`（风险与退出策略、如何验证）→ `stack-review-part4.md`（来源列表）。
> 引用缩写沿用 inputs/04：`NM:` = `/Users/zhennn/cal-hack-2026-main/node_modules/`，`CVX:` = `NM:convex/src/`，`BRIEF` = `design/00-brief.md`，`PC-n` = `design/inputs/04-platform-constraints-partn.md`。

## 0. 结论（先读）

**推荐：维持 Next.js 16.4.3 + Convex 1.48.0（云托管）+ Clerk 7.9.20 + @anthropic-ai/sdk 1.x；同时从第一天起按"可迁出"纪律写代码，把 Convex 当作可替换的"事务 + 订阅 + 调度"适配层，而不是领域层。**

维持的三条主要依据：

1. **一个机制同时满足两条核心不变量。** 执行原子幂等（BRIEF §3-5）与版本化审批（§3-3）要事务；约束变化让三个参与方窗口在几秒内同时翻转（deepdives/frontend-ia、testing-ops 的 e2e 断言"三个窗口 5 秒内无刷新出现 Blocked"）要实时订阅。Convex 的 mutation 是带 OCC 自动重试的事务（PC-1 §1.3），query 是响应式的（PC-2 §1.11），两者共享同一份数据和同一份 TypeScript 代码。替代方案都要把"事务库"和"实时通道"拼成两套系统。
2. **权限投影只有一条路径。** 私密简报不得到达浏览器（§3-1），字段×角色裁剪必须在服务端返回值上完成（PC-2 §1.11、PC-7 §5）。在 Convex 里，投影就是 query 的返回代码，订阅自动继承同一份投影，不存在"实时通道绕过投影"的第二条路径。Supabase 的 Postgres Changes 恰好有这条第二路径：它按 RLS 行级授权、不支持视图、`DELETE` 不受 RLS 约束（来源 S7）。
3. **"状态迁移 + 启动 Claude 调用"天然原子。** 在 mutation 里写状态并 `runAfter(0, internal…)`，回滚时调度一并消失（PC-1 §1.5）；默认运行时 action 上限 30 分钟（S4），足够跑一次 Opus 5.5 回合。替代方案要另建队列 worker（常驻进程）或受 Edge Function 400 秒墙钟限制（S9）。

**接受的代价：** 没有原生唯一约束，要靠"单一写入口 + 索引查重"（PC-2 §1.6）；convex-test 不模拟并发（PC-2 §1.12）；云托管锁定，但后端以 FSL-1.1-Apache-2.0 开源、可自托管（S2、S3）；流式导出、每日备份、日志流只在 Pro（$25/开发者/月）提供（S5）。

**退出路径分两级（详见 part3 §6）：**
- **L0 换托管，不换代码**：`npx convex export` 导出，`npx convex import` 导入自托管 Convex（Docker，SQLite / Postgres / MySQL 存储，S3），零业务代码改动。
- **L1 换平台**：迁到 Postgres（Drizzle + tRPC/Route Handler + 作业队列 + 失效推送）。引擎与场景的纯函数、Zod 协议、Claude 调用封装、展示组件可以直接带走；Convex 函数外壳、schema、鉴权中间层要改适配；实时层、调度与 watchdog、并发测试要重写。

## 1. 需求与约束（引自任务书核心）

把任务书 §3 的 8 条核心翻译成对平台的要求（R1–R8），后文逐条评估：

| # | 平台要求 | 来自哪条核心 / 输入 | 失败的样子 |
| --- | --- | --- | --- |
| R1 事务与 OCC | 多表原子写（变更单 + 预算承诺 + 任务 + 事件 + 状态迁移在一次事务里）；并发下"每版本每人一条审批""每执行键一条执行记录""每房间一个活跃 run"成立 | §3-3、§3-5；PC-2 §1.6 | 双击产生两份预算承诺；旧审批在约束变化后仍被计入 |
| R2 实时订阅（三窗口同步） | customer / provider / finance 三个浏览器同时订阅同一房间；预算下调后三方视图一起翻转（不等模型），且每方看到的是自己的投影 | §3-1、§3-3；deepdives/frontend-ia-part3、testing-ops-part4 | 一方仍看到旧方案可审批；另一方要手动刷新 |
| R3 调度与 action | Claude 回合是外部调用（可能数分钟）；要能原子启动、超时检测（watchdog）、过期拒绝迟到结果、有限重试 | §3-2、§3-4；PC-1 §1.4–1.5、PC-3 §2 | 迟到的模型输出覆盖新约束下的状态；调用丢失后 run 永远卡在 running |
| R4 权限投影 | 私密简报只到本人；对他方可见字段经显式披露；投影在服务端完成，且实时推送路径与读路径用同一份投影 | §3-1；PC-2 §1.11、PC-7 §5 | 私密字段出现在 WebSocket 帧或 RSC payload 里 |
| R5 不可篡改历史与全序 | 提案只追加；事件可追溯；事件需要按提交顺序的全序游标 | §3-6；PC-2 §1.6（`v.commitTs()`） | 事件顺序与提交顺序不一致，回放结果不同 |
| R6 本地测试 | 纯函数单测；状态机/权限/披露的确定性测试；并发与幂等测试能在本地或 dev 环境跑 | BRIEF §5 文件 16 | 幂等缺陷只在生产暴露 |
| R7 托管成本与运维面 | 小团队可负担；需要运维的部件尽量少 | BRIEF §6"反对过度设计" | 为实时和队列多养两套服务 |
| R8 锁定与退出 | 数据可完整导出；领域代码不被平台 API 渗透 | 本任务 | 想离开时只能整体重写 |

硬约束（不在本复核中推翻）：技术栈已定（BRIEF §2）；Claude 调用只在服务端（Convex action），密钥不进 Next（PC-7 §5.2）；房间角色是应用数据，Clerk 只做认证（PC-4 §3.4）。

## 2. 候选方案表

版本取自 `npm view`（2026-10-24）或已安装包（`NM:*/package.json`）。

| 方案 | 组成（版本） | 事务 | 实时 | 调度 / 长任务 | 权限投影 | 需托管的部件 |
| --- | --- | --- | --- | --- | --- | --- |
| **A 维持（推荐）** | next 16.4.3、react 19.3.1、convex 1.48.0（云）、@clerk/nextjs 7.9.20、@anthropic-ai/sdk 1.1.0（最新 1.3.0）、zod 4.6.7 | mutation 事务 + OCC 自动重试；无唯一约束 | 所有 query 自动响应式 | `ctx.scheduler` + action（默认运行时 30 分钟 / Node 10 分钟）；action 最多执行一次，watchdog 要自建 | query 的 TS 返回值；订阅与读同一路径 | Next 宿主 + Convex 云 + Clerk |
| A′ 同 A，Convex 自托管 | 同 A；convex-backend（Docker）+ Postgres/MySQL/SQLite | 同 A | 同 A | 同 A | 同 A | Next + 自管 Convex 后端与面板 + 数据库 + Clerk |
| B Supabase | next 16、@supabase/supabase-js 2.118.0、@supabase/ssr 0.12.7、supabase CLI 2.122.0、Clerk 第三方认证、Supabase Realtime、Cron/Queues、Edge Functions 或 Next Route Handler 调 Claude | Postgres 事务；原生 UNIQUE；多语句事务要写成 SQL 函数（RPC）或绕过 PostgREST 直连 | Postgres Changes（按订阅者逐条做 RLS 授权、单线程）或 Broadcast | pg_cron + 队列；Edge Function 墙钟 150 秒（免费）/ 400 秒（付费），CPU 2 秒 | RLS（行级）；列级要拆表、视图或 SECURITY DEFINER 函数；Postgres Changes 不支持视图 | Next 宿主 + Supabase + Clerk（Claude 调用若放在 Next 上，还受 Vercel 函数时长约束） |
| C 自建 Postgres 栈 | next 16、托管 Postgres（如 Neon）、drizzle-orm 0.45.4（或 Prisma 7.10.1；npm `latest` 标签当前指向 8.0.0-rc.27）、@trpc/server 11.19.0（SSE 订阅）、pg-boss 12.38.0 或 graphile-worker 0.18.0、Clerk | Postgres 事务；原生 UNIQUE、`ON CONFLICT`；SERIALIZABLE 需应用层重试 40001 | 自建：LISTEN/NOTIFY 或 outbox → SSE；多实例需要 pub/sub；Vercel 函数最长 300/800 秒 | 常驻 worker 进程消费作业；outbox 与业务写同事务 | tRPC procedure 的 TS 返回值；推送只发"失效信号"、客户端重新拉取 | Next 宿主 + Postgres + worker 宿主 + 实时宿主（或 Pusher/Ably 一类服务） |
| D 参考：同步引擎 | @rocicorp/zero 1.11.3（Postgres 上的同步引擎） | Postgres | 客户端同步 | 需另配 | 服务端权限规则 | 未深评：数据模型与"私密字段不落客户端缓存"的约束需另做研究，不在本轮候选内 |

候选取舍说明：
- 只把 B、C 作为正式替代。它们分别代表"托管 Postgres 平台"和"可移植性最高的自建栈"，也正是 L1 退出的两个落点。
- A′ 不是替代，而是 L0 退出手段：代码不变，只换运营方。
- Firebase / Firestore（规则语言 + 文档库，与 Next 服务端的事务语义差距大）、InstantDB 等未纳入：任务书要求在已定栈内部决策，本节只需证明"维持"的依据。
