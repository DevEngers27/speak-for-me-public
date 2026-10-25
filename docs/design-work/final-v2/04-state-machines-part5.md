# 04 · 状态机（part5）：派生阶段、活性、不变量、备选、测试、开放问题、与 canon 对照

> 分片清单见 `04-state-machines.md` 顶部。

## 4.10 房间派生阶段与"谁该行动"

阶段名与 01 part4 X6、13 的 `derivedPhaseV` 一致（七个阶段：`setup{gaps}`、`negotiating`、`needs_input`、`awaiting_approval`、`stopped{reason: ended_no_agreement | canceled}`、`executed`、`closed`；早稿的 `setup_members / setup_inputs` 由 `gaps` 区分，`no_agreement / canceled` 合并为 `stopped.reason`，取值直接用 run 终态名，与 01 part4 X6、13 §13.8.2 / §13.9.2 一致）；本节定义输入与优先级。

```ts
// core/engine/phase.ts —— 纯函数，rooms.view / rooms.listMine 调用；输入是已按查看者投影的字段
export type Phase = "setup" | "negotiating" | "needs_input" | "awaiting_approval" | "stopped" | "executed" | "closed";
export type PhaseView = { phase: Phase;
  gaps?: { gap: ReadinessGap; ownerRole: Role }[];          // setup：每个缺口的负责角色（有 seat_vacant 时 13 显示"成员"子态）
  reason?: "ended_no_agreement" | "canceled";             // stopped：取 run 终态名
  activeRole?: Role; roundNo?: number;                      // negotiating："Provider agent drafting…"
  you?: boolean; waitingOn?: Role;                          // needs_input：provider 且非收件人时 waitingOn 省略
  proposalVersion?: number; pendingRoles?: Role[]; youPending?: boolean };   // awaiting_approval

export function derivePhase(i: PhaseInput): PhaseView {
  if (i.room.status === "closed") return { phase: "closed" };
  if (i.room.status === "executed") return { phase: "executed" };
  if (i.room.status === "setup") return { phase: "setup", gaps: i.gaps };
  const run = i.run;                                   // = rooms.currentRunId；open 房间里不会是 superseded / executed
  if (!run || run.status === "ended_no_agreement") return { phase: "stopped", reason: "ended_no_agreement" };   // !run 只是防御：open 房间必有 run（M2）
  if (run.status === "canceled") return { phase: "stopped", reason: "canceled" };
  if (run.status === "negotiating") return { phase: "negotiating", roundNo: run.roundNo, activeRole: i.activeTurn!.role };
  if (run.status === "needs_input") {
    const you = i.openRequest!.toRole === i.viewerRole;
    return { phase: "needs_input", you,
      waitingOn: you || i.viewerRole === "provider" ? undefined : i.openRequest!.toRole };   // canon D12 ⑦
  }
  const pending = i.slots.filter(s => s.validity !== "effective").map(s => s.role);      // 4.7.1
  return { phase: "awaiting_approval", proposalVersion: i.proposal!.version,
    pendingRoles: pending, youPending: pending.includes(i.viewerRole) };
}
```

open 房间的当前 run 不会是 `superseded`（bump 同事务必开新 run）；`executed` run 必伴随 `executed` 房间。

| 阶段 | 谁需要行动 | 界面主行动（13 定文案） | 无人行动时的出口 |
| --- | --- | --- | --- |
| `setup`（含 `seat_vacant` 缺口） | creator | 邀请 / 重发链接 | creator `rooms.close`；ops `rooms.forceClose`（4.11） |
| `setup`（其余缺口） | 每个缺口的负责角色 | Confirm brief / Confirm quote / Record committed baseline | creator `rooms.close`；ops `rooms.forceClose` |
| `negotiating` | 无（代理） | 回合进度；creator 可 Cancel | 看门狗、reconcile；任一约束写入 |
| `needs_input` | `toRole` | 回答请求卡（只对收件人显示选项） | 7 天过期 → `stopped{reason: ended_no_agreement}`；creator 重谈 / 取消；任一约束写入 |
| `awaiting_approval` | 状态不是 `effective` 的必需审批人 | "Approve v3 under constraints v2" / Reject（带 `expected*`） | creator 重谈 / 取消；约束写入；时钟翻转 bump |
| `stopped{reason: ended_no_agreement \| canceled}` | 任一成员 | 修改自己的约束（自动开新 run）或 `runs.start`；creator Close | ops `rooms.forceClose` |
| `executed` | 被指派人（任务）；任一成员 | Tasks；Start a follow-up change（`rooms.startFollowUp`） | — |
| `closed` | 无 | 只读历史 | — |

