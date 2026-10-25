# Convex 内部选型（第 1/3 部分：结论、需求与约束、候选方案表）

> 作者：技术选型代理（Convex 内部）。日期 2026-10-24。栈已定（Next.js 16 + Convex 1.48 + Clerk 7 + Claude），本文只做栈内子决策。
> 分片：本文件 = §0 结论、§1 需求与约束、§2 候选方案表；`convex-internals-part2.md` = §3 评估维度、§4 推荐与理由；`convex-internals-part3.md` = §5 否决理由、§6 风险与退出、§7 如何验证、§8 来源。
> 引用缩写沿用 inputs/04：`NM:` = `/Users/zhennn/cal-hack-2026-main/node_modules/`；`RL:` = 本代理用 `npm view <pkg> readme` 存下的 README（`scratchpad/techstack-readmes/`）；`NPM` = 2026-10-24 的 `npm view` 输出（`scratchpad/techstack-npmview.txt`）；`RL-DD` = `design/deepdives/run-lifecycle.md`；`IE-DD` = `design/deepdives/idempotent-execution.md`。

## §0 结论（一页）

| # | 子决策 | 决定 | 包与版本（NPM，2026-10-24） |
| --- | --- | --- | --- |
| C1 | 协商 run 编排 | **自建 `ctx.scheduler` 链**：mutation 写状态 + 同事务 `runAfter(0, runTurn)` + 同事务 `runAfter(deadline, turnWatchdog)`；全部调度集中在 `scheduleAttempt()` 一个函数（与 RL-DD D1 一致）。**不用** `@convex-dev/workflow`；**不用** `@convex-dev/action-retrier`；`@convex-dev/workpool` 作为有明确触发条件的升级路径，v1 不装 | 无新依赖（workpool 0.4.14 备选） |
| C2 | 模型调用限流 | **采用 `@convex-dev/rate-limiter`，范围收窄**：①每用户对"会花钱/会建资源"的公开 mutation 节流（startRun、retryTurn、createRoom）；②全局每分钟模型请求（分片 token bucket，低于 Anthropic 账户 RPM）；③全局每 UTC 日 live 调用上限（分片 fixed window，`start` 对齐 UTC 0 点），**替代** RL-DD D4 的 `usageCounters` 热点文档。每 run `callCount` 与每房间每日上限**留在自有表**（它们是 run 状态机与审计的一部分） | `@convex-dev/rate-limiter` 0.4.2（Apache-2.0，peer `convex ^1.43.0`，`react` 可选） |
| C3a | 统一鉴权与成员检查 | **采用 convex-helpers `customQuery / customMutation / customCtx`**：在 `convex/lib/functions.ts` 定义 `userQuery / userMutation / memberQuery / memberMutation`，公开函数只能用它们构造（lint 规则禁止在其他文件从 `_generated/server` 导入 `query`/`mutation`） | `convex-helpers` 0.1.128 精确锁定（≥2 周），0.1.129 满 2 周后可升 |
| C3b | Zod 校验器桥接 | **不在函数边界采用**（不用 `zCustomQuery/zCustomMutation`）：args/returns 一律 `v.*`；Zod 只用于模型输出 schema、协议消息、handler 内对金额/日期/长度的领域细化（`parse` 纯函数） | — |
| C3c | RLS 封装 | **不采用** `wrapDatabaseReader/Writer`；同样**不采用** convex-helpers `Triggers`。私密性靠"按角色投影的 query + 私密表单一读取模块 + lint/金丝雀测试" | — |
| C4 | 已承诺金额求和 | **不采用 `@convex-dev/aggregate`**；`getCommittedCents` = `commitments.by_roomId` 区间 `.collect()` 求和（每房间条数有界），与 IE-DD D7 一致，且保留"读区间 → OCC 冲突"的正确性论证 | — |
| C5 | schema 演进 | **采用 `@convex-dev/migrations`，但在第一个"有需保留数据"的部署（prod）上线前引入**；纪律为 widen → migrate → narrow；上线前 dev/preview 用 reset + seed 代替迁移 | `@convex-dev/migrations` 0.3.7（Apache-2.0，peer `convex ^1.42.0`、`convex-helpers ^0.1.115`） |
| C6 | crons | **用内建 `cronJobs()`**（`convex/crons.ts`），**不用** `@convex-dev/crons` 组件；只做全局巡检：卡死回合兜底清扫、执行不变量巡检、每日用量汇总与告警、到期兜底（邀请、报价、人工请求）。**每个实体的定时事件一律 `scheduler.runAt`**（精确、exactly-once、随事务回滚） | 内建（`NM:convex/dist/esm-types/server/cron.d.ts:178`） |
| C7 | 测试分工 | **convex-test（L1）**：状态机、鉴权、按角色披露、调度链（假时钟）、过期拒收、串行幂等、组件注册后的限流逻辑；**真实后端（L2）**：并发/OCC、唯一性、限额、默认运行时打包 SDK、crons、rate-limiter 分片行为。L2 优先用云端 dev 部署（与生产同版本），本地开源 backend 作 CI 备选 | `convex-test` 下限 0.0.63、精确锁定；`vitest` 4.x；`@edge-runtime/vm` 5.0.0 |

