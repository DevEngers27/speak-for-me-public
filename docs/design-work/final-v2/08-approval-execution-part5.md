# 08 审批与执行（part5）：8.5 `approvals.record`

> 本节是 `approvals.record` 语义的定稿处；参数与错误码的**命名**跟随 12 §12.15 / §12.4（函数目录与码表的归属章），与 04 §4.7、07 §7.7 的已知分歧集中列在 part11 §8.13 O11。

## 8.5.1 签名

```ts
// convex/approvals.ts —— approve / reject / withdraw 的唯一写入口（公开 mutation）
export const record = memberMutation({        // 构造器：鉴权 + 由 proposalId 解析房间与成员（12 §12.3）+ withSanitizedErrors
  resolveRoomFrom: { table: 'proposals', arg: 'proposalId' },
  args: {
    proposalId: v.id('proposals'),
    decision: v.union(v.literal('approve'), v.literal('reject'), v.literal('withdraw')),
    expectedConstraintsVersion: v.number(),    // 人看到的约束版本（A1）
    expectedTermsKey: v.string(),              // 人看到的条款规范串（A1）
    reasonKey: v.union(v.string(), v.null()),  // reject 必须 ∈ 场景 rejectReasonKeys；其余必须为 null
    note: v.union(v.string(), v.null()),       // 仅本人可见；≤ 500 码点
  },
  returns: approvalRecordResultV,
  handler: (ctx, args) => recordDecisionCore(ctx, ctx.member, args),
});
// 不接受 role / kind / userId / operationId / 任何幂等键（07 约定 1："我"永远由服务端推导）。
// recordDecisionCore 与 dev-only 并发探针共用（探针用多个 ConvexHttpClient + setAdminAuth 调这个公开函数，
// 走真实鉴权路径；不设 testing:decideAs，review r05）。
```

## 8.5.2 返回值与错误码

```ts
export const approvalRecordResultV = v.union(
  v.object({ status: v.literal('recorded'), decision: decisionV, missingRoles: v.array(roleV) }),
  v.object({ status: v.literal('unchanged') }),
  v.object({ status: v.literal('executed'), executionId: v.id('executions'), alreadyExecuted: v.boolean() }),
);
```

| 返回 | 含义 | 前端处理（文案为英文模板，13 定稿） |
| --- | --- | --- |
| `recorded` | 新决定已追加；approve 时集合未齐，reject / withdraw 已生效 | "Waiting on: finance"（`missingRoles` 是"等谁"，07 显式解密，全员可见） |
| `unchanged` | 与本人当前 cv 上的最新决定相同（双击），或 withdraw 时本人没有当前 cv 上的 approve；未写行、未写事件、不计节流 | 静默；按钮保持禁用 |
| `executed{alreadyExecuted:false}` | 本次调用完成执行 | 跳转结果页 "Executed · CO-1 · Internal record only" |
| `executed{alreadyExecuted:true}` | 此前已执行（双击、重试、他人先投最后一票） | 同上，不提示错误 |

陈旧检查失败**抛** `approval.stale`（与 04 / 12 / 13 一致；canon D02 的"返回"按"以该码回应、不写行"理解，见 A12）。

