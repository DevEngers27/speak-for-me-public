# Spike 报告：Convex 组件评估（workflow / workpool / action-retrier / rate-limiter）

目录：`/private/tmp/claude-501/-Users-zhennn-cal-hack-2026-main/8539c825-8b44-4f0c-8956-406ed3a7762f/scratchpad/spikes/convex-components/`（下称 SPIKE）。全程离线，无任何真实 Claude 调用，未读取任何密钥；codegen 尝试时把 `HOME` 指向空目录，避免 CLI 读用户凭据。

## 1. 目的

为"一个协商 run = N 轮 × 3 角色回合；每回合 1 个 action 调模型 + 1 个 mutation 校验并持久化；失败有界重试；预算变更时取消"，比较两种（实际做了三种）编排实现，并用 convex-test 离线**实际跑起来**，而不只停在类型检查：

- A `chain`：自建 `ctx.scheduler` 链 + `attempts` 表 + watchdog
- B `workflow`：`@convex-dev/workflow`（内含 workpool）
- C `retrierChain`（附加）：调度链 + `@convex-dev/action-retrier` 负责单回合重试

## 2. 做了什么

### 2.1 安装与版本（npm 11.19 / node 24.21）

```
npm install convex@1.48.0 @convex-dev/workflow @convex-dev/workpool @convex-dev/action-retrier @convex-dev/rate-limiter convex-helpers typescript@5
npm install -D convex-test vitest @edge-runtime/vm
```

| 包 | 版本 | peerDependencies | dependencies |
| --- | --- | --- | --- |
| @convex-dev/workflow | 0.4.10 | workpool ^0.4.4, convex ^1.46.0, convex-helpers ^0.1.127 | async-channel ^0.2.0 |
| @convex-dev/workpool | 0.4.14 | convex ^1.36.1, convex-helpers ^0.1.94 | @convex-dev/batch-worker ^0.2.2 |
| @convex-dev/action-retrier | 0.3.1 | convex ^1.24.8 | 无 |
| @convex-dev/rate-limiter | 0.4.2 | convex ^1.43.0, react ^18.2 \|\| ^19 | @convex-dev/batch-worker **0.3.5（钉死）** |
| convex-helpers | 0.1.129 | convex ^1.46.0；zod/hono/@standard-schema/spec/react/typescript 为可选 peer | — |
| convex / convex-test / vitest / @edge-runtime/vm / typescript | 1.48.0 / 0.0.65 / 5.0.5 / 5.0.0 / 5.9.3 | | |

注意：batch-worker 装出两份（顶层 0.3.5 给 rate-limiter，`workpool/node_modules/@convex-dev/batch-worker` 0.2.2 给 workpool），组件彼此隔离，不冲突，但说明组件之间依赖版本并不对齐。四个组件都导出 `./test`（`register(t, name)`），可直接接入 convex-test；workflow 的 `register` 会顺带注册 `${name}/workpool`，workpool 会注册 `${name}/batchWorker`。

### 2.2 代码结构（SPIKE/convex/）

| 文件 | 作用 | 有效行数* |
| --- | --- | --- |
| `convex.config.ts` | `app.use(workflow)`、`app.use(workpool,{name:"modelPool"})`、`actionRetrier`、`rateLimiter` | — |
| `schema.ts` | rooms / runs / attempts / turns / rejections / stubCalls | 87 |
| `turns.ts` | **引擎无关**：`loadTurnContext`、`commitTurnLogic`（唯一写入口：run 状态检查、constraintVersion 过期拒绝、(runId,turnIndex) 幂等、顺序检查、确定性金额/角色校验） | 94 |
| `model.ts` | stub 模型 action（按 failPlan 注入 transient / fatal(`NonRetryableError`) / lost / 调用中途砍预算） | 59 |
| `rooms.ts` | `changeBudget`：递增 constraintVersion 并按引擎取消活动 run | 68 |
| `lib.ts` | 组件客户端（WorkflowManager / RateLimiter / ActionRetrier）与常量 | 28 |
| `chain.ts` | 引擎 A | **108** |
| `wf.ts` | 引擎 B | **68** |
| `retrierChain.ts` | 引擎 C | **64** |
| `observe.ts` | `runDetail` 查询（含 workflow `status` + `listSteps`） | — |
| `wfProbe.ts` | 确定性探针（fetch / env / Date+random / 改代码） | — |
| `engines.test.ts`、`probes.test.ts` | convex-test 用例 26 个 | — |

