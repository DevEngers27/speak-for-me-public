# 04 · 状态机（part3）：reconcile、run 类公开 mutation、turn、attempt

> 分片清单见 `04-state-machines.md` 顶部。本片：4.3.5 `runs.reconcile`、4.3.6 公开 mutation 与"动作 × 状态"总表、4.4 turn、4.5 attempt 与持久化守卫 G0–G3。

### 4.3.5 `runs.reconcile` —— 活性保证

`runs.reconcile(runId, why)` 是 internal mutation，同时导出为同事务 helper。调用点：G0–G3 任一失败后（`turns.complete` / `turns.fail` / `agents.watchdog`）、`agents.runAttempt` 读上下文返回 null 时（经 `turns.fail(stale)`）、`ops.livenessSweep`（10 §10.1 R16 与 §10.9 / 12 §12.20 / 15 §15.8：cron 每 5 分钟，以及 `ops.setDraining(false)` 后立即；对无在途 attempt 的 `negotiating` run 逐个调用）、`turns.beginAttempt` 发现回合快照不符时。

```ts
export async function reconcileRun(ctx: MutationCtx, runId: Id<"runs">, why: ReconcileWhy) {
  const run = await ctx.db.get(runId); const room = run && (await ctx.db.get(run.roomId));
  if (!run || !room || room.currentRunId !== run._id || run.status !== "negotiating") return "noop";
  const turn = run.activeTurnSeq === null ? null : await turnBySeq(ctx, run._id, run.activeTurnSeq);
  const step = await decideReconcile(ctx, room, run, turn);     // 只读判定，顺序见下
  if (step === "noop") return "noop";                           // 看门狗 / 已登记调度 / 排空或 run_cap 恢复负责
  const rctx: RoomCtx = isRoomCtx(ctx) ? ctx                    // 被 turns.complete / fail / watchdog 内联调用：复用调用方的写锁
    : { ...ctx, tx: await openRoomTx(ctx, room._id, { allow: ["open"] }) };   // 独立调用：确定要写才加写锁（4.1.2）
  switch (step) {
    case "repair":                                              // D06 被破坏：不应发生
      opsLog(ctx, "constraints_drift", { runId, why });             // 15 §15.6.4 告警表登记的码
      await disposeCurrentRun(rctx, room, "constraints_changed");                          // R7
      await react(rctx, room._id, { depth: 0, runCause: "constraints_changed" }); return "repaired";  // 09 §9.4
    case "advance": return advanceRun(rctx, run, turn);         // 推进被遗漏
    case "replace": return replaceTurnTx(rctx, run, turn!);     // 同 role / kind / round 新 turn，不递归
    case "failed":  return toNeedsInput(rctx, run, { kind: "agent_failed", toRole: turn!.role });   // R6
    case "begin":   return beginAttemptTx(rctx, turn!, {         // 下一 attempt，或上限 → R6（参数形状见 10 §10.5.1 BeginOpts）
      origin: turn!.currentAttemptNo === 0 ? "turn_start" : "auto_retry", delayMs: 0, actorUserId: null, why });
  }
}
// decideReconcile（只读，首个命中即返回）：
//   run.constraintsVersionAtStart ≠ room.constraintsVersion                         → "repair"
//   !turn 或 turn.status === "completed"                                            → "advance"
//   turn.status === "stale"；或 turn running 但当前 attempt 已 stale（防御：G2/G3 应已把 turn 置 stale，
//     这里兜底，避免 running 回合带着 stale attempt 永久停留）                        → "replace"
//   turn.status === "failed"                                                        → "failed"
//   有 running attempt；或 beginFnId 指向 pending 调度；或 waitingReason === "draining" 且仍在排空；
//     或 waitingReason === "run_cap" 且 run_starts 滚动 24 小时桶仍满（canon D12 ⑥）           → "noop"
//   其余                                                                            → "begin"
```

