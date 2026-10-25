# 整体栈复核与退出策略（第 3/4 部分）

> 本文件：§6 风险与退出策略、§7 如何验证。来源列表见 part4。

## 6. 风险与退出策略

### 6.0 风险登记

| # | 风险 | 影响 | 缓解 |
| --- | --- | --- | --- |
| K1 | 无唯一约束：有人绕过单一写入口直接 `insert` | §3-5 双重承诺 | 不变量表列出"表 × 唯一键 × 唯一写入口"；ESLint `no-restricted-syntax` 禁止在入口模块以外对 `approvals/executions/agentRuns` 调用 `ctx.db.insert`；V1 并发测试进 CI |
| K2 | OCC 在并发插入同一索引区间时的行为与预期不符（PC-7 待验证 #2） | 同 K1 | V1 在本地后端与云 dev 都跑；若不成立，退化为"按键的锁文档"：先 patch 一个固定 id 的计数 / 锁文档，强制读写冲突 |
| K3 | convex-test 不模拟并发，测试给出虚假信心 | 幂等缺陷漏测 | 测试分层：convex-test 只负责确定性逻辑；并发与幂等单列真部署脚本 |
| K4 | 价格或条款变化；Free 档无备份 | 成本、数据安全 | 生产环境开 Pro（每日备份、流式导出）；每周 `npx convex export` 冷备份到自有存储；L0 / L1 演练（V5、V6） |
| K5 | 业务状态被 Convex 组件（workflow 日志、agent 线程）持有 | 迁出时无法导出语义完整的状态 | 不用组件保存业务状态（与 candidates2/minimal ADR-03 一致）；所有状态在自有表 |
| K6 | 平台 API 渗入领域层（`ctx`、`Id<>`、`_generated` 出现在引擎里） | L1 重写面扩大 | §6.1 纪律 + V7 静态检查 |
| K7 | 自托管不是"免运维"：升级、admin key、面板、资源（社区模板称 2–4 vCPU、4 GB+，S11，二手） | L0 退路比想象中贵 | 一年至少一次 L0 演练；文档记录版本与升级步骤 |
| K8 | FSL 许可证：只禁止"竞争性使用"（把 Convex 当作替代品卖给他人） | 本系统为内部使用，不触发；若将来把引擎作为 BaaS 出售需复核 | 18-decisions 记录；法务复核留作开放问题 |
| K9 | Clerk 锁定 | 用户身份迁移 | 内部 `users` 以 `tokenIdentifier`（`iss`+`sub`）为键（PC-2 §1.7）；角色只在应用表；换 IdP 时做一次 `sub` 映射 |
| K10 | 默认运行时调用 Anthropic SDK 的长请求行为未验证（PC-7 待验证 #4） | R3 | V4；不行就改放 `"use node"` 文件（上限变为 10 分钟，S4） |

### 6.1 可迁出纪律（从第一天执行，几乎零成本）

1. **引擎与场景纯函数化**：`convex/engine/**`、`convex/scenarios/**` 不导入 `_generated`、`convex/server`、不接收 `ctx`；只依赖 zod、`convex/values` 的类型（与 candidates2/minimal/11-architecture §2 的依赖方向一致）。
2. **"决策返回写计划"**：状态迁移函数形如 `decideApproval(state, input) → { ok, reasonCode, writes: WritePlan[], events: EventDraft[] }`；Convex mutation 只做"加载 → decide → 按写计划落库"。换平台时只重写"按写计划落库"的适配器（在 Postgres 里放进一个事务）。
3. **业务键显式化**：幂等键、执行键、`proposalVersion`、`constraintVersion` 都是普通字段，不靠 `_id` 或 `_creationTime` 表达语义；`_id` 只当不透明字符串引用，迁移时原样作为 `text` 主键，不需要重映射。
4. **金额为整数分**（`v.number()` 且 `Number.isSafeInteger`，PC-2 §1.8），迁移为 `bigint`；日期为 ISO 字符串或毫秒数，不用平台特有类型。
5. **事件表只追加 + `commitTs`**：迁移为 `bigint` 列并按原值排序，历史顺序可保持。
6. **唯一性不变量清单与 03-schema 同步维护**：每一行在 Postgres 里直接变成 `UNIQUE` 约束；导入时由数据库替你复核历史数据。
7. **Claude 调用封装在 `engine/model`**：只依赖 @anthropic-ai/sdk（Apache-2.0，与运行时无关），传入 transport / clock，任何 Node 环境都能运行。
8. **前端数据钩子集中**：页面只用 `useRoomView()` 一类自有 hook，内部才调用 `useQuery`；L1 时换成 TanStack Query + 失效订阅，页面不动。

### 6.2 若必须离开 Convex（L1）：模块分类