## 4.11 活性：每个非终态都有出口

| 非终态 | 人工出口 | 系统出口（已登记的调度或定时器） | 保证 |
| --- | --- | --- | --- |
| room `setup` | 补齐缺口 → M2；creator → M4 | — | 缺口逐项显示负责人 |
| room `open` | 最后一票 → M3；creator → M5 | — | 其中 run 各态见下 |
| run `negotiating` | creator cancel；任一约束写入 | attempt 看门狗；`turns.complete/fail` → `advanceRun`；reconcile（守卫失败 / 上下文为空）；解除排空后的 `ops.livenessSweep`；`spend_deferred` 的次日调度；`run_cap` 停泊由 B6a 登记的 `beginFnId` 在 `run_starts` 窗口腾出时恢复；`ops.livenessSweep` 每 5 分钟兜底（15 §15.8） | INV-SM-03 |
| run `pending_approval` | approve / reject；creator 重谈 / 取消；约束写入 | `clock.rollLocalDate` 结论翻转 → bump | 审批不过期（U7），但 creator 恒有两个出口 |
| run `needs_input` | `toRole` 回答；creator 重谈 / 取消；约束写入 | `humanRequests.expireDue`（7 天） | 恰好一个 open 请求，且每个请求都含 `end_run` |
| turn `scheduled` | — | 同事务 `beginAttemptTx` 或已登记 `beginFnId`；解除排空 → reconcile；run 结束 → `stale` | — |
| turn `running` | — | attempt 终态 → 下一 attempt（`beginFnId`）或 U4 | — |
| attempt `running` | — | action 提交；看门狗（≤ 3 次重登记后必终态） | — |
| proposal `active` | reject；run 结束 | bump → `stale`；执行 | INV-SM-06 |
| humanRequest `open` | 回答 | 过期 cron；bump；run 结束 | — |
| catalogItem `draft` | provider 确认 | — | 只在 follow-up 新房间 `setup` 期存在 |
| task `open` | 被指派人勾选 | — | 不阻塞任何流程 |

**身份消失的兜底**（completeness-21）：creator 独占 `rooms.close` / `runs.cancel` / `requestRenegotiation`，席位不可换（D24），审批不过期（U7）。若 creator 或某个必需审批人的 Clerk 身份消失（删号 / 封禁 / 离职），上表的人工出口可能全部失效。v1 的兜底是 internal mutation `rooms.forceClose({ roomId, reason })`（`assertTier` 全层级可用，只经 CLI 由部署 admin 发起，12 §12.20 登记；事件 `room_closed { by: 'ops' }`）：对 `setup` / `open` 房间等价 M4 / M5（当前 run → `canceled`，open 请求 → `superseded`）。活性不变量 **INV-SM-07**：任何非终态房间都存在至少一条不依赖 creator 的终结路径（`needs_input` 的 7 天过期 + `forceClose`；`pending_approval` / `negotiating` 的 `forceClose`）。席位转移与审批过期列入 17（E10）。

## 4.12 不变量

