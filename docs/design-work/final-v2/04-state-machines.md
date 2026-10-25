# 04 · 状态机（part1）：目标与决定、总则、房间

> 分片（按顺序阅读）：
> 1. `04-state-machines.md`（本文件）：4.0 目标与决定、4.1 总则与单一来源、4.2 房间
> 2. `04-state-machines-part2.md`：4.3 run（状态、迁移表 R1–R19、`startRunTx`、`advanceRun`）
> 3. `04-state-machines-part3.md`：4.3.5 `runs.reconcile`、4.3.6 run 类公开 mutation 与"动作 × 状态"总表（12 引用同一张表）、4.4 turn、4.5 attempt 与持久化守卫
> 4. `04-state-machines-part4.md`：4.6 提案、4.7 审批、4.8 人工请求、4.9 目录项 / 任务 / 邀请
> 5. `04-state-machines-part5.md`：4.10 派生阶段与"谁该行动"、4.11 活性表（每个非终态的出口）、4.12 不变量、4.13 备选与否决、4.14 测试、4.15 开放问题、4.16 与 canon 的对照
>
> 底稿：`candidates/runtime/04-state-machines*`（迁移表骨架、两组守卫分离）、`candidates/product/04-state-machines-part4.md`（派生阶段与"谁该行动"）。吸收：`deepdives/run-lifecycle-part2.md` §4 与其反驳 r01/r02/r04/r07/r11/r13、`inputs/07` 全部活性条目。命名、状态值与关键决定以 `00-canon*.md` 为准。

## 4.0 目标与决定

**目标**：给每个存储状态一张完整迁移表——触发函数、调用者、守卫、同事务副作用、失败码——使得（1）每个非终态都有已登记的出口（人工动作、已调度函数或明确的定时器），（2）任何迟到、重复、并发写入都被守卫拒收而不卡住流程，（3）03 的字段、05 的轮次结果、08 的审批执行、09 的约束变化、12 的函数都能对上同一张表。

| # | 决定 | 理由（详见 4.13 的备选与否决） |
| --- | --- | --- |
| SM-D1 | 存储状态只有 canon §1.3 列出的值；可执行性、审批有效性、房间阶段全部派生 | 存储的派生值必然过时（I10）；派生让"约束一变全部窗口同时翻转"不依赖回写 |
| SM-D2 | run 没有 `paused`；回合失败 → `needs_input` + `humanRequest(kind: agent_failed)` 给失败方（canon D15） | `paused` + 24h 看门狗是一个无人负责的等待态；请求有收件人、有期限、有出口 |
| SM-D3 | 回合严格串行：run 任意时刻至多一个非终态 turn（`runs.activeTurnSeq`）、至多一个 `running` attempt；不存在 `pendingTurnSeqs` / `openTurnCount` / `pendingEvaluations` | 5 份候选的并行屏障各有一个永久卡死反例（inputs/07 活性死锁 2 ×5）；串行让"下一步"只由一个已完成回合决定（canon D08） |
| SM-D4 | 持久化守卫 G0–G3 任一失败 → attempt `stale` **并且** `runs.reconcile(runId)`（canon D07） | run-lifecycle r01：只标 stale 会让 run 停在 `negotiating` 却无在途回合 |
| SM-D5 | 约束变化一律取代当前非终态 run；新 run 预检可直接进入 `pending_approval` 并沿用同一 `proposalId`（canon D06） | 取代 + 新 run 让 `run.constraintsVersionAtStart === room.constraintsVersion` 恒成立，删去"跨版本存活的 run"这一死锁来源（inputs/07 活性死锁 1） |
| SM-D6 | `needs_input` 恰好对应一个 open 请求；`choose_candidate` 回答走 `needs_input → pending_approval` | inputs/07：缺这条边导致 human_choice 旅程走不通；无请求的 `needs_input` 是死路 |
| SM-D7 | 房间 `executed` 是终态，拒绝全部协商、约束、审批写入（canon D04）；后续变更走 `rooms.startFollowUp` 新房间 | 同房间追加轮需要"已执行范围"进入规则与枚举，每一处都被评委打出重复承诺反例 |
| SM-D8 | 所有 status 写入经唯一 helper `setStatus` → `assertTransition`；迁移表是 `core/engine/stateMachines.ts` 的常量，Convex validator 由同一数组派生 | 文档、代码、schema 三处同源；非法迁移在单测和运行时都抛错 |

