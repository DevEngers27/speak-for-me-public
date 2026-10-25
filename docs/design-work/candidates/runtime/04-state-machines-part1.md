# 04 状态机（part1）：总则、run、turn、attempt

> 分片：part1 总则与运行时三层状态机；part2 房间、提案（派生）、审批决定（派生）、人工请求、邀请、两组守卫、就绪条件。
> 实现：`convex/engine/stateMachines.ts` 导出每个状态机的 `STATUSES`、`TRANSITIONS: Record<From, To[]>` 与 `assertTransition(machine, from, to)`；schema 中的 status validator 由同一组字面量生成（03 §3.1 的单一来源规则）。**修改任何 status 字段的代码都必须先调用 `assertTransition`**，并且只能出现在本章"触发函数"列列出的函数里（代码审查清单 + 16 的 SM-* 用例）。

## 4.1 哪些状态存储、哪些派生

| 对象 | 状态 | 存储 / 派生 | 理由 |
| --- | --- | --- | --- |
| 房间 `rooms` | open / closed | 存储 | 生命周期，只此两态（不混入协商进度） |
| 协商运行 `runs` | 7 态（§4.2） | 存储 | 有副作用的长生命周期流程，需要守卫与审计 |
| 回合 `turns` | open / completed / failed / discarded | 存储 | 协议单位 |
| 模型尝试 `modelCalls` | 8 态（§4.4） | 存储 | 重试、超时、迟到拒收的单位 |
| 提案 `proposals` | current / superseded / executed + executable | **派生**（提案文档永不修改） | 核心 6；可执行性随约束与日期变化，存储必过时（I10） |
| 审批决定 | pending / approved / rejected / withdrawn / stale_approve / stale_reject | **派生**（`decisions` 只追加） | 核心 3、6 |
| 人工请求 `humanRequests` | open / answered / superseded / cancelled | 存储 | 需要关闭原因与回答记录 |
| 邀请 `invites` | open / accepted / revoked（+ 派生 expired） | 存储 + 派生 | 过期由时间决定，不需要定时任务 |

"needs input"、"blocked"、"pending approval" 这些原方案里的房间状态，在本设计中分别由"活跃 run 的状态"与"当前提案的派生可执行性"表达，不另存字段。

## 4.2 协商运行（run）

### 4.2.1 状态

| 状态 | 含义 | 活跃 | 终态 |
| --- | --- | --- | --- |
| `running` | 有回合在进行或已调度 | 是 | 否 |
| `awaiting_approval` | 有一个当前提案等待人工审批；没有在飞的 attempt | 是 | 否 |
| `waiting_human` | 等待人工请求的回答（无可行候选、澄清、代理拒绝、拒绝循环达上限） | 是 | 否 |
| `failed` | 提议回合失败（重试耗尽、致命错误、代理不可用、预算耗尽）；可恢复 | 是 | 否 |
| `executed` | 当前提案已执行 | 否 | 是 |
| `superseded` | 被约束变化、拒绝、请求回答、重谈请求取代 | 否 | 是 |
| `cancelled` | 房间关闭 | 否 | 是 |

### 4.2.2 迁移表

| # | from → to | 触发函数（调用者） | 守卫 | 同事务副作用 |
| --- | --- | --- | --- | --- |
| T1 | ∅ → running | `startRunTx`（被 `runs.start` 人工、`onConstraintsChanged` / `decisions.decide` 拒绝 / `requests.answer` / `runs.requestRenegotiation` 调用） | 房间 open；就绪（§4.11）；无其他活跃 run（系统触发时先 T12）；候选非空；人工触发时 `expectedConstraintsVersion === room.constraintsVersion` | 插入 run（候选快照、round 1）；`rooms.currentRunId`、`runSeq+1`；`startTurn(propose)`（系统触发延迟 3 s）；事件 `run_started` |
| T2 | ∅ → awaiting_approval | `startRunTx`（仅 `onConstraintsChanged`） | 当前提案未执行，且在新约束版本下仍可执行 | 插入零回合 run，`currentProposalId` 沿用，outcome `reapproval`；事件 `reapproval_required` |
| T3 | ∅ → waiting_human | `startRunTx` | 候选为空（outcome `no_feasible`），或本约束版本下由拒绝触发的 run 已达 `MAX_REJECTION_RUNS_PER_VERSION = 3`（outcome `blocked`） | `planHumanRequests` 插入请求；事件 `run_waiting_human` |
| T4 | running → awaiting_approval | `concludeRound`（apply 内，系统） | 本轮全部 turn 终态；`run.currentProposalId` 存在 | outcome = converged / round_cap / proposer_held；事件 `run_awaiting_approval` |
| T5 | running → waiting_human | `concludeRound` 或 `applyTurnOutput`（系统） | 本轮有被采纳的 clarify（每 run ≤ 1），或提议方 `reject` | 插入请求；outcome = clarify / agent_declined |
| T6 | running → failed | `onTurnFailed`（apply / watchdog / claim，系统） | 失败的是 propose 回合 | `run.failure = {turnId, code}`；事件 `run_failed`；必要时打开熔断 |
| T7 | failed → running | `runs.resume`（任一参与者） | run 为当前活跃 run；`resumeCount < 2`；live 模式下总开关开、熔断关；run 调用预算有余 | `resumeCount+1`；为失败回合创建**新的** turn（`resumedFromTurnId`），`scheduleAttempt`；事件 `run_resumed` |
| T8 | failed → awaiting_approval | `proposals.proposeManually`（提议方角色的人） | `expectedConstraintsVersion` 一致；候选键在 `run.candidates` 中 | 插入 `authorKind: "human"` 提案；outcome `manual` |
| T9 | waiting_human → awaiting_approval | 同 T8 | 同 T8 | 同 T8；本 run 的 open 请求 → superseded |
| T10 | awaiting_approval → awaiting_approval | 同 T8 | 同 T8；新候选 ≠ 当前提案候选 | 当前提案被替换；旧提案上的决定自然不再适用 |
| T11 | awaiting_approval → executed | `executeIfReady`（在 `decisions.decide` 内） | 审批 / 执行守卫 G-D*、G-E*（§4.10） | 执行记录、账本、事件、`bumpConstraints(execution_recorded)`（08） |
| T12 | 任一活跃态 → superseded | `supersedeRunTx`（被 `bumpConstraints`、拒绝、请求回答、重谈请求调用） | run 处于活跃态 | `endedReason`；open turn → discarded；scheduled attempt → skipped 并尽力 `scheduler.cancel`；本 run open 请求 → superseded；事件 `run_superseded` |
| T13 | 任一活跃态 → cancelled | `rooms.close`（房间创建者） | 房间 open | 同 T12 的清理；事件 `room_closed` |

