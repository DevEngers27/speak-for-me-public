# 04 状态机

> 极简原则：**只有 run 和 turn 存状态**；房间、提案、审批、人工请求、席位的"状态"全部由存储事实派生。所有修改 `runs.status` 的代码都调用 `assertRunTransition(from, to)`（`convex/engine/state.ts`），runs 表 validator 与该表共用 `RUN_STATUSES`。

## 1. 房间阶段（派生，不存）

```ts
roomPhase =
  !allSeatsClaimed            ? "inviting"   // 有席位未认领
: !allRolesHaveBrief          ? "briefing"   // 有角色没有已确认简报
: !room.currentRunId          ? "ready"      // 理论上不出现：最后一份简报确认时自动开 run
: run.status                                  // 直接展示当前 run 的状态
```
房间没有 closed：v1 不需要关闭（ADR-08）。执行后房间仍可开新 run 做后续变更（`runs.start`，trigger `manual`）。

## 2. Run 状态机

状态：`negotiating | pending_approval | needs_input | failed | executed | superseded`。终态：`executed`、`superseded`。

| # | from | to | 触发者 · 函数 | 守卫 | 同事务副作用 |
| --- | --- | --- | --- | --- | --- |
| R0 | （无） | negotiating | 系统 · `startRun`（由 `briefs.confirm`/`requests.answer`/`runs.start` 调用） | G-START：全部角色有已确认简报；全部席位已认领可不要求（代理可先谈，审批时才需要人）；`runs(room) < MAX_RUNS_PER_ROOM(20)`；`AGENTS_ENABLED` | 旧活动 run → superseded（R9）；插入 run；`room.currentRunId`；若 `enumerateFeasible(全部约束) = ∅` 直接走 R0′；否则 `scheduleTurn(provider)` |
| R0′ | （无） | needs_input | 同上 | 代码判定无可行组合 | 插入 run（status 直接 needs_input）+ `buildRequests` 生成人工请求；**不调模型** |
| R1 | negotiating | pending_approval | 系统 · `completeTurn`（最后一个评估方 recommend_accept） | 回合守卫 GT；当前提案 `validation.reasonCodes = []` | `activeTurnId = undefined` |
| R2 | negotiating | negotiating | 系统 · `completeTurn` | GT；provider 提案违反硬约束或评估方 reject，且 `round < maxRounds` | `round += 1`；`scheduleTurn(provider)` |
| R3 | negotiating | needs_input | 系统 · `completeTurn` | GT；轮次用尽（`round = maxRounds` 且仍无一致），或代理 `clarify` | `buildRequests` 插入请求 |
| R4 | negotiating | failed | 系统 · `failTurn` / `turnWatchdog` | 该回合失败且 `attempt = MAX_AUTO_ATTEMPTS(2)`，或不可重试错误（BAD_REQUEST、REFUSAL、AGENTS_DISABLED） | `activeTurnId = undefined` |
| R5 | failed | negotiating | 人 · `runs.retryTurn` | 调用者是成员；run 是当前 run；`attempt < MAX_ATTEMPTS(3)` | 以同一 (round, role) 插入 attempt+1 的 turn 并调度 |
| R6 | pending_approval | executed | 人 · `approvals.decide(approve)`（最后一票） | GA（下）+ `isFullyApproved` + `validateProposal = []` | 插入 changeOrder、tasks；`endedReason = executed` |
| R7 | pending_approval | negotiating | 人 · `approvals.decide(reject)` | GA；`round < maxRounds` | `round += 1`；`currentProposalId` 保留（新提案产生前仍显示被拒提案）；`scheduleTurn(provider)`，上下文带拒绝 reasonCode |
| R8 | pending_approval | needs_input | 人 · `approvals.decide(reject)` | GA；`round = maxRounds` | `buildRequests` |
| R9 | negotiating / pending_approval / needs_input / failed | superseded | 系统 · `startRun`（因约束变化） | 新 run 即将插入 | `endedReason = constraints_changed`；在途 action 不取消也无须取消：其结果被 GT 拒收 |
| R10 | needs_input | negotiating | 人 · `requests.answer`（effect `continue`） | GR（下） | `scheduleTurn(同一角色)`，上下文附"委托人确认按现有简报继续" |
| R11 | needs_input | pending_approval | 人 · `requests.answer`（effect `select_proposal`） | GR；所选提案属于本 run 且 `validation.reasonCodes = []` 且仍可执行 | `currentProposalId = 所选` |
| R12 | needs_input | superseded | 人 · `requests.answer`（effect `patch_brief`）→ `applyBriefVersion` → `startRun` | GR | 新简报版本、约束 +1、新 run（trigger constraint_change） |
| R13 | executed | （新 run） | 人 · `runs.start` | 当前 run 已 executed；G-START | 新 run trigger manual；旧 run 保持 executed（不是 superseded） |