\* 去空行与 `//` 注释行（`grep -v`）。turns/model/rooms/lib/schema 三个引擎共享。

引擎 B 的核心就是这段（`SPIKE/convex/wf.ts`）：

```ts
for (let turnIndex = 0; turnIndex < total; turnIndex++) {
  const out = await step.runAction(internal.model.callModelTurn, { runId, turnIndex },
    { retry: TURN_RETRY, name: `turn_${turnIndex}_model` });
  const r: CommitResult = await step.runMutation(internal.turns.commitTurn,
    { runId, turnIndex, constraintVersion: out.constraintVersion, proposal: out.proposal },
    { inline: true, name: `turn_${turnIndex}_commit` });
  if (!r.ok) return { outcome: r.reasonCode, committedTurns: turnIndex };
}
```

引擎 A 需要：`scheduleAttempt`（同一 mutation 内插 attempt 行 + `runAfter(delay, turnAction)` + `runAfter(delay+11min, watchdog)`）、`turnAction`（try/catch 后 `runMutation(reportAttempt)`）、`reportAttempt`（迟到结果丢弃、取消 watchdog、提交、推进或按指数退避+抖动重排）、`watchdog`（仍 inFlight 则按超时失败处理）、`handleFailure`。

### 2.3 codegen

```
env -u CONVEX_DEPLOYMENT HOME=SPIKE/.fakehome CI=1 npx convex codegen --typecheck disable
✖ No CONVEX_DEPLOYMENT set, run `npx convex dev` to configure a Convex project
```

源码确认（`node_modules/convex/src/cli/lib/components.ts:105-160`）：应用级 codegen 走 `startComponentsPushAndCodegen`，凭据为空直接 return；**有组件的应用没有离线 codegen**。替代：`SPIKE/scripts/gen-generated.mjs` 按 Convex 模板手工生成 `_generated/{api,server,dataModel}`，`components` 的类型与真实 codegen 相同写法（`import("<pkg>/_generated/component.js").ComponentApi<"name">`，对照 `src/cli/codegen_templates/component_api.ts:90`）。之后：

```
npx tsc -p .        -> tsc exit=0（Files: 141, Check time: 0.19s）
```

故意写错参数的探针文件能被 tsc 拦截（`Type 'string' is not assignable to type 'Id<"runs">'`、`Property 'nope' does not exist on type '{ workflow: ComponentApi<"workflow">; ...'`），说明类型不是 any。

### 2.4 运行

```
npx vitest run --reporter=verbose   # environment: edge-runtime; server.deps.inline: ["convex-test", /@convex-dev/]
```

## 3. 实测结果（原样摘录，完整日志 SPIKE/vitest-run4.log）

```
 Test Files  2 passed (2)
      Tests  25 passed | 1 skipped (26)
```

关键输出（每行是 run 结束后的 `runDetail` 摘要）：

