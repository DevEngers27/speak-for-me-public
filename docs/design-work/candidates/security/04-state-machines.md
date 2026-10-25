# 04 状态机（part1：迁移表框架、房间、席位与邀请、简报、run）

> 本章分 2 个文件：part1（本文件）；part2 代理回合、提案与决定（派生）、人工请求、两组守卫、并发与竞态表。
> 原则：存储的状态只有生命周期型状态（房间、run、回合、人工请求、邀请）；"可执行""被阻断""已过期"之类全部派生（02 §2.7）。每个存储状态的修改都经 `assertTransition`，迁移表是代码常量。

## 4.1 迁移表框架

```ts
// packages/engine/src/stateMachines.ts
export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  running:           ["running", "awaiting_approval", "needs_human", "failed", "superseded", "cancelled"],
  awaiting_approval: ["executed", "running", "needs_human", "superseded", "cancelled"],
  needs_human:       ["awaiting_approval", "superseded", "cancelled"],
  failed:            ["running", "superseded", "cancelled"],
  executed: [], superseded: [], cancelled: [],
};
export function assertTransition<S extends string>(table: Record<S, readonly S[]>, from: S, to: S): void {
  if (!table[from].includes(to)) throw new ConvexError({ code: "ILLEGAL_TRANSITION" });
}
```

`ILLEGAL_TRANSITION` 只应在代码缺陷时出现；它让一个错误的迁移整笔回滚，而不是静默写入。每张迁移表有单测穷举"允许 / 不允许"。

## 4.2 房间生命周期

| # | from → to | 触发函数 | 触发者 | 守卫 | 同事务副作用 | 失败后状态 |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | — → `setup` | `rooms.create` | 有建房资格的用户 | 场景存在；`timeZone` 合法；标题与目标通过文本校验；所选席位角色存在 | 插入房间（cv 0）、全部席位、创建者绑定所选席位；事件 `room_created`、`seat_filled` | 无房间 |
| L2 | `setup` → `active` | `activateRoomIfReady`（被 `invites.accept`、`briefs.confirm`、`catalog.publish` 在末尾调用） | 系统 | 全部席位 `occupied`；每个角色都有已确认简报版本且 `inherentDisclosuresAck`；场景 `readiness(input)` 为空（如目录已发布、`baselineCommittedCents ≤ capCents`） | cv ← 1；写 `constraintSnapshots(cv=1, cause=activation)`；`startRun(trigger="initial")`；事件 `room_activated` | 保持 `setup`，不报错 |
| L3 | `setup`/`active` → `closed` | `rooms.close` | 房主 | 未关闭 | 当前非终态 run → `cancelled`（outcome `ROOM_CLOSED`）；open 人工请求 → `cancelled`；open 邀请 → `revoked`；尽力 `scheduler.cancel` 未开始的回合；事件 `room_closed` | 不变 |

没有重新打开：关闭后一切只读（I-28）。修订已执行的变更单不需要新房间：在 `active` 房间中请求重新协商即可（R9）。

## 4.3 席位与邀请

| # | 对象 | from → to | 触发 | 守卫 |
| --- | --- | --- | --- | --- |
| S1 | 席位 | — → `open` | `rooms.create` | 一次性插入 |
| S2 | 席位 | `open` → `occupied` | `rooms.create`（创建者）/ `invites.accept` | 07 §7.7 的全部检查；不可逆 |
| V1 | 邀请 | — → `open` | `internal.invites.store` | 调用者是房主；席位 `open`；房间未关闭；同席位旧 open 邀请先置 `revoked` |
| V2 | 邀请 | `open` → `accepted` | `invites.accept` | 未过期（`now < expiresAt`）；席位仍 `open`；接受者在本房间无席位 |
| V3 | 邀请 | `open` → `revoked` | `invites.revoke` / 重新发邀请 / 房间关闭 | 调用者是房主（或系统） |

"过期"不存储：`peek` 与 `accept` 都按 `expiresAt` 判断。

## 4.4 简报

草稿没有状态机（自由编辑，`baseVersion` 做乐观并发：确认时若 `draft.baseVersion !== 当前最大 version` 返回 `STALE_DRAFT`，提示先合并）。确认动作：

| # | 动作 | 触发 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- |
| B1 | 确认新版本 | `briefs.confirm` | 本人席位；房间未关闭；`extractedFieldKeys` 为空（抽取预填的字段都已逐项确认）；内容通过场景校验；`inherentDisclosuresAck`；披露受众合法；若 lifecycle 为 `active` 且硬约束变化，还要通过场景的"变更守卫"（如 finance 的 `capCents ≥ committedCents`） | `writeBriefVersion`；若 `active` 且 `hardDigest` 变化 → `bumpConstraints`（09）；若披露变化 → 事件 `disclosure_changed`；事件 `brief_confirmed`；setup 期末尾调用 `activateRoomIfReady` |
| B2 | 内容与上一版本完全相同 | `briefs.confirm` | — | 拒绝 `NO_CHANGES`，不产生空版本 |

## 4.5 run