活性不变量（INV-SM-03）：`run.status === "negotiating"` ⇒ 恰有一个非终态 turn（= `activeTurnSeq`），且它满足以下之一：有 `running` attempt（由其看门狗兜底）；`beginFnId` 指向 `pending` 的调度；`waitingReason ∈ {draining, spend_deferred, run_cap}` 且对应条件仍成立（解除排空后由 `ops.setDraining(false)` 触发的 `ops.livenessSweep` 唤醒；`spend_deferred` 与 `run_cap` 各由已登记的 `beginFnId` 在次日 / 滚动窗口腾出时唤醒，10 §10.5.2 B6 / B6a）。reconcile 在任何"不满足"的情形都给出一个迁移，不存在只标 stale 后返回的分支。`ops.livenessSweep` 的定时扫描只是兜底与告警器：排空恢复之外的任何命中都 `opsLog("stuck_run")` 并视为代码缺陷，活性的主要保证仍是上面这些已登记的唤醒者（4.13）。

### 4.3.6 run 类公开 mutation 与"动作 × 状态"总表

**本表是 04 与 12 共用的唯一一张表**（canon C40），12 的函数目录引用它，不另写允许状态。✓ = 允许并给出迁移；✗ = 拒绝且不写任何行（括号内为失败码）；所有写入另受鉴权（12）与 canon D12 ⑥ 节流（`run.rate_limited`，适用于约束写入、`runs.start` / `requestRenegotiation` / `retryTurn`、`humanRequests.answer`）。

| mutation（调用者） | room `setup` | run `negotiating` | run `pending_approval` | run `needs_input` | 无非终态 run（上一 run `ended_no_agreement` / `canceled`） | room `executed` | room `closed` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `runs.start`（任一成员） | ✗（`run.invalid_state`） | 幂等返回当前 run | 幂等返回 | 幂等返回 | ✓ R1 / R3（`cause: manual_start`） | ✗（`run.invalid_state`） | ✗（同左） |
| `runs.requestRenegotiation`（creator） | ✗ | ✗（`run.invalid_state`：代理正在工作） | ✓ R12（不 bump） | ✓ R16（请求 → `superseded`） | ✗（`run.invalid_state`，用 `runs.start`） | ✗ | ✗ |
| `runs.cancel`（creator） | ✗ | ✓ R8 | ✓ R13 | ✓ R18 | ✗ | ✗ | ✗ |
| `runs.retryTurn`（`toRole` 成员） | ✗ | ✗ | ✗ | ✓ R14，仅当 open 请求 `kind: agent_failed` 且含 `retry_turn` | ✗ | ✗ | ✗ |
| `approvals.record`（必需审批人） | ✗（`approval.not_current`） | ✗（同左） | ✓ 4.7；reject → R10 / R11；最后 approve → R9 | ✗（`approval.not_current`） | ✗（同左） | ✗（`approval.already_executed`；对已执行提案的 approve 幂等成功） | ✗（`run.invalid_state`） |
| `humanRequests.answer`（`toRole` 成员） | ✗ | ✗（`run.invalid_state`） | ✗ | ✓ R14–R17、R19–R21 | ✗ | ✗ | ✗ |
| `briefs.confirm` / `budget.setCap` / `catalog.confirm` / `catalog.retire`（各自角色） | ✓ 只写来源、不 bump，末尾 `openIfReady` | ✓ 投影变化 → bump → R7 | ✓ → R12 | ✓ → R16 | ✓ → bump → `react()` 开新 run | ✗ | ✗ |
| `ledger.recordBaseline`（finance） | ✓ 一次 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `sharedFacts.add`（本人） | ✓ | ✓ 不 bump、不改 run | ✓ | ✓ | ✓ | ✗ | ✗ |
| `rooms.close`（creator） | ✓ M4 | ✓ M5 + R8 | ✓ M5 + R13 | ✓ M5 + R18 | ✓ M5 | ✗ | ✗ |
| `rooms.forceClose`（ops；internal，经 CLI，不受节流；列入本表只为覆盖全部关房路径，4.11） | ✓ M4 | ✓ M5 + R8 | ✓ M5 + R13 | ✓ M5 + R18 | ✓ M5 | `unchanged` | `unchanged` |
| `rooms.startFollowUp`（任一成员） | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ 新房间（canon D04） | ✗ |
| `tasks.markDone`（被指派人） | — | — | — | — | — | ✓ 4.9 | ✗ |

四个 run 类 mutation 的规格：

