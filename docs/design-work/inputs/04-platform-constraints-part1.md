# 04 平台约束与推荐模式（第 1/7 部分）

## 分片清单

| 分片 | 内容 |
| --- | --- |
| 04-platform-constraints.md | 索引与 20 条要点速查 |
| part1（本文件） | 约定；§1 Convex：函数类型、运行时、事务与 OCC、action、调度器 |
| part2 | §1 Convex：唯一性、认证、validator、查询与分页、1.48 新能力、客户端语义、convex-test、对设计的直接含义 |
| part3 | §2 Convex 官方组件与"自建 scheduler 链 vs 组件"比较表 |
| part4 | §3 Clerk 7.9 + convex/react-clerk + Next 16 proxy |
| part5 | §4 Claude（上）：模型、thinking/effort、被禁参数、结构化输出（含 SDK 实测） |
| part6 | §4 Claude（下）：stop_reason、超时与重试、缓存与中途 system 消息、用量、流式、成本；§4 对设计的直接含义 |
| part7 | §5 Next 16 + React 19 及其含义；待验证总表（17 条） |

## 约定

- 引用缩写：`NM:` = `/Users/zhennn/cal-hack-2026-main/node_modules/`；`CVX:` = `NM:convex/src/`；`SDK:` = `NM:@anthropic-ai/sdk/`；`CLK:` = `NM:@clerk/nextjs/dist/types/`；`NXD:` = `NM:next/dist/docs/01-app/`；`SK:` = `/private/tmp/claude-501/bundled-skills/2.1.308/024617f944dd2690a4dfb433093d80da/claude-api/`；`ORIG:` = `/Users/zhennn/cal-hack-2026-main/`；`PROBE:` = 本代理在 scratchpad 中运行的只读探针（不改任何仓库）。
- 版本基线（`ORIG:package.json`）：convex 1.48.0、@clerk/nextjs 7.9.20（解析到 @clerk/backend 3.26.2、@clerk/react 6.18.1）、next 16.4.3、react 19.3.1、@anthropic-ai/sdk 1.1.0、zod 4.6.7、typescript 6.0.3、Node >=24.19。
- 可信度标记："源码"= 读自已安装包源码/类型；"文档"= 读自技能文件或包内文档；"待验证"= 本地无证据，实现前必须用最小实验确认。

---

## §1 Convex 1.48.0（上）

### 1.1 函数类型、可见性、_generated

- query 只读且响应式；mutation 读写且事务化；action 可做外部 I/O，但没有 `ctx.db`，只能经 `ctx.runQuery` / `ctx.runMutation` 读写（源码 `CVX:server/registration.ts:86, 292, 322`）。
- `internalQuery` / `internalMutation` / `internalAction` 不暴露给客户端，只能被其他函数（`ctx.run*`）或调度器调用（源码 `CVX:server/impl/registration_impl.ts:305, 475, 656` 及其上方注释）。
- `_generated/server` 导出 `query/internalQuery/mutation/internalMutation/action/internalAction/httpAction` 与 `QueryCtx/MutationCtx/ActionCtx/DatabaseReader/DatabaseWriter`，并新增类型化的 `env`（平台变量 `CONVEX_CLOUD_URL`、`CONVEX_SITE_URL` + 在 `convex.config.ts` 声明的变量）；`_generated/api` 导出 `api`、`internal`（源码 `CVX:cli/codegen_templates/server.ts:4-71, 102-213`；`api.ts:113-114`）。`convex.config.ts` 中声明环境变量的具体语法：待验证。
- 原仓库尚无 `convex/_generated`，用的是 `queryGeneric`（`ORIG:convex/health.ts`）。新仓库需先跑 `npx convex dev` 生成代码；无部署时能否单独 codegen：待验证。
- 源码注释的最佳实践：所有公开 mutation 必须声明 `args` 与 `returns` validator（`registration_impl.ts:226-229`）；mutation 必须确定性、不能 `fetch`（`registration_impl.ts:231-232`）。
- 1.48 中 mutation 内也有 `ctx.runQuery`（同一事务、同一快照）与 `ctx.runMutation`（子事务，抛错则其写入回滚）；两者都有参数校验与新隔离上下文的开销，源码建议优先用普通 helper 函数（`registration.ts:123-166`）。
- 数据库 API 推荐"表名在前"的新签名：`ctx.db.get/patch/replace/delete("table", id, ...)`，旧签名保留兼容（`CVX:server/database.ts:197-206, 287, 335`）。

### 1.2 运行时："use node" vs 默认 isolate

- 默认运行时支持 `fetch` 与大部分 npm 包；`"use node"` 是最后手段：冷启动更慢，且该文件**只能定义 action**，不能有 query/mutation（源码 `registration_impl.ts:566-572, 645-648`）。
- 打包方式：默认运行时入口用 esbuild `platform: "browser"` 打包，Node 入口单独打包（源码 `CVX:cli/lib/config.ts:633-657`）；默认运行时文件里用到 Node API 会构建失败并提示拆到 `"use node"` 文件（`CVX:bundler/index.ts:157-176`）。
- @anthropic-ai/sdk 1.1.0 只在 `internal/node.js` 引用 Node 内置模块，且 package.json 的 `browser` 字段把它替换成 `node.browser.js`（源码 `SDK:package.json:41-48`、`SDK:internal/node.js:1-10`）；凭据链只在需要读本地 profile 文件时才动态引入它（`SDK:lib/credentials/credential-chain.js:201`）。推论：显式传 `apiKey` 时 SDK 可在默认运行时打包。**默认运行时中长连接/流式请求的实际行为：待验证**；退路是把调用 Claude 的 action 放进 `"use node"` 文件。