```
[chain] [] => {"status":"completed","turns":6,"attempts":["0#1:succeeded",...,"5#1:succeeded"],...}
[chain] [{"key":"0:provider","mode":"transient","times":2}] => {"status":"completed","turns":6,"attempts":["0#1:succeeded","1#1:failed","1#2:failed","1#3:succeeded",...],"stubCalls":{"0:provider":3,...}}
[chain] [{"key":"1:finance","mode":"transient","times":9}] => {"status":"failed","endReason":"turn_5_failed:stub_overloaded_529 (call 3)","turns":5,...}
[chain] [{"key":"0:customer","mode":"fatal","times":1}] => {"status":"failed","endReason":"turn_0_failed:{\"__convexWorkpoolNonRetryable\":true,\"message\":\"stub_refusal\"}","turns":0,"attempts":["0#1:failed"]}
[chain] [{"key":"1:customer","mode":"budgetCutDuring","times":1}] => {"status":"canceled","endReason":"budget_changed","turns":3,"attempts":[...,"3#1:canceled"],"rejections":["3:late_attempt_canceled"]}
[chain] lost => {"status":"completed","turns":3,"attempts":["0#1:succeeded","1#1:succeeded","2#1:timedOut","2#2:succeeded"],"stubCalls":{"0:finance":2,...}}
[workflow] [] => {"status":"completed","turns":6,"wfStatus":"completed","wfSteps":["0:turn_0_model:success","1:turn_0_commit:success",...,"11:turn_5_commit:success"]}
[workflow] transient x2 => {"status":"completed","turns":6,"stubCalls":{"0:provider":3,...}}
[workflow] transient x9 => {"status":"failed","endReason":"workflow_failed:Error: stub_overloaded_529 (call 3)...","turns":5}   bounded calls = 3
[workflow] fatal => {"status":"failed","endReason":"workflow_failed:Error: stub_refusal..."}   fatal calls = 1
[workflow] budgetCutDuring => {"status":"canceled","turns":3,"rejections":[],"wfStatus":"canceled","wfSteps":[...,"5:turn_2_commit:success","6:turn_3_model:?"]}
  stderr: Workflow: ...workflows already has generation number 1 when completing ...steps. Expected 0
[workflow] cancel-before-start => {"status":"canceled","turns":0,"stubCalls":{},"wfStatus":"canceled"}
[retrierChain] transient x2 => completed, stubCalls 0:provider = 3（日志 "failed, retrying in 690.46 ms" / "1990.32 ms"）
[retrierChain] fatal => {"status":"failed",...,"stubCalls":{"0:customer":3}}   fatal calls = 3
  log: Run ...runs failed, retrying in 547.77 ms: {"__convexWorkpoolNonRetryable":true,"message":"stub_refusal"}
[probe fetch] {"st":{"error":"Error: `fetch` is not supported in Convex queries or mutations. ..."}}
[probe env]   {"st":{"error":"TypeError: Cannot read properties of undefined (reading 'env')..."}}
[probe time]  {"st":{"result":{"now":1792842005759,"rnd":0.0233...},"type":"completed"}}
[probe codeChange] final= {"st":{"error":"Journal entry mismatch:\n\n{\"args\":{\"tag\":\"b\"},...}\n\n!==\n\n{\"args\":{\"tag\":\"inserted\"},...}","type":"failed"}}
```

第一次改 action-retrier 版本时在 `onComplete` 里调用 `retrier.cleanup()`，实测：

```
Error running onComplete handler for ...runs: Run ...runs hasn't completed.
[retrierChain] [] => {"status":"running","turns":0,"attempts":["0#1:inFlight"]}
```

即 onComplete 抛错被组件吞掉只打日志，整条链**静默卡死**在 running。

测试工具层面的两个发现：
1. `t.finishAllScheduledFunctions(vi.runAllTimers)` 会在 0ms 的 action 还没跑完时就触发 11 分钟后的 watchdog 定时器，导致 chain 全部误判超时（第一次运行：`"attempts":["0#1:timedOut","0#2:timedOut","0#3:timedOut"],"stubCalls":{}`）。改为逐个推进（`vi.advanceTimersToNextTimer()` + `t.finishInProgressScheduledFunctions()`）后正确。
2. convex-test 0.0.65 不支持取消 inProgress 的调度函数：`convexTest invariant error: Unexpected scheduled function state after it finished running: canceled`。chain 改为只取消 pending（在途 action 交给过期拒绝），retrierChain 的"在途砍预算"用例因 `retrier.cancel` 内部会取消在途 action 而跳过。

## 4. 对设计的结论

### 4.1 三种实现对比

| 维度 | A 自建 scheduler 链 | B workflow 组件 | C 链 + action-retrier |
| --- | --- | --- | --- |
| 引擎代码量 | 108 行 + attempts 表 | **68 行**，无自建 attempt 表 | 64 行 + 关联索引 |
| 有界重试 | 自写指数退避+抖动；可区分 NonRetryable | 内置退避+抖动；**尊重 `NonRetryableError`**（fatal 只调 1 次） | 内置退避；**不认 `NonRetryableError`**（fatal 调 3 次） |
| action 丢失/超时 | 自写 watchdog，**实测有效**（timedOut→重试→完成） | 交给 workpool 监控（日志可见 `[monitor] "main" loop`），平台级中断无法离线验证 | 组件负责，无法离线验证 |
| 迟到结果 | `reportAttempt` 见 attempt 非 inFlight 即丢弃并记 `late_attempt_canceled` | 取消后在途步骤结果被丢弃，commit 步骤根本不执行（`rejections: []`） | onComplete 内按 attempt 状态丢弃 |
| 取消 | 递增版本 + 取消 pending 调度 + attempt 标 canceled；在途 action 跑完被拒 | 同一 mutation 内 `workflow.cancel()`，原子；在途 action 跑完但结果作废 | `retrier.cancel()`；在途尽力而为 |
| 确定性约束 | 无 | handler 内 fetch 报错、`process` 不存在；Date/Math.random 可用（被打补丁）；**改代码插入步骤→`Journal entry mismatch` 失败**（实测） | 无 |
| 可观测性 | 全在自有表，attempt 粒度精确 | `status()` + `listSteps()` 给出带名字的步骤日志，响应式；workpool 周期打印 report JSON | 只有 runId 状态；onComplete **没有 context**，需自建 `by_retrier_run` 索引关联 |
| 失败模式风险 | 自己的 bug 自己可见 | onComplete 失败语义：exactly-once（README），未在离线下制造失败 | onComplete 抛错→**静默卡死**（实测） |
| 学习成本 | 只需 Convex 本身 | 中：步骤/重放/版本化概念 | 低，但坑多 |