## 4.1 总则

### 4.1.1 存储与派生

| 对象 | 存储状态（canon §1.3） | 派生（不入库） |
| --- | --- | --- |
| `rooms.status` | `setup` → `open` → `executed` \| `closed` | 阶段 `phase`、待办 `todos`、就绪缺口 `readinessGaps`（4.10） |
| `runs.status` | `negotiating`、`pending_approval`、`needs_input`；终态 `executed`、`superseded`、`ended_no_agreement`、`canceled` | 进度文案、"等谁" |
| `turns.status` | `scheduled` → `running` → `completed` \| `failed` \| `stale` | — |
| `attempts.status` | `running` → `completed` \| `invalid_output` \| `timeout` \| `error` \| `refused` \| `stale` | — |
| `proposals.status` | `active`、`superseded`、`rejected`、`stale`、`executed` | `passesChecks`（规则是否通过）、`isExecutable`（当前性 ∧ `passesChecks`，**不含**审批集合）、`allApproved`（必需审批齐全）、对 provider 的 `fit: ok \| blocked` |
| `approvals.decision` | `approve` \| `reject` \| `withdraw`（行不可变） | 每个必需角色的有效性 `effective` / `stale_approve` / `stale_reject` / `withdrawn` / `pending`（4.7） |
| `humanRequests.status` | `open` → `answered` \| `expired` \| `superseded` | — |
| `catalogItems.status` | `draft` → `confirmed` → `retired` | — |
| `tasks.status` | `open` → `done` | — |

`passesChecks`、`isExecutable`、`allApproved` 分开命名（canon §1.3、D19）：`passesChecks` 只是规则通过；`isExecutable = isCurrentForApproval ∧ passesChecks`（08 §8.4.2 的唯一实现，不含审批集合，所以 canon D02 的"approve 前跑 `isExecutable`"在每一张 approve 前都有意义）；`allApproved = evaluateApprovalSet().complete`；执行条件 `canExecuteNow = isExecutable ∧ allApproved` 只在最后一张必需 approve 的事务里成立。三者都在读时重算。

### 4.1.2 单一来源与写入纪律

```ts
// core/engine/stateMachines.ts —— 零依赖纯 TS（canon D21）
export const RUN_STATUSES = ["negotiating", "pending_approval", "needs_input",
  "executed", "superseded", "ended_no_agreement", "canceled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_TERMINAL: ReadonlySet<RunStatus> =
  new Set(["executed", "superseded", "ended_no_agreement", "canceled"]);
export const RUN_TRANSITIONS: Record<RunStatus | "none", readonly RunStatus[]> = {
  none:               ["negotiating", "pending_approval", "needs_input"],         // R1–R3
  negotiating:        ["pending_approval", "needs_input", "superseded", "canceled"],
  pending_approval:   ["executed", "negotiating", "needs_input", "superseded", "canceled"],
  needs_input:        ["negotiating", "pending_approval", "superseded",
                       "ended_no_agreement", "canceled"],
  executed: [], superseded: [], ended_no_agreement: [], canceled: [],
};
// ROOM_ / TURN_ / ATTEMPT_ / PROPOSAL_ / REQUEST_ / CATALOG_ / TASK_ 同构，见各节
export function assertTransition<M extends Machine>(m: M, from: From<M>, to: To<M>): void {
  if (!TRANSITIONS[m][from].includes(to)) throw new EngineInvariantError("state.illegal_transition", { m, from, to });
}
```