| ID | 不变量 | 落点 |
| --- | --- | --- |
| INV-SM-01 | 每房间至多一个非终态 run，且 = `rooms.currentRunId` | `startRunTx` 读写 rooms（OCC）；SM-STRUCT-2 |
| INV-SM-02 | run 非终态 ⇒ `run.constraintsVersionAtStart === room.constraintsVersion` | `constraints.bump` 同事务取代（canon D06）；reconcile 修复 |
| INV-SM-03 | `negotiating` ⇒ 恰一个非终态 turn，且有 running attempt / pending `beginFnId` / 仍成立的 `waitingReason` | 4.3.5 |
| INV-SM-04 | `needs_input` ⇔ 恰一个 open 请求（`runId` = 本 run）；open 请求 ⇒ 其 run 是当前 run 且 `needs_input` | `openHumanRequestTx`；H4 |
| INV-SM-05 | `pending_approval` ⇒ `currentProposalId` 为 `active`，进入时 `passesChecks`，每次 bump 重判 | R2 / R5 / R15；D06 |
| INV-SM-06 | 每房间至多一个 `active` 提案，且它是唯一非终态 run 的 `currentProposalId` | P1 / P2a / P2b / P4 |
| INV-SM-07 | 任何非终态房间都存在至少一条不依赖 creator 的终结路径（请求过期；ops `rooms.forceClose`） | 4.11；SM-29 |
| INV-SM-08 | run 至多一个非终态 turn，turn 至多一个 running attempt；`turn.currentAttemptNo` = 其 attempts 的最大 `attemptNo` | `createTurnTx`、`beginAttemptTx` |
| INV-SM-09 | status 只经 `setStatus` 写；schema 中不存在 `paused`、`pendingTurnSeqs`、`openTurnCount`、`pendingEvaluations`、`endorsed`、`approved` | SM-02、SM-STRUCT-1 |
| INV-SM-10 | room `executed` ⇒ 恰一条 execution，其提案与 run 均 `executed`；此后无协商 / 约束 / 审批写入 | M3；4.2.2 |
| INV-SM-11 | `rejected` 提案永不回到 `active` | P5 守卫 |
| INV-SM-12 | `approvals` 只追加；完成判定按集合且 userId 两两不同 | 4.7；08 |
| INV-SM-13 | 每个迁移同事务写事件；迟到结果只补记用量、不产生提案 | `events.append`；G0–G3 |
| INV-SM-14 | 没有任何请求选项导致 `rooms.close` | 4.8.2；SM-18 |
| INV-SM-15 | 提案条款不变；`version` 房间内唯一单调（原编号与 INV-SM-07 重号，已改） | P1；结构测试 |

## 4.13 备选与否决

| 备选 | 来源 | 否决理由 |
| --- | --- | --- |
| `paused` + 24h 看门狗 | 旧 canon D06 | 无收件人、无期限的等待态；改为 `needs_input` + `agent_failed`（canon C6） |
| 并行评估 + `pendingTurnSeqs` / `openTurnCount` / 屏障 + "整轮 failed" | 8 份候选、invariants R-D | 一方失败、另一方被判 stale 后计数永不归零（inputs/07 ×5）；串行代价是墙钟（U4） |
| 守卫失败只标 stale | run-lifecycle D2 | run 停在 `negotiating` 无在途（r01） |
| 约束变化后保留 run 于 `pending_approval` | versioned-approvals D6、plugin R9 | 旧 run 的 `constraintsVersionAtStart` 恒不符，之后任何回合被拒（活性死锁 1）；改为取代 + R2 沿用同一 proposalId |
| 复制一个 revalidated 提案版本 | Role A RA-R11 | 两行条款相同的版本是噪音，且让旧审批与新行脱钩 |
| 沿用 `negotiating` / `needs_input` run 的 active 提案直接进 `pending_approval` | canon D06 早稿字面 | 跳过未完成的代理评估（含轮次用尽时已被 customer 代理否决的版本）；canon D06 修订后只沿用 `pending_approval`（C47、SM-30） |
| `executed → closed` 归档迁移（M7） | completeness-22 备选 | canon §1.3 两者皆终态、D04 要求执行后只读；"收起已执行房间"是查看者本地筛选（13），不需要状态写入 |
| 看门狗以 `turnId` + `turn.startedAt` 计时 | agentquality 候选 | 第二个 attempt 被第一个看门狗误杀；改为每 attempt 自有看门狗、读 `_scheduled_functions` |
| 以定时扫描作为活性的**主要**机制 | invariants INV-49 | 每个等待都必须有登记的唤醒者，否则扫描会掩盖漏调度的 bug；本章采用 10 / 12 的 `ops.livenessSweep` 只作兜底与告警器（排空恢复之外的命中即缺陷），活性由 SM-27 性质测试证明 |
| 房间 `status` 混入协商进度（negotiating / needs_input / confirmed） | Role A | 与 run 状态成为两份真相；阶段改为派生（4.10） |
| `scheduler.cancel` 尽力取消在途回合 | security / runtime 候选 | 对已完成函数会抛错，对在途 action 无效；守卫已足够（canon D01） |
| `requestRenegotiation` 允许四态 / 允许 `executed` | plugin 04 / product | 与 12 不一致、执行后重复承诺（canon C40、D04） |
| 关房作为请求选项（`close_room`） | PD-04 (i)、plugin 05 | 一个角色替所有人永久关房（canon D15） |
| 被拒提案保持 `active` 直到新提案 | finance / product 候选 | bump 后被预检复活（inputs/07）；改为 `rejected` 终态 |

