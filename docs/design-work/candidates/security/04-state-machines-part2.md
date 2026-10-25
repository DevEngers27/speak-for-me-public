# 04 状态机（part2：代理回合、提案与决定、人工请求、两组守卫、竞态）

## 4.6 代理回合（一行 = 一次尝试）

| # | from → to | 触发 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- |
| T1 | — → `scheduled` | `scheduleTurn`（被 `startRun`、`completeTurn`、`decide(reject)`、`runs.retry`、自动重试调用） | run `running`；同 (run, round, role) 无非终态尝试；`callCount < maxCalls`（否则改走 R6） | `callCount + 1`；`runAfter(backoffMs, internal.agentRuntime.runTurn, {turnId})`；`runAfter(TURN_DEADLINE_MS, internal.agentRuntime.turnWatchdog, {turnId})` |
| T2 | `scheduled` → `running` | `beginTurn`（action 的第一步） | 回合持久化守卫（§4.9，除 `status` 外全部条件） | 冻结 `candidates`、输入版本 id；返回 `AgentContext` |
| T3 | `scheduled` → `rejected_stale` | `beginTurn` | 守卫不成立（run 已被取代等） | 不调用模型；action 直接结束 |
| T4 | `running` → `succeeded` | `completeTurn` | 回合持久化守卫成立且输出语义有效 | 写 `agentNotes`、可能的新提案、推进轮次（05） |
| T5 | `running` → `rejected_stale` | `completeTurn` | 守卫不成立 | 只记 `modelCalls` 用量与事件 `stale_result_discarded`；不写提案与笔记 |
| T6 | `running` → `failed` | `failTurn` / `completeTurn`（语义无效） | 回合仍为当前 | 可重试错误且 `attempt < 2` → 自动插入 attempt+1（T1，带退避）；否则 run → `failed`（R7） |
| T7 | `scheduled`/`running` → `failed` | `turnWatchdog` | 截止时仍非终态 | 记 `WATCHDOG_TIMEOUT`；同 T6 的重试判断 |

终态：`succeeded`、`rejected_stale`、`failed`。看门狗与 `completeTurn` 可能同时到达：二者都先读回合状态再迁移，OCC 让后提交者看到终态并直接返回（迟到的 `completeTurn` 走 T5 的记录分支，不覆盖）。

可重试错误：`MODEL_HTTP_429`、`MODEL_HTTP_5XX`、`MODEL_TIMEOUT`、`MODEL_NETWORK`、`STOP_MAX_TOKENS`、`OUTPUT_NOT_JSON`、`OUTPUT_SCHEMA`、`OUTPUT_SEMANTIC`、`WATCHDOG_TIMEOUT`。不可重试：`MODEL_HTTP_400`（编程错误）、`STOP_REFUSAL`、`CONFIG_ERROR`、`AGENTS_DISABLED`。

## 4.7 提案与决定：派生状态与界面文案

提案状态（不入库）：

| 派生状态 | 条件 | 界面徽章 |
| --- | --- | --- |
| `executed` | 存在 `changeOrders.by_proposal` | Executed |
| `current_ready` | 是 `room.currentProposalId`，当前 cv 下求值通过 | Ready for approval |
| `current_blocked` | 是当前提案，求值不通过 | Blocked · {按查看者粗化的原因} |
| `superseded` | 其他 | Superseded |

决定状态（每个必需席位一个，不入库）：

| 派生状态 | 条件 | 文案示例 |
| --- | --- | --- |
| `approved` / `rejected` / `withdrawn` | 当前 cv 下该席位最新一行的 kind | "Approved v3 under constraints v2" |
| `stale_approve` | 当前 cv 无记录，更早 cv 有 approve | "Approved v3 under constraints v1 — constraints changed, approval no longer applies" |
| `stale_reject` | 当前 cv 无记录，更早 cv 有 reject | "Rejected under constraints v1 — re-review needed" |
| `used_for_execution` | 提案已执行，且该决定在变更单 `decisionIds` 中 | "Used for change order CO-1" |
| `pending` | 其他 | "Waiting" |

撤回（`withdraw`）只在 run 为 `awaiting_approval`、提案未执行时允许；执行后决定不可撤回（RA-R16）。

## 4.8 人工请求