- `convex/lib/validators.ts` 由同一数组生成 validator，并对 `RunStatus` 与 `Infer<typeof runStatusV>` 做双向类型相等断言（run-lifecycle r14）。
- `convex/lib/status.ts#setStatus(ctx, table, id, from, to, extra)`：重读行、断言 `row.status === from`、`assertTransition`、经 `ctx.tx.patch` 写（03 §3.3.2 规则 3）。**它是唯一能写 `status` 字段的代码**（结构测试 SM-STRUCT-1）。
- **写路径上下文 `RoomCtx`**：本章与 09 伪代码里凡会写库的 helper（`setStatus`、`startRunTx`、`createTurnTx`、`openHumanRequestTx`、`advanceRun`、`disposeCurrentRun`、`replaceTurnTx`、`beginAttemptTx`、09 的 `withConstraintChange` / `bump` / `react`）的 `ctx` 参数类型都是 `RoomCtx = MutationCtx & { tx: RoomTx }`：入口 mutation 在第一次写之前调用一次 `openRoomTx`（03 §3.3.1 M-ROOM，`rooms.writeSeq + 1`）并把 `tx` 挂到上下文，helper 只经 `ctx.tx.insert / patch` 与 `appendEvents(ctx.tx, …)` 写、经 `ctx.db` 读，不各自再开写锁。可能只读即返回的入口（`runs.reconcile`、`clock.rollLocalDate`、`agents.watchdog` 的空操作分支）在确定要写之后才打开 `RoomTx`，避免无谓的 `writeSeq` 冲突（4.3.5、09 §9.6.7）。
- 用户动作命中非法迁移 → `ConvexError({ code: "run.invalid_state" })`，不写任何行；内部路径命中 → `EngineInvariantError` → `withSanitizedErrors` 映射为 `internal` 并回滚（canon D16），`opsLog("state.illegal_transition")`。
- 每个迁移同事务经 `events.append` 写事件（类型名以 03 为准；受众渲染按 canon D14，provider 对 `run_needs_input` 只见 `run_waiting`）。

### 4.1.3 两组守卫，互不混用

回合持久化守卫 G0–G3（4.5.2）只用于 `turns.complete` / `turns.fail` / `agents.watchdog`，只读 attempt、turn、run、room；审批 / 执行守卫 A-G1…A-G10（4.7.3）只用于 `approvals.record` → `executions.executeIfComplete`，从不读 turns / attempts。两组唯一的交点是 `rooms.constraintsVersion`（只由 `constraints.bump` 改）与 `rooms.currentRunId`（只由 `startRunTx` 改）。

## 4.2 房间（room）

| # | from → to | 触发函数（调用者） | 守卫 | 同事务副作用 | 失败码 |
| --- | --- | --- | --- | --- | --- |
| M1 | ∅ → `setup` | `rooms.create`（任一已登录用户） | 场景 `scenarioKey@scenarioVersion` 已注册；`timeZone` 合法（`Intl` 可解析，待验证 V-D2）；创建者自选的角色属于场景角色 | 插入 room（`constraintsVersion: 0`、`localDate = todayInTimeZone(now, tz)`、`nextProposalVersion: 1`、`createdBy`、`provenance`）；登记首个本地午夜 `clock.rollLocalDate`（id 存 `rooms.clockFnId`，09 §9.6.7）；创建者 `members` 行；事件 `room_created` | `auth.unauthenticated` / `auth.user_not_provisioned`（12）、`run.invalid_state{guard:"scenario_version"}`（场景未注册，canon §1.5） |
| M2 | `setup` → `open` | `openIfReady(ctx, roomId, actorUserId)`（helper，在 `invites.accept`、`briefs.confirm`、`budget.setCap`、`catalog.confirm`、`catalog.retire`、`ledger.recordBaseline` 的末尾调用；系统） | 同事务先 `rollLocalDateTx`（`setup` 分支只推进 `localDate`、不 bump，09 §9.6.7），再判 `roomReadiness` 无缺口（4.2.1） | `setStatus(open)`；`constraints.bump({ cause: "room_opened", sourceRefs: 全部生效来源 })` → cv 0→1 并写第一行 `constraintRevisions`（09 §9.3）；`react()` → `startRunTx(cause: "room_opened")`；事件 `room_opened` | — |
| M3 | `open` → `executed` | `executions.executeIfComplete`（在最后一个必需 approve 的 `approvals.record` 同事务内；系统） | 08 的执行守卫全部通过 | 执行写入（08）；proposal → `executed`、run → `executed`；事件 `room_executed`；**不** bump（canon D03） | — |
| M4 | `setup` → `closed` | `rooms.close`（`rooms.createdBy`）；ops `rooms.forceClose`（internal，身份消失兜底，4.11） | 调用者是 creator（forceClose：部署 admin 经 CLI，12 §12.20） | 事件 `room_closed`（forceClose 带 `by: 'ops'`）；未接受的邀请随房间关闭失效（`invites.accept` 守卫要求 `setup`） | `auth.not_creator`、`run.invalid_state` |
| M5 | `open` → `closed` | `rooms.close`（creator）；ops `rooms.forceClose` | 同上 | 当前非终态 run → `canceled`（R8/R13/R18，`endedReason: room_closed`）；其 `active` 提案 → `superseded`；open 请求 → `superseded`（`closedReason: room_closed`）；非终态 turn → `stale`（在途 attempt 由守卫拒收）；事件 `run_ended`、`room_closed` | 同上 |
| M6 | `executed` / `closed` → 任何 | 禁止 | — | — | `run.invalid_state` |

