# 04 状态机（事件溯源候选）

## 0. 原则

| # | 决定 | 理由 |
| --- | --- | --- |
| SM-1 | **状态迁移 = 事件**。每条迁移由一个事件类型表示；`applyEvent` 是唯一改状态字段的地方，且必经 `assert*Transition` | 迁移历史天然在日志里；不存在"手工赋值" |
| SM-2 | 分层：房间生命周期 / run / 回合 / 提案（派生）/ 决定（派生）/ 人工请求 / 邀请 / 简报 | Role A 的 7 值 RoomStatus 混合了这些维度（RA-D04） |
| SM-3 | 能派生的不存：提案状态、可执行性、决定有效性、邀请过期 | DM-5 |
| SM-4 | 约束变更时：**旧 run → superseded + 新 run**（trigger `constraints_changed`）；不在同一 run 内回到 negotiating | 新 run 的 `constraintsVersionAtStart` 成为回合守卫的锚点，迟到结果判定简单；每个 run 对应一组固定约束，审计可读（裁决 F04.1 整理者注） |
| SM-5 | 人在 pending_approval 中拒绝：**同一 run** 回到 negotiating（round+1），轮次用尽则 needs_input | 约束没变，不需要新锚点 |

## 1. 房间

| from | to | 事件 | 触发者 | 守卫 |
| --- | --- | --- | --- | --- |
| （无） | open | room_created | 允许名单用户（`rooms.create`） | 已认证；`ROOM_CREATORS` 名单或开放模式（15） |
| open | closed | room_closed（+ 活动 run 的 run_superseded{room_closed}、open 请求的 human_request_cancelled） | owner | 无执行进行中（执行是同步的，天然满足） |

closed 是终态；closed 房间的所有命令 plan 返回 `ROOM_CLOSED`。"准备就绪"（三方简报都已确认、目录非空、预算已设）是派生量 `readiness`，不是状态。

## 2. Run

`runStatusV = "negotiating" | "pending_approval" | "needs_input" | "failed" | "confirmed" | "superseded"`

```ts
// convex/engine/state/run.ts
export const RUN_ALLOWED: Record<RunStatus, readonly RunStatus[]> = {
  negotiating:      ["pending_approval", "needs_input", "failed", "superseded"],
  pending_approval: ["confirmed", "negotiating", "needs_input", "superseded"],
  needs_input:      ["negotiating", "pending_approval", "superseded"],
  failed:           ["negotiating", "superseded"],
  confirmed:        [],
  superseded:       [],
};
export function assertRunTransition(from: RunStatus, to: RunStatus) {
  if (!RUN_ALLOWED[from].includes(to)) throw new ConvexError({ code: "INVALID_TRANSITION", from, to });
}
```

| # | from | to | 事件 | 触发者 | 守卫（plan 中检查） |
| --- | --- | --- | --- | --- | --- |
| R1 | （无） | negotiating | run_started | 反应器（最后一份必需简报确认后）/ 任一成员 `runs.start` / 约束变更反应 / 人工回答反应 | room open；readiness 满足；`currentRunNo` 为空或其 run 已终态；`AGENTS_ENABLED` 或 stub |
| R2 | negotiating | pending_approval | run_ready_for_approval | 反应器（customer 与 finance 评估回合都 recommend_accept 且提案校验通过） | 提案为 current；`proposal.validation.ok`；run.constraintsVersionAtStart = room.constraintsVersion |
| R3 | negotiating | needs_input | run_needs_input（+ human_request_opened） | 反应器 | 代码判定无可行候选 / 轮次用尽 / 评估回合 reject NEEDS_TRADEOFF / 调用上限 |
| R4 | negotiating | failed | run_failed | `failTurn` 或 `turnWatchdog` | 自动重试已用尽（10 §3） |
| R5 | negotiating / pending_approval / needs_input / failed | superseded | run_superseded | 约束变更命令的反应器 / room_closed / `runs.start{restart}` | — |
| R6 | pending_approval | confirmed | execution_completed | `approvals.decide`（最后一票） | 08 §3 的审批/执行守卫全部通过 |
| R7 | pending_approval | negotiating | run_resumed{human_rejected} | 反应器（人拒绝） | round < maxRounds |
| R8 | pending_approval | needs_input | run_needs_input | 反应器（人拒绝） | round = maxRounds |
| R9 | needs_input | negotiating | run_resumed{human_answer} | `requests.answer`（澄清请求选 keep_as_is） | 请求属于本 run 且 constraintsVersion 未变 |
| R10 | needs_input | pending_approval | proposal_created{authorKind:human_option} + run_ready_for_approval | `requests.answer`（choose_candidate） | 选项的 constraintsVersion = room.constraintsVersion |
| R11 | failed | negotiating | run_resumed{retry} | 任一成员 `runs.retryTurn` | 调用上限未到；`AGENTS_ENABLED` |