| 类别 | 模块 | 迁移动作 |
| --- | --- | --- |
| 直接带走 | 状态机迁移表与守卫、规则引擎与 `reasonCode`、金额 / 日期工具、披露投影函数、代理上下文组装、对他方可见文本模板、Zod 协议 schema、场景插件（目录、约束、规则、fixture）、Claude 调用封装、展示型 React 组件、Clerk 前端组件 | 零改动或只改导入路径；纯函数单测原样运行 |
| 改适配层 | Convex query / mutation 外壳 → tRPC procedure 或 Route Handler；`schema.ts` → SQL DDL（`v.string`→`text`、`v.number`(分)→`bigint`、`v.id`→`text` 外键、判别联合→`kind` 列 + `jsonb` 或子表、`v.commitTs`→`bigint`）；`auth.config.ts` → Clerk `verifyToken` 中间件（`CLK:server/index.d.ts` 已导出）；自有数据 hook 的内部实现 | 机械翻译，按写计划适配器统一落库 |
| 要重写 | 实时层（订阅 → outbox / LISTEN-NOTIFY / Broadcast 推失效信号 + 重新拉投影）；调度、重试、watchdog（`ctx.scheduler` → pg-boss / graphile-worker 或 Supabase Cron + Queues）；并发控制（OCC 自动重试 → 显式事务 + `FOR UPDATE` 或 SERIALIZABLE 重试）；convex-test 测试 → testcontainers 集成测试；运维（环境变量、部署、备份） | 这是 L1 的主要工作量；纯函数化越彻底，这部分越薄 |

### 6.3 数据导出方式

1. **快照导出（所有计划）**：`npx convex export --prod --path snapshot.zip [--include-file-storage]`（`CVX:cli/convexExport.ts`）。ZIP 内每张表一个目录、内含 `<table>/documents.jsonl`（`CVX:cli/lib/command.ts:518`）。用一个只读转换脚本把 JSONL 转成 `COPY` 输入。
2. **流式导出（Pro 及以上）**：用于不停机的增量同步与切换（S5、S6）；也可以给报表或数据仓库供数，避免为了 SQL 报表而换主库。
3. **导入**：`npx convex import`，支持 `append` / `replace` / `--replace-all` 模式（`CVX:cli/lib/convexImport.ts:102-104`、`command.ts:490-499`）。这是 L0（云 → 自托管）的路径。自托管后端以 Postgres 作存储时，表内是 Convex 的内部格式而非关系表，不能当 L1 的目标库直接查询（待验证）。
4. **切换流程（L1）**：①打开维护开关（`ops` 表一个标志，所有写 mutation 先检查并拒绝）；②导出快照；③转换并导入 Postgres，`UNIQUE` 与外键约束在导入时复核；④核对各表行数和不变量查询（每版本每人审批 ≤1、每执行键执行 ≤1）；⑤切换 `NEXT_PUBLIC_*` 并按环境重新构建（构建期内联，PC-7 §5.3）；⑥保留只读的 Convex 部署 30 天作对照。

### 6.4 触发离开的条件（任一满足时再评估）

价格或条款对预计规模不可接受；合规要求数据驻留在自管环境（→ 先选 L0）；出现主库级 SQL 报表需求且流式导出不够用；Convex 停止维护某个依赖的能力（→ L1）。

## 7. 如何验证（可执行步骤）

| # | 验证什么 | 步骤 | 通过标准 |
| --- | --- | --- | --- |
| V1 | OCC 唯一性（K1 / K2） | 新仓库 `npx convex dev --local`；写 `scripts/concurrency-check.ts`：用 `ConvexHttpClient` 以同一 `(proposalVersionId, seatId)` 并行发起 50 次 `approvals.record`，同一 `executionKey` 并行发起 50 次 `executions.commit`；对云 dev 部署重跑 | 每个键恰好 1 行；其余调用返回幂等结果而非报错；记录 OCC 重试耗尽时的报错形态 |
| V2 | 三窗口同步 | Playwright 三个浏览器上下文（三个 Clerk 测试用户）打开同一房间；finance 下调预算；记录三个窗口出现 Blocked 的时间戳 | 三个窗口都在 5 秒内翻转，无刷新；同一窗口内各订阅不出现新旧混合状态 |
| V3 | 投影无泄露 | 私密简报写入唯一金丝雀串；Playwright `page.on("websocket")` 记录全部帧，并抓取 RSC payload；以另外两方身份走完一轮协商 | 金丝雀串在他方的任何帧和 payload 中出现 0 次 |
| V4 | 默认运行时调用 Claude | 部署最小 action（显式 `apiKey`）调用一次 `claude-opus-5-5`，分别在默认运行时与 `"use node"` 下各跑 10 次 | 能打包、能完成；P95 耗时低于所选运行时上限（30 / 10 分钟）并留出余量 |
| V5 | 导出往返演练 | `npx convex export --path ./snap.zip --include-file-storage` → `unzip -l snap.zip` 核对目录结构 → 转换脚本导入本地 Postgres（docker）并建立 `UNIQUE` → 对比行数 | 行数一致；唯一约束无冲突；事件按 `commitTs` 排序的结果与 Convex 一致 |
| V6 | L0 自托管演练 | 按 convex-backend `self-hosted/README.md` 用 docker compose 启动（Postgres 存储）→ `generate_admin_key.sh` → 设 `CONVEX_SELF_HOSTED_URL` / `CONVEX_SELF_HOSTED_ADMIN_KEY` → `npx convex deploy` → `npx convex import snap.zip` → 跑 e2e | e2e 全绿；记录所需资源与 CLI 不支持的命令 |
| V7 | 纯函数边界 | ESLint `no-restricted-imports`：`convex/engine/**`、`convex/scenarios/**` 禁止导入 `**/_generated/**`、`convex/server`；在纯 Node 下运行 vitest（不启动 Convex） | lint 0 违例；引擎单测在无 Convex 环境通过 |
| V8 | 版本 / 兼容 / 许可证复核 | `npm view convex version license peerDependencies`；`npm view @clerk/nextjs peerDependencies`；`npm view @anthropic-ai/sdk version`；读 convex-backend `LICENSE.md` | 与本文 §2、§3.2 记录一致；不一致则更新本文 |

