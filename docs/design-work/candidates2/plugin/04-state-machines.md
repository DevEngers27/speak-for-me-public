# 04 状态机

> 所有状态机在 `packages/engine/src/state.ts` 以 `ALLOWED: Record<From, To[]>` + `assertTransition(machine, from, to)` 实现；任何改 status 的代码必须调用它。状态只存一份（runs/turns/proposals/humanRequests 的 `status`），能派生的不存。

## 1. Room

| from | to | 触发者 / 函数 | 守卫 |
| --- | --- | --- | --- |
| （无） | open | 用户 `rooms.create` / CLI `seed.createFromFixture` | 调用者在创建者允许名单（15）；插件 key 已注册 |
| open | closed | 创建者 `rooms.close`；或 humanRequest 选项 `close` 的回答 | 当前 run 为终态或随之 → superseded（endedReason `room_closed`） |

"可开始协商"是派生条件：`allRolesSeated && allBriefsConfirmed && catalogHasConfirmedEntry`。

## 2. Run（核心）

| # | from | to | 触发者 / 函数 | 守卫 | 同事务副作用 |
| --- | --- | --- | --- | --- | --- |
| R1 | （无） | negotiating | 参与方 `runs.start`；系统（约束变化、回答、拒绝、重谈） | room open；可开始协商；`currentRunId` 为空或指向终态 run；`enumerate` 非空 | 插 run；设 currentRunId；插 proposer turn；`runAfter(0, internal.agentTurns.run)` + watchdog |
| R1' | （无） | needs_input | 同 R1 | `enumerate` 为空 | 插 run；`tradeoffs` → humanRequests；不调模型 |
| R2 | negotiating | pending_approval | `internal.turns.complete`（最后一个评估回合） | 回合持久化守卫（§6）；本轮全部评估为 recommend_accept；当前提案 `evaluate` 通过 | 不新增事件类型；`rooms.view.todo` 为每位必需审批人生成待办 |
| R3 | negotiating | negotiating（round+1） | 同上 | 存在 object；`round < maxRounds` | 插下一轮 proposer turn，带上轮异议码 |
| R4 | negotiating | needs_input | 同上；或 proposer `decline` | 轮次用尽仍有异议；或 proposer 拒绝全部候选；或 `ask_principal` | `tradeoffs` / 话题模板 → humanRequest |
| R5 | negotiating | failed | `internal.turns.fail` / `internal.turns.watchdog` | 该回合应用级重试已用尽（10） | event turn_failed |
| R6 | failed | negotiating | 参与方 `runs.retryTurn` | `callCount < callLimit`；run 仍是 currentRun；约束版本未变 | 同 turnSeq、attempt+1 的新 turn |
| R7 | pending_approval | confirmed | 最后一票 `decisions.decide` | 08 的执行守卫全部通过 | 执行（08）；`currentRunId` 清空 |
| R8 | pending_approval | negotiating | 任一必需审批人 `reject` | run 是 currentRun；`round < maxRounds` | 新一轮 proposer turn，输入带拒绝的 reasonCode（不带 note） |
| R8' | pending_approval | needs_input | 同上 | 轮次用尽 | humanRequest 给 `plugin.tradeoffs` 指定的角色 |
| R9 | pending_approval | pending_approval | `bumpConstraints` 后的保留判定 | 当前提案在新 snapshot 下 `evaluate` 通过且 contentKey 不变 | 无写入；旧审批因版本不符自然变 stale |
| R10 | negotiating / pending_approval / needs_input / failed | superseded | `bumpConstraints` 后保留判定失败；`runs.requestRenegotiation`；`rooms.close` | run 是 currentRun | 取消 open humanRequests；尽力 `scheduler.cancel` 未开始的回合；当前提案 → superseded；随后 R1/R1' 新建 run |
| R11 | needs_input | pending_approval | targetRole `requests.answer`，effect 为 `proposal` | 请求 open 且属于当前 run；约束版本未变；所选 selection 在当前 snapshot 下 `evaluate` 通过 | 插 proposal（authorKind human_option，authorRole = 回答者）；不再调模型：回答者已代表本方做了取舍，其他方仍须各自审批 |

