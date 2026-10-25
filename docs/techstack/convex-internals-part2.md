# Convex 内部选型（第 2/3 部分：评估维度、推荐与理由）

> 分片清单见 `convex-internals.md`。版本/peer/发布时间均来自 2026-10-24 的 `npm view`（NPM）。已装基线：convex 1.48.0、react 19.3.1、next 16.4.3、zod 4.6.7、typescript 6.0.3（读自 `NM:<pkg>/package.json`）。

## §3 评估维度

"兼容"列 = 该包 peer 与已装基线的比对；Next 16 只与前端相关，组件全部运行在 Convex 部署内，不进入 Next 构建（rate-limiter 的 `./react` 子路径除外，本设计不用）。"最近发布"判断维护活跃度。"成熟度"对 0.x 一律视为 API 可能变。

| 候选 | 版本 / 最近发布 | peer 与兼容 | 许可证 | 学习成本 | 迁移成本（引入/退出） | 对核心不变量的影响 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 自建链 | — | 仅 convex 1.48 | — | 低（Convex 原语） | 引入≈`scheduleAttempt` + `turnWatchdog` + 退避约 80 行（RL-DD D1 估算）；退出到 A2 只改 `scheduleAttempt` | 状态唯一真相源 = `runs/agentTurns`；守卫 G0–G3 在自有 mutation |
| A2 workpool | 0.4.14 / 2026-10-10（近 3 月 5 次发布） | `convex ^1.36.1` ✓、`convex-helpers ^0.1.94` ✓（C3a 已引入）；依赖 `@convex-dev/batch-worker ^0.2.2` | Apache-2.0 | 中 | 引入：`convex.config.ts` + 组件注册 + `onComplete`；`maxParallelism` 是唯一不可替代的增量 | 需把 `onComplete` 作为 completeTurn 的入口；守卫不变；多一份 work 状态（组件表） |
| A3 workflow | 0.4.10 / 2026-10-10 | `convex ^1.46.0` ✓、`convex-helpers ^0.1.127` ✓、`@convex-dev/workpool ^0.4.4` | Apache-2.0 | 高（确定性重放、日志上限、版本纪律） | 引入：把 step 推进搬进 handler，`runs` 变工作流镜像；退出：重写编排层 | **出现第二份状态（工作流日志）**，与 `runs` 一致性需额外证明；改代码使在途实例失败 |
| A4 action-retrier | 0.3.1 / 2026-06-25（发布稀疏） | `convex ^1.24.8` ✓ | Apache-2.0 | 低 | 低 | 重试层与 SDK `maxRetries` 相乘（RL-DD D3 否决原因） |
| B1 自有计数 | — | — | — | 低 | 全局日计数是热点，需自写分片 | 计数与 run 同事务 ✓ |
| B2/B3 rate-limiter | 0.4.2 / 2026-10-10（9–10 月 5 次发布） | `convex ^1.43.0` ✓、`react ^18.2.0 \|\| ^19.0.0`（可选）✓；依赖 `@convex-dev/batch-worker 0.3.5` | Apache-2.0 | 低（`limit/check/reset`） | 引入：组件 + 一个 `rateLimiter.ts`；退出：换回 B1 计数，调用点不变 | 默认事务性：mutation 回滚则消耗回滚（`RL:_convex-dev_rate-limiter.md:49-50`）；fail closed；分片保证上界不被突破（同文件 "Scaling rate limiting with shards"） |
| D1 customFunctions | convex-helpers 0.1.129 / 2026-10-21；0.1.128 / 2026-10-08 | `convex ^1.46.0` ✓；`zod ^3.25 \|\| ^4`（可选）✓ 4.6.7；`typescript ^5.5 \|\| ^6 \|\| ^7`（可选）✓ 6.0.3；`react`（可选）✓ | Apache-2.0 | 低 | 引入一个文件；退出：把构造器内联成 `requireMember()` 调用 | **正向**：鉴权/成员检查变成"构造器默认行为"，漏写不可能通过 lint |
| D3 zod4 桥接 | 同上（`convex-helpers/server/zod4`） | 依赖 `zod/v4`、`zod/v4/core` 子路径 | Apache-2.0 | 中 | 退出要把每个函数 args 改回 `v.*` | `z.transform/intersection/custom` 退化为 `v.any()`；`returns` 用 Zod 解析时默认**剥离**多余字段而非报错，掩盖投影错误 |
| D4 RLS | 同上 | — | Apache-2.0 | 中 | 中 | 无表规则时默认 `allow`；行级规则不表达字段级披露；每文档规则带来额外读 → 读集变大 → OCC 冲突增多 |
| D5 Triggers | 同上 | — | Apache-2.0 | 中 | 中 | 隐式同事务写入，破坏"单一写入口"的可审计性（04 §1.6 推论③） |
| E1 区间求和 | — | — | — | 低 | 无 | 读集包含整个房间 commitments 区间 → 并发插入必然冲突重试（IE-DD 正确性论证依赖此点） |
| E2 aggregate | 0.3.4 / 2026-10-21（依赖**精确锁定** `convex-helpers 0.1.128`） | `convex ^1.43.0` ✓ | Apache-2.0 | 中 | 需对每个写入点同步更新聚合，已有数据要回填迁移 | 第二份真相源；"每次修改表都必须同步更新聚合"（`RL:_convex-dev_aggregate.md:273-275`），漏一处就静默错账 |
| F1 migrations | 0.3.7 / 2026-10-10 | `convex ^1.42.0` ✓、`convex-helpers ^0.1.115` ✓ | Apache-2.0 | 低 | 引入：组件 + `migrations.ts`；退出：删组件 | 分批在线，失败可从断点续跑，`dryRun` 跑一批后抛错（`RL:_convex-dev_migrations.md:209-217, 282-296`） |
| G1 内建 crons | convex 1.48.0 | — | Apache-2.0 | 低 | 无 | 静态、可审查；convex-test **不支持 cron**（需直接调用目标函数测试） |
| G2 crons 组件 | 0.2.3 / 2026-10-10；依赖 `cron-parser ^4.9.0` | `convex ^1.24.8` ✓ | Apache-2.0 | 中 | 低 | 动态注册 = 运行时状态，本系统无此需求 |
| H1 convex-test | 0.0.65 / 2026-10-23（10 月 5 次发布） | `convex ^1.43.0` ✓ | Apache-2.0 | 低 | — | 不模拟并发/OCC、不强制限额、不支持 cron（https://docs.convex.dev/testing/convex-test） |
| H2/H3 真实后端 | — | 与部署同版本 | — | 中 | — | 唯一能证明并发不变量的地方 |