不允许的迁移（`assertRunTransition` 抛 `ConvexError({code:"ILLEGAL_TRANSITION"})`）：从 executed/superseded 出发的任何迁移；needs_input → executed；failed → pending_approval 等。

### 守卫定义

- **GT（回合持久化守卫，completeTurn/failTurn/watchdog）**：`room.currentRunId === turn.runId && run.activeTurnId === turn._id && turn.status === "running" && run.status === "negotiating" && room.constraintsVersion === run.constraintsVersion`。不满足：turn → `stale`（若仍 running）并只记用量；业务状态不变。
- **GA（审批守卫，decide）**：调用者有席位且 `seat.role ∈ proposal.requiredApproverRoles`；`room.currentRunId === proposal.runId`；`run.status === "pending_approval"`；`run.currentProposalId === proposal._id`；`proposal.constraintsVersion === room.constraintsVersion`。approve 还要求 `validateProposal(...) = []`（RA-R06：可以随时说不，但不能批准不可执行的版本）。
- **GR（回答守卫，answer）**：调用者 `seat.role === request.targetRole`；`requestIsOpen(request)`。

两组守卫刻意分开（F04.2）：GT 只关心"这个模型结果还算不算数"，GA 只关心"这个人能不能对这个版本签字"。

## 3. Turn 状态机

`running → succeeded | failed | stale`，全部是一次写入。

| from | to | 函数 | 条件 |
| --- | --- | --- | --- |
| （无） | running | `scheduleTurn` | 插入并设 `run.activeTurnId`；同事务 `runAfter(0, internal.agents.runTurn)` 与 `runAfter(TURN_DEADLINE_MS, internal.agents.turnWatchdog)` |
| running | succeeded | `completeTurn` | GT 通过且输出通过 Zod + 业务校验 |
| running | failed | `failTurn` / `completeTurn`（业务校验失败记 INVALID_OUTPUT）/ `turnWatchdog`（TIMEOUT） | GT 通过；若 `attempt < MAX_AUTO_ATTEMPTS` 同事务插入 attempt+1 并调度（不改 run.status） |
| running | stale | 任一提交函数 | GT 不通过（run 已被取代或已有新尝试） |
| failed/stale | （补记） | `completeTurn` | 看门狗之后到达的结果：只补 `usage/latencyMs` 并置 `lateResult = true` |

## 4. 派生状态（不存）

| 对象 | 派生状态 | 规则 |
| --- | --- | --- |
| 提案 | `current / superseded / executed` | 02 §6 `proposalStatus`；界面另显 `executable` 与 `blockedReasonCodes` |
| 审批 | `valid / invalidated` | `approvalValidity`；invalidated 的行保留并在界面显示"Invalidated by constraints v{n}" |
| 审批人当前决定 | `pending / approved / rejected` | 该席位对当前提案的最新一行；没有则 pending |
| 人工请求 | `open / answered / void` | 有 answer → answered；否则 `requestIsOpen` → open；否则 void（被约束变化或新 run 自动作废，**无需取消写入**） |
| 席位 | `invited / claimed / expired` | `userId` 存在 → claimed；`inviteExpiresAt < now` → expired；否则 invited |

## 5. 关键时序：约束变化打断待审批（简要，完整版见 09）

1. finance 调 `briefs.confirm`（新预算）。事务内：校验 → 插入 finance 简报 v2 → `constraintsVersion` 4→5 → `startRun`：旧 run（pending_approval）→ superseded → 插 run#2 → 可行性判定 → 调度 provider 回合。
2. 提交即刻：所有订阅 `rooms.view` 的窗口重新计算：旧提案 `superseded`、旧审批 `invalidated`、run#2 `negotiating`。阻断不等模型。
3. 若旧 run 有在途回合，其结果到达时 GT 失败 → turn `stale`。

## 6. 开放问题

- 约束变化时是否保留"同一 run 内重谈"：本设计选择**一律新 run**（ADR-05），代价是每次约束变化至少一次 provider 调用；收益是只有一种路径、一组守卫。
