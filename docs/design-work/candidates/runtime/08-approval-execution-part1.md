# 08 审批与执行（part1）：绑定、必需审批人、decide 与执行的事务时序

> 分片：part1 本页；part2 撤回与过期、并发与重复、执行派生、执行边界、拒绝之后。

## 8.1 审批绑定什么

一条 `approve` 决定绑定三样东西：`proposalId`（不可变提案）、决定时的 `constraintsVersion`、`termsKey`（terms 的规范串，与提案相同，作冗余证据）。

- 不用内容哈希：提案文档永不修改，`proposalId` 本身就证明"批准的就是这份条款"；`termsKey` 是可读的规范串（如 `LOGIN+REPORTS|standard|2026-11-20|80000|RUSH:-`），避开 Convex 运行时对 `crypto.subtle` 的不确定性（F03.7）。
- **人批准的必须是他看到的**：`decisions.decide` 要求客户端回传 `expectedConstraintsVersion` 与 `expectedTermsKey`（来自它订阅到的 `rooms.workspace`），与服务端当前值不一致即返回 `STALE_VIEW`，不写入任何东西（T-07）。客户端值只用于比较，存储的永远是服务端值。
- 约束版本一变，旧决定派生为 `stale_approve` / `stale_reject`，记录不删不改（核心 3、6；04 §4.7）。

## 8.2 谁必须批准

- 由场景 `requiredApprovals(input)` 决定，**在提案创建时快照**进 `proposals.requiredApprovals`，执行时以快照为准（F08.2、RA-R05）。首个场景：customer（terms）、provider（terms）、finance（budget）。
- 两类审批（ADR-14，F08.3）：provider 与 customer 签 "Accept terms"，finance 签 "Approve budget commitment"。两类都绑定同一个提案与约束版本，是同一个流程里的两种按钮文案与审计类型，不是两套流程。
- **完成判定按集合**：对每个必需（角色，审批类型），存在一个该角色的参与者，其对本提案的最新决定是 approve 且 `constraintsVersion === room.constraintsVersion`；并且这些参与者的 userId 两两不同。禁止 `approvals.length >= N` 式计数（双击会让计数提前达标）。
- 房间创建者身份不带来审批权；代理的 `recommend_accept` 从不写入 `decisions`（核心 2，F05.7）。

## 8.3 `decisions.decide` 的事务时序

```ts
decide(args: {
  proposalId: Id<"proposals">; decision: "approve" | "reject" | "withdraw";
  expectedConstraintsVersion: number; expectedTermsKey: string;
  reasonCode?: string; reasonNote?: string; reasonNoteAudience?: "private" | "room";
}): Promise<
  | { kind: "recorded"; decisionId: Id<"decisions">; state: DecisionState }
  | { kind: "unchanged"; state: DecisionState }
  | { kind: "executed"; executionId: Id<"executions">; changeOrderId: Id<"changeOrders"> }
  | { kind: "renegotiating"; runId: Id<"runs"> }>
```

| 步 | 动作（全部在一个 mutation 内） | 失败 → 结果 |
| --- | --- | --- |
| 1 | `requireUser`；读 proposal、room；`requireParticipant(room)` | `UNAUTHENTICATED` / `NOT_FOUND` / `NOT_PARTICIPANT` |
| 2 | G-D1 房间 open | `ROOM_CLOSED` |
| 3 | G-D2 调用者角色在 `proposal.requiredApprovals` 中 → 得到 `approvalKind` | `FORBIDDEN_ROLE` |
| 4 | G-D7 `executions.by_proposalId` 无记录。已执行时：若本次是 approve 且调用者对该提案的最新决定就是 approve（双击、重连重发），返回已有执行的 `executed` 结果（幂等）；其他情况报错 | `ALREADY_EXECUTED` |
| 5 | G-D3 当前提案；G-D4 活跃 run 为 awaiting_approval 且指向该提案 | `NOT_CURRENT` / `INVALID_STATE` |
| 6 | G-D5 `expectedConstraintsVersion`、`expectedTermsKey` 与服务端一致 | `STALE_VIEW` |
| 7 | 派生调用者当前决定状态，按 04 §4.7 表判断：相同决定 → 返回 `unchanged`（双击幂等） | `INVALID_STATE`（如对 pending 撤回） |
| 8 | approve：`ruleInput = loadRuleInput(room)`，`evaluateProposal` 必须 executable（G-D6）；reject：`reasonCode` ∈ 场景 `humanReject` 词表，备注 ≤ 500 字符 | `NOT_EXECUTABLE` / `VALIDATION_FAILED` |
| 9 | 插入 `decisions` 行（roleKey、approvalKind 取自快照；constraintsVersion、termsKey 取自服务端） | — |
| 10 | 事件 `decision_recorded`；reasonNote 公开时随事件渲染 | — |
| 11a | approve → `executeIfReady`（8.4）；执行了则返回 `executed`，否则 `recorded` | 见 8.4 |
| 11b | reject → `supersedeRunTx(run, "rejected")` → `startRunTx({ kind: "rejection", proposalId, decisionId }, origin: "system")`，返回 `renegotiating`（新 run 可能是 running，也可能直接 waiting_human，见 04 §4.2.3 第 5–6 步） | — |
| 11c | withdraw → 返回 `recorded` | — |

任何一步失败都整体回滚，不会出现"决定已写但事件没写"或"执行了一半"。

## 8.4 `executeIfReady(ctx, { room, run, proposal, ruleInput, lastDecisionId })`

| 步 | 动作 | 结果 |
| --- | --- | --- |
| E1 | G-E1 集合判定（8.2）；收集满足要求的 decisionIds | 未齐 → 返回"未执行"，8.3 第 11a 步返回 `recorded` |
| E2 | G-E2 重新按 `commitments.by_room` 汇总台账，必须等于 `ruleInput.scenarioState.committedCents`（快照）；再用汇总值与当前时间调用 `evaluateProposal`，必须 executable | 汇总不等 → 抛 `ENGINE_LEDGER_DRIFT`（不变量被破坏，回滚并告警）；不可执行 → 抛 `NOT_EXECUTABLE`（理论上不可达：同一事务内刚做过 G-D6） |
| E3 | G-E3 `operationKey = "exec:" + proposalId + ":" + room.constraintsVersion`；`executions.by_operationKey` 命中 → 返回已有执行 | 幂等（第二道保险兼审计键） |
| E4 | `d = scenario.deriveExecution(proposal, ruleInput)`（纯函数，与审批面板预览同一个函数） | — |
| E5 | 插入 `executions`（decisionIds、triggeredByUserId、derivationVersion）；`scenario.writeExecution(ctx, executionId, d)` 插入 `changeOrders`、`commitments{kind:"execution"}`、`tasks` | — |
| E6 | `assertTransition(run, "awaiting_approval" → "executed")`；patch run（status、endedAt、endedReason executed）；事件 `execution_completed` | — |
| E7 | `bumpConstraints(ctx, room, { kind: "execution_recorded", executionId })`：台账变了，约束版本 +1，快照中 committedCents 增加；房间已没有活跃 run，所以不会自动开始新的协商（09 §9.4） | — |
| E8 | 返回 `{ kind: "executed", executionId, changeOrderId }` | — |

主防线是**状态守卫**（G-D7 / G-D4：执行后提案有执行记录、run 为 executed，任何重复调用在第 4 步就返回已有结果或被拒），operationKey 是第二道保险（F08.4）。两者加上 OCC，保证重复点击、并发最后两票、客户端重连重发都不会产生第二条承诺或第二批任务（核心 5）。