改变硬约束的回答（raise_budget、relax_deadline）走 R5 + 新 run 的 R1，而不是 R9。

## 3. 回合（agentTurns，普通表，但迁移同样受守卫）

| from | to | 写入者 | 条件 |
| --- | --- | --- | --- |
| （无） | running | 反应器 `scheduleTurn` / `runs.retryTurn` | 同一 mutation 内 `runAfter(0, runTurn)` + `runAfter(WATCHDOG_MS, turnWatchdog)` |
| running | succeeded | `completeTurn` | 持久化守卫全过 + 输出通过 Zod 与候选成员检查 |
| running | invalid_output | `completeTurn` | 守卫过、输出不合法（含 recommend_accept 一个校验失败的提案）|
| running | failed | `failTurn` / `turnWatchdog` | 异常、非 end_turn、超时 |
| running | stale | `completeTurn` / `failTurn` | 持久化守卫不过 |

**回合持久化守卫**（`completeTurn`、`failTurn` 都先检查；任一不满足 → 回合 stale + 事件 turn_rejected_stale，结果丢弃，仅记用量）：
1. `turn.status === "running"` 且 `attempt` 匹配；
2. `room.currentRunNo === turn.runNo` 且 `run.status === "negotiating"`；
3. `room.constraintsVersion === turn.constraintsVersion`（= run.constraintsVersionAtStart）；
4. 评估回合：`room.currentProposalVersion === turn.baseProposalVersion`。

**审批/执行守卫**（`approvals.decide`）见 08 §3。两组守卫不得混用（F04.2）：回合守卫比"run 与约束锚点"，审批守卫比"当前提案与当前约束"。

## 4. 提案（派生，无存储状态）

| 派生状态 | 条件 | 界面 |
| --- | --- | --- |
| executed | 存在 `changeOrders(roomId, proposalVersion)` | Executed |
| current · executable | `currentProposalVersion = v` 且 run.status = pending_approval 且 `validateProposal` 通过且 `constraintsVersion = room.constraintsVersion` | 可批准 |
| current · evaluating | 同上但 run.status = negotiating | Agents reviewing |
| current · blocked | `currentProposalVersion = v` 但约束版本不符或校验失败 | Blocked + reasonCodes（按角色投影） |
| superseded | 其余 | Superseded |

## 5. 决定（派生有效性）

`decisions` 行不可变。对 (proposalVersion, userId) 取 `seq` 最大的一行为"最新决定"：

| 最新决定 | 条件 | 有效性 |
| --- | --- | --- |
| approve | `constraintsVersion = room.constraintsVersion` 且提案 current | effective_approve（计入完成判定） |
| approve | 否则 | stale（显示 "Approved under constraints v{n} — no longer counts"） |
| reject | 同上条件 | effective_reject / stale_reject |
| withdraw | — | none（等同未决定） |

规则：approve 需要提案当前可执行（RA-R06）；reject 随时可以；withdraw 仅在提案未执行时；执行后不可撤回（plan 返回 `ALREADY_EXECUTED`）。

## 6. 人工请求

| from | to | 事件 | 触发者 | 守卫 |
| --- | --- | --- | --- | --- |
| （无） | open | human_request_opened | 反应器（代码判定） | 每个 run 同一 targetRole 至多一条 open |
| open | answered | human_request_answered | 目标角色本人 `requests.answer` | `request.constraintsVersion === room.constraintsVersion`；optionKey 属于 options |
| open | cancelled | human_request_cancelled | 任一约束变更的反应器 / run_superseded / room_closed | — |

## 7. 邀请与简报

- 邀请：`pending → accepted`（`invites.accept`，产生 member_joined）、`pending → revoked`（owner 重新签发时旧令牌作废）；`expired` 派生（`now > expiresAt`）。邀请表是普通表，只有 accepted 产生事件。
- 简报：草稿（普通表，可反复保存）→ `briefs.confirm` 产生 `brief_confirmed{version+1}`；确认版本不可改，只能确认新版本。

## 8. 迁移与事件对照（检查表）

| 事件 | 改变的状态 |
| --- | --- |
| run_started | runs 新行 negotiating；rooms.currentRunNo、lastRunNo |
| proposal_created | proposals 新行；rooms.proposalVersion、currentProposalVersion；runs.round |
| run_ready_for_approval / needs_input / resumed / failed / superseded | runs.status（经 assertRunTransition）；superseded/confirmed 时清空 rooms.currentRunNo |
| execution_completed | runs.status = confirmed；changeOrders/commitments/tasks 新行；清空 currentRunNo |
| human_request_* | humanRequests.status |
| decision_recorded | decisions 新行（无状态字段变化） |