### 4.2 假设核对

- 证实：任何引擎下"提交 mutation 做过期拒绝"都不可省（chain 靠它拒绝在途结果；workflow 只是让 commit 不执行，但 commit 内的 constraintVersion 检查仍是第二道防线）。
- 证实：workflow 修改步骤序列会让在途实例失败（不是只停在 README 层面）。
- 证实：rate-limiter 能在 `startRun` mutation 内同事务使用（`limiter.limit(..., {throws:true})`）；回滚语义本次未单独构造用例。
- 证伪："至少能离线 `convex codegen`"——带组件的应用离线不能 codegen。
- 证伪（原 04 文档的隐含预期）："组件重试都尊重 `NonRetryableError`"——action-retrier 不认。
- 新事实：workflow 的 `onComplete` 结果 kind 是 workpool 的 `success | failed | canceled`（README 示例里写的 `"error"` 与类型不符，按 `vResultValidator` 写才通过 tsc）。

### 4.3 推荐

**协商 run 的回合循环用 `@convex-dev/workflow`**，前提条件写进设计：
1. 一个 workflow 实例只覆盖一个 run（分钟级），**人工审批/取舍请求不用 `awaitEvent`**，仍用状态行；这样实例寿命短，部署前排空即可规避确定性重放风险。
2. workflow 名带版本（如 `negotiationV1`），步骤序列变化时新增版本而不是原地改。
3. `turns.commitTurn` 仍是唯一写入口，保留 constraintVersion / run 状态 / (runId,turnIndex) 幂等校验。
4. 预算变更 mutation 内"递增版本 + `workflow.cancel`"同事务完成。
5. workpool 的 `maxParallelism` 作为 Anthropic 全局并发保护；rate-limiter 只做业务限流（每房间启动次数、每日 token），不代替"单活跃 run"检查。
6. **不用 action-retrier**（与 workpool 重叠且有上述两个坑）。

若团队不愿承担确定性约束，A 是可行的备选：多约 40 行引擎代码 + 一张 attempts 表，但取消、超时、可观测都完全可控，且 watchdog 已实测有效。

### 4.4 无法离线验证

平台级中断（action 被杀/超时）时 workpool/workflow 如何上报；真实部署上的 OCC 并发（convex-test 串行执行）；workflow onComplete exactly-once 在 onComplete 抛错时的行为；在途 `retrier.cancel` 的真实表现；`workflow.cancel` 对已完成实例是否抛错（代码里以 run.status 先行守卫）；真实 codegen 产物与手写 `_generated` 的逐字一致性。

## 5. 可直接复用的代码

- `SPIKE/convex/turns.ts`：`commitTurnLogic`（唯一写入口 + 过期拒绝 + 幂等 + 确定性校验）
- `SPIKE/convex/wf.ts`：workflow 版回合循环 + `onRunComplete`
- `SPIKE/convex/chain.ts`：自建链（attempt + watchdog + 退避）备选
- `SPIKE/convex/rooms.ts`：`changeBudget` 递增版本并按引擎取消；`cancelIfUnfinished`
- `SPIKE/convex/model.ts`：stub 模型与故障注入（transient / fatal / lost / budgetCutDuring）
- `SPIKE/convex/lib.ts`、`SPIKE/convex/convex.config.ts`：组件安装与配置
- `SPIKE/convex/engines.test.ts`：三引擎参数化 convex-test 套件与逐步推进的 `drain()`
- `SPIKE/convex/probes.test.ts` + `wfProbe.ts`：确定性探针
- `SPIKE/scripts/gen-generated.mjs`：无部署时生成带组件类型的 `_generated`
- `SPIKE/vitest.config.ts`、`SPIKE/tsconfig.json`
