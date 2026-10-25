# 04 状态机 · part1：分层原则、房间、协商运行（run）

> 原方案一个 `rooms.status` 承载房间、run、提案、审批四件事（GAP-05）。本设计按"谁拥有这个生命周期"分层：房间只存 open/closed；run 与回合、人工请求、邀请、任务有各自存储的状态机；提案与审批**没有存储状态**，全部派生（part2 §3–§4）。每条迁移只由一个 helper 执行并带守卫，所有迁移都在同一事务写事件（EV-2）、patch 房间（M-ROOM）。

## 1. 分层一览

| 层 | 存储的状态 | 迁移入口 | 派生的展示状态 |
| --- | --- | --- | --- |
| 房间 | `rooms.status: open / closed` | `rooms.create`、`rooms.close` | 阶段 phase（§2.2） |
| 协商运行 | `runs.status`（8 值） | `startRun`、`transitionRun` | — |
| 代理回合 | `agentTurns.status`（6 值） | `scheduleTurn`、`completeTurn`、`failTurn`、`turnWatchdog`、`cancelLiveTurns` | — |
| 人工请求 | `humanRequests.status`（4 值） | `openRequests`、`requests.answer`、`closeRequest` | — |
| 邀请 | `invites.status`（3 值） | `invites.*` | expired |
| 任务 | `tasks.status`（3 值） | `tasks.setStatus` | — |
| 提案 | 无 | — | rules_blocked / current / executed / superseded；current 下再分 executable / blocked_now |
| 审批 | 无（只追加的决定） | — | 每个必需角色：approved / rejected / pending / stale_approve / stale_reject |

## 2. 房间

### 2.1 迁移表

| # | from | to | 函数 | 触发者 | 守卫 | 同事务副作用 |
| --- | --- | --- | --- | --- | --- | --- |
| RM-1 | （无） | open | `rooms.create` | 任意已登录用户（受创建策略约束，07 §5） | title 1–120 字符、goal 1–2000 字符、timeZone 是合法 IANA、ownerRole ∈ 场景角色 | 插入房间（各计数器 0，constraintsVersion 0）、`addParticipant(owner, ownerRole)`、事件 room_created、participant_joined |
| RM-2 | open | closed | `rooms.close` | 房主 | status = open | 若有非终态 run → cancelled（R-11）；open 请求 → cancelled；open 邀请 → revoked；running 回合 → cancelled；`closedAt`；事件 room_closed |

closed 是终态：所有写入口第一条守卫都是 `room.status === "open"`（`requireParticipant(ctx, roomId, { open: true })`），只读查询照常可用。v1 不提供删除房间（历史不可篡改）。

### 2.2 阶段（派生，供 13 的界面与 `runs.start` 的守卫共用）

```ts
function roomPhase(room, participants, currentRun, lastRun): RoomPhase {
  if (room.status === "closed") return "closed";
  if (!allRequiredRolesSeated(participants) || !allRequiredBriefsConfirmed(participants)) return "setup";
  if (!currentRun) return lastRun?.status === "executed" ? "idle" : "ready";
  return currentRun.status; // negotiating | awaiting_input | pending_approval | failed
}
```
`allRequiredBriefsConfirmed` 读 `participants.currentBriefVersionId`。`ready` 与 `idle` 下任何参与方都可以调用 `runs.start`（前者 trigger = initial，后者或 no_agreement 之后 trigger = manual）。

## 3. 协商运行（run）

### 3.1 状态

| 状态 | 含义 | 终态 |
| --- | --- | --- |
| `negotiating` | 有代理回合在跑或待调度 | 否 |
| `awaiting_input` | 等待一个或多个具体的人回答请求（HR-4） | 否 |
| `pending_approval` | 有当前提案等待人工审批（PR-4） | 否 |
| `failed` | 回合重试耗尽、调用预算耗尽或代理被关闭；可人工重试 | 否 |
| `executed` | 已原子执行 | 是 |
| `superseded` | 被约束变化、人工拒绝或重谈请求取代；会同时启动新 run | 是 |
| `no_agreement` | 取舍请求全部被拒绝；当前约束下没有一致意见 | 是 |
| `cancelled` | 房间关闭 | 是 |

```ts
export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  negotiating:      ["pending_approval", "awaiting_input", "failed", "superseded", "cancelled"],
  awaiting_input:   ["negotiating", "pending_approval", "superseded", "no_agreement", "cancelled"],
  pending_approval: ["executed", "superseded", "cancelled"],
  failed:           ["negotiating", "superseded", "cancelled"],
  executed: [], superseded: [], no_agreement: [], cancelled: [],
};
export const RUN_INITIAL: readonly RunStatus[] = ["negotiating", "awaiting_input", "failed"];
```
`transitionRun(ctx, room, run, to, meta)` 调 `assertTransition`；进入终态时同事务清空 `rooms.currentRunId` 与 `currentProposalId`、写 `endedAt`（RN-1、PR-4）；离开 `pending_approval` 时清空 `currentProposalId`；进入 `pending_approval` 时设置它。

### 3.2 迁移表