## 4.14 测试清单（16 引用；CT = convex-test，RD = 真实部署）

| ID | 内容 | 层 |
| --- | --- | --- |
| SM-01 | 全部迁移表表驱动：每个 (from, to) 合法 / 非法 | 纯函数 |
| SM-02 | validator 字面量与 `STATUSES` 相等；禁用字面量（INV-SM-09）不存在 | 纯函数 |
| SM-STRUCT-1/2 | `status` 只经 `setStatus` 写；`insert("runs")` 只在 `startRunTx` | AST |
| SM-03 | 活性死锁 1 回归：pending_approval 中上调 cap → R12 + R2（同 proposalId）→ customer reject → R10 → 新回合快照新 cv → 被接受 | CT |
| SM-04 | 活性死锁 2 回归：customer 评估两次 `invalid_output` → U4 → R6 `agent_failed` → `retry_turn` → 完成 → finance 评估被调度 → `resolveRound` | CT |
| SM-05 | 人为制造 cv 漂移 → G3 → reconcile 修复（R7 + 新 run） | CT |
| SM-05b | 只有回合快照 cv 漂移、run cv 与房间一致：G3 → turn `stale` → 恰一次 reconcile → `replaceTurnTx` 建出替代回合；断言无递归调用、run 不停在 `negotiating`、attempt 不留在 `running` | CT |
| SM-06 | 上下文读取为 null → `turns.fail(stale)` → reconcile，不等看门狗 | CT |
| SM-07 | 看门狗：`pending` 重登记 3 次后 `timeout`；attempt#2 运行时旧看门狗触发为空操作 | CT（显式推进假时钟） |
| SM-08 | attempt#1 超时、#2 运行中、#1 迟到返回 → 只补记用量，提案数不变 | CT |
| SM-09 | `choose_candidate` → R15；全量不通过 → R19，open 请求数恒为 1 | CT |
| SM-10 | 轮次用尽且无合格提案 → customer `rounds_exhausted` 请求（不是空 `needs_input`） | CT |
| SM-11 | `keep_as_is` 延长一次；第二次 `rounds_exhausted` 请求不再提供 `keep_as_is`（提供与回答共用同一资格谓词，直接提交该选项 → `request.option_unknown`），只剩 `choose_candidate` / `end_run` | CT |
| SM-12 | 请求过期 → `ended_no_agreement`；房间仍 `open`；`runs.start` 可重开 | CT |
| SM-13 | 注入"约束效果未改变投影"的回答 → 不 bump，按 R20 重跑预检（仍无解 → 新 `infeasible` 请求；有解 → `negotiating`），open 请求数恒为 1 | CT |
| SM-14 | 被拒提案不复活：reject v3 → 无关条目改价 bump → 新 run `negotiating` | CT |
| SM-15 | 4.3.6 动作 × 状态总表全格（与 12 共用表驱动 fixture） | CT |
| SM-16 | `executed` 房间：4.2.2 每个 mutation 被拒；`tasks.markDone`、`startFollowUp` 成功 | CT |
| SM-17 | `rooms.close` 于 `negotiating` / `needs_input`：run `canceled`、请求 `superseded`、在途 attempt 被 G1 拒收 | CT |
| SM-18 | 遍历 `buildHumanRequests` 全部 kind：无关房选项，均含 `end_run` | 纯函数 |
| SM-19 | 系统 bump 时排空中 / `run_starts` 已满 → run / turn 建立、无 attempt（`waitingReason` 为 `draining` / `run_cap`）；解除排空后 `ops.livenessSweep` → attempt；`run_cap` 回合带 `beginFnId`，窗口腾出时由该调度 → attempt，期间 `runs.reconcile` 为 noop；人工 `runs.start` → `run.draining` / `run.rate_limited` | CT |
| SM-20 | `spend_deferred` → 次日调度生效 | CT |
| SM-21 | run 的 attempt / 美元上限 → customer 的 `rounds_exhausted`（`questionKey` `call_limit` / `spend_limit`），无 `keep_as_is`，`choose_candidate` 可零调用送审 | CT |
| SM-22 | `pending_approval` 中时钟翻转 → bump(`clock`) → 取代 → 新 run（与 09 共用） | CT |
| SM-23 | 评估期间交付日已过 → 按阻断进入下一轮，不进 `pending_approval` | CT |
| SM-24 | `approvals.record` A-G1…A-G10 表驱动，失败时行数不变；双击 approve → `unchanged` | CT |
| SM-25 | 两个迟到 `turns.complete` 并发 → 只推进一次（G2）；并发 `runs.start` → 单 run | RD |
| SM-26 | `derivePhase` 七个阶段（`setup` 两类缺口、`stopped` 两种 reason 各一例）+ provider 投影不含 `toRole` | 纯函数 |
| SM-27 | 随机操作序列（bump、answer、reject、cancel、失败注入、排空）后断言 INV-SM-01…06、08、15（INV-SM-07 由构造保证，SM-29 覆盖） | CT 性质测试 |
| SM-28 | 无人可放松（每方单看可行、合起来不可行）→ customer 的 `infeasible` 回退请求只含 `disclose { field, toRoles }` + `end_run` → 回答 `disclose` → R20：仍无解则恰好一个新的 `infeasible` 请求（finance 得 `raise_cap`），有解则建 provider 回合、run → `negotiating`；全程 open 请求数恒为 1 | CT |
| SM-29 | `rooms.forceClose` 于 `setup` / `negotiating` / `pending_approval` / `needs_input`：等价 M4 / M5（run `canceled`、请求 `superseded`、在途 attempt 被 G1 拒收、事件 `room_closed { by: 'ops' }`）；`executed` / `closed` → `unchanged` | CT |
| SM-30 | R2 只沿用被取代前处于 `pending_approval` 的提案：`negotiating`（customer 评估在途、active 提案在新约束下仍通过）中 bump → 新 run `negotiating`、首个 provider 回合重新提出；`needs_input`（`rounds_exhausted`，active 提案仍通过）中 bump → 同样重新协商；`pending_approval` 中 bump 且仍通过 → R2 沿用同一 `proposalId` | CT |
| SM-31 | `pass_to_next`：给 customer 的 `infeasible` 请求含 `pass_to_next { toRole: finance }`，给 finance（末位）的不含；customer 回答 → R21：旧请求 `answered`、finance 收到按自身视图生成的 `infeasible` 请求（有 `raise_cap`，或只含 `disclose` + `end_run`），open 请求数恒为 1、cv 不变；本 run 内同一 (customer, finance) 不再提供第二次 | CT |

