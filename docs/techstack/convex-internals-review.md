# 反驳审查：Convex 内部选型（convex-internals.md / part2 / part3）

> 审查代理，2026-10-24。核对方式：自行重跑 `npm view <pkg>@<ver> version license peerDependencies peerDependenciesMeta dependencies exports time`（缓存 `scratchpad/techstack/.npm`）、读 `/Users/zhennn/cal-hack-2026-main/node_modules`（下称 `NM:`）、读 README 存档（`scratchpad/techstack-readmes/`，下称 `RL:`）、抓取官方文档与 GitHub main 源码。两个源仓库只读，未安装任何包。

## 0 结论

**verdict：accept_with_changes。** C1（自建 scheduler 链）、C3a（customFunctions）、C3b/C3c（边界不用 Zod、不用 RLS/Triggers）、C4（区间求和）、C6（内建 crons）、C7（L1/L2 分工）都站得住，版本与 peer 声明基本属实。必须改的集中在 **C2 限流**：它和 model-layer 的 `spendCounters`、run-lifecycle 审查 r12 冲突，上限层数过多；事务内的限流顺序推理是反的；被调度 mutation 里 throw 会让调度链断掉。另有一处平台事实错误（R1 的降级代价），以及测试工具版本没有精确锁定。

## 1 逐条核对作者的待验证声明

| # | 声明 | 结果 | 证据（2026-10-24） |
| --- | --- | --- | --- |
| 1 | rate-limiter 0.4.2：Apache-2.0，peer convex ^1.43.0、react 可选，依赖 batch-worker 0.3.5，2026-10-10 发布 | ✓ | `npm view @convex-dev/rate-limiter@0.4.2`；`peerDependenciesMeta.react.optional=true`；time 0.4.2=2026-10-10。补充：batch-worker 本身是组件，rate-limiter 的 `convex.config.ts` 调用了 `component.use(batchWorker)`（github.com/get-convex/rate-limiter `src/component/convex.config.ts`） |
| 2 | convex-helpers 0.1.129（10-21）/0.1.128（10-08）：Apache-2.0，peer convex ^1.46.0，zod、typescript、react 可选 | ✓ | 两版 peer 相同；另有 `hono ^4.0.5`、`@standard-schema/spec ^1.0.0` 两个可选 peer，原文没列，不影响结论 |
| 3 | workflow 0.4.10 peer | ✓ | convex ^1.46.0、convex-helpers ^0.1.127、workpool ^0.4.4；依赖 async-channel ^0.2.0 |
| 4 | workpool 0.4.14 peer/依赖 | ✓ | convex ^1.36.1、convex-helpers ^0.1.94；batch-worker ^0.2.2 |
| 5 | action-retrier 0.3.1，peer convex ^1.24.8，2026-06-25 | ✓ | 过去 12 个月只有 0.3.0（2025-11-11）和 0.3.1 两次发布 |
| 6 | aggregate 0.3.4 精确锁定 convex-helpers 0.1.128 | ✓ | 另外还精确锁定了 `@convex-dev/batch-worker 0.3.3` |
| 7 | migrations 0.3.7 peer | ✓ | convex ^1.42.0、convex-helpers ^0.1.115 |
| 8 | crons 0.2.3 依赖 cron-parser ^4.9.0 | ✓ | — |
| 9 | convex-test 0.0.65 peer ^1.43.0 与 CHANGELOG 各版本特性 | ✓（措辞小差） | raw.githubusercontent.com/get-convex/convex-test/main/CHANGELOG.md：0.0.55 commitTs、0.0.62 typed registerComponent、0.0.63 每个 query/mutation 内 **pin** `Date.now()`、0.0.65 signJwt。`getRequestMetadata` 在 0.0.58 与 0.0.59 都有条目 |
| 10 | convex 1.48.0 于 2026-10-22 发布，Apache-2.0 | ✓ | `npm view convex time`；`NM:convex/package.json` 版本为 1.48.0 |
| 11 | @edge-runtime/vm 最新 5.0.0，vitest 最新 5.0.5；vitest 5 是否兼容需复核 | ✓（兼容性未证实） | vitest dist-tags：latest 5.0.5、V4 4.1.12。convex-test 文档只给出 Vitest 4 `projects` 写法和 Vitest 3 写法，CHANGELOG 没有提到 Vitest 5，convex-test 自己的 devDependencies 用的是 vitest 1.6.1。@edge-runtime/vm 5.0.0 发布于 **2024-12-02**，之后再无新版本 |
| 12 | limits：默认运行时 action 30 分钟、Node 10 分钟、扫描 32k、写 16k、读写各 16 MiB、文档 1 MiB、调度 1000 个 | ✓ | docs.convex.dev/production/state/limits 原表；另有 query/mutation 1 秒、调度参数 4 MiB。确实修正了 inputs/04 part1:54 与 part6:22 的"通常 10 分钟" |
| 13 | convex-test 不支持 cron、不强制 size/time 限额 | ✓ | docs.convex.dev/testing/convex-test 的 Limitations 节 |
| 14 | rate-limiter README：事务性、fail closed、分片不突破上界、async 模式最终一致且可出现负余额、fixed window 可设 `start` | ✓ | `RL:_convex-dev_rate-limiter.md:49-54, 266-306, 308-336, 402-405`；GitHub main `src/shared.ts` 写的是 `config.start ?? now - random`，所以 `start: 0` 不会被当成未设置（main 分支，0.4.2 里是否相同待验证） |
| 15 | zod4 桥接的 returns 先跑 Zod `parseAsync` 再交给 Convex 校验，`z.object` 默认剥离多余字段 | ✓ | GitHub main `server/zod4.ts`：`returns.parseAsync(...)` 加 `zodOutputToConvex(returns)`。本地用 `NM:zod` 4.6.7 实测，`z.object({a}).parse({a,secret})` 返回 `{"a":"x"}` |
| 16 | 所有 @convex-dev 组件都导出 `./test` | ✓ | rate-limiter、workflow、workpool、action-retrier、aggregate、migrations、crons、batch-worker 的 `exports` 里都有 `./test`；rate-limiter 的 `src/test.ts` 会顺带注册子组件 `rateLimiter/batchWorker` |
| 17 | workpool：在途 attempt 跑完自己的结果；与 cancel 竞争时仍可能报 success；从 Dashboard 直接取消算 failure | ✓ | `RL:_convex-dev_workpool.md:161-170`。原文还有半句"and can trigger retries instead"，备忘录漏了 |
| — | §4.3 待验证："被 customization 消费的 roomId 要不要显式回传" | 已证实：要 | GitHub main `server/customFunctions.ts`：`omit(allArgs, keys(inputArgs))` 之后 `{...args, ...added.args}`。草案返回 `args: { roomId }`，写法正确；`returns` 会透传；`internalQuery` 也能作为 base |

