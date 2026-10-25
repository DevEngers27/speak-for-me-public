# 04 · 状态机（part2）：协商运行 run

> 分片清单见 `04-state-machines.md` 顶部。本片：4.3.1 状态、4.3.2 迁移表 R1–R19、4.3.3 `startRunTx`、4.3.4 `advanceRun` 与轮次结果映射。

## 4.3 协商运行（run）

### 4.3.1 状态

| 状态 | 含义 | 终态 | 谁在等谁 |
| --- | --- | --- | --- |
| `negotiating` | 有且仅有一个非终态 turn（`runs.activeTurnSeq` 指向它），它有一个 `running` attempt、或一个已登记的 `turns.beginAttempt` 调度、或明确的等待原因（`backoff` / `spend_deferred` / `draining` / `run_cap`） | 否 | 等代理（系统） |
| `pending_approval` | `runs.currentProposalId` 指向一个 `active` 且在进入时 `passesChecks` 的提案；无非终态 turn | 否 | 等必需审批人 |
| `needs_input` | 恰好一个 `status: open` 的 `humanRequests` 行（`runId` = 本 run）；无非终态 turn | 否 | 等 `request.toRole` 的那个人 |
| `executed` | 当前提案已执行（房间同时 `executed`） | 是 | — |
| `superseded` | 被约束变化（`endedReason: constraints_changed`）或 creator 的重谈请求（`renegotiation_requested`）取代；同事务已有新 run | 是 | — |
| `ended_no_agreement` | 人选择 `end_run` 或轮次与延长都已用尽后 `keep_as_is`（`endedReason: no_agreement`），或请求 7 天过期（`request_expired`） | 是 | — |
| `canceled` | creator `runs.cancel`（`canceled_by_creator`）或 `rooms.close`（`room_closed`） | 是 | — |

每房间至多一个非终态 run，且它就是 `rooms.currentRunId`（INV-SM-01）；`currentRunId` 指向房间最新的 run（任何状态，终态时**不**清空），只由 `startRunTx` 写（canon §1.2、C49）。`runs` 上本章依赖的字段（03 落地）：`status`、`cause: "room_opened" | "constraints_changed" | "renegotiation_requested" | "manual_start"`、`constraintsVersionAtStart`、`roundNo`（1 起）、`maxRounds`（场景快照，默认 3）、`roundsExtended: boolean`、`activeTurnSeq: number | null`、`nextTurnSeq`、`currentProposalId?`、`previousRunId?`、`startedBy?: Id<"users">`（系统触发时为引起变化的人）、`endedReason?`、`attemptCount` / `maxAttempts`、`reservedMicroUsd`（10）。

### 4.3.2 迁移表

"触发"列中 helper 名见 4.3.3–4.3.5；公开 mutation 的参数与失败码见 part3 §4.3.6。