终态：confirmed、superseded。needs_input 回答若产生 ConstraintPatch，走 R10（约束变化）→ 新 run，而不是回到原 run。

**为什么约束变化用"旧 run superseded + 新 run"**：旧 run 的回合都基于旧 snapshot；新 run 让 `constraintsVersionAtStart` 成为一个干净的守卫值。例外是 R9：提案在新约束下仍完全成立时不浪费模型调用、也不复制提案（否决 Role A 的 revalidated 复制，RA-R11）。

## 3. Turn

| from | to | 触发 | 守卫 |
| --- | --- | --- | --- |
| （无） | running | `scheduleTurn` helper | run negotiating；`callCount < callLimit`（同事务 +1） |
| running | succeeded | `turns.complete` | 回合持久化守卫通过；输出通过 Zod 与动作合法性检查 |
| running | invalid_output | `turns.complete` / `turns.fail(kind:'invalid')` | stop_reason ≠ end_turn、JSON/Zod 失败、候选键不在 candidateKeys |
| running | failed | `turns.fail` / `turns.watchdog` | 网络/超时/4xx；watchdog 到期仍 running |
| running | stale | `turns.complete` / `turns.fail` | 持久化守卫不通过（run 已不是 current、约束已变、序号不符） |

invalid_output 与可重试的 failed 由引擎自动重排一次（attempt+1，同 turnSeq）；第二次仍失败 → R5。

## 4. Proposal

| from | to | 触发 |
| --- | --- | --- |
| （无） | active | `insertProposal`；同时把房间上一条 active 提案 → superseded，`currentProposalId` 指向新提案 |
| active | superseded | 新提案插入；R10 |
| active | executed | R7 |

"blocked/可执行"永远派生（06 `evaluate`），不存。

## 5. Decision（派生状态，每参与方对当前提案）

| 最新 decision | `decision.constraintsVersion == room.constraintsVersion` 且 contentKey 一致 | 显示 |
| --- | --- | --- |
| 无 / withdraw | — | pending |
| approve | 是 / 否 | approved / stale_approved |
| reject | 是 / 否 | rejected / stale_rejected |

写入规则：approve 要求 `evaluate` 通过且 run pending_approval；reject 同样只在 pending_approval 时可用（协商中的意见由代理表达）；withdraw 只能撤回自己的、且提案未 executed。

## 6. 两组守卫（不得混用）

| 组 | 用在 | 条件 |
| --- | --- | --- |
| 回合持久化守卫 | `turns.complete` / `turns.fail` | `room.currentRunId === turn.runId`；`run.status === 'negotiating'`；`run.pendingTurnSeqs.includes(turn.turnSeq)`；turn 为该 (runId, turnSeq) 的最新 attempt 且 status running；`room.constraintsVersion === run.constraintsVersionAtStart` |
| 审批/执行守卫 | `decisions.decide`（approve 与执行） | `run.status === 'pending_approval'`；`room.currentProposalId === proposalId`；proposal.status active；`evaluate(snapshot).executable`；集合判定（08） |

## 7. HumanRequest 与 Invite

| 机 | from | to | 触发 | 守卫 |
| --- | --- | --- | --- | --- |
| request | open | answered | `requests.answer` | 调用者 roleKey === targetRole；optionKey ∈ options；`request.constraintsVersion === room.constraintsVersion`；run 仍是 current |
| request | open | cancelled | R10、`rooms.close` | — |
| invite | unused | accepted | `invites.accept` | 未过期、未撤销、席位空、用户在本房间无席位 |
| invite | unused | revoked | 创建者 `invites.rotate` | 未接受 |