| 抛出 `code` | 触发 | 用户可见（模板） | 可重试 | `params` 受众 |
| --- | --- | --- | --- | --- |
| `auth.unauthenticated` / `auth.user_not_provisioned`（构造器） | 无身份 / 无 users 行 | Sign in again | 登录后 | — |
| `auth.not_member`（构造器） | 非成员，或提案不存在（同码，防探测） | Not available | 否 | — |
| `auth.role_forbidden` | 调用者角色不在 `proposal.requiredApprovals` | You are not an approver for this proposal | 否 | — |
| `approval.stale` | `expectedConstraintsVersion` 或 `expectedTermsKey` 与当前不符 | stale 横幅 "Constraints changed while you were approving (now v{currentConstraintsVersion}). Review and decide again."——**不是**"等新提案"（review r06） | 刷新后重批 | `{ currentConstraintsVersion }`（房间可见） |
| `approval.self_conflict` | 调用者在本房间解析出不止一个席位（D24 被破坏）；`publicOpsLog('approval.self_conflict', { fn: 'approvals.record' })` | Something is wrong with your seat | 否 | — |
| `run.invalid_state` | 房间 `closed`；场景版本不匹配（A10、S5，**仅 approve**；reject / withdraw 不受影响） | This room is not accepting decisions | 否 | `{ guard }`（`room_status` / `scenario_version`） |
| `approval.not_current` | 房间 `setup`；提案不是当前 run 的当前提案、提案非 `active`、run 非 `pending_approval` | A newer proposal or negotiation replaced this one | 刷新后对新状态操作 | — |
| `approval.already_executed` | 房间已 `executed`：对已执行提案的 reject / withdraw，或对其中任何未执行提案的任何决定 | Already executed — start a follow-up change instead | 否 | — |
| `approval.not_executable` | A4 纵深防御触发（正常路径不会） | Blocked by checks; nothing was recorded | 否 | finance：全部阻断码；customer：自有码或 `private.constraint_unmet`；provider：无 |
| `run.rate_limited` | withdraw：本人对该提案的 withdraw 行数已达 `MAX_WITHDRAWALS_PER_USER_PER_PROPOSAL = 10`；approve：本人对该提案的 approve 行数已达 `MAX_APPROVE_ROWS_PER_USER_PER_PROPOSAL = 60`（S9）；**reject 永不触发** | Too many changes on this proposal | 否 | `{ retryAfterMs: null }` |
| `input.invalid` | reject 的 `reasonKey` 不在场景枚举、非 reject 却带 `reasonKey`、`note` 超长或含控制字符 | Invalid reason or note | 改后重试 | `{ field }` |
| `internal` | 不变量破坏（seq 重复、重复执行、链断裂、计划漂移、未捕获异常） | Something went wrong; nothing was recorded | 否；告警（15） | 无（公开路径只写 `publicOpsLog` 的三键行，不记 `requestId`） |

reject 不受任何决定次数上限约束（canon D02 否决全局 `TOO_MANY_DECISIONS`：它会挡住唯一的逃生口 reject，review r03）；`approvals.record` 也不在 D12 ⑥ 的节流清单里。reject 也不读整提案区间、不受场景版本守卫（S9、S5），所以任何人写满多少审批行、部署怎样提升场景版本，都挡不住它（invariants-01 / invariants-16，E14）。

## 8.5.3 分步时序（一个 mutation；任一步抛错则全部写入回滚）