| # | from → to | 触发（调用者） | 守卫 | 同事务副作用 |
| --- | --- | --- | --- | --- |
| R1 | ∅ → `negotiating` | `startRunTx`：被 `runs.start`（任一成员）、`react()`（M2 开房 / 任一 bump 后，系统）、`runs.requestRenegotiation`（creator）调用 | `room.status === "open"`；无非终态当前 run（系统路径由调用方先取代）；预检：未命中 R2 且 `buyerFeasible(ruleInput)` 非空 | 插入 run（`roundNo: 1`、`constraintsVersionAtStart` = 本事务重读的 `room.constraintsVersion`）；`room.currentRunId`；创建 turn（provider，`propose`，round 1）并 `turns.beginAttempt`（系统路径 `run_starts` 超限时首回合停泊为 `run_cap`，4.3.3）；事件 `run_started` |
| R2 | ∅ → `pending_approval` | `startRunTx`（仅 `cause: constraints_changed`，系统） | 被同一事务取代的旧 run **被取代前处于 `pending_approval`**（canon D06 / §1.3：`stale → active` 只在被取代 run 处于 `pending_approval` 时经预检保留；`negotiating` / `needs_input` 中的提案代理评估尚未完成、或已被代理否决（如轮次用尽），一律由新 run 重新评估，4.15 Q1），其 `currentProposalId` = P，P 在本事务内刚由 `active` 变 `stale`（从未被人拒绝）；`passesChecks(P, ruleInput@新 cv, room.localDate)` 通过 | 插入 run，`currentProposalId = P`，不建 turn、零模型调用；P `stale → active`（P5）；旧审批行不动，按 D02 自然变为 `stale_approve`；事件 `run_started` + `reapproval_required`（无金额、无人名） |
| R3 | ∅ → `needs_input` | `startRunTx`（系统或人工） | 未命中 R2 且 `buyerFeasible` 为空 | 插入 run；`openHumanRequestTx(kind: infeasible)`（4.8，按 `relaxationOrder` 恰好一个请求）；事件 `run_started` + `run_needs_input`（provider 渲染为 `run_waiting`）；零模型调用 |
| R4 | `negotiating` → `negotiating`（自环，不改 status） | `advanceRun`（在 `turns.complete` 内，系统） | 刚完成的 turn 是 `activeTurnSeq`；轮次结果为"下一回合"或"下一轮" | 新建下一 turn（`nextTurnSeq++`、`activeTurnSeq` 指向它；下一轮时 `roundNo++`）并 `turns.beginAttempt`；事件 `turn_scheduled`（只含 round、角色、kind） |
| R5 | `negotiating` → `pending_approval` | `advanceRun`（系统） | 本轮最后一个评估回合完成；`resolveRound` = `await_approval`：全部评估方 `recommend_accept` 同一 `proposalVersion`，且 `passesChecks(currentProposal)` 用**当前** `room.localDate` 重算通过 | `activeTurnSeq = null`；事件 `run_awaiting_approval` |
| R6 | `negotiating` → `needs_input` | `advanceRun` / 失败路径（`turns.fail`、`agents.watchdog`、`turns.beginAttempt` 的上限分支；系统） | 其一：`resolveRound` = `needs_input(kind, toRole)`（不可代答的 `clarify`、通过策略检查的 `escalate`）；轮次用尽（`roundNo === maxRounds` 且结果为"下一轮"）；本 run 该角色 `propose`/`counter` 已达 4 次（canon D12 ⑤）；turn 重试耗尽或不可重试 → `agent_failed`；run 调用 / 美元上限 → **customer 的 `rounds_exhausted`**（`questionKey` 带 `call_limit` / `spend_limit`，选项 `choose_candidate` + `end_run`，无 `keep_as_is`；05 §5.8.5、10 B4 / B5）；下一轮 provider 回合创建时快照为空或 provider 已 propose 4 次 → `rounds_exhausted`（`no_candidates`，不建 turn） | `activeTurnSeq = null`；`openHumanRequestTx`（恰好一个）；事件 `run_needs_input` |
| R7 | `negotiating` → `superseded` | `constraints.bump` 的 `disposeCurrentRun`（09，系统）；`runs.reconcile` 发现 D06 被破坏时的修复（4.3.5） | run 非终态 | `endedReason: constraints_changed`；active 提案 → `stale`（P4）；非终态 turn → `stale`；事件 `run_ended`；随后 `react()` 开新 run |
| R8 | `negotiating` → `canceled` | `runs.cancel`（creator）、`rooms.close`（creator）、ops `rooms.forceClose`（4.11） | — | active 提案 → `superseded`（P2b）；非终态 turn → `stale`；`endedReason: canceled_by_creator` / `room_closed`；事件 `run_ended` |
| R9 | `pending_approval` → `executed` | `executions.executeIfComplete`（在最后一个 approve 的 `approvals.record` 内） | 08：`evaluateApprovalSet` 完成、`isExecutable` 重算通过、`executionKey` 未用 | 执行写入；P → `executed`；room → `executed`（M3） |
| R10 | `pending_approval` → `negotiating` | `approvals.record(reject)`（必需审批人） | A-G1…A-G10 通过；`roundNo < maxRounds` | P → `rejected`（P3）；`roundNo++`；新建 provider `propose` turn（反馈 = 被拒版本：provider 代理只见 "vN rejected"，买方代理另见拒绝者角色；**不含 `reasonKey` / `note`**，05 §5.8.6、08 A13；被拒 `candidateKey` 进入本 run 阻断集）并 `beginAttempt`；事件 `proposal_status_changed` |
| R11 | `pending_approval` → `needs_input` | `approvals.record(reject)` | 同上但 `roundNo === maxRounds` | P → `rejected`；`openHumanRequestTx(kind: rounds_exhausted, toRole: customer)` |
| R12 | `pending_approval` → `superseded` | `constraints.bump`（含 `cause: clock`）；`runs.requestRenegotiation`（creator） | — | bump：P → `stale`，再 `react()`（可能 R2 沿用 P）；重谈：P → `superseded`（P2b）、`endedReason: renegotiation_requested`、不 bump、`startRunTx(cause: renegotiation_requested)` 且不走 R2 |
| R13 | `pending_approval` → `canceled` | `runs.cancel`、`rooms.close` / ops `rooms.forceClose` | — | P → `superseded` |
| R14 | `needs_input` → `negotiating` | `humanRequests.answer` / `runs.retryTurn`（`toRole` 成员） | 选项效果为 `disclose`（仅 `clarify` 请求；`infeasible` 回退请求的 `disclose` 走 R20）、`retry_turn`，或 `keep_as_is` 且仍可继续（见右） | 请求 → `answered`；`disclose`：写 `sharedFacts`，为发问方新建同轮同 kind 的 turn；`retry_turn`：新建 turn（`retryOfTurnId`，同 role / kind / round，`failed` 是 turn 终态）；`keep_as_is` 按请求 kind（05 §5.11.4）：`clarify` → 视为拒绝披露，发问方同轮新回合；`rounds_exhausted` → 延长一轮（`maxRounds++`、`roundsExtended = true`，每 run 一次）后 `roundNo++` 新建 provider turn；customer 的 `agent_escalated` → 下一轮；provider 的 `agent_escalated` → provider 同轮新回合；轮次已尽且不可延长 → 改走 R17 |
| R15 | `needs_input` → `pending_approval` | `humanRequests.answer(choose_candidate)`（customer） | 候选 `candidateKey` 用**全量** `RuleInput` 重算 `passesChecks` 通过 | 请求 → `answered`；若候选与本 run 当前 `active` 且仍通过的提案同 `candidateKey` → **复用同一 proposalId**（05 §5.11.4）；否则插入提案（`origin: human_choice`、`sourceRequestId`，P1），run 内旧 `active` → `superseded`；`currentProposalId` 指向它；事件 `proposal_created`（新插时）+ `run_awaiting_approval` |
| R16 | `needs_input` → `superseded` | 带约束效果的回答（`raise_cap` / `drop_items` / `extend_deadline`）经 `withConstraintChange` → `constraints.bump`；任何其他 bump；`runs.requestRenegotiation` | — | 请求先置 `answered`（回答者那条）或 `superseded`（其余情形）；再按触发分两种写法：**bump 路径**（带约束效果的回答、任何其他 bump）按 R7 处置（`endedReason: constraints_changed`，active 提案 → `stale`（P4）），之后的新 run **不**经 R2 沿用（canon D06：被取代 run 不在 `pending_approval`）；**重谈路径**（`runs.requestRenegotiation`，不 bump）按 R12 的重谈写法处置（`endedReason: renegotiation_requested`，active 提案 → `superseded`（P2b），`startRunTx(cause: renegotiation_requested)` 且不传 `keepCandidateId`）。两种路径下被取代 run 的 `currentProposalId` 都保留为历史指针，不会有 `active` 提案只挂在终态 run 上 |
| R17 | `needs_input` → `ended_no_agreement` | `humanRequests.answer(end_run)`；`keep_as_is` 但轮次与延长都已用尽；`humanRequests.expireDue`（cron，`now ≥ expiresAt`） | — | 请求 → `answered` / `expired`；active 提案 → `superseded`；`endedReason: no_agreement` / `request_expired`；事件 `run_ended`；房间阶段变为 `stopped{reason: ended_no_agreement}`，creator 收到待办（4.10）；**没有任何选项关闭房间** |
| R18 | `needs_input` → `canceled` | `runs.cancel`、`rooms.close` / ops `rooms.forceClose` | — | 请求 → `superseded`（`closedReason: run_canceled` / `room_closed`）；active 提案（若有）→ `superseded`（P2b）；`endedReason: canceled_by_creator` / `room_closed`；事件 `run_ended` |
| R19 | `needs_input` → `needs_input`（自环） | `humanRequests.answer(choose_candidate)` | 全量重算 `passesChecks` 失败（候选只按 customer 视图生成，canon D15） | 旧请求 → `superseded`（`closedReason: regenerated`，`answerOptionKey` 照记以保留"人选了什么"）；该候选进入剔除集合；同事务 `openHumanRequestTx` 生成同 kind 新请求（不变量"恰好一个 open"保持） |
| R20 | `needs_input` → `needs_input` / `negotiating` | `humanRequests.answer(disclose)`，且请求是 `infeasible` 的回退请求（06 §11.2） | 请求 open；`disclose { field, toRoles }` 经 `sharedFacts.add` 同一闸门 | 写 `sharedFacts`；旧请求 → `answered`；同事务用同一 `buyerFeasible` 与 `buildHumanRequests` 重跑预检：全局仍无解 → `openHumanRequestTx` 生成新的 `infeasible` 请求（此时放松角色已能看见冲突并得到 `raise_cap` 等选项），run 留在 `needs_input`；有解 → 按 R1 建 provider 回合，run → `negotiating`。事件 `human_request_answered`（+ `human_request_opened` / `turn_scheduled`） |
| R21 | `needs_input` → `needs_input`（自环） | `humanRequests.answer(pass_to_next { toRole })`（`infeasible` 请求的收件人；canon D15 新增） | 请求 open 且 `kind: infeasible`；`toRole` 是场景 `relaxationOrder` 中位于本收件人之后的下一个角色（是否提供只取决于位置，不取决于任何私密值，不构成预言机）；本 run 该 (from, to) 尚未转交过 | 旧请求 → `answered`；同事务 `openHumanRequestTx` 按目标角色**自身视图**生成新的 `infeasible` 请求（`buildHumanRequests(toRole, viewFor(toRole))`；目标视图里没有可放松选项时只含 `disclose` 回退项与 `end_run`，回答 `disclose` 再走 R20）；不 bump、不建 turn。事件 `human_request_answered` + `human_request_opened`（provider 只见 `run_waiting`） |