## §4 推荐与理由

### 4.1 C1 编排：自建 scheduler 链（A1）

- **采纳 RL-DD D1 的决定，本代理复核后补两条理由**：
  1. 组件省下的只是"重试调度 + 看门狗"约 80 行；而"迟到结果拒收（G0–G3）、单活跃 run、私密上下文组装、用量记账"无论选哪条路都得自建（04 §2 含义 1）。
  2. 新事实：默认运行时 action 上限 30 分钟（limits 文档，2026-10-24），远大于一回合的 SDK 总预算，因此 watchdog 期限完全由 `TURN_BUDGET` 推导，不受平台上限挤压；若 Claude 调用被迫放入 `"use node"`（04 待验证 #4），上限变 10 分钟，`TURN_BUDGET` 的模块加载断言要以 `min(平台上限, …)` 为界。
- **接缝**：`scheduleAttempt(ctx, turnId)` 是唯一调用 `ctx.scheduler.runAfter` 启动回合的地方；`agentTurns.dispatchRef` 用中性名存调度 id（RL-DD D1a）。
- **workpool 升级触发条件**（任一出现即评估）：Anthropic 429 在 SDK 重试后仍成为 `api_error` 的主要来源且 C2 的全局每分钟桶不足以平滑；或看门狗/重试代码在生产出 ≥2 次缺陷。升级时**关闭组件重试**（保持 RL-DD D3 的单层重试），只用 `maxParallelism` + `onComplete`。

### 4.2 C2 限流：rate-limiter，范围收窄（B3）