| # | from | to | 函数（调用者） | 触发者 | 守卫 | 同事务副作用 |
| --- | --- | --- | --- | --- | --- | --- |
| R-0a | （无） | negotiating | `startRun`（`runs.start` / `onConstraintsChanged` / `decisions.record` 拒绝 / `runs.requestRenegotiation`） | 用户或系统 | 房间 open；phase ≠ setup；`currentRunId` 为空（RN-1）；`enumerateFeasible(currentInputs, today)` 非空；llm 模式下 `AGENTS_ENABLED` 且 `modelCallsUsed < modelCallBudget`（stub 模式不计预算） | `runNo = ++runSeq`；插入 run（round 1，step propose）；设 `currentRunId`；`scheduleTurn(proposerRole)`；事件 run_started |
| R-0b | （无） | awaiting_input | `startRun` | 同上 | 同上但可行集为空 | 插入 run（step idle）；`openRequests(tradeoff 组)`；事件 run_started、request_* |
| R-0c | （无） | failed | `startRun` | 同上 | 可行集非空但（llm 模式下）代理关闭或调用预算耗尽 | 插入 run，`errorCode` 记在事件中；界面显示原因 |
| R-1 | negotiating | pending_approval | `completeTurn`（轮次结算，05 §5） | 系统 | 本 run 有 `lastValidProposalId` 且（全部评估方 recommend_accept 或轮次用尽） | `currentProposalId = lastValidProposalId`；step idle；事件 run_status_changed |
| R-2 | negotiating | awaiting_input | `completeTurn` | 系统 | clarify 打开 disclosure 请求；或轮次用尽且无有效提案（打开 choose_package 或 tradeoff 请求） | `openRequests`；step idle |
| R-3 | negotiating | failed | `completeTurn` / `failTurn` / `turnWatchdog` | 系统 | 某回合自动尝试耗尽；或调度下一回合时 `CALL_BUDGET_EXHAUSTED` / `AGENTS_DISABLED` | `failedTurnId`；事件 |
| R-4 | awaiting_input | negotiating | `closeRequest`（由 `requests.answer` 调用） | 目标参与方 | 关闭的是 disclosure 请求，且该 run 已无 open blocking 请求 | 按请求记录的提问回合重排同一步骤（`scheduleTurn(askerRole, step)`）；事件 |
| R-5 | awaiting_input | pending_approval | `requests.answer`（choose_package） | 目标参与方（customer） | 选中的包在当前约束下 `evaluateProposal` 全部通过 | `insertProposal(author = human_choice)`；同组其他请求 cancelled |
| R-6 | awaiting_input | no_agreement | `closeRequest` | 目标参与方 | 本组 tradeoff / choose_package 请求全部 declined | endReason all_declined；事件 |
| R-7 | pending_approval | executed | `executeIfReady`（`decisions.record` 内） | 投最后一票的人 | EX-2 | 见 08；清空指针 |
| R-8 | pending_approval | superseded | `decisions.record`（reject） | 必需审批人 | DE-3 | endReason rejected_by_human；随后 `startRun(trigger = human_reject, feedback)` |
| R-9 | negotiating / awaiting_input / failed | superseded | `onConstraintsChanged` | 系统（因某人确认了简报或执行） | 必然发生（CS-5） | endReason constraints_changed；`cancelLiveTurns`；随后 `startRun(trigger = constraint_change)` |
| R-10 | pending_approval | superseded | `onConstraintsChanged` | 系统 | 当前提案在新约束下 `evaluateProposal` 有 fail | 同 R-9；若仍全部通过则**不迁移**，只写 reapproval_required（旧审批自然变 stale） |
| R-11 | 任一非终态 | superseded | `runs.requestRenegotiation` | 任一参与方 | reasonCode 合法；`modelCallsUsed < budget` | endReason renegotiation_requested；`cancelLiveTurns`；open 请求 cancelled；`startRun(trigger = renegotiation)` |
| R-12 | failed | negotiating | `runs.retry` | 任一参与方 | `AGENTS_ENABLED`；调用预算未耗尽 | 对 `failedTurnId` 的 (round, step, role) 调度 attempt + 1 |
| R-13 | 任一非终态 | cancelled | `rooms.close` | 房主 | — | endReason room_closed；`cancelLiveTurns`；请求 cancelled |

`startRun` 在 R-8、R-9、R-10、R-11 中紧接旧 run 的终态迁移执行，二者同事务：旧 run 先进入终态并清空 `currentRunId`，新 run 再设置它，RN-1 在事务提交时成立。若新 run 的守卫失败（如调用预算耗尽），新 run 以 R-0c 进入 failed，房间不会"没有 run 却也没有原因"。

### 3.3 为什么约束变化要"旧 run 终止 + 新 run"（F04.1 的二选一）

- 选项 A：旧 run superseded，新建 run（trigger constraint_change）。选项 B：同一 run 回到 negotiating。
- 决定：A。理由：①回合持久化守卫只需比较 `run.constraintsVersion = room.constraintsVersion`（CS-5），run 的约束版本终生不变，迟到结果的判定简单；②一个 run 对应"一组约束下的一次协商"，历史与成本按 run 归集清楚；③轮次预算自然重置，不必设计"约束变化后还剩几轮"。
- 例外：pending_approval 下当前提案在新约束下仍全部通过时，run 不变（R-10 的不迁移分支）。此时 run 内没有回合在跑，CS-5 不涉及它；它只需要人在新约束版本上重新批准。这替代了 Role A 的 revalidated 复制提案（RA-R11 否决）。

### 3.4 run 状态图

```text
           ┌──────────── R-12 retry ─────────────┐
 start ──> negotiating ──R-1──> pending_approval ──R-7──> executed
   │         │   ▲  │                 │
   │       R-2  R-4 R-3              R-8/R-10/R-11 ──> superseded ──(同事务)──> 新 run
   │         ▼   │  ▼
   └─R-0b─> awaiting_input ──R-6──> no_agreement        failed ──R-9/R-11──> superseded
               └──R-5──> pending_approval          任一非终态 ──R-13──> cancelled
```