一句话：**编排、求和、校验边界都保持"自有表 + 自有代码"，只引入三个解决真实问题且不改变状态真相源的依赖——convex-helpers 的 customFunctions（鉴权入口）、rate-limiter（防滥用与全局吞吐）、migrations（上线后的数据演进）。**

## §1 需求与约束

### 1.1 来自任务书（00-brief §3）的硬核心

| 核心 | 对 Convex 内部选型的直接要求 |
| --- | --- |
| §3.1 私密委托 | 私密字段永不进入他方可调用 query 的返回值；鉴权与成员检查必须在每个公开函数里**不可遗漏**（→ C3a） |
| §3.2 代理只建议 | 编排层不得把"代理建议接受"迁移为审批；审批只有人类 mutation 能写（→ C1 不让编排框架持有状态） |
| §3.3 人批准具体版本 | 审批与约束版本、提案 id 绑定；编排框架的重试/重放不能产生新审批（→ C1） |
| §3.4 代码负责校验 | 金额、日期、范围在确定性代码里校验；validator 只管形状（→ C3b） |
| §3.5 执行幂等且原子 | 最后一票事务内重算 `committed + amount <= total`，必须读到 commitments 区间（→ C4）；重复点击、重试、并发不得重复写（→ C7 L2） |
| §3.6 历史不可篡改 | 提案/审批/承诺只追加；迁移不能改写历史语义（→ C5 只做"加可选字段/回填派生字段"） |
| §3.8 不伪造 | stub/模拟数据有标注；限流拒绝要给出真实原因码而非伪造进展（→ C2） |

### 1.2 来自 inputs/04 的平台事实（已据此推理，详见原文件）

1. 被调度的 mutation exactly-once 且自动重试；被调度的 action **at-most-once、不重试**；`cancel` 不能中止在途 action（04 要点 1，`NM:convex/src/server/scheduler.ts:37-40, 141-160`）。
2. 在 mutation 里写状态 + `runAfter(0, internal…)` 是唯一的原子"迁移 + 启动外部调用"（04 要点 2）。
3. 索引无唯一约束；唯一性靠单一写入口 + 索引查重 + OCC；convex-test 不模拟并发（04 要点 3、§1.12）。
4. 组件不支持 `"use node"`（04 §2.0）；组件有独立表与命名空间。
5. workflow handler 必须确定性，改代码让在途实例失败，单次执行步骤 I/O 合计 1 MB、日志 8 MiB（04 §2.1；`RL:_convex-dev_workflow.md` Limitations 节 834-855 行）。
6. 新事实（本代理 2026-10-24 查得，修正 04 §1.4"通常 10 分钟"）：Convex 默认运行时 action 上限 **30 分钟**，Node 运行时 action **10 分钟**；query/mutation 用户代码 1 秒；单事务扫描 32,000 文档、写 16,000 文档、读写各 16 MiB；单文档 1 MiB；单 mutation 最多调度 1000 个函数；单个调度参数 4 MiB（来源 https://docs.convex.dev/production/state/limits ，2026-10-24）。