调用点只在**已经要写库的 mutation** 里（startRun、retryTurn、createRoom、以及创建 attempt 行的内部 mutation），放在业务守卫之后、`insert` 之前；被拒绝时 `throw ConvexError({ code: "RATE_LIMITED", retryAfter })` 让整个事务回滚（含其他限流消耗）；全局日上限被拒绝时按 RL-DD D4 把 run 迁移为 `failed(global_daily_cap)`（这是一条写入，因此该限流调用必须是本事务最后一个限流调用，避免回滚前已消耗其他桶）。

```ts
// convex/lib/rateLimiter.ts（草案；数值待按账户速率限制定，04 待验证 #12）
import { RateLimiter, MINUTE, HOUR, DAY } from "@convex-dev/rate-limiter";
import { components } from "../_generated/api";
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  startRunPerUser:   { kind: "token bucket", rate: 10, period: HOUR, capacity: 3 },
  retryTurnPerUser:  { kind: "token bucket", rate: 20, period: HOUR, capacity: 5 },
  createRoomPerUser: { kind: "fixed window", rate: 20, period: DAY },
  modelRequestsGlobal:  { kind: "token bucket", rate: 40, period: MINUTE, shards: 4 },
  liveCallsGlobalDaily: { kind: "fixed window", rate: 2000, period: DAY, start: 0, shards: 8 },
});
```

- 理由：①threat model 需要"单个成员刷 startRun/Retry 烧钱"的防线，RL-DD D4 的每房间日上限挡不住"一人建很多房间"；②全局日计数是 RL-DD 自己标注的热点，组件已提供分片且保证不突破上界；③事务性与 fail-closed 与 §3.5 的"同事务"纪律一致。
- 不放进组件的：每 run `callCount`（run 状态机的一部分，UI 要显示）、每房间每日上限（按 `agentTurns` 索引计数，可审计）。不做按 token 计的限流（v1 由日调用上限 + Anthropic workspace 花费上限兜底；需要时加 `llmTokensGlobal` + `reserve`）。
- 不用 `applyUpdates: "asynchronously"`：它是最终一致的，会出现负余额（README "Avoiding contention with asynchronous updates"），与"上限是硬约束"不符。

### 4.3 C3a 统一鉴权：customFunctions（D1）

```ts
// convex/lib/functions.ts（草案）
import { customQuery, customMutation, customCtx } from "convex-helpers/server/customFunctions";
import { query, mutation } from "../_generated/server";
export const userQuery = customQuery(query, customCtx(async (ctx) => ({ user: await requireUser(ctx) })));
export const userMutation = customMutation(mutation, customCtx(async (ctx) => ({ user: await requireUser(ctx) })));
export const memberQuery = customQuery(query, {
  args: { roomId: v.id("rooms") },
  input: async (ctx, { roomId }) => {
    const user = await requireUser(ctx);                    // identity.tokenIdentifier → users.by_tokenIdentifier
    const member = await requireMember(ctx, roomId, user._id); // members.by_roomId_and_userId；非成员抛 FORBIDDEN
    return { ctx: { user, member }, args: { roomId } };    // 被消费的 roomId 是否需显式回传：待验证（读 customFunctions.ts 类型）
  },
});
// memberMutation 同形；internal* 不包装（被调度函数不依赖身份，显式传 actorUserId，04 §1 含义 7）
```

- 纪律：ESLint `no-restricted-imports` 禁止 `convex/lib/functions.ts` 以外的文件从 `_generated/server` 导入 `query`/`mutation`/`action`；公开函数必须写 `returns`（源码最佳实践，04 §1.1）；角色动作检查（`assertRole(member, "finance")`）仍在 handler 内显式调用，因为它是 07 动作矩阵的逐函数落点。
- 为什么用库而不是手写 D2：差别只在"漏写"能否被机器发现；构造器 + lint 让漏写变成编译/CI 错误。库代码量小、Apache-2.0、convex 官方组织维护，退出成本是一个文件。

### 4.4 C3b/C3c Zod 与 RLS：不在边界采用