## 4.15 开放问题

- **Q1**（已裁决，canon D06 / §1.3 修订）：只有被取代 run 处于 `pending_approval` 时才沿用其提案（R2、`startRunTx`、09 `bump` 的 `keepCandidateId` 条件）；`negotiating` / `needs_input` 中的提案代理评估尚未完成或已被代理否决（如轮次用尽），一律重新评估（completeness-29）。09 §9.5 表与 V9 同此，测试 SM-30。
- **Q2**：`runs.cancel` / `runs.requestRenegotiation` 只给 creator 是否过严（备选：任一买方角色）。
- **Q3**（已关闭）：canon §1.3 已把 `superseded` 扩为"或所属 run 非因约束变化而结束"，与 P2b 一致。
- **Q4**（已关闭）：canon D04 已显式豁免 `tasks.markDone` 与 `rooms.startFollowUp`（4.2.2）。
- **Q5**（已关闭）：canon D17 已写明 `MAX_ATTEMPTS_PER_TURN = 2`（首发或人工重试 1 次 + 至多 1 次自动重试），PD-11 的自动 3 次被否决；10 同此。
- **Q6**（已关闭）：canon §1.5 已补录 `approval.not_executable`。
- **Q7**（已改写）：无人可放松时不再只给 `end_run`，而是 customer 的 `disclose` 回退请求（4.8.3、R20、SM-28）。只有当 customer 已向放松角色披露全部硬字段而仍无人可放松时，回退请求才只剩 `end_run`；按 06 §11.2 的视图定义此时放松角色的视图已含全部冲突输入，理论上不应出现，出现即 `opsLog("request.no_relaxation")`。该卡片是否同时提示"各方可主动修改约束"由 13 定文案。
- **Q8**（已统一）：`runs.cause` 取 `room_opened` / `manual_start`；延长标记 `roundsExtended`（05 / 08 / 10 的 `extraRoundGranted`、06 / 12 的 `keepAsIsUsed` 已改）；`end_run` 的 `endedReason: no_agreement`；`retry_turn` 新建 turn（`retryOfTurnId`）；排空中开房仍建 run 且首回合 `waitingReason: draining`；回合等待用 `waitingReason` / `beginFnId`，两次 attempt 之间保持 `running`，没有 `running → scheduled`（10 §10.4.5 / §10.5.2 / §10.9 已按本章改写）。