### 1.3 Mutation 的事务与 OCC

- 单个 mutation 内的全部读写原子提交（源码 `registration.ts:86`；`database.ts:396-399` 指向 OCC 说明）。
- 并发控制是乐观的（OCC）：两个事务读写集冲突时，后提交者被回滚并由 Convex 自动重试（文档：workflow README "rollbacks due to database conflicts, which are automatically retried"；workpool README "write conflicts (aka OCC errors)"，见 part3）。持续冲突的重试次数与最终报错形态：待验证。
- 含义：mutation handler 可能被执行多次，所以必须无外部副作用（确定性约束保证了这一点）；热点文档（例如每次都改 `rooms.updatedAt` 或计数器）会放大冲突概率。
- 事务限额：本地源码没有具体数值（文档地址 `docs.convex.dev/production/state/limits`，数值待验证）。运行时可用 `ctx.meta.getTransactionMetrics()` 读剩余额度（`CVX:server/meta.ts:150`），嵌套调用可用 `transactionLimits` 只降不升地收紧限额（`meta.ts:33-54`）。

### 1.4 Action：非事务

- 每次 `ctx.runQuery` / `ctx.runMutation` 都是独立事务（源码 `registration.ts:331, 355`；`registration_impl.ts:560-564` 明确建议减少调用次数、避免竞态）。所以"action 读 → 调外部 → action 写"之间状态可能已变，最终写入的 mutation 必须重新校验前置条件（版本号比对 / compare-and-set）。
- `ctx.runAction` 只应用于跨运行时（默认 → `"use node"`），否则抽成普通函数（`registration.ts:376-391`）。
- 客户端直接调用 action 的风险：WebSocket 重连时在途 action 直接判失败（"Connection lost while action was in flight"）且不重发；在途 mutation 则会安全重发（源码 `CVX:browser/sync/request_manager.ts:205-224`）。
- action 的最长运行时间：本地源码无数值，待验证（Convex 文档通常写 10 分钟）。

### 1.5 调度器 `ctx.scheduler`

| 项 | 语义 | 引用 |
| --- | --- | --- |
| `runAfter(delayMs, fn, args)` / `runAt(ts, fn, args)` | 返回 `Id<"_scheduled_functions">`；`delayMs` 必须非负，0 表示调度方完成后立即到期；`runAt` 的时间戳不能超出前后 5 年 | `CVX:server/scheduler.ts:93-127` |
| 在 mutation 内调度 | 随 mutation 提交才生效（示例注释 "Run immediately after this mutation commits"）；mutation 回滚则调度不存在 | `scheduler.ts:57`、`registration.ts:114` |
| 在 action 内调度 | 调用即登记，不会因 action 后续失败而撤销：待验证 | — |
| 被调度的 mutation | **exactly once**，瞬时错误自动重试 | `scheduler.ts:37-38` |
| 被调度的 action | **at most once**，不重试，可能因瞬时错误失败 | `scheduler.ts:39-40` |
| `cancel(id)` | action 未开始则不运行；已在运行则继续跑完，但它新调度的函数会被取消；已完成则 `cancel` 抛错；对 mutation 的取消是原子的（要么取消成功，要么它已提交） | `scheduler.ts:141-160` |
| 查询状态 | `ctx.db.system.get("_scheduled_functions", id)`；`state.kind ∈ pending / inProgress / success / failed{error} / canceled`，另有 `scheduledTime`、`completedTime`、`name`、`args` | `database.ts:150-163`；`schema.ts:1134-1146` |
| 调用链追踪 | `ctx.meta.getRequestMetadata().scheduledFunctionId` 沿调用树向下传播（被调度 action 里再 `runMutation` 也能拿到） | `meta.ts:113-124, 200, 226` |
| 可见性建议 | 被调度的函数用 `internal*`，防止客户端直接调用 | `scheduler.ts:42-43` |

要点：
1. "mutation 写状态 + 同事务 `runAfter(0, internal.x.action)`"是把"状态迁移"和"启动外部调用"绑在一起的唯一原子方式。
2. action 不重试，因此 action 被平台中断（超时、重启）时没有任何回调。需要一个独立的 `runAfter(deadline, internal.x.watchdog)` mutation（exactly once）来把超时的运行标记为失败。
3. 重试要自己做：action 失败时在 catch 中 `runMutation` 记录失败并调度下一次尝试；若 action 进程整体丢失，只能靠 watchdog 发现。
4. `cancel` 不能中止在途 action；对在途 action 只能让它的最终写入在 mutation 里因"运行已作废/版本不匹配"被拒绝（过期拒绝）。