| 步 | 动作 | 读 | 写 | 失败 → 结果 |
| --- | --- | --- | --- | --- |
| S0 | 构造器：`ctx.auth` → `users.by_tokenIdentifier` | users | — | `auth.unauthenticated` / `auth.user_not_provisioned` |
| S1 | 构造器：读 proposal → `members.by_room_user(proposal.roomId, userId).take(2)` | proposals、members | — | 提案不存在或 0 行 → `auth.not_member`；2 行 → `approval.self_conflict` |
| S2 | 读 room；`today = room.localDate`（09 §9.6.7：规则读已推进的本地日期，不读 `Date.now()`，审批结论与审批人屏幕一致） | rooms | — | — |
| S3 | 已执行快速路径：`proposal.status === 'executed'` → `executions.by_executionKey('exec:' + proposalId).take(2)` | executions | — | approve → 返回 `executed{alreadyExecuted:true}`（不写行、不写事件，RA-R08）；reject / withdraw → `approval.already_executed`；0 或 2 行 → `internal` |
| S4 | 房间：`room.status === 'open'` | — | — | `executed` → `approval.already_executed`；`setup` → `approval.not_current`；`closed` → `run.invalid_state{guard:'room_status'}` |
| S5 | 场景版本（**仅 approve**：approve 要按当时的规则重算；reject / withdraw 不跑规则，不需要版本一致，否则版本提升会挡住唯一的逃生口）：`scenarioOf(room)` 可解析——房间钉住的 `scenarioKey@scenarioVersion` 仍在注册表中（11 §11.3、canon §1.6） | — | — | `run.invalid_state{guard:'scenario_version'}`（15 定义迁移；reject 后 `createTurnTx` 在版本不符时让 run 走 `needs_input(agent_failed, end_run)`） |
| S6 | 当前性：`run = db.get(room.currentRunId)`；`isCurrentForApproval(room, run, proposal)` | runs | — | `approval.not_current` |
| S7 | 角色：`req = proposal.requiredApprovals.find(r => r.role === member.role)` | — | — | `auth.role_forbidden` |
| S8 | 版本：`expectedConstraintsVersion === room.constraintsVersion ∧ expectedTermsKey === proposal.termsKey` | — | — | 抛 `approval.stale{ currentConstraintsVersion }`（未写任何行） |
| S9 | 读审批行，按决定分三种读法（同房间并发由 M-ROOM 的 `writeSeq` 串行）：**reject** 只读本人最新一行 `approvals.by_proposal_user.eq(proposalId).eq(userId).order('desc').first()`，不读他人行、不设任何上限；**withdraw** 读本人区间 `by_proposal_user.eq(proposalId).eq(userId).collect()`（按构造 ≤ 60 approve + 10 withdraw + 1 行），取最新行为 `mine` 并计 withdraw 行数；**approve** 读本提案全部审批行 `by_proposal_user.eq(proposalId).collect()`（判定集合需要；只有必需角色的 3 人能写行，按构造 ≤ 3 × 71 = 213 行），`latest = latestDecisionsByUser(rows)`、`mine = latest.get(userId)`；本人 approve 行数 ≥ `MAX_APPROVE_ROWS_PER_USER_PER_PROPOSAL`（= 60）且本次需要写新行（不是 S10 的 unchanged，收敛检查不被限额挡住）→ 只对 approve 抛 `run.rate_limited`（invariants-01：全提案读上限会把 reject 变成 `internal`，已删除） | approvals | — | approve 路径 seq 重复 → `internal`；approve 超人均上限 → `run.rate_limited`；reject 在此步不会失败 |
| S10 | 去重与撤回前置：approve：`mine` 为当前 cv 上的 approve → 记为 unchanged、跳过 S12，先用 S9 已读的整区间与 `members.by_room_role`（每个必需角色 `take(2)`）跑纯函数 `evaluateApprovalSet`：未齐 → 直接返回 `unchanged`（不跑 S11、不 `openRoomTx`、不占写锁，12 §12.2 第 4 条）；已齐却未执行（收敛恢复，E11）→ 继续 S11 与 S13；withdraw：`mine` 不是当前 cv 上的 approve → 返回 `unchanged`；本人 withdraw 行（S9 读到的本人区间计数）≥ 10 → `run.rate_limited`；reject：`mine` 已是 reject 不可能（提案会是 `rejected`）→ `internal`；校验 `reasonKey` / `note` | — | — | `input.invalid` 等见左 |
| S11 | 仅 approve（含 S10 判定集合已齐的 unchanged）：`ruleInput = loadRuleInput(ctx, room, today)`；`verdict = checkProposal(ruleInput, proposal, today)`；`passesChecks(verdict)` | briefs、catalogItems、ledgerEntries（区间读） | — | 不通过 → `approval.not_executable` + `publicOpsLog('approval.not_executable', { fn: 'approvals.record' })`（公开路径只能用闭集三键 logger，07 E1、15 §15.6.2；告警按该码计数） |
| S12 | `tx = openRoomTx(ctx, roomId, { allow: ['open'] })`（M-ROOM，03 SC-05：`rooms.writeSeq + 1`）→ `tx.insert('approvals', { roomId, proposalId, runId: run._id, userId, role: member.role, kind: req.kind, decision, seq: (mine?.seq ?? 0) + 1, boundConstraintsVersion: room.constraintsVersion, boundTermsKey: proposal.termsKey, reasonKey?, note?, decidedAt })` → `events.append(tx, [{ type: 'approval_recorded', payload: { proposalVersion, role, decision, boundConstraintsVersion, reasonKey?（仅当该键受众为 room，A13） }, restrictedRef: { table: 'approvals', id } }])` | rooms | rooms.writeSeq、approvals、events | — |
| S13 | 分支：withdraw → 读本提案全部审批行（同 approve 的 S9 读法，按构造 ≤ 213 行）与 `members.by_room_role`，返回 `recorded{ decision: 'withdraw', missingRoles: evaluateApprovalSet(写入后).missingRoles }`（至少含本人角色；run 不动）；reject → §8.5.4，返回 `recorded`；approve（含 S10 判定集合已齐的 unchanged；该路径此时才 `openRoomTx`）→ `executeIfComplete(tx, { proposalId, actorUserId })`（part6，内部重读并 `evaluateApprovalSet`） | 见 part6 | reject 分支见下；approve 见 part6 | `ApprovalInvariantError` → `internal` |
| S14 | `executeIfComplete` 返回 `not_complete{missingRoles}` → 本次写了新行则返回 `recorded{decision, missingRoles}`，否则 `unchanged`；返回 `executed` → 返回 `executed{executionId, alreadyExecuted:false}` | — | — | — |

顺序理由：先鉴权与成员检查，再暴露提案的任何状态（S3 之前不泄露"已执行"）；先当前性（S4–S7）后陈旧检查（S8），使"run 已被取代"统一报 `approval.not_current`，而"同一提案在新 cv 下被保留"报 `approval.stale`（前端引导重批）；先陈旧检查后规则重算（S11）。