| 函数 | 参数 | 守卫（顺序） | 读 | 写 / 调度 | 返回 |
| --- | --- | --- | --- | --- | --- |
| `runs.start` | `{ roomId }` | 成员 → `room.status === "open"`（`run.invalid_state{guard:"room_status"}`）→ 有非终态 run 直接返回（不写、不计节流）→ 就绪（`not_ready`）→ `opsFlags.draining === false`（`run.draining`）→ 节流 | rooms、members、runs、briefs、catalogItems、ledgerEntries、sharedFacts、opsFlags | 经 `startRunTx(cause: manual_start)`：runs、rooms、turns、attempts、humanRequests、events；调度 `agents.runAttempt` + `agents.watchdog` | `{ runId, created, status }` |
| `runs.requestRenegotiation` | `{ roomId, expectedRunId }` | creator（`auth.not_creator`）→ room open → `room.currentRunId === expectedRunId`（`run.invalid_state{guard:"run_changed"}`，防止对已变化的 run 动作）→ run ∈ {`pending_approval`, `needs_input`}（`run_status`）→ 非 draining → 节流 | 同上 + proposals、humanRequests | 旧 run → `superseded`（`renegotiation_requested`）；active 提案 → `superseded`；open 请求 → `superseded`；`startRunTx(cause: renegotiation_requested)`（不传 `keepCandidateId`） | `{ runId, status }` |
| `runs.cancel` | `{ runId }` | creator（`auth.not_creator`）→ run 是 `room.currentRunId`（`run.invalid_state{guard:"run_changed"}`）→ 已终态 → `unchanged` | rooms、runs、proposals、humanRequests、turns | run → `canceled`（`canceled_by_creator`）；active 提案 → `superseded`；请求 → `superseded`（`closedReason: run_canceled`）；非终态 turn → `stale`；不开新 run，之后任一成员可 `runs.start` | `{ status: "canceled" \| "unchanged" }` |
| `runs.retryTurn` | `{ runId }` | `humanRequests.answer(retry_turn)` 的便捷别名（共用 `applyHumanAnswer`）：run 是当前 run 且 `needs_input`（`run_status`）→ 存在含 `retry_turn` 的 open `agent_failed` 请求（`no_failed_turn`）→ 调用者 = `toRole`（`auth.role_forbidden`）→ 非 draining → 节流 | 同 answer | 请求 → `answered`；新 turn（同 role / kind / round，`retryOfTurnId`，因为 `failed` 是 turn 终态，与 05 §5.11.4、10 §10.10 一致）；`beginAttemptTx`（`origin: retry_turn`） | `{ attemptId }` |

## 4.4 回合（turn）