不存在 executed / superseded / cancelled 的出边。"修改已执行的协议"= 同一房间的新 run（`runs.requestRenegotiation`，trigger `renegotiation_requested`），旧 run 与执行记录原样保留（GAP-13、RA-S05）。

### 4.2.3 `startRunTx(ctx, room, opts)` —— 创建 run 的唯一入口

```ts
type StartOpts = { trigger: RunTrigger; origin: "manual" | "system"; expectedConstraintsVersion?: number };
```

1. 读 `room.currentRunId` 指向的 run。若活跃：`origin === "manual"` → 返回它（幂等，F11）；`origin === "system"` → `supersedeRunTx(run, reasonFor(trigger))`。
2. `ruleInput = loadRuleInput(ctx, room)`（09 §9.2：按 `constraintVersions[room.constraintsVersion]` 的指针取不可变记录）。
3. `readiness = scenario.readiness(ruleInput)`；不就绪：manual 抛 `NOT_READY{missing}`，system 不建 run、写事件 `negotiation_not_ready`。
4. `trigger.kind === "constraints_changed"` 且存在未执行的当前提案、`evaluateProposal(current, ruleInput).executable` → T2。
5. `candidates = enumerateCandidates(ruleInput).filter(c => !excluded(c))`，其中 excluded = 本约束版本下被人拒绝过的提案所用候选键（从 decisions 查得）。
6. 候选为空，或本版本拒绝触发的 run 已达 3 个 → T3。
7. 否则 T1。

单活跃 run 的保证：1 与 T1 / T2 / T3 的插入都读写 `rooms` 文档，并发调用由 OCC 串行化；任何其他代码路径不得插入 `runs`（代码审查清单 + RT-11）。

## 4.3 回合（turn）

| # | from → to | 触发函数 | 守卫 / 说明 |
| --- | --- | --- | --- |
| U1 | ∅ → open | `startTurn`（startRunTx、advanceProtocol、runs.resume） | run 为 running；同一 (run, round, role) 不存在 open 或 completed 的 turn |
| U2 | open → completed | `applyTurnOutput` | apply 守卫 G-A1…G-A6 通过 |
| U3 | open → failed | `onTurnFailed` | 重试决策为 fail，或 claim 守卫 G-C5…G-C7 失败 |
| U4 | open → discarded | `supersedeRunTx`、`rooms.close` | run 离开 running |

终态 turn 不会重新打开；恢复执行用新 turn（T7），保证每个 turn 的 attempt 历史与结果一一对应。

## 4.4 模型尝试（attempt，`modelCalls`）

| # | from → to | 触发函数 | 条件 |
| --- | --- | --- | --- |
| A1 | ∅ → scheduled | `scheduleAttempt` | 同一事务登记 executeAttempt 与 watchdog |
| A2 | scheduled → running | `claimAttempt` | G-C1…G-C7 全部通过 |
| A3 | scheduled → skipped | `claimAttempt`（G-C2…G-C6 失败）、`supersedeRunTx`（取消） | `skipReason` 记录原因 |
| A4 | scheduled → failed | `claimAttempt`（G-C7） | `INTERNAL_PRECONDITION` |
| A5 | scheduled / running → timed_out | `attemptWatchdog` | 到达 `deadlineAt` 仍未 record |
| A6 | running → received | `recordAttemptResult` | 写 outcome 与 usage，登记 apply |
| A7 | received → accepted | `applyAttemptResult` | 守卫通过且 outcome 为 output |
| A8 | received → stale | `applyAttemptResult` | G-A2…G-A6 任一失败 |
| A9 | received → failed | `applyAttemptResult`（非 output outcome）、`attemptWatchdog`（`APPLY_FAILED`） | — |

终态：accepted、stale、failed、timed_out、skipped。终态之后只允许"补记 usage"（`lateResult: true`），不允许改 status。