事件：payload 只含 03 §3.11 的白名单字段（D14）；reject 的 `reasonKey` 是人的显式表态，受众由场景 `humanReasonKeys[].audience` 声明（A13、07 DX-6）：受众 `room` 的键写进 payload，渲染如 "Customer rejected v1. Reason: scope insufficient."（14 §8 模板）；受众 `buyers` 的键（v1 只有 finance 的 `over_our_limit`）**不进 payload**，只经 `restrictedRef → approvals` 在 `timeline.page` 渲染时对 customer / finance 连接（"Finance rejected v1 · over our limit"），provider 只见 "Finance rejected v1."；`note` 只经 `restrictedRef` 对作者本人连接，永不进 payload。reject 时 04 的迁移 helper 另写 `proposal_status_changed{ to: 'rejected' }` 与 run 迁移事件。重复调用（`unchanged`、快速路径）不写事件；被拒调用整体回滚，也不留事件。

## 8.5.4 reject 分支（交给 04/05 的 helper `onProposalRejected`，本章规定其必须满足的条件）

1. `proposal.status: active → rejected`（`setStatus` → `assertTransition`；终态，A5）。
2. `candidateKey` 进入本 run 的派生剔除集合 `excludedCandidateKeys(run)`（被人拒绝的键，与 `action.repeats_blocked` 同一来源，派生不存，03 §3.8；按决定所在 run 从 `approvals.by_run_decision` 的 `(runId, 'reject')` 行 → `proposalId` → `candidateKey` 派生，D06 沿用、`proposals.runId` 仍属旧 run 的提案在本 run 被拒时同样计入），proposer 下一回合的 `candidateSnapshot` 剔除它（canon D10）。
3. `run.roundNo < maxRounds`（默认 3；`roundsExtended` 延长时 `maxRounds` 已 +1）→ `run: pending_approval → negotiating`，`roundNo + 1`，同事务创建 proposer 的 propose 回合（`turn.constraintsVersion = room.constraintsVersion` 快照，D07）并经 `beginAttemptTx` 唯一接缝调度。代理反馈按 05 §5.12 / §5.8.6：provider 代理只得 "vN rejected"；买方代理另得 `byRole`；任何他方代理都不得 `reasonKey` / `note`（拒绝者本方代理可见自己的 `reasonKey`）。`opsFlags.draining` 置位时 `beginAttemptTx` 返回 `run.draining` 不建 attempt，run 仍 `negotiating`，排空结束后由 `runs.reconcile` 补调度（D07/D17）——**reject 本身照常成功**。房间场景版本与部署不符时同理：S5 只拦 approve，reject 照常写入并迁移提案；`createTurnTx` 的版本守卫（04/10）不建回合，run 进入 `needs_input` + `agent_failed` 请求（选项由 04 定，默认只有 `end_run`；迁移用的 `constraints.bump(cause: 'scenario_migrated')` 会 supersede 该 run）。
4. `run.roundNo === maxRounds` → `run: pending_approval → needs_input`，`buildHumanRequests` 恰好开一个 `humanRequests { kind: 'rounds_exhausted', toRole: 'customer', options: choose_candidate（customer 视图下可行且不在已阻断集合）/ keep_as_is（每 run 至多 1 次）/ end_run }`（D15）。
5. 不调用 `runs.start`、不 bump、不改 `room.currentRunId`；`run.currentProposalId` 保留指向被拒提案（历史），守卫靠 `proposal.status` 拒绝后续决定。
6. 重复 reject（双击）：第二次在 S6 失败（run 已不在 `pending_approval`）→ `approval.not_current`，前端视为"已处理"；run 只迁移一次、只调度一个回合（K11）。

## 8.5.5 withdraw 分支

- 前置（S10）：本人最新行是当前 cv 上的 approve；提案未执行（S3）。否则返回 `unchanged`（没有可撤回的东西即"无变化"，不另设错误码）。
- 写入 `decision: 'withdraw'` 行（S12）；run 保持 `pending_approval`；本人槽位为 `withdrawn`（界面 "Withdrawn — awaiting decision"），可再次 approve（追加新行，seq + 1）。
- withdraw 与最后一票并发：两者都经 `openRoomTx` 写 `rooms.writeSeq`，OCC 冲突点确定（03 SC-05 的 M-ROOM）；审批区间读是第二个冲突点（V2）。反例 K24、race 场景 S5（part7、part9）。
- 旧 cv 上的 approve 已是 `stale_approve`，不能也无需撤回（返回 `unchanged`）。
