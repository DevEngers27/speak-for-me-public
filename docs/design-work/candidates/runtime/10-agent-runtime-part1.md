# 10 代理运行时（part1）：不变量、编排选型、三层对象、生命周期

> 本章是本设计的主视角，最深。分片：
> - part1：运行时不变量 R1–R10、编排选型、run / turn / attempt 三层对象、完整生命周期时序
> - part2：失败模式总表（F01–F28）
> - part3：scheduleAttempt / claimAttempt / executeAttempt / recordAttemptResult / applyAttemptResult / attemptWatchdog 的精确规格与守卫
> - part4：重试预算、超时与延迟预算、调用预算、总开关与熔断、并发控制、部署与版本
> - part5：模型调用规范（调用点矩阵、SDK 配置、请求形状、JSON Schema 构造、上下文与缓存布局、响应分类、错误映射）
> - part6：用量与成本记录、缓存验证、stub 模式与故障注入、简报抽取、可观测性、待验证与实测计划
>
> 名词以 00-overview 术语表为准；表结构见 03，状态迁移见 04，模型输出 schema 见 05。

## 10.1 运行时要保证的事（R1–R10）

| 编号 | 不变量 | 主要落点 |
| --- | --- | --- |
| R1 | 每个房间同一时刻至多一个"活跃 run"（status ∈ running / awaiting_approval / waiting_human / failed），且 `rooms.currentRunId` 指向它 | `startRunTx`（唯一创建入口，04 §4.2） |
| R2 | 一个 run 只在一个约束版本下进行：`runs.constraintsVersion` 创建后不变；约束变化必然让活跃 run 进入 superseded | `bumpConstraints`（09） |
| R3 | 模型结果只有在"它所属的 attempt 仍是该 turn 的当前 attempt、turn 仍 open、run 仍是当前活跃 run 且 running、约束版本未变、协议版本一致"时才生效，否则记为 stale | `applyAttemptResult` 守卫 G-A1…G-A6（part3 §10.6） |
| R4 | 每一次真实的模型 HTTP 请求恰好对应一行 `modelCalls`；用量无论成败、无论是否过期都落库 | SDK `maxRetries: 0` + `recordAttemptResult` |
| R5 | 重试只在一层发生（Convex attempt 层），且受四级预算约束：每 turn、每 run、每房间、每部署每日 | `decideRetry` + `usageCounters` |
| R6 | 任何 attempt 都有一个与它同事务登记的 watchdog；action 被平台中断、部署打断、写回失败时，房间不会卡在 running | `scheduleAttempt` 同时 `runAfter(deadline, attemptWatchdog)` |
| R7 | 模型输出只能在服务端生成的候选集合里选择（`candidateKey`），不能产生金额、日期、范围项或身份字段 | 05 输出 schema + 06 `enumerateCandidates` |
| R8 | 模型结果先持久化（record）再应用（apply）；应用失败可以在不重新调用模型的前提下被重新驱动或判失败 | 两阶段写回（part3 §10.6） |
| R9 | 代理不可用（总开关关闭、熔断、额度耗尽、模型持续失败）时，审批与执行链路仍可完整走通：提议方的人可以手动选择候选方案 | `proposals.proposeManually`（08、12） |
| R10 | 运行时的每个状态变化都可追溯：谁触发、基于哪个约束版本、用了多少 token、为什么被丢弃 | `runs` / `turns` / `modelCalls` 结构化字段 + events |

## 10.2 编排选型：自建 scheduler 链（ADR-01 摘要，全文见 18）

**决定**：用 Convex 原生的 `mutation + ctx.scheduler + 自有状态表 + watchdog mutation` 自建编排；不使用 `@convex-dev/workflow`、`@convex-dev/workpool`、`@convex-dev/action-retrier`，不使用 `@convex-dev/agent`。

**理由**（按 inputs/04 §2 的事实逐条对照）：