## 2 被推翻或需要更正的声明

1. **R1"降到 1.47.x 要放弃 `v.commitTs` 和 mutation 内 `runQuery`（1.48 新增）"不成立。** `NM:convex/CHANGELOG.md`：`v.commitTs()` 和 `ctx.db.vars.commitTs` 在 **1.43.0** 加入（152-168 行）；mutation 里的 `ctx.runQuery/runMutation` 在 1.18.0 的条目里已经是推荐写法（1088-1100 行）；`ctx.meta` 在 1.36.0 加入（342-345 行）。1.48.0 真正新增的只有 `ctx.auth.signJwt` 和 mutation 内的 `ctx.storage.store/get`（3-25 行）。这个错误是从 inputs/04 要点 7 继承来的，两处都要改。
2. **H1 行把"不模拟并发/OCC"归给 convex-test 文档，归属不对。** 该文档的 Limitations 只列了错误消息、限额、ID 格式、Edge Runtime 差异、文本/向量搜索和 cron，没有提到并发。这条应改为引用 inputs/04 §1.12（待验证）。
3. **§5 A4 说"README 要求被重试的 action 幂等"，在 action-retrier README 里找不到。** 幂等要求出自 workpool README 的 Idempotency 节（`RL:_convex-dev_workpool.md:172-191`）。否决 A4 的结论不受影响。
4. **§4.2"全局日上限必须是本事务最后一个限流调用，以免回滚前已消耗其他桶"，推理反了。** 见 r02。
5. **C2 的前提"替代 RL-DD D4 的 `usageCounters` 热点"已经过时。** `design/deepdives/run-lifecycle-review-part2.md:25-29`（r12）已经决定 v1 删掉全局日计数。`techstack/model-layer.md:73,262-263,293` 另外选了 `spendCounters`（按 run/room/global 预留美元），并明确否决 rate-limiter（F2）。见 r01。

## 3 问题清单