终态无出边。`withdraw` 不改变 run 状态（审批集合不再完成，run 继续等）。

### 4.3.3 `startRunTx` —— 插入 run 的唯一入口

```ts
type StartRunOpts = {
  cause: RunCause; origin: "manual" | "system"; actorUserId?: Id<"users">;
  keepCandidateId?: Id<"proposals">;   // 仅 bump → react 传入：被同事务取代、且被取代前处于 pending_approval 的旧 run 刚 stale 的当前提案
  reactDepth?: number;                 // 09 §9.4：反应链深度；本函数内若需 bump 必须以此为 depth
};
export async function startRunTx(ctx: RoomCtx, roomId: Id<"rooms">, o: StartRunOpts) {   // ctx.tx：调用方已打开的房间写锁（4.1.2）
  const room = await ctx.db.get(roomId);                         // 重读（run-lifecycle r13：同事务内 bump 可能刚改过 cv）
  if (!room || room.status !== "open") throw invalidState();
  const cur = room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  if (cur && !RUN_TERMINAL.has(cur.status)) {
    if (o.origin === "manual") return { runId: cur._id, created: false };  // runs.start 幂等（12 §12.13）
    throw new EngineInvariantError("run.start_with_live_run");             // 系统路径必须先取代
  }
  const { input, shared } = await loadRuleInput(ctx, roomId);    // 06 §5.1：全部硬约束 + room.localDate；同一次读返回有效披露账本 shared: SharedLedger
  const proto = scenarioOf(room).protocol;                       // convex/scenarios/registry.ts 按房间钉住的 scenarioKey@version 取插件（06 §12.1 ProtocolDecl）
  const base = { roomId, cause: o.cause, constraintsVersionAtStart: room.constraintsVersion,
    roundNo: 1, maxRounds: proto.maxRounds, roundsExtended: false, activeTurnSeq: null,
    nextTurnSeq: 1, previousRunId: cur?._id, startedBy: o.actorUserId, attemptCount: 0, ... };
  // R2：只有约束变化路径；keepCandidateId 由 09 bump 只在被取代 run 被取代前处于 pending_approval 时传入（canon D06 / §1.3，4.15 Q1）；只看刚变 stale 的那一个提案与规则结论
  if (o.cause === "constraints_changed" && o.keepCandidateId) {
    const p = await ctx.db.get(o.keepCandidateId);
    if (p?.status === "stale" && cur?.currentProposalId === p._id && passesChecks(p, input).ok) {
      const runId = await insertRun(ctx, { ...base, status: "pending_approval", currentProposalId: p._id });
      await setStatus(ctx, "proposals", p._id, "stale", "active");   // 只改 status；proposals.runId 保持来历（canon D25）
      return linkAndEmit(ctx, room, runId, ["run_started", "reapproval_required"]);
    }
  }
  if (buyerFeasible(input).length === 0) {                   // R3：零模型调用
    const runId = await insertRun(ctx, { ...base, status: "needs_input" });
    const plugin = scenarioOf(room);
    const draft = buildHumanRequests(plugin, { kind: "infeasible", full: input,   // 06 §11.1 签名
      viewOf: (r) => viewFor(plugin, input, shared, r),              // 06 §5.2 唯一的角色视图构造器；收件人只拿自身视图，从不把全局 input 当收件人视图
      run: { excludedCandidateKeys: [], chooseExcludedKeys: [], passedToNext: [], roundsExtended: false },   // 新 run：各集合为空
      shared });
    await openHumanRequestTx(ctx, runId, draft);              // H1：写入前 assertOptionsProjected(draft.toRole, draft.options)，不一致 → internal、不写请求
    return linkAndEmit(ctx, room, runId, ["run_started", "run_needs_input"]);
  }
  const runId = await insertRun(ctx, { ...base, status: "negotiating" });   // R1
  await createTurnTx(ctx, runId, { role: proto.proposerRole, kind: "propose", roundNo: 1 });
  // createTurnTx → beginAttemptTx：系统开局的首个 attempt 由 10 §10.5.2 B6a 检查 run_starts 桶（canon D12 ⑥，含本 run ≤ 6）；
  // 超限时回合状态不变、记 waitingReason: "run_cap" 并以 beginFnId 登记到滚动窗口腾出的时刻，不抛错；排空 / 日美元同理（B3 / B6）
  return linkAndEmit(ctx, room, runId, ["run_started"]);
}
```