| # | from → to | 触发 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- |
| H1 | — → `open` | `openRequests`（R3、R6、R11、clarify） | — | 事件 `request_opened`（只含目标角色与种类）；disclosure 请求同时 `runAt(expiresAt, internal.requests.expire)` |
| H2 | `open` → `answered` | `requests.answer` | 调用者是目标席位；取舍请求要求 `request.constraintsVersion === room.constraintsVersion`（披露请求不要求）；`optionKey` 属于该请求；房间 `active` | 按选项执行（adopt → R12；amend → 新简报版本 → `bumpConstraints`；disclose → 新简报版本（只改披露，不递增 cv）；revise_catalog → 只记录并引导到目录编辑页；decline → 只记录）；事件 `request_closed` |
| H3 | `open` → `cancelled` | 取舍请求：`bumpConstraints`、R12 的兄弟请求、run 被取代；任何请求：`rooms.close` | — | 事件 `request_closed(outcome=cancelled)` |
| H4 | `open` → `expired` | `internal.requests.expire`（被调度 mutation，exactly once） | 仍为 `open` | 事件 |

人工请求的选项在生成时就固定；回答时不重新计算，只重新校验 cv 未变（变了则请求早已被 H3 取消，回答得到 `REQUEST_CLOSED`）。

## 4.9 两组守卫（不可混用）

**审批/执行守卫**（`decisions.decide` 内，按顺序；任一失败整笔回滚）：

```ts
const m = await requireCapability(ctx, proposal.roomId, "decision.make");           // 身份→席位→能力
if (m.room.lifecycle !== "active") throw err("ROOM_NOT_ACTIVE");
if (!proposal.requiredApproverRoleKeys.includes(m.roleKey)) throw err("FORBIDDEN_ROLE");
if (m.room.currentProposalId !== proposal._id) throw err("STALE_VIEW");             // 提案已不是当前
if (args.expectedConstraintsVersion !== m.room.constraintsVersion) throw err("STALE_VIEW");
const run = await ctx.db.get("runs", m.room.currentRunId!);
if (run.status !== "awaiting_approval" || run.constraintsVersion !== m.room.constraintsVersion)
  throw err(run.status === "executed" ? "ALREADY_EXECUTED" : "STALE_VIEW");
if (args.kind === "approve") {
  const ev = evaluate(proposal, await loadConstraintInput(ctx, m.room), todayIn(m.room.timeZone));
  if (!ev.ok) throw err("PROPOSAL_BLOCKED", { checks: viewEvaluation(ev, m.roleKey, disclosedTo(m), scenario.reasonCodes) });
}
```

`ALREADY_EXECUTED` 不是失败：`decide` 捕获后返回 `{ status: "executed", changeOrderId }`，使重复点击得到幂等结果（08 §8.4）。

**回合持久化守卫**（`beginTurn`、`completeTurn` 内）：

```ts
function turnIsCurrent(turn, run, room): boolean {
  return room.lifecycle === "active"
    && room.currentRunId === run._id && run.status === "running"
    && turn.constraintsVersion === run.constraintsVersion
    && run.constraintsVersion === room.constraintsVersion
    && turn.round === run.round
    && (turn.kind === "propose" || turn.subjectProposalId === room.currentProposalId);
}
// completeTurn 额外要求 turn.status === "running"；beginTurn 要求 turn.status === "scheduled"
```

两组的区别：审批守卫关心"人看到的东西是否仍是当前"（提案指针、cv、run 处于等待审批）；回合守卫关心"这个模型结果是否属于当前这次协商"（run 指针、轮次、cv）。把回合守卫用在审批上，会错误地允许在 `running` 中批准；反之会拒绝合法的回合结果。

## 4.10 竞态与结果

| 并发事件 | 串行化点 | 结果 |
| --- | --- | --- |
| 两名审批人同时投出最后一票 | 都读写 run 与 room 文档 | 先提交者执行；后者重试时看到 `executed`，返回同一 `changeOrderId` |
| 同一人双击批准 | 同上 | 第二次要么在执行前追加一条重复 approve（集合去重，无害），要么得到幂等结果 |
| finance 降预算 vs 最后一票 | room 文档（cv） | 降预算先：`decide` 得 `STALE_VIEW`，界面刷新显示阻断；执行先：降预算按新已承诺额校验，低于则 `CAP_BELOW_COMMITTED` |
| 迟到的回合结果 vs 约束变更 | room 文档（cv、currentRunId） | 回合守卫不成立 → `rejected_stale`，不写提案 |
| 看门狗 vs `completeTurn` | 回合文档 | 只有一个迁移生效 |
| 两个 review 回合同时完成 | run 文档（轮次推进字段） | 后提交者重试时看到两条都已 `succeeded`，由它执行 `resolveRound`；先提交者只记录自己的结果 |
| 人工请求回答 vs 约束变更 | room 文档 | 变更先：请求已 `cancelled`，回答得 `REQUEST_CLOSED`；回答先：按回答结果继续，之后的变更再取代 |
| 客户端断线重发同一 mutation | Convex 客户端去重（inputs/04 §1.11） | 与单次调用相同 |