### r01 [high] C2 与 model-layer、run-lifecycle 审查冲突，上限层数过多
- **证据**：把三份文档合在一起，v1 会同时存在这些上限：每 run `callCount`（RL-DD D4）、每 run 24 个 attempt（model-layer:263）、每房间日调用数（RL-DD D4）、每房间日美元 `SPEND_CAP_ROOM_DAY_USD`、全局日调用 `liveCallsGlobalDaily`（本备忘录）、全局日美元 `SPEND_CAP_GLOBAL_DAY_USD`、全局每分钟 `modelRequestsGlobal`（本备忘录），再加 Console 消费上限，共 8 层，并且分布在 3 个真相源里。r12 删掉全局日计数，理由是"v1 个位数房间用不上，且与 Console 上限重复"；model-layer F2 的意见是"用户触发频率限流可以以后单独引入"。
- **修正**：C2 只保留每用户节流（`startRunPerUser`、`retryTurnPerUser`、`createRoomPerUser`）。删掉 `liveCallsGlobalDaily`，全局日封顶交给 model-layer 的 global spend 行或 Console。`modelRequestsGlobal` 推迟引入，触发条件是 429 观测数据（与 model-layer R9 合并）。和 model-layer 一起出一张"上限落点表"写进 10-agent-runtime。更简单的替代方案也要写进候选表：用 `runs.by_startedBy_and_creationTime` / `rooms.by_createdBy` 的索引计数做每用户节流，零依赖、在同一事务里、可审计。它只比组件少了 token bucket 的平滑，v1 用不着平滑。

### r02 [medium] 事务内限流顺序写反了
- **证据**：README 说"all rate limit changes will roll back if your mutation fails"，反过来说，事务提交时所有消耗都会一起提交。全局日上限被拒绝后要提交 `failed(global_daily_cap)` 写入；如果它是最后一个调用，前面 `limit()` 成功消耗的每用户桶和每分钟桶会随这次写入一起提交，正好是作者想避免的情况。
- **修正**：被拒绝后仍要提交写入的限流调用必须排在**最前**；或者先对所有桶调用 `check()`，全部通过后再逐个 `limit()`。只有"拒绝即 throw"的限流才可以放在后面。§7 步骤 5 增加对应用例。

### r03 [medium] 在被调度的内部 mutation 里 throw `RATE_LIMITED` 会让调度链断掉
- **证据**：§4.2 把限流放进"创建 attempt 行的内部 mutation"，并统一要求拒绝时 throw。被调度的 mutation 只对平台内部错误和 OCC 自动重试（inputs/04 要点 1），用户代码抛出的错误会让这次调度失败、不会重试，run 会卡在中间态，直到 `sweepStuckTurns`（每 10 分钟一次）才被清理，而且结局是 failed，不是延后执行。README 的 `reserve` 示例给出的正确做法是：拿到 `retryAfter` 后 `scheduler.runAfter(retryAfter, …)`（`RL:…rate-limiter.md:352-385`）。
- **修正**：内部路径一律用返回值（`ok:false`），或者用 `reserve: true` 然后 `runAfter(retryAfter)`，并写一条 `deferred(rate_limited)` 事件；throw 只用在面向用户的公开 mutation。如果按 r01 删掉全局桶，这条问题随之消失。

### r04 [medium] R1 降级代价与 1.48 依赖点写错
- **证据**：见 §2 第 1 条。
- **修正**：R1 改为"回退到 1.47 只会失去 `ctx.auth.signJwt` 和 mutation 内的 storage；回退到 1.46 还会失去 `defineTable().staged()`（1.47 加入，CHANGELOG 48-59 行）"。03-schema 不需要为 `v.commitTs` 标注 1.48 依赖。同时通知 inputs/04 的维护者更正要点 7。

### r05 [medium] 测试工具版本没有精确锁定，与 ≥2 周纪律自相矛盾
- **证据**：§7 步骤 1 写的是 `vitest@4`，会解析到 4.1.12（2026-10-15，才 9 天）。vitest 5 的兼容性没有证据（见 §1 第 11 条）。convex-test 下限 0.0.63 发布于 2026-10-20，要到 2026-11-03 才满 2 周；按今天的标准，满 2 周的最新版是 0.0.61（2026-10-09）。@edge-runtime/vm 已经 23 个月没有发布。
- **修正**：锁定 `vitest@4.1.11`（2026-08-18，V4 线仍在维护）。把"Vitest 5 + edge-runtime + convex-test"列为待验证。convex-test 的下限二选一：明确把它记成例外（理由写清楚：0.0.63 的 Date pin 只在 handler 依赖同一事务内 `Date.now()` 一致时才需要），或者把下限降到 0.0.61。@edge-runtime/vm 记一条低风险条目：只用于测试，并且 convex-test 的 devDependencies 也锁在 5.0.0。步骤 1 补一次 `tsc --noEmit`（convex-test 自身是用 TS 5.9.3 构建的，项目用 TS 6.0.3）。

