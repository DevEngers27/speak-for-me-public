# 04 状态机 · part2：回合、人工请求、邀请、任务；提案与审批的派生状态

## 4. 代理回合（agentTurns，每次尝试一行）

| # | from | to | 函数 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| T-0 | （无） | running | `scheduleTurn` | 调用方已通过 run 守卫；llm 模式下 `AGENTS_ENABLED` 且 `modelCallsUsed < budget` | `modelCallsUsed += 1`（llm）；插入回合（attempt、constraintsVersion 快照、`deadlineAt = now + TURN_DEADLINE_MS`）；`runAfter(0, internal.agents.executeTurn)` 与 `runAfter(TURN_DEADLINE_MS, internal.agents.turnWatchdog)`，两个 id 写回回合；加入 `run.pendingTurnIds`（RN-4、RN-5） |
| T-1 | running | succeeded | `completeTurn` | `assertTurnLive`（RN-3）通过；输出通过 Zod 与业务校验 | 写 output；移出 pendingTurnIds；按动作分派（05 §4）；可能插入提案、打开请求、结算轮次 |
| T-2 | running | invalid_output | `completeTurn` | 活性守卫通过；输出不合法（schema 不符、未知报价行、日期非法、违反本角色动作集） | errorCode；若自动尝试未耗尽 → `scheduleTurn(attempt + 1)` 替换 pending；否则 run → failed（R-3） |
| T-3 | running | failed | `failTurn`（action 的 catch）/ `turnWatchdog`（到期仍 running） | 活性守卫通过 | errorCode（TIMEOUT、REFUSAL、TRUNCATED、HTTP_5XX、HTTP_4XX…）；可重试码且未耗尽 → 重排；否则 run → failed |
| T-4 | running | stale | `completeTurn` / `failTurn` | 活性守卫**不**通过（run 已不是当前、约束版本已变、回合不在 pending 中） | 只记 modelCall 用量；事件 turn_rejected_stale；不写任何业务表 |
| T-5 | running | cancelled | `cancelLiveTurns`（由 R-9/R-10/R-11/R-13 调用） | — | 尝试 `ctx.scheduler.cancel(scheduledFnId)`，包 try/catch（已开始或已完成的调用不能取消，inputs/04 §1.5）；迟到结果到达时因状态非 running 只记用量 |

终态：succeeded、invalid_output、failed、stale、cancelled。重试不复用旧行，而是插入 attempt + 1 的新行，这样每次模型调用都有自己的用量与结果记录。

可重试错误码：`SCHEMA_INVALID`、`UNKNOWN_LINE`、`ACTION_NOT_ALLOWED`、`TRUNCATED`、`TIMEOUT`、`HTTP_5XX`、`HTTP_429`。不可重试：`HTTP_4XX`（BadRequest 视为编程错误）、`REFUSAL`、`AGENTS_DISABLED`、`CALL_BUDGET_EXHAUSTED`。`MAX_AUTO_ATTEMPTS = 2`（同一 (run, round, step, role) 自动最多 2 次；人工 `runs.retry` 再加 1 次，仍受调用预算约束）。

## 5. 人工请求（humanRequests）

| # | from | to | 函数 | 触发者 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- | --- | --- |
| H-0 | （无） | open | `openRequests` | 系统（`startRun` 可行集为空、轮次结算、clarify 分派） | 只有代码构造的问题与选项（HR-1）；数值参数满足派生闭包（HR-3） | blocking 请求让 run → awaiting_input（HR-4）；事件 request_opened（目标）、request_waiting（房间） |
| H-1 | open | answered | `requests.answer` | 目标参与方 | `requireParticipant` 且等于 targetParticipantId；`request.constraintsVersion = room.constraintsVersion`；optionKey 存在且不是 decline | 执行选项效果（05 §6）：改简报类效果经 `commitBriefVersion`（会 bump，进而 CS-6 关闭其余请求、R-9 换 run）；disclose 产生新简报版本但不 bump；choose_package 走 R-5 |
| H-2 | open | declined | `requests.answer`（decline） | 目标参与方 | 同上 | 若是 disclosure：回到 R-4；若同组 tradeoff/choose_package 全部 declined：R-6 |
| H-3 | open | cancelled | `closeRequest`（由 `onConstraintsChanged`、R-11、R-13 调用） | 系统 | — | 事件 request_closed |

一个 tradeoff 组可能同时发给多个角色（09 §5）。第一个改变约束的回答通过 bump 取消其余请求（CS-6），因此"谁先回答谁的选择生效"，其他人看到请求已因约束变化关闭。

