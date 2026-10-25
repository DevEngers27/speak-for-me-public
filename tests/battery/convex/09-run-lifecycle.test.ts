import { w2BatteryCases } from '../../convex-helpers/w2Battery.fixture';
import {describe,it as vitestIt} from 'vitest';
import {runtimeCase} from '../../convex-helpers/runtimeCases.w2-4.fixture';
import {answerBump,infeasibleAfterCap,lowerCapStillFits,directCapSupersedesRequest} from '../w2-3.cases';

// W2-4: real scheduler assertions retain the registry titles below.

const implemented: Record<string, () => Promise<void>> = {
  'CE-134': runtimeCase('CE-134'),
  'CE-142': runtimeCase('CE-142'),
  'CE-144': runtimeCase('CE-144'),
  'CE-123': runtimeCase('CE-123'),
  'CE-125': runtimeCase('CE-125'),
  'CE-126': runtimeCase('CE-126'),
  'CE-127': runtimeCase('CE-127'),
  'CE-133': runtimeCase('CE-133'),
  'CE-135': runtimeCase('CE-135'),
  'CE-136': runtimeCase('CE-136'),
  'CE-137': runtimeCase('CE-137'),
  'CE-138': runtimeCase('CE-138'),
  'CE-139': runtimeCase('CE-139'),
  'CE-140': runtimeCase('CE-140'),
  'CE-146': runtimeCase('CE-146'),
  'INV-67': runtimeCase('INV-67'),
  'INV-69': runtimeCase('INV-69'),
  'INV-70': runtimeCase('INV-70'),
  'INV-71': runtimeCase('INV-71'),
  'INV-72': runtimeCase('INV-72'),
  'INV-75': runtimeCase('INV-75'),
  'INV-76': runtimeCase('INV-76'),
  'CE-145': answerBump,
  'CE-128': infeasibleAfterCap,
  'CE-129': lowerCapStillFits,
  'CE-141': directCapSupersedesRequest,
  'CE-132': w2BatteryCases['CE-132']!
};
const it = { todo(title: string) { const body = implemented[title.split(' ')[0]!]; if (body) vitestIt(title, body); else vitestIt.todo(title); } };
// End W2-4.