- args/returns 用 `v.*`：它们是推送期契约与客户端类型来源；frontend-ia D-FE-03 依赖 `returns` 对多余字段的**报错**来抓投影错误，而 zod4 桥接在 Convex 校验前先用 Zod 解析、默认剥离多余字段（`server/zod4.ts` returns 处理，2026-10-24 读自 GitHub main）。
- Zod 的位置：`packages/engine` 的模型输出 schema、协议消息 schema，以及 handler 内 `parseCents()/parseIsoDate()` 等细化校验。注意 inputs/04 要点 16：SDK 的 `zodOutputFormat` 会把约束降级成描述，模型输出仍需 `safeParse`。
- RLS 不采用：本系统的私密性是**字段级**（披露矩阵），行级规则表达不了"provider 能看提案但不能看 finance 的 cap"；而且 `defaultPolicy` 默认 allow、内部函数绕过、每文档规则放大读集。替代：私密表（briefs）只能经 `privateBriefs.ts` 模块读取（lint 规则限制 `ctx.db.query("briefs")` 出现位置）+ 隐私金丝雀测试。

### 4.5 C4 求和：区间 `.collect()`

`getCommittedCents(ctx, roomId)` = `commitments.by_roomId` 全部行的 `amountCents` 求和。每房间 < 100 行，远低于单事务 32,000 文档扫描上限；读整个区间正是 IE-DD 依赖的冲突来源（并发执行/改预算必定冲突重试）。触发重评：单房间 commitments > 1,000 行或 `getTransactionMetrics()` 显示该读取占比 > 10%。

### 4.6 C5 迁移：migrations 组件，prod 前引入

- prod 上线前：schema 变化直接改 + dev/preview `reset`+`seed`（15-operations 的 seed 已标注 `simulated`）。
- prod 上线后：每次不兼容变更走 widen（加可选字段/放宽 union）→ `@convex-dev/migrations` 回填 → narrow；`dryRun` 先跑一批；只追加表（proposals、approvals、commitments、events）**只允许加派生字段，不改已有字段语义**（§3.6）。大表新索引用 `staged: true`（04 §1.6）。

### 4.7 C6 crons：内建，仅全局巡检

| cron | 周期 | 目标（internal） | 为何不是 runAt |
| --- | --- | --- | --- |
| `sweepStuckTurns` | 每 10 分钟 | 找 `running` 且超过 deadline + 宽限的回合 → 走与 watchdog 相同的 `failTurn` 路径 | watchdog 本身是被调度 mutation（exactly-once），此为纵深防御，防部署回滚丢调度等未知情况 |
| `checkExecutionInvariants` | 每小时 | IE-DD part4 的不变量巡检，违例写日志并告警 | 全局扫描，无对应实体 |
| `rollupDailyUsage` | 每日 UTC 00:10 | 汇总 `modelCalls` 到日报，算 `watchdogFailRate/invalidOutputRate` 告警 | 全局 |
| `expireBackstop` | 每小时 | 关闭已过 `expiresAt` 但未被 runAt 关闭的邀请/人工请求/报价 | 主路径是确认时 `runAt`（scenario-plugin 设计），这里只兜底 |

### 4.8 C7 测试分工

| 层 | 工具 | 负责 | 不负责 |
| --- | --- | --- | --- |
| L1 | convex-test（`convexTest(schema, modules)`、`t.withIdentity`、`vi.useFakeTimers` + `t.finishAllScheduledFunctions(vi.runAllTimers)`、`t.registerComponent` / 各组件 `./test` 导出） + Vitest 4 `edge-runtime` | 状态机迁移、customFunctions 鉴权、逐 query 披露、调度链与 watchdog、过期拒收、`[serial]` 幂等、rate-limiter 调用点（拒绝即回滚） | 并发/OCC、限额、cron、默认运行时打包、真实错误消息 |
| L2 | 云端 dev 部署（每开发者一个）+ 集成部署；本地开源 backend 作 CI 备选 | 并发同键 mutation（审批、执行、唯一性）、rate-limiter 分片上界、SDK 在默认运行时打包与长请求、crons 实际触发、`getTransactionMetrics` | 时间控制、mock（本地 backend 同样不能控时间/mock fetch，https://docs.convex.dev/testing/convex-backend） |

convex-test 版本下限 0.0.63：0.0.55 起支持 `v.commitTs()`/`db.vars.commitTs`，0.0.58 起 `getRequestMetadata`，0.0.61 起 `defineTestApp`，0.0.62 起 `registerComponent` 返回带类型引用，0.0.63 起每个函数内固定 `Date.now()`（https://raw.githubusercontent.com/get-convex/convex-test/main/CHANGELOG.md ，2026-10-24）。