| # | from → to | 触发 | 守卫 / 说明 |
| --- | --- | --- | --- |
| U1 | ∅ → `scheduled` | `createTurnTx`（`startRunTx` R1、`advanceRun` R4、`approvals.record` R10、`humanRequests.answer` R14、`replaceTurnTx`） | run 为（或同事务进入）`negotiating`；run 内无其他非终态 turn；写入 `turnSeq = run.nextTurnSeq`、`roundNo`、`role`、`kind: propose \| evaluate`、`constraintsVersion = room.constraintsVersion`、`candidateSnapshot`（canon D10：≤ 12 项、按 `candidateKey` 稳定排序、首轮 provider 首位为最低价含必需项候选、剔除 `excludedCandidateKeys(run)`：本 run 已提出过——含被阻断——∪ 被人拒绝 ∪ `choose_candidate` 复核失败）、`currentAttemptNo: 0`；`run.activeTurnSeq = turnSeq`；随后 `beginAttemptTx`（系统开局超出 `run_starts` 桶时由其 B6a 记 `waitingReason: run_cap` 并以 `beginFnId` 延迟登记，4.3.3）。**场景版本前置**：`scenarioOf(room)` 必须可解析（房间钉住的 `scenarioKey@scenarioVersion` 仍在注册表中，11 §11.3）；不可解析时不建回合，run → `needs_input` + 本应行动角色的 `agent_failed` 请求（选项只有 `end_run`）——这是 reject 之后建回合的兜底（08 S5 只拦 approve，08 §8.5.4 第 3 步）；迁移纪律见 15 §15.5.1，正常部署下不会触发 |
| U2 | `scheduled` → `running` | `turns.beginAttempt` 插入第 1 个 attempt | 见 4.5.1 |
| U3 | `running` → `completed` | `turns.complete` | G0–G3 通过且语义校验通过；写 `turn.outcome`（所选候选、动作、`blockedCandidateKey?`） |
| U4 | `running` → `failed` | 失败路径（`turns.fail` / `agents.watchdog` / `turns.complete` 的语义失败） | 错误类不可重试，或 `currentAttemptNo ≥ MAX_ATTEMPTS_PER_TURN`（默认 2，10 定），或 run 调用 / 美元上限；同事务 R6（前两者 → 失败方的 `agent_failed`；run 上限 → customer 的 `rounds_exhausted`，`call_limit` / `spend_limit`） |
| U5 | `scheduled` → `failed` | `turns.beginAttempt` | 首个 attempt 前就撞到 run 上限；同事务 R6（customer 的 `rounds_exhausted`，`questionKey` 带 `call_limit` / `spend_limit`，选项 `choose_candidate` + `end_run`，无 `keep_as_is`） |
| U6 | `scheduled` / `running` → `stale` | `disposeCurrentRun`（bump）、`runs.cancel`、`rooms.close` / `rooms.forceClose`、`runs.requestRenegotiation`、reconcile 修复 | run 离开 `negotiating` 或回合快照失效；在途 attempt 保持 `running`，返回时被 G1 拒收 |

两次 attempt 之间 turn 保持 `running`，用 `waitingReason: "backoff"` + `beginFnId`（`runAfter(backoffMs, turns.beginAttempt)` 的返回 id）表示等待；canon §1.3 没有 `running → scheduled`，本设计也不需要它。终态 turn 不重开：`retry_turn` 与修复都建新 turn，保证每个 turn 的 attempt 历史与结果一一对应。

## 4.5 尝试（attempt）与持久化守卫

### 4.5.1 迁移

| # | from → to | 触发 | 条件 |
| --- | --- | --- | --- |
| A1 | ∅ → `running` | `turns.beginAttempt`（helper 或被调度的 internal mutation，canon D01 唯一调度接缝） | room `open`、run 当前且 `negotiating`、`activeTurnSeq === turn.turnSeq`、turn ∈ {`scheduled`, `running`} 且无 `running` attempt、`turn.constraintsVersion === room.constraintsVersion`（否则：turn 非终态 → `stale`，返回 `{ kind: 'stale' }`，`beginAttemptTx` 内**不**递归调用 reconcile，由外层调用者调用一次 `runs.reconcile`，它走 `replaceTurnTx`；10 B2、invariants-02）；`opsFlags.draining` → 记 `waitingReason: draining` 并返回 `run.draining`，不建行；`currentAttemptNo < MAX_ATTEMPTS_PER_TURN`、`run.attemptCount < run.maxAttempts`、美元预留成功（否则 U4/U5 → R6）；全局日美元已满 → `waitingReason: spend_deferred`、`beginFnId = runAfter(到次日, turns.beginAttempt)`，返回 `deferred`。通过：插入 attempt（`attemptNo = currentAttemptNo + 1`、`deadlineAt`、`provenance`）；同事务 `runAfter(0, agents.runAttempt, { attemptId, actorUserId })` 与 `runAfter(deadline, agents.watchdog, { attemptId })`，两个 id 存入行 |
| A2 | `running` → `completed` | `turns.complete` | G0–G3 通过；`safeParse` 与语义校验（optionKey 在快照内、动作在角色白名单内、非 `action.repeats_blocked`）通过 |
| A3 | `running` → `invalid_output` | `turns.complete`（语义失败）/ `turns.fail`（`output.not_json` / `schema_violation` / `truncated` / `unknown_reference`） | G0–G3 通过 |
| A4 | `running` → `refused` | `turns.fail(output.refusal)` | 同上；不自动重试 |
| A5 | `running` → `timeout` | `agents.watchdog`（重登记已达 3 次仍 `pending` / `inProgress`）；`turns.fail(model_timeout)`（SDK 中止） | 同上 |
| A6 | `running` → `error` | `turns.fail`（API / 上下文溢出 / `agents_disabled`）；`agents.watchdog`（调度函数 `failed`，或 `success` 但回合仍 running → `internal`） | 同上 |
| A7 | `running` → `stale` | `turns.complete` / `turns.fail` / `agents.watchdog` | G1、G2 或 G3 失败 |