1. **问题形状简单**：一次协商是 ≤ 3 轮、每轮 1 个提议回合 + 2 个并行评审回合的有界序列；"等人"只是状态行，不需要进程挂起或 `awaitEvent`。workflow 的核心价值（长时间持久化步骤、可重放）在这里用不上。
2. **组件不解决最难的部分**：无论用哪个组件，过期结果拒收、单活跃 run、私密上下文、用量记录都要自建（inputs/04 §2.2 末段）。用组件意味着 run 状态同时存在于组件表和我们的 `runs` 表，形成两个真相源。
3. **workflow 的确定性约束在本项目是实际成本**：协议与规则会频繁迭代，而改动工作流步骤会让在途实例 determinism violation；1 MB 步骤数据上限也要额外管理。
4. **重试必须看得见**：我们需要每次 HTTP 请求一行用量与失败原因（R4），并且退避要能读取 429 的 `retry-after`。自建 attempt 表天然满足；组件的重试对业务表不可见。
5. **agent 组件与已定技术栈冲突**（要求 Vercel AI SDK v7），且线程模型默认跨线程检索，与私密委托相悖。

**代价与对策**：自建需要写 attempt 表、watchdog、退避调度、取消逻辑——这些在 part3 中逐一给出规格，总量约等于 4 个 internal 函数 + 1 个纯函数模块（`retryPolicy.ts`）。若将来出现"全局并发上限"需求（大量房间同时协商导致 429 风暴），只把模型调用 action 迁到 workpool（`maxParallelism`），run / turn 状态机保持不变（17 路线）。

## 10.3 三层对象：run / turn / attempt

| 层 | 表 | 含义 | 生命周期 | 为什么单独成层 |
| --- | --- | --- | --- | --- |
| run | `runs` | 在一个约束版本下的一次协商过程（含"无需协商、直接重新审批"的零回合 run） | running → awaiting_approval / waiting_human / failed → executed / superseded / cancelled | 绑定约束版本（R2）、候选集合快照、轮次、调用预算、结局 |
| turn | `turns` | 某个角色在某一轮的一次逻辑回合（propose 或 review） | open → completed / failed / discarded | 协议语义的单位：结果（动作、候选、理由码）挂在 turn 上 |
| attempt | `modelCalls` | 为某个 turn 发起的一次模型请求（或 stub 计算） | scheduled → running → received → accepted / stale / failed；scheduled / running → timed_out；scheduled → skipped | 重试、超时、迟到拒收、用量记录的单位；同时是全局用量账本（简报抽取也写这里） |

关键关系：`turns.currentAttemptId` 是"租约"。任何 attempt 只有在自己仍是当前 attempt 时才能把结果应用到 turn 上；watchdog 或重试一旦创建了新 attempt，旧 attempt 的迟到结果只记用量、不生效。因为被调度的 action 本身至多执行一次（inputs/04 §1.5），不存在两个 worker 抢同一个 attempt，所以不需要 leaseToken / leaseExpiresAt 之类的字段。

## 10.4 一次完整 run 的生命周期（标准路径时序）

以首个场景的"首次协商"为例（proposerRole = provider，reviewerRoles = [customer, finance]，maxRounds = 3）。每一步写明调用者、函数、读写的表、可能的失败与失败后的状态。