run 的含义：在一个固定约束版本下的一次协商尝试。每房间至多一个非终态 run（I-10）。

| # | from → to | 触发函数 | 触发者 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| R1 | — → `running` | `startRun`（被 `activateRoomIfReady`、`bumpConstraints`、`runs.requestRenegotiation` 调用） | 系统/参与方 | 房间 `active`；旧 run 已在同事务终止；全局可行性预检非空 | 插入 run（`round 0`、`phase idle`）；`room.currentRunId`；`scheduleTurn(propose, round 1, firstProposer)`（开关关闭时 `scheduleTurn` 把 run 置为 `failed`/`AGENTS_DISABLED`，开启后可重试）；事件 `run_started` |
| R2 | — → `awaiting_approval` | `startRun({ carryOver })`（仅 `bumpConstraints` 使用） | 系统 | 当前提案未执行且在新 cv 下求值通过 | 插入 run；`currentProposalId` 不变；事件 `run_started`、`run_awaiting_approval`。旧决定自动 stale，人需重新批准（不复制提案，ADR-10） |
| R3 | — → `needs_human` | `startRun` | 系统 | 全局可行性预检为空 | 为每个目标角色生成人工请求（05 §5.7）；事件 `run_needs_human` |
| R4 | `running` → `running` | `completeTurn` 内的轮次推进 | 系统 | 回合持久化守卫（part2 §4.9） | 新提案、`round + 1`、调度下一批回合 |
| R5 | `running` → `awaiting_approval` | `resolveRound` | 系统 | 当前提案求值通过，且无有效 counter 或已到 `maxRounds` | 事件 `reviews_completed`、`run_awaiting_approval` |
| R6 | `running` → `needs_human` | `resolveRound` / 调度前预检 / 调用上限 | 系统 | 到 `maxRounds` 仍无通过的提案；或预检为空；或 `callCount ≥ maxCalls` 且无通过的提案 | 生成人工请求；事件 |
| R7 | `running` → `failed` | `failTurn` / `turnWatchdog` | 系统 | 回合为当前回合；自动重试已用尽或错误不可重试 | 事件 `run_failed`（只带公开错误类） |
| R8 | `failed` → `running` | `runs.retry` | 任一成员 | `room.currentRunId === run._id`；`run.constraintsVersion === room.constraintsVersion`；`callCount < maxCalls`；该回合人工重试 < 3 次；限流 | 为失败的回合插入新尝试并调度 |
| R9 | `awaiting_approval` → `executed` | `decisions.decide`（最后一票） | 必需审批人 | 审批/执行守卫（part2 §4.9）；全部必需角色在当前 cv 上的当前决定为 approve | `executeInTx`：变更单、承诺、任务；`bumpConstraints(cause=executed)`；事件 `change_order_executed`、`run_ended` |
| R10 | `awaiting_approval` → `running` | `decisions.decide(reject)` | 必需审批人 | `round < maxRounds` 且 `callCount < maxCalls` | `nextProposerRoleKey` = 拒绝者角色；`round + 1`；调度该角色的 propose 回合（其上下文含本人拒绝理由与备注） |
| R11 | `awaiting_approval` → `needs_human` | `decisions.decide(reject)` | 必需审批人 | 轮次或调用已用尽 | 给拒绝者生成 `adopt_candidate`/`decline` 请求（候选来自拒绝者自己的视图） |
| R12 | `needs_human` → `awaiting_approval` | `requests.answer(adopt_candidate)` | 目标人 | 请求 open；`request.constraintsVersion === room.constraintsVersion`；由候选派生的人工提案求值通过 | 插入 `author.kind="human"` 的提案；同 run 其余 open 请求 → `cancelled` |
| R13 | `needs_human`（任意非终态）→ `superseded` | `bumpConstraints`（`requests.answer(amend_brief)`、简报确认、目录发布、改预算） | 系统 | cv 递增 | 见 09；新 run 由 R1/R2/R3 之一开始 |
| R14 | 任意非终态 → `superseded` | `runs.requestRenegotiation` | 任一成员 | run 不在 `running`；每用户每日上限 | 旧 run outcome `SUPERSEDED_BY_RENEGOTIATION`；`startRun(trigger="renegotiation")` |
| R15 | 任意非终态 → `cancelled` | `rooms.close` | 房主 | — | 见 L3 |

补充规则：
- R12 中若人工提案求值不通过（例如人选中的候选触犯了他看不见的卖方约束），请求记为 `answered`，run 保持 `needs_human`，并为同一目标重新生成请求，界面显示该提案的粗化阻断原因。每次这样的尝试都会产生一个公开的提案，因此人和代理一样，只能通过"提出提案"获得 1 位可行性信息（07 T-09）。
- `needs_human` 下全部请求都被拒绝（`decline`）时 run 停留在 `needs_human`，界面提示"Change a constraint or request renegotiation"；不引入额外的"停滞"状态。
- `paused` 不存在：原状态集中的 paused 由"`needs_human` + 人工请求"或"`failed` + 重试"覆盖（GAP-18）。