终态之后只允许补记用量（`usage`、`stopReason`、`requestId`、`lateUsage: true`），不改 status。A3/A5/A6 之后：可重试（10 的错误类策略：`truncated` 重试一次、`schema_violation`、`timeout`、瞬时 `error`）且未达上限 → 调度下一 attempt（turn 保持 `running`）；否则 U4 → R6。

### 4.5.2 持久化守卫 G0–G3（canon D07）

`turns.complete(attemptId, …)` / `turns.fail(attemptId, …)` / `agents.watchdog({ attemptId })` 按顺序检查：

| 守卫 | 条件 | 失败时 | 事件 | 之后 |
| --- | --- | --- | --- | --- |
| G0 | `attempt.status === "running"` ∧ `turn.currentAttemptNo === attempt.attemptNo` | attempt 已是终态：只补记用量，不改状态 | 不写 | `runs.reconcile` |
| G1 | `room.currentRunId === run._id` ∧ `run.status === "negotiating"` | attempt → `stale`，用量照记 | `turn_rejected_stale { turnSeq, guard: "G1" }` | `runs.reconcile`（run 已终态时为空操作） |
| G2 | `run.activeTurnSeq === turn.turnSeq` | 同上；turn 若非终态 → `stale` | 同上（`G2`） | `runs.reconcile` |
| G3 | `turn.constraintsVersion === room.constraintsVersion` | attempt → `stale`，用量照记；turn 若非终态 → `stale`（与 G2 相同） | 同上（`G3`） | `runs.reconcile`：run 的 cv 与房间一致（只有回合快照漂移）→ stale 回合分支 `replaceTurnTx`（同 role / kind / round 新 turn，不递归）；run 的 cv 也漂移 → 修复分支（取代 run 并 `react()`） |

- 比较的全是服务端快照，从不读模型回显的版本号或 id（canon D10）。
- 事件 payload 只有 `turnSeq` 与守卫名，不带角色私密内容、不带 reasonCode（run-lifecycle r09）。
- `agents.runAttempt` 的上下文读取（internal query）先跑同样四条守卫；不通过返回 null，action 立即调 `turns.fail(attemptId, { code: "stale" })`，不调模型、不空挂到看门狗（run-lifecycle r01 第 3 条）。

### 4.5.3 看门狗决策（`agents.watchdog({ attemptId })`）

| 读到的 `_scheduled_functions` 状态（`ctx.db.system.normalizeId` + `get` `attempt.actionFnId`） | 动作 |
| --- | --- |
| attempt 已非 `running` | 空操作（新 attempt 创建时不取消旧看门狗，G0 让它无害） |
| `pending` / `inProgress`，`watchdogArmCount < 3` | 重登记 `runAfter(WATCHDOG_REARM_MS)`，`watchdogArmCount++`，更新 `deadlineAt`（run-lifecycle r07：调度积压不等于超时） |
| `pending` / `inProgress`，已重登记 3 次 | A5 `timeout` → 失败路径 |
| `failed` | A6 `error(action_crashed)` → 失败路径 |
| `success` 但 attempt 仍 `running` | A6 `error(internal)` → 失败路径（action 结束却未提交） |
| `canceled` | 不应出现（从不调用 `scheduler.cancel`）→ `error(internal)` + `opsLog` |

失败路径先跑 G1–G3（失败则 A7 + reconcile），再按 4.5.1 决定下一 attempt 或 U4 → R6。重登记前同样先跑 G1–G3：房间 / run / 回合已不是当前 → 不再重登记，直接走失败路径。`timeout` 只是逻辑终结：物理 action 可能仍在排队或运行，其租约、美元暴露与同回合自动重试的最早时刻见 10 §10.8；看门狗的全部写入经房间写锁（`rooms.writeSeq + 1`，INV-M1）。