describe("CT · 09-run-lifecycle", () => {
  it.todo("INV-67 单活跃 run：`rooms.currentRunId` 指向房间**最新** run（任何状态，终态时不清空），只由 `startRunTx` 写；非终态（`negotiating` / `pending_approval` / `needs_input`）run 至多一个，若存在必为 `currentRunId` 所指；`startRunTx` 是创建 run 的唯一 helper（公开 `runs.start` 与 `openIfReady` / `react()` 共用），断言 `cur` 为空或已终态；公开 `runs.start` 守卫顺序：成员 → `room.status === 'open'`（`run.invalid_state{ room_status }`）→ 已有非终态 run 则直接返回它（`created: false`，不写、不计节流）→ 就绪（`not_ready`）→ `opsFlags.draining` 为假（`run.draining`）→ 节流（INV-11）；系统路径不受排空与 `run_starts` 节流阻断（首回合停泊）；读写 rooms 文档（房间写锁 + OCC 串行）");
  it.todo("INV-69 持久化守卫（`turns.complete / fail(attemptId, …)`）：G0 `attempt.status === 'running' ∧ turn.currentAttemptNo === attempt.attemptNo`；G1 `room.currentRunId === run._id ∧ run.status === 'negotiating'`；G2 `run.activeTurnSeq === turn.turnSeq`；G3 `turn.constraintsVersion === room.constraintsVersion`。任一不符 → attempt `stale`、usage 照记、写事件（G0 情形不写）、**并调用 `runs.reconcile(runId)`**；守卫通过前不写任何业务表");
  it.todo("INV-70 活性：`run.status === 'negotiating'` ⇒ 恰有一个非终态 turn（= `activeTurnSeq`），且它有 `running` attempt，或 `beginFnId` 指向 `pending` 的调度，或 `waitingReason ∈ {draining, spend_deferred, run_cap}` 且对应条件仍成立（解除排空后由 `ops.setDraining(false)` 触发的巡检唤醒；`spend_deferred` / `run_cap` 由各自登记的 `beginFnId` 在次日 / 滚动窗口腾出时唤醒，10 §10.5.2 B6 / B6a；`ops.livenessSweep` 兜底）；`runs.reconcile` 在守卫失败、看门狗判定、attempt 上限后重建该性质：重新调度当前 turn 的下一 attempt；回合快照漂移（G3 而 run 的 cv 与房间一致）→ `replaceTurnTx`；run 的 cv 也漂移 → 取代 run 并 `react()`；按上限转 `needs_input`（回合上限 → 失败方 `agent_failed`；run 的 attempt / 美元上限 → customer `rounds_exhausted`）；`loadTurnContext` 返回 null 时 action 调 `turns.fail(stale)`，不空挂到看门狗");
  it.todo("INV-71 看门狗以 `attemptId` 登记、每个 attempt 自有（`attempts.watchdogFnId`）；到期先读 `_scheduled_functions`（`ctx.db.system.normalizeId`）：`pending / inProgress` → 重登记（≤ 3 次），`failed` → attempt `error`，`success` 而回合仍 running → `error(internal)`，`canceled` 不会出现；新 attempt 创建时不 cancel 旧看门狗（G0 让其成为空操作）；`turns.beginAttempt`（mutation）同事务写 attempt 行 + `runAfter(0, agents.runAttempt, { attemptId, actorUserId })` + `runAfter(deadline, agents.watchdog, { attemptId })`，是唯一调度接缝；不用 `scheduler.cancel`、不用 action-retrier");
  it.todo("INV-72 调用上限四层 + 排空：① 节流桶（INV-11）；② 每回合链至多 2 个 attempt（首发 / 人工重试 1 + 自动重试 ≤ 1，`MAX_ATTEMPTS_PER_TURN = 2`），每 run attempt 数 ≤ `runs.maxAttempts`（默认 `maxRounds × 3 × 2 = 18`）；③ 每 run 美元预留 / 结算 `runs.reservedMicroUsd`（调度前预留、提交时结算）；②③ 的 run 级上限用尽 → 不调度，转 `needs_input` + customer 的 `rounds_exhausted`（码 `run.call_limit`，`questionKey` 为 `call_limit` / `spend_limit`）；回合链用尽 → 失败方 `agent_failed`；④ 全局日美元 `spendCounters(global, day)`，被调度路径不 throw：回合停泊 `waitingReason: spend_deferred` 并 `runAfter` 到次日；`opsFlags.draining` 置位 → `turns.beginAttempt` 停泊回合（`waitingReason: draining`，返回 `run.draining`，不建 attempt），公开 `runs.start` 拒绝 `run.draining`，系统路径照常建 run 只停泊首回合，在途 attempt 照常提交；`AGENTS_ENABLED=false` 只作紧急止血（attempt `error(agents_disabled)`）");
  it.todo("INV-73 `needs_input` 出口完备且每个效果有迁移：`raise_cap` / `drop_items` / `extend_deadline` → `constraints.bump`（走 INV-32 循环）；`choose_candidate` → 全量复核通过：等于本 run 当前 active 且仍通过的提案则复用同一 proposalId，否则插入 `origin: 'human_choice'` 提案，run `needs_input → pending_approval`；不通过 → 旧请求 `superseded`（`closedReason: regenerated`，照记 `answerOptionKey`）、候选进剔除集、同事务生成同 kind 新请求（04 R19）；`disclose` → `sharedFacts`，`clarify` 请求 → `negotiating`、发问方同轮新开回合，`infeasible` 回退请求 → 同事务重跑预检；`retry_turn` → 同角色同轮新 turn + 新 attempt、`negotiating`；`pass_to_next` → 本请求 `answered`、同事务按目标角色自身视图给 `relaxationOrder` 下一角色开 `infeasible` 请求、run 留在 `needs_input`、不 bump（只出现在 `infeasible` 请求含回退请求，末位角色没有，每 run 每个 (from, to) 至多一次，是否提供只取决于位置，04 R21 / SM-31）；`keep_as_is` 按 kind（INV-65）；`end_run` → `ended_no_agreement`；`runs.requestRenegotiation` 允许态 = `{pending_approval, needs_input}`（04 与 12 同一张表），仅 creator（`auth.not_creator`），`executed` 房间拒绝；`runs.cancel` 仅 creator → `canceled`（已终态 → `unchanged`）");
  it.todo("INV-75 `setup` 期的写入（`invites.accept` / `briefs.confirm` / `budget.setCap` / `catalog.confirm` / `catalog.retire` / `ledger.recordBaseline`）只写来源、不 bump、不开 run，末尾调用 `openIfReady`；最后一个就绪条件（04 §4.2.1：三席齐、三方简报已确认且硬字段齐、≥ 1 个 confirmed item、baseline 已录）满足时，同事务 `setup → open` → `bump(cause: 'room_opened')`（cv 0 → 1，首行 `constraintRevisions`）→ `react()` → `startRunTx(cause: 'room_opened')`；该系统路径不受排空与 `run_starts` 节流阻断（排空时首回合 `waitingReason: draining`）；触发它的那次写入照常受 `constraint_writes` 节流，被拒则整体回滚、简报不写入");
  it.todo("INV-76 run 终态互斥且无出边：`executed`（仅经 INV-47）、`superseded`（经 `constraints.bump`、`requestRenegotiation` 或 `runs.reconcile` 发现 D06 被破坏时的修复）、`ended_no_agreement`（`end_run` / 请求过期 / 轮次用尽且 customer 放弃）、`canceled`（`runs.cancel` / `rooms.close` / 运维 `rooms.forceClose`）；进入终态同事务：open 请求 → `superseded` 或 `expired`，非终态 turn → `stale`，其 `active` 提案 → `stale`（bump）或 `superseded`（其余，04 P2b），running attempt 留给 G1 拒收（不 cancel）");
  it.todo("CE-121 回合 k 的 action 在途；（stub 加 `STUB_DELAY_MS`）期间另一路径产出 v3 → `pending_approval` → 执行；k 迟到调 `turns.complete`");
  it.todo("CE-123 attempt#1 超时被看门狗标 `timeout`，attempt#2 已创建；attempt#1 的 action 随后返回");
  it.todo("CE-125 看门狗对已 `completed` 的 attempt 触发；或对已 `superseded` run 的 attempt 触发");
  it.todo("CE-126 评估方 finance 回合 `refusal`（不可重试）");
  it.todo("CE-127 变异纵深：某写路径 bump 了 cv 但未 supersede run；下一回合 `loadTurnContext` G3 失败");
  it.todo("CE-128 run 1 `pending_approval` 时降预算到无合规组合（$4,400，`committed 400000 + 最便宜 80000 > 440000`）");
  it.todo("CE-129 run 处于 `pending_approval`、当前提案 v2 $800 时，finance 把上限从 $5,000 降到 $4,800（v2 仍合规）");
  it.todo("CE-130 执行后 finance 再改预算 / provider 再 retire 条目");
  it.todo("CE-132 变异：reject 后提案保持 `active` 直到新提案");
  it.todo("CE-133 活跃 run 存在时任一成员 `runs.start`");
  it.todo("CE-134 任一成员 1 小时内第 7 次成功调用 `retryTurn` / `requestRenegotiation` / `briefs.confirm` / 实际开局的 `runs.start` 任意组合");
  it.todo("CE-135 单 run 内 attempt 数达到 `runs.maxAttempts`（18）；或美元预留失败");
  it.todo("CE-136 `ops.setDraining(true)` 时：成员调 `runs.start`；live 回合 `beginAttempt`；finance 降预算触发 bump；在途 attempt 提交；随后解除排空");
  it.todo("CE-137 `spendCounters(global, day)` 超限时被调度的 `beginAttempt`");
  it.todo("CE-138 构造任何进入 `needs_input` 却无 open 请求的路径（如旧设计 `stop_run`）；以及 `pass_to_next` / `choose_candidate` 复核失败这两条 `needs_input → needs_input` 自环");
  it.todo("CE-139 open 请求 7 天无人回答；cron 到期");
  it.todo("CE-140 失败方双击 `retry_turn`");
  it.todo("CE-141 finance 收到 `raise_cap` 请求后不回答而是直接 `budget.setCap`");
  it.todo("CE-142 run 已延长过一次后的 `rounds_exhausted` 请求里提交旧的 `keep_as_is` optionKey；轮次已尽时 customer 对 `agent_escalated` 选 `keep_as_is`；对 `clarify` 请求选 `keep_as_is`");
  it.todo("CE-144 customer `choose_candidate` 选的候选在全视图复核下不通过（触犯未披露的卖方约束）");
  it.todo("CE-145 `humanRequests.answer(raise_cap)` 后检查该请求行");
  it.todo("CE-146 (a) 最后一个就绪条件（第三份简报确认）满足时 `draining` 为真；(b) 该成员的 `constraint_writes` 已满时提交第三份简报确认");

  // W1-1F: issue #52, newly catalogued invariant.
  it.todo("INV-79 终结活性：任何非终态房间（`setup` / `open`）都至少有一条不依赖 creator 的终结路径——open 请求 7 天过期（`humanRequests.expireDue` → run `ended_no_agreement`）与运维 `rooms.forceClose`（internal sysMutation，经 CLI、部署 admin 双人确认）；creator 或必需审批人的身份消失（v1 席位不可换、审批不过期，D24 / U7）不会让房间永久停在非终态");
});