## 4.16 与 canon 的对照

- §1.3 状态值：全部照用；无 `paused`、无 `endorsed` / `approved`；`stale → active` 只在 D06 预检保留的同一 bump 事务内（P5），`superseded` 含"所属 run 非因约束变化而结束"（P2b）；`setup → open` 只由 `openIfReady`（M2）；派生项与 `passesChecks` / `isExecutable` / `canExecuteNow` 定义列于 4.1.1。
- §1.6 函数名：`runs.start` / `retryTurn` / `requestRenegotiation` / `cancel`、`turns.beginAttempt` / `complete` / `fail`、`runs.reconcile`、`agents.runAttempt` / `watchdog`、`approvals.record`、`executions.executeIfComplete`、`humanRequests.answer`、`constraints.bump`、`clock.rollLocalDate`、`events.append` 照用；事务 helper 名与 canon §1.6 的清单一致（`openRoomTx`、`roomReadiness`、`openIfReady`、`disposeCurrentRun`、`startRunTx`、`createTurnTx`、`replaceTurnTx`、`advanceRun`、`openHumanRequestTx`、`setStatus`），写 helper 统一以 `RoomCtx` 经调用方的 `RoomTx` 写入（4.1.2）；`humanRequests.expireDue`、`ops.livenessSweep`、`tasks.markDone` 已入 canon §1.6；`rooms.forceClose` 是 12 §12.20 登记的 internal 运维入口（4.11）。
- D01：`beginAttempt` 唯一调度接缝，不调用 `scheduler.cancel`（4.5.1、4.13）。
- D02：审批只追加、当前决定取最大 seq、`expected*`、`unchanged`、reject 终局、withdraw 只撤本人在当前 cv 上的 approve（否则 `unchanged`）、`not_executable` 纵深（4.7）。
- D03 / D04：执行同事务、不 bump；房间 `executed` 终态、拒绝写入、`startFollowUp`（M3、4.2.2）；没有 `executed → closed` 归档迁移，已执行房间保持只读（4.2 M6 段）。
- D06：bump 取代非终态 run、active → `stale`、请求 → `superseded`、`react()` 新 run 预检沿用同一 proposalId、被拒提案不参与（R2、R7、R12、R16、P4、P5）；沿用只限被取代 run 处于 `pending_approval`（canon D06 / §1.3 修订，4.15 Q1、SM-30）；系统路径照常建 run、首回合可停泊为 `draining` / `run_cap`（4.3.3）。
- D07：G0–G3、失败必 reconcile、attempt 级看门狗读 `_scheduled_functions`、上下文为 null 调 `turns.fail`（4.3.5、4.5）。
- D08：串行回合、`resolveRound` 结果映射、provider 被阻断不花评估调用、`maxRounds = 3`（4.3.4）。
- D10：`candidateSnapshot` 规则写入 U1；只在快照内解析。
- D12 ⑤⑥⑦：每 run 每角色 ≤ 4 次提案、节流（含 `run_starts` 桶：人工 `runs.start` 超限拒绝、系统路径首回合 `run_cap` 停泊）、provider 只见 `run_waiting`（R6、4.3.3、4.3.6、4.10）。
- D14 / D16：事件 payload 无私密值；失败码经 `ConvexError`，内部错误映射 `internal`。
- D15：请求结构、九种 effect（含本版新增的 `pass_to_next`，R21）的出口、`keep_as_is` 按 kind 的含义（`infeasible` / `agent_failed` 不提供）、收件人选择口径（自身视图候选集为空且单独放松一个硬字段即可非空）、恰好一个 open、7 天过期、无关房选项、回合失败走 `agent_failed`、run 上限走 customer 的 `rounds_exhausted`、无人可放松时的 `disclose` 回退与 R20、`needs_input → pending_approval`（4.8、R14–R21）。
- D17：排空与上限不阻断系统路径（4.3.3、A1）。
- D19：`passesChecks` / `isExecutable`（不含审批集合）/ `allApproved` 分开命名（4.1.1）。
- D22：规则的"今天"一律读 `room.localDate`（含 R5 前与 A-G8 的重算）；物化前落后时同事务 `rollLocalDateTx`（09 §9.6.7）；时钟翻转经 bump（R12、SM-22）。
- D24 / D25：一人一席、self_conflict 第二道防线；席位不可换时的身份消失兜底 `rooms.forceClose`（4.11、INV-SM-07）；提案只改 status（4.7.3、4.6）。
- C5、C6、C10、C13、C14、C40：分别落在 SM-D3、SM-D2、R2、4.3.5、4.5.3、4.3.6。
- canon 包修订新增的 C44、C45、C47、C48、C49、C50、C52、C54、C55、C56：分别落在 4.1.1（`isExecutable` 不含审批集合）、4.2.2（两项豁免）、R2 / P5（只沿用 `pending_approval`、同事务 `stale → active`）、M2（`openIfReady`、cause `room_opened`）、4.3.1（`currentRunId` 不清空）、R10（代理反馈不含 `reasonKey`）、4.3.3（系统路径照常建 run、首回合停泊）、R21（`pass_to_next`）、4.15 Q5（`MAX_ATTEMPTS_PER_TURN = 2`）、M1 / A-G9（`scenario_version`、无可撤回 = `unchanged`）。
- D10 / D15（跨章裁定的落实）：`buyerFeasible` 用 feasibility 模式、无 `limit`（4.3.3）；`rounds_exhausted` 的原因映射（provider 的提案上限 → `no_candidates`，`call_limit` / `spend_limit` 只用于 run 的 attempt / 美元上限）与 `keep_as_is` 的单一资格谓词（R6、4.8.2、4.8.3、SM-11）。