| 步 | 触发者 → 函数 | 读 | 写 / 调度 | 失败与失败后状态 |
| --- | --- | --- | --- | --- |
| 1 | 任一参与者 → `runs.start({roomId, expectedConstraintsVersion})`（public mutation） | rooms、participants、briefVersions、catalogItems、constraintVersions、runs（当前） | 若已有活跃 run：直接返回它（幂等）。否则 `startRunTx`：计算 RuleInput(vN) → `enumerateCandidates` → 插入 `runs`（status running、candidates 快照、round 1）→ patch `rooms.currentRunId` → `startTurn(propose, provider)` → `scheduleAttempt` | 房间未就绪 → `NOT_READY`（无任何写入）；视图过期 → `STALE_VIEW`；候选为空 → run 直接以 waiting_human 创建并生成 humanRequests（不调模型，04 §4.2.3 T3） |
| 2 | `scheduleAttempt`（helper，同事务） | turns | 插入 `modelCalls`（status scheduled、attemptNo 1、deadlineAt）→ patch `turns.currentAttemptId` → `runAfter(delay, internal.agentActions.executeAttempt, {attemptId})` → `runAfter(delay + timeout + grace, internal.agentRuntime.attemptWatchdog, {attemptId})`，两个调度 id 存回 attempt | mutation 回滚则调度一并消失（inputs/04 §1.5），不会出现孤儿调度 |
| 3 | 调度器 → `executeAttempt`（internal action）→ `claimAttempt`（internal mutation） | modelCalls、turns、runs、rooms、systemState、usageCounters、上下文所需各表 | 守卫 G-C1…G-C7 通过：attempt → running、run.modelCallsUsed+1、usageCounters 预占 1 次调用；返回 `{kind:"proceed", request, envelope}` | 守卫失败：attempt → skipped（原因码），按 part4 §10.7 判定 turn 失败或静默放弃；返回 `{kind:"abort"}`，action 结束，不调模型 |
| 4 | `executeAttempt` → Claude（或 stub） | — | — | 网络错误、超时、4xx/5xx、拒答、截断、格式错误都在 action 内分类成 `AttemptOutcome`（part5 §10.17），**不抛出** |
| 5 | `executeAttempt` → `recordAttemptResult`（internal mutation） | modelCalls | attempt.status running → received，写 outcome、usage、requestId、latency；usageCounters 记 token；`runAfter(0, internal.agentRuntime.applyAttemptResult, {attemptId})`，调度 id 存为 `applyFnId` | attempt 已被 watchdog 判为 timed_out：只补记 usage 并标 `lateResult: true`，不调度 apply。record 本身抛错：action 的 catch 再调用一次精简版 `recordAttemptFailure`；仍失败则交给 watchdog（part3 §10.6.4） |
| 6 | 调度器 → `applyAttemptResult`（internal mutation，exactly once） | modelCalls、turns、runs、rooms、proposals | 守卫 G-A1…G-A6；outcome 为 output：写 turn.result、可能插入 proposal 版本、写事件、推进协议（安排评审回合或结束本轮）；outcome 为失败：`decideRetry` → 安排下一 attempt 或判 turn 失败 | 守卫失败：attempt → stale（记 staleReason），不改协议状态。确定性异常（代码缺陷）：Convex 将该调度标为 failed，watchdog 发现 attempt 停在 received → 判 turn 失败（`APPLY_FAILED`），不再调用模型 |
| 7 | apply（提议成功）→ `startTurn(review, customer)`、`startTurn(review, finance)` | — | 两个 turn 各自 `scheduleAttempt`（delay 0），并行执行 | 同 2–6；两个 apply 都写同一 run 文档，OCC 串行化 |
| 8 | 最后一个评审 turn 的 apply → `concludeRound` | turns（本轮全部） | 全部 recommend_accept（或因故障判为 no_recommendation）→ run → awaiting_approval（outcome converged）；有 counter / reject 且 round < maxRounds → round+1，`startTurn(propose)`；达到上限 → awaiting_approval（outcome round_cap）；有被采纳的 clarify → run → waiting_human 并创建 humanRequest | 见 05 §5.6 的完整判定表 |
| 9 | 人 → `decisions.decide`（08） | proposals、decisions、runs、rooms、ledger | 追加 decision；集合判定；齐了则同事务执行 | 见 08 |

时间线（无故障、首轮收敛）：步 1–3 约数十毫秒；步 4 提议回合约 6–15 秒（Opus 5.5、effort medium，待实测）；步 7 两个评审并行约 4–10 秒（effort low）；整个 run 约 15–30 秒。三轮全部用满约 45–90 秒。