- **系统路径永不因上限、节流或排空而抛错**（canon D06 末句、D12 ⑥、D17）：约束变化必须被记录，所以 `react()` 调 `startRunTx` 时即使 `opsFlags.draining` 置位、全局日美元已满、或房间 24 小时内已开满 `RUN_STARTS_PER_DAY = 6` 个 run（`run_starts` 桶），也照常插入 run 与 turn；排空 / 日美元由 `turns.beginAttempt` 返回 `run.draining` / `deferred` 并在 turn 上记 `waitingReason`（4.4），`run_starts` 超限由 `beginAttemptTx` 的 B6a（10 §10.5.2）把首回合记为 `waitingReason: run_cap`、不建 attempt，并以 `beginFnId` 登记到滚动窗口腾出的时刻（`runs.reconcile` 因 `beginFnId` pending 而 noop，`ops.livenessSweep` 只兜底，4.3.5）——判定只在一处，04 不另算桶。人工 `runs.start` / `runs.requestRenegotiation` 在入口处检查 `draining`（`run.draining`）与 `run_starts`（`run.rate_limited`）并拒绝。
- "每房间单非终态 run"：`startRunTx` 读写 `rooms` 文档，并发调用被 OCC 串行化；其他任何代码不得 `insert("runs")`（结构测试 SM-STRUCT-2）。
- `buyerFeasible(input)`（05 §5.8.2 S0 的 `enumerateCandidates(fullView, { mode: 'feasibility' })`，feasibility 模式无 `limit`，06 §10 实现）用全部硬约束枚举，只决定"是否值得开模型回合"，结果不进任何角色的上下文；它对 provider 泄露的至多是"run 在跑 / 在等"1 bit，按 canon D12 政策接受并由 D12 ⑥ 节流。
- 被人拒绝的提案永不进入 R2：`keepCandidateId` 只来自 `disposeCurrentRun` 刚从 `active` 改成 `stale` 的那一行，且只在被取代 run 被取代前处于 `pending_approval` 时传入；`rejected` 行不会被改。
- "提案属于哪个活跃 run"只由 `runs.currentProposalId` 表达；`proposals.runId` 是创建它的 run（来历），沿用时不改写，所以同一提案可以跨两次 bump 连续被 R2 沿用，审批守卫也只看当前 run（4.7.3 A-G3 / A-G4）。