## 6. 邀请与任务

| 实体 | 迁移 | 函数 | 触发者 | 守卫 |
| --- | --- | --- | --- | --- |
| invite | （无）→ open | `invites.create`（action）→ `invites.insertHashed` | 房主 | roleKey ∈ 场景角色且该角色尚无参与方；同键旧 open 行 → revoked |
| invite | open → accepted | `invites.accept` | 持有 token 的已登录用户 | ID-3、ID-4、ID-6；房间 open |
| invite | open → revoked | `invites.revoke`、`rooms.close`、新邀请覆盖 | 房主 / 系统 | — |
| invite | expired（派生） | — | — | `now ≥ expiresAt` 时 accept 返回 `INVITE_EXPIRED` |
| task | todo → in_progress → done；done → in_progress；in_progress → todo | `tasks.setStatus` | 角色 = assigneeRoleKey 的参与方 | 房间 open；迁移在表内 |

## 7. 提案的派生状态（PR-1：提案行不变，状态全靠读取时计算）

```ts
function proposalDisplayState(p, room, executionByProposal): ProposalState {
  if (executionByProposal.has(p._id)) return { kind: "executed" };
  if (p.creationVerdict === "blocked") return { kind: "rules_blocked", reasons: p.creationChecks };
  if (room.currentProposalId === p._id) {
    const checks = evaluateProposal(p.terms, currentInputs, todayIn(room.timeZone));
    return allPass(checks) ? { kind: "current", executable: true }
                           : { kind: "current", executable: false, checks };   // 理论上只在跨日后出现
  }
  return { kind: "superseded" };
}
```
说明：约束变化使当前提案失败时，R-10 会把 run 迁走并清空 `currentProposalId`，所以 "current 但不可执行" 只会因为"今天"推移（交付日或报价有效期越过当天）而出现；此时审批按钮禁用（DE-3），界面提示"请求重谈"。被约束变化淘汰的提案显示为 superseded，并附上它在当前约束下的检查结果（以 reasonCode 解释"为什么被阻断"，满足 AC-03）。

## 8. 审批的派生状态（DE-4）

```ts
function approvalState(proposal, role, room, decisionsOfProposal): ApprovalState {
  const mine = decisionsOfProposal.filter(d => d.roleKey === role);
  const latestAt = (cv) => maxBy(mine.filter(d => d.constraintsVersion === cv), d => d.roomSeq);
  const cur = latestAt(room.constraintsVersion);
  if (cur?.kind === "approve") return "approved";
  if (cur?.kind === "reject") return "rejected";
  if (cur?.kind === "withdraw") return "pending";
  const older = maxBy(mine.filter(d => d.constraintsVersion < room.constraintsVersion), d => d.roomSeq);
  if (older?.kind === "approve") return "stale_approve";
  if (older?.kind === "reject") return "stale_reject";   // Role A RA-B30 的修正
  return "pending";
}
```
执行守卫只认 `approved`；界面对 stale_* 显示"你曾在约束 v{n} 下批准/拒绝；约束已更新到 v{m}，请重新决定"。

## 9. 迁移与不变量的交叉检查

| 风险 | 可能破坏 | 为什么不会 |
| --- | --- | --- |
| 两个 mutation 同时为同一房间 `startRun` | RN-1 | 二者都 patch rooms（M-ROOM），OCC 让后者重试并看到 `currentRunId` 已设置 |
| 迟到的模型结果在约束变化后写入提案 | CS-5、RN-3 | `cancelLiveTurns` 已把回合标为 cancelled；即便没来得及，`assertTurnLive` 比较约束版本 |
| 最后两票并发 | EX-1 | 都 patch rooms；后提交者重试时 `by_proposalId` 已命中执行，返回已有结果 |
| 审批与预算下调并发 | DE-3、EX-5 | M-ROOM 串行：下调先提交则审批重试时按新约束评估；审批先执行则下调重试时 `budgetCapCents ≥ committed` 按新台账判断 |
| run 停在 awaiting_input 却没有 open 请求 | HR-4 | 关闭请求的唯一入口 `closeRequest` 在同事务计算剩余 blocking 请求并迁移 run（R-4 / R-6） |
| 拒绝后无路可走（RA-B16） | 流程完整性 | R-8 必然启动新 run，新 run 必然进入 negotiating、awaiting_input 或 failed 之一，三者都有明确的人工出口 |
| run 一直 negotiating（action 丢失） | RN-4 | 每个 running 回合都有 watchdog；到期置 failed 并按重试策略推进 |
