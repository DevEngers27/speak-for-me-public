# 04 状态机

所有迁移经 `assertTransition(machine, from, to)`（纯函数，表驱动）；非法迁移抛 `ConvexError({ code: "ILLEGAL_TRANSITION" })`。每条迁移同事务写一条 event。

## 4.1 Room

| from | to | 触发者 / 函数 | 守卫 |
| --- | --- | --- | --- |
| — | open | owner / `rooms.create` | 登录；创建者在允许名单（`ROOM_CREATORS` 环境变量，空 = 任何登录用户，dev 默认） |
| open | closed | owner / `rooms.close` | 无非终态 run，或同事务把它置 canceled |

"可以开始协商"是派生值 `readiness(room)`：所有场景角色有成员、各自有 confirmed brief、目录至少一个 confirmed scope 条目、budget 已设置（>0）。

## 4.2 Run

| # | from | to | 触发者 / 函数 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| R1 | — | negotiating | 成员 `runs.start` / 系统 `startRunInternal` | room open；readiness；`room.currentRunId` 为空或指向终态 run；`jointFeasible ≠ ∅`；`AGENTS_ENABLED` | runSeq+1；`room.currentRunId`；调度提议方 turn |
| R2 | — | needs_input | 同上 | `jointFeasible = ∅` | 生成 tradeoff 请求（05 §5），零模型调用 |
| R3 | negotiating | negotiating | 系统 `agents.completeTurn` | 回合持久化守卫 G-T；本轮已结束且需要下一轮；`roundIndex < maxRounds` | roundIndex+1，调度下一轮 |
| R4 | negotiating | pending_approval | 系统 `completeTurn` | 本轮全部评估方 `recommend_accept`；`validateProposal = OK` | proposal → endorsed；`room.currentProposalId` |
| R5 | negotiating | needs_input | 系统 `completeTurn` | clarify 被接受 / 轮次用尽 / `NO_ACCEPTABLE_CANDIDATE` 且代码复核属实 | 生成 humanRequest |
| R6 | negotiating | paused | 系统 `failTurn` / `turnWatchdog` / `beginAttempt` | turn 尝试耗尽 / 调用上限 / 总开关关闭 | pauseReason |
| R7 | paused | negotiating | 成员 `runs.retryTurn` | `pauseReason=turn_failed`；`modelCallCount < modelCallLimit`；约束未变 | 同 turnSeq 新 attempt（不新建 turn） |
| R8 | needs_input | negotiating | 目标角色 `humanRequests.answer` | 答案效果为 `set_preference`（软约束，不 bump） | 写偏好；调度被打断的那个角色重新做本轮 turn |
| R9 | needs_input | pending_approval | 目标角色 `humanRequests.answer` | 效果 `choose_candidate`；候选仍通过 `validateProposal` | 插入 `authorKind=human_choice` 提案，直接 endorsed |
| R10 | pending_approval | executed | 最后一个审批人 `decisions.submit` | 审批 / 执行守卫 G-A + 集合判定 + 预算重算 | 08 执行步骤 |
| R11 | pending_approval | negotiating | 任一必需审批人 `decisions.submit(reject)` | G-A；`roundIndex < maxRounds` | proposal → rejected_by_human；reasonCode 进下一轮上下文 |
| R12 | pending_approval | needs_input | 同上 | 轮次用尽 | 给 customer 发 choose_option 请求 |
| R13 | 任一非终态 | superseded | 系统 `bumpConstraints` | — | 清空 room 指针；取消 open 请求；尽力取消已调度 turn |
| R14 | 任一非终态 | canceled | owner `runs.cancel` / `rooms.close` | — | 同 R13，但不自动重启 |

终态：executed、superseded、canceled。`failed` 不是 run 状态——回合失败让 run 进入可恢复的 paused，避免死路（Role A RA-B16）。

## 4.3 Turn

| from | to | 触发 | 守卫 / 说明 |
| --- | --- | --- | --- |
| — | running | `scheduleTurns`（在 R1/R3/R7/R8/R11 的 mutation 内） | 同事务 `runAfter(0, internal.agents.runTurn)` 与 `runAfter(TURN_DEADLINE_MS, internal.agents.turnWatchdog)` |
| running | running | `agents.recordAttempt`（invalid_output，attemptCount < 2） | 立即调度第 2 次 attempt，带错误反馈 |
| running | succeeded | `agents.completeTurn` | G-T 通过；决策通过 `checkDecision` |
| running | failed | `agents.failTurn` / `turnWatchdog` | 尝试耗尽、refusal、BadRequest、超时；→ run R6 |
| running | stale | `completeTurn` / `failTurn` | G-T 不通过；结果丢弃，只记用量 |
| running | canceled | R13 / R14 | 在途 action 跑完后其提交被 G-T 拒绝（stale_discarded 计入 modelCalls） |

### 两组守卫（不可混用）

```ts
// G-T 回合持久化守卫（completeTurn / failTurn / recordAttempt）
room.currentRunId === turn.runId && run.status === "negotiating"
  && turn.status === "running"
  && room.constraintsVersion === turn.constraintsVersionAtStart
  && room.catalogRevision === turn.catalogRevisionAtStart
  && attemptNo === turn.attemptCount            // 迟到的旧 attempt 被拒

// G-A 审批 / 执行守卫（decisions.submit）
run.status === "pending_approval" && room.currentProposalId === proposalId
  && proposal.constraintsVersion === room.constraintsVersion
  && proposal.status === "endorsed"
```

## 4.4 Proposal

| from | to | 触发 | 守卫 |
| --- | --- | --- | --- |
| — | under_review | completeTurn（propose / 被采纳的 counter） | 条款由 `materializeTerms` 生成 |
| — | endorsed | humanRequests.answer（choose_candidate） | validate OK |
| under_review | endorsed | completeTurn R4 | 全部评估方建议接受 |
| under_review | superseded | 下一轮产生新提案 | — |
| endorsed | rejected_by_human | decisions.submit(reject) | G-A |
| endorsed | executed | R10 | G-A + 完成判定 |

约束变更不改提案状态：显示状态 `displayState` 读时派生——`executed` / `current` / `current_blocked`（validate 失败）/ `stale`（`constraintsVersion ≠ room.constraintsVersion` 或不再是 current）/ `superseded` / `rejected_by_human`。

## 4.5 Decision（无状态机）
只追加；有效决定 = 对 (proposalId, room.constraintsVersion, userId) 取 `createdAt` 最新一条。`withdraw` 只在 run 未 executed 时允许，等价于"无决定"。

## 4.6 HumanRequest

| from | to | 触发 | 守卫 |
| --- | --- | --- | --- |
| — | open | 系统（R2/R5/R12） | 每 groupId 至多 3 个请求（每个目标角色一个） |
| open | answered | 目标角色 `humanRequests.answer` | 调用者 roleKey === targetRole；`constraintsVersion` 等于当前；optionKey 存在；同组未被答复 |
| open | canceled | bumpConstraints / 同组另一请求被答复 / run 终止 | — |

## 4.7 Invite

| from | to | 触发 | 守卫 |
| --- | --- | --- | --- |
| — | open | owner `invites.create` | 该 roleKey 尚无成员；同 roleKey 旧 open 邀请同事务 revoked |
| open | accepted | `invites.accept` | 未过期；调用者在该房间尚无角色；该 roleKey 尚无成员 |
| open | revoked | owner `invites.revoke` | — |