### 1.3 规模假设（v1）

个位数并发房间；每个 run ≤ `maxRounds`=3 轮、每轮 ≤ 3 个 slot，每 run 逻辑调用上限 12（RL-DD D4）；每房间 commitments 条数 = 1 条 baseline + 每次执行 1 条，量级 < 100。所有选择以此为基准，扩展触发条件写在 §6。

## §2 候选方案表

| 子决策 | 候选 | 一句话描述 |
| --- | --- | --- |
| C1 编排 | A1 自建 scheduler 链 | mutation + `runAfter` + attempt 行 + watchdog mutation，状态全在自有表 |
| | A2 `@convex-dev/workpool` 0.4.14 | 队列 + `maxParallelism` + 可选重试 + `onComplete`（成功/失败/取消） |
| | A3 `@convex-dev/workflow` 0.4.10 | 持久化确定性工作流，`step.runAction`、`awaitEvent`、按步重试、可重启 |
| | A4 `@convex-dev/action-retrier` 0.3.1 | 单 action 指数退避重试 + `onComplete` |
| C2 限流 | B1 自有计数（RL-DD D4 原方案） | run 文档计数 + 按索引计数 + `usageCounters` 单行/日（热点，需自建分片） |
| | B2 `@convex-dev/rate-limiter` 0.4.2（全量） | 所有上限都放进组件 |
| | B3 B1 + B2 混合（推荐） | 业务上限留自有表；节流与全局吞吐/日上限进组件 |
| | B4 convex-helpers `server/rateLimit` | 旧版 helper，README 已指向组件 |
| C3 helpers | D1 convex-helpers customFunctions | 自定义 query/mutation 构造器，注入 `user/member/room` |
| | D2 手写 `requireUser()` / `requireMember()` 并在每个 handler 首行调用 | 零依赖，靠纪律 |
| | D3 convex-helpers `server/zod4`（`zCustomQuery/zCustomMutation`） | 用 Zod 写 args/returns，转成 Convex validator |
| | D4 convex-helpers `server/rowLevelSecurity` | 每文档 read/insert/modify 规则包装 `ctx.db` |
| | D5 convex-helpers `server/triggers` | 表写入时同事务回调 |
| C4 求和 | E1 区间 `.collect()` 求和 | 读 `commitments.by_roomId` 全部行 |
| | E2 `@convex-dev/aggregate` 0.3.4 | B-tree 维护 count/sum，按 namespace=roomId 查询 |
| | E3 rooms/budgets 上的计数字段 | 反规范化计数（IE-DD D7 已否决，F02.3） |
| C5 迁移 | F1 `@convex-dev/migrations` 0.3.7 | 在线分批、可恢复、dryRun、状态可查 |
| | F2 convex-helpers `server/migrations` | 旧版，需在 schema 加表，README 已指向组件 |
| | F3 手写 internalMutation + 分页游标 | 无依赖，自管断点与状态 |
| | F4 不迁移，reset + seed | 仅适用于无需保留数据的环境 |
| C6 定时 | G1 内建 `cronJobs()` | 静态声明，部署即生效 |
| | G2 `@convex-dev/crons` 0.2.3 | 运行时动态注册 cron（依赖 cron-parser） |
| | G3 每实体 `scheduler.runAt` | 精确到实体的定时事件 |
| C7 测试 | H1 convex-test 0.0.6x + Vitest | 进程内 TS 模拟后端 |
| | H2 本地开源 Convex backend | 真实后端二进制，CI 可跑 |
| | H3 云端 dev/集成部署 | 与生产同版本的真实部署 |