`executed`、`closed` 无出边。v1 不提供重新打开（canon D04、D26）。也**没有** `executed → closed` 的归档迁移：canon §1.3 把二者都定为终态，D04 要求执行后房间只读。已执行房间从收件箱"收起"是查看者本地的界面筛选（13 "Hide executed rooms"），不是状态写入；执行派生的 `open` 任务不阻塞任何流程（4.11）。因此 canon D18 的"归档（`rooms.close`）是生产唯一清理"只针对 `setup` / `open` 房间，`executed` 房间保持只读历史。

### 4.2.1 就绪条件（M2 的守卫）

`roomReadiness(ctx, roomId) → { ready: true } | { ready: false; gaps: { gap: ReadinessGap; ownerRole: Role }[] }`（12 引用此名）：引擎检查席位与基线，其余由场景 `scenario.readiness(ruleInput)` 声明；`ReadinessGap = "seat_vacant" | "brief_unconfirmed" | "brief_field_missing" | "deadline_passed" | "catalog_empty" | "baseline_missing"`。首个场景（`scope_change`）要求全部满足：

1. 三个角色（customer、provider、finance）各有一个 `members` 行（canon D24：一人一房一席、一席一人）；
2. 三个角色各有至少一个已确认的 `briefs` 版本，且硬字段齐全：customer `requiredItemKeys`（非空，且每个键属于本房间曾确认过的目录键 confirmed ∪ retired，否则 `item.unknown`——关闭伪 itemKey 自由文本信道，privacy-08；因此 customer 简报只能在 provider 首次确认目录之后确认，此前缺口显示 "Waiting for Provider to confirm the catalog"）与 `deadline`（且 `deadline ≥ room.localDate`：`setup` 期间日期推进使已确认的截止日过期时缺口为 `deadline_passed`，负责角色 customer，重新确认简报即可）；finance `capCents`；provider v1 无硬字段，只需确认；
3. 至少一个 `status: confirmed`、`kind: item` 的 `catalogItems` 行；
4. 已有一条 `ledgerEntries(kind: baseline)`（可为 0，由 finance 显式录入，`ledger.recordBaseline`）。

**不**要求"目录覆盖 customer 的必需项"（必需项可以已被 retired，或在确认后被 provider 撤下）：缺项由规则给出 `item.required_missing`，run 进入 `needs_input` 并向能放松的人发请求（R3），而不是让房间停在 `setup` 无人负责。房间页按缺口逐项显示负责角色（"Waiting for Finance to record the committed baseline"），4.10。

### 4.2.2 `executed` 房间拒绝的写入（canon D04）

以下 mutation 在 `room.status === "executed"` 时一律返回 `run.invalid_state { guard: "room_status" }`，不写任何行：`briefs.confirm`、`budget.setCap`、`catalog.confirm`、`catalog.retire`、`ledger.recordBaseline`、`sharedFacts.add`、`invites.create`、`invites.accept`、`runs.start`、`runs.requestRenegotiation`、`runs.cancel`、`runs.retryTurn`、`humanRequests.answer`、`rooms.close`；`approvals.record` 返回 `approval.already_executed`（对已执行提案的 approve 返回幂等成功 `{ status: "executed", executionId, alreadyExecuted: true }`，12 §12.15、08）。内部入口同样拒绝：`constraints.bump`、`startRunTx`、`turns.beginAttempt`、`clock.rollLocalDate`（只推进 `setup` / `open` 房间，跳过 `executed` / `closed`）。

只有两个写入不改变本房间的协商状态，因而保留：`tasks.markDone`（被指派人勾选执行派生的任务，4.9）与 `rooms.startFollowUp`（只读旧房间、写一个新房间，canon D04）。canon D04 已把这两处列为仅有的豁免（经 `openRoomTx({ allow: ['executed'] })`，4.15 Q4 已关闭）。