### r06 [low] 和其他备忘录的版本、时机不一致
- **证据**：本文锁定 convex-helpers 0.1.128，`techstack/data-evolution-part5.md:16` 写的是 `convex-helpers@0.1.129`。本文说 migrations 在"prod 上线前引入"，data-evolution:10/part2:66 说"第一次需要回填时安装"。本文 C5 没有提到 1.47 的 `.staged()` schema 校验器，data-evolution 已经采用了它。
- **修正**：统一锁 0.1.128，2026-11-04 之后可以一起升到 0.1.129。migrations 的安装时机采用 data-evolution 的说法。C5 的 narrow 步骤写明可以用 `defineTable(...).staged()`。

### r07 [low] 来源归属错误
- **证据与修正**：见 §2 第 2、3 条，以及 §1 第 9 条的措辞。改正引用即可，结论不变。

### r08 [low] returns 严格性只在 L1 验证，不够
- **证据**：convex-test main 的 `validateReturnValue` 会用 `validateValidator` 拒绝未知字段，所以 L1 用例能通过。但真实后端的 returns 校验发生在服务端（`design/deepdives/frontend-ia-review.md:24`，C2）；另外 inline 的 `t.query(handler)` 会跳过 args 和 returns 校验（convex-test `index.ts`）。
- **修正**：§7 步骤 4 用 `api.rooms.view` 引用调用，不要用 inline handler；同一个用例在 L2 dev 部署上再跑一遍，结论以 L2 为准。

### r09 [low] 分片是自找的复杂度
- **证据**：个位数房间、每天最多 2000 次、每分钟 40 次，单行 OCC 冲突可以忽略。`shards: 4/8` 直接带来 R5（总量没满却被拒），而 README 的分片建议是按 QPS/2 来估。
- **修正**：如果保留全局桶，也不要设 `shards`，R5 随之删除。

### r10 [low] 没有提到 rate-limiter 带一个嵌套子组件
- **证据**：§1 第 1、16 条。即使不用 async 模式，部署里也会多出 `rateLimiter/batchWorker` 的表和函数。以后加 workpool 会再带进 batch-worker ^0.2.2，组件命名空间是隔离的，不会冲突，但会出现两份。
- **修正**：§3 的 rate-limiter 行注明这个子组件；§7 步骤 2 确认 `components.rateLimiter` 生成成功，并且 Dashboard 能看到子组件。

### r11 [low] C3a 的 lint 规则没有给未鉴权公开函数留出口
- **证据**：§4.3 禁止在别处导入 `query/mutation/action`，但只定义了 user/member 两类构造器。健康检查、邀请链接预览这类公开但不需要登录的函数无处安放，最后很可能被 eslint-disable 掉。
- **修正**：再加一个显式命名的 `anonQuery`，写进 lint 白名单并要求附审查注释；同时注明 v1 没有公开 action。

## 4 主动检查

- **兼容性**：推荐的依赖都运行在 Convex 部署里，不进入 Next 16.4.3 的构建（rate-limiter 的 `./react` 不使用）。react 19.3.1 满足 rate-limiter 和 convex-helpers 的可选 peer；zod 4.6.7 满足 convex-helpers 的 `^4.0.0`；typescript 6.0.3 满足 `^6.0.0`。Node v24.21.0 满足 vitest 4.1 的 `engines`（`^20||^22||>=24`）。Clerk 7.9.20 与这些组件没有交集（`@clerk/nextjs` 依赖 `@clerk/react ^6.18.1`，与 convex 1.48 的可选 peer `@clerk/react ^6.4.3` 一致）。
- **许可证**：全部是 Apache-2.0。
- **12 个月维护活跃度**：convex-helpers 和 convex-test 很活跃（10 月各有 3 次以上发布）；rate-limiter 在 2025-12 到 2026-09 之间停了 9 个月，之后密集发布；migrations 3 次；action-retrier 2 次；@edge-runtime/vm 0 次。
- **与任务书核心的关系**：没有违背 §3。C3b 让 `v.*` 继续作为边界契约，C4 让 commitments 保持唯一真相源，C1 让审批只能由人类 mutation 写入，这三点都直接支撑 §3.2–3.5。
- **过度设计**：集中在 C2（r01、r09）。C6 的 `sweepStuckTurns` 不算过度设计，`data-evolution-part3.md:23` 指出备份恢复不会带回待执行的调度，这正好给了它理由。