### 4.3.4 `advanceRun` 与轮次结果映射

`turns.complete` 通过守卫并持久化回合结果后调用 `advanceRun(ctx, run, turn)`。05 的纯函数决定"下一步"，本节只规定它的结果如何落到迁移上。

| 刚完成的 turn | 结果（05 判定） | 迁移 |
| --- | --- | --- |
| provider `propose`，所选 `optionKey` 解析出的候选 `passesChecks` 通过 | 插入提案（P1，旧 active → `superseded`），`currentProposalId` | R4：建本轮第一个评估回合（customer） |
| provider `propose`，候选被规则阻断 | **不插入提案**；turn 记 `outcome: { blockedCandidateKey }`（provider 只得到 `blocked`，canon D12 ①） | `roundNo < maxRounds` → R4 下一轮；否则 R6（`rounds_exhausted`） |
| 任一回合 `clarify`，可由已披露事实代答（每角色每 run ≤ 1，canon D12 ③） | 答案附入该角色下一回合上下文 | R4：为同一角色新建同轮同 kind 的 turn |
| 任一回合 `clarify` 不可代答；或 `escalate` 通过策略检查 | — | R6（`clarify` / `agent_escalated` / `infeasible`） |
| 非最后一个评估回合（customer） | 结果入 turn（05 可声明短路，短路等价于提前调用 `resolveRound`） | R4：建下一评估回合（finance） |
| 最后一个评估回合 | `resolveRound(proposal, evaluations)` | `await_approval` → R5；`next_round(feedback)` → `roundNo < maxRounds` 时 R4，否则 R6（`rounds_exhausted`）；`needs_input(kind, toRole)` → R6 |
| 下一轮 provider 回合创建前 `enumerateCandidates(viewFor(provider))` 为空，或 provider 本 run 已 propose 4 次（05 §5.3.3） | `createTurnTx` 的前置检查 | 不建 turn → R6（`rounds_exhausted`，`questionKey` `no_candidates`） |

- 在 R5 前用**当前** `room.localDate` 重算 `passesChecks`：若交付日在评估期间已过（`date.in_past`），按"被阻断"进入下一轮，不会出现"全员 recommend_accept 但不可执行"的悬空态（inputs/07"stuck: all recommend_accept but evaluate fails"）。
- provider 的 `reject(reasonKey: cannot_deliver)` 与 `escalate` 一样交 05 策略检查，结果只可能是 R4 或 R6，不存在第三种出口。
- 每次 `advanceRun` 写 run 行（`activeTurnSeq`、`nextTurnSeq`、`roundNo`）；它与 `turns.complete` 同事务，所以两个迟到的提交不可能都推进（第二个在 G2 失败）。
