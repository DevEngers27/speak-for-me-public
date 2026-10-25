# 04 状态机

> 所有状态迁移表放 `convex/lib/state.ts`：导出 `ALLOWED_RUN`、`ALLOWED_PROPOSAL`、`ALLOWED_REQUEST`、`ALLOWED_TASK` 与 `assertTransition(machine, from, to)`；任何修改 status 的代码都必须调用。违反抛 `ConvexError({ code: "INVALID_TRANSITION" })`。

## 1. 房间 `rooms.status`

| from | to | 触发者 / 函数 | 守卫 |
| --- | --- | --- | --- |
| setup | active | 任一成员 `runs.start` | 三个角色都有成员；三份简报都有确认版本；预算已有 revision ≥ 1；`budgets.openingBalanceDeclared === true`（期初已录入，或已显式声明为零）；目录至少一个 active scope 条目 |
| active | closed | owner `rooms.close` | 当前无活动 run，或活动 run 为 needs_input/failed（关闭时 run → cancelled） |
| setup | closed | owner `rooms.close` | 无 |

closed 是终态；历史只读。

## 2. 协商运行 `runs.status`

决定：**任何约束变化都 supersede 当前活动 run 并新建 run**（统一规则，回合守卫只需比较 `constraintsVersionAtStart`）。拒绝在同一 run 内进入下一轮。

| from | to | 触发者 / 函数 | 守卫与副作用 |
| --- | --- | --- | --- |
| （新建） | negotiating | `startRunInternal` | 无活动 run；room.active；调度首个 propose 回合 |
| （新建） | pending_approval | `startRunInternal`（约束变化后当前提案仍有效） | 当前提案 `validateProposal` 通过；不调模型 |
| （新建） | needs_input | `startRunInternal`（枚举结果为空） | 生成 humanRequests；不调模型 |
| negotiating | pending_approval | `completeTurn` | 本轮评估回合全部完成且无 counter/reject；当前提案通过规则闸门 |
| negotiating | negotiating | `completeTurn`（round+1） | 评估者 counter / reject，且 round < maxRounds 且调用未超限（规则闸门拒绝只让 provider 同轮重选，不加 round） |
| negotiating | needs_input | `completeTurn` / `startTurn` | 轮次用尽、调用超限、代理 clarify、枚举为空 |
| negotiating | failed | `failTurn` / `turnWatchdog` | 回合失败且自动重试已用尽 |
| pending_approval | confirmed | `decisions.approve`（最后一票） | 08 执行守卫全部通过 |
| pending_approval | negotiating | `decisions.reject` | round < maxRounds；调度 provider 回合（携带拒绝码） |
| pending_approval | needs_input | `decisions.reject` | round 用尽；生成 tradeoff 请求 |
| needs_input | negotiating | `requests.answer`（不改约束的选项，如 clarify 回答） | 请求 status open → answered |
| failed | negotiating | `runs.retryTurn` | 任一成员；`modelCallCount < maxModelCalls` |
| negotiating / pending_approval / needs_input / failed | superseded | `bumpConstraints` 的调用方（`afterConstraintChange`）；`runs.requestRenegotiation`（仅 pending_approval / needs_input，不 bump） | 写 `endedReason`（"constraints_changed" / "renegotiation_requested"）；room.currentRunId 由新 run 覆盖 |
| needs_input / failed | cancelled | `rooms.close`、`close_without_change` 答复 | — |

confirmed、superseded、cancelled 是终态。修订已执行结果 = 开新 run（trigger `renegotiation_requested`），旧变更单不受影响。

## 3. 代理回合 `agentTurns.status`

| from | to | 函数 | 守卫 |
| --- | --- | --- | --- |
| （新建） | running | `startTurn`（internalMutation） | 回合持久化守卫 G-T；`modelCallCount < maxModelCalls` 后 +1 |
| running | succeeded | `completeTurn` | G-T 通过且输出通过 Zod 与业务校验 |
| running | invalid_output | `completeTurn` | 输出不合法（stop_reason ≠ end_turn、JSON/Zod 失败、candidateKey 不在快照中）；attempt < 2 时自动 `retryTurn` |
| running | failed | `failTurn` / `turnWatchdog` | 异常或超时 |
| running | stale | `completeTurn` / `failTurn` | G-T 不通过；只记录用量与原因，写 `turn_rejected_stale` 事件 |

**回合持久化守卫 G-T**（只用于回合）：`room.currentRunId === turn.runId` ∧ `run.status === "negotiating"` ∧ `run.openTurnSeqs` 含 `turn.turnSeq` ∧ `room.constraintsVersion === run.constraintsVersionAtStart` ∧ 该 (run, turnSeq) 的最新 attempt 就是本回合。

**审批/执行守卫 G-A**（只用于签字与执行，不能与 G-T 混用）：`room.status === "active"` ∧ `run._id === room.currentRunId` ∧ `run.status === "pending_approval"` ∧ `proposal._id === room.currentProposalId` ∧ `proposal.status === "active"`，再加 06 `validateProposal` 在当前快照下通过。

## 4. 提案 `proposals.status`

| from | to | 函数 | 说明 |
| --- | --- | --- | --- |
| （新建） | active | `insertProposal` | 原 currentProposal（若 active）同事务 → superseded；room.currentProposalId 指向新提案 |
| active | superseded | `insertProposal`（新提案出现） | 旧签字随之派生失效 |
| active | executed | `executeProposal` | 仅一次 |

**派生显示状态**（不入库，`rooms.view` 计算）：`executed`、`superseded`、`current_executable`、`current_blocked`（validate 不通过）、`current_awaiting_reapproval`（有效但签字版本落后）。约束变化**不改变**提案 status。

## 5. 签字（派生，无存储状态）

每个 (proposal, user) 的**显示状态**由最新分录与当前快照派生：

| 最新分录 | 条件 | 显示 |
| --- | --- | --- |
| 无 | — | pending |
| approve | cv 相等 ∧ 提案是当前 | approved |
| approve | cv 不等 或 提案非当前 | stale |
| reject | cv 相等 | rejected |
| reject | cv 不等 | stale_reject |
| withdraw | — | withdrawn（计为 pending） |
| 任意 | 提案 executed | 以 changeOrder.authorizingDecisionIds 为准显示 "signed (executed)" |

允许的分录序列（`decisions.*` 守卫）：approve 只在 G-A 与 validate 通过时；reject 只需 G-A 的前四项（可执行性不要求）；withdraw 只在最新分录是同 cv 的 approve 且提案未执行。

## 6. 人工请求 `humanRequests.status`

| from | to | 函数 | 守卫 |
| --- | --- | --- | --- |
| （新建） | open | `openHumanRequests`（代码） | 同一 run 同一 targetRole 至多一条 open |
| open | answered | `requests.answer` | 调用者 role === targetRole；`request.constraintsVersion === room.constraintsVersion`；optionKey 在 options 中 |
| open | cancelled | `bumpConstraints` 的调用方、`rooms.close`、同 run 另一请求被回答 | cancelReason 必填 |

## 7. 邀请与任务

| 机器 | 迁移 | 守卫 |
| --- | --- | --- |
| invite | unused → accepted（`invites.accept`）；unused → revoked（owner）；expired 由 `expiresAt < now` 派生 | 角色未被占、用户未入房 |
| task | todo → in_progress → done；in_progress → todo | 只有 assigneeRole 的成员；变更单不受影响 |
