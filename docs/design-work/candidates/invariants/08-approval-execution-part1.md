# 08 审批与执行 · part1：绑定、必需审批人、decisions.record 与 executeIfReady 的事务步骤

## 1. 审批绑定什么

- 一条决定绑定 `(proposalId, constraintsVersion)`（DE-2）。提案不可变（PR-1），所以绑定 proposalId 即绑定条款内容；约束版本覆盖了全部规则输入，包括预算、必需项、截止日、报价、已承诺台账（CS-3）。两者任一变化，旧决定都不再计数（DE-4），但记录保留（DE-1）。
- 不存内容哈希：哈希只在内容可变时有意义；本设计没有任何修改提案的路径。`contentKey` 仅用于显示"条款与 v2 相同"。
- 不复制提案：约束变化后若当前提案仍全部通过，提案保持原 version，各方在新约束版本上重新批准（否决 Role A RA-R11）。界面提示"条款未变；约束从 v3 变为 v4；需要重新批准"。

## 2. 必需审批人与审批类别（解决 GAP-09、F08.2、F08.3）

- 场景声明 `RoleSpec.requiredApprover` 与 `approvalKind`；scope_change：customer（terms）、provider（terms）、finance（budget）。`insertProposal` 把它们快照进 `requiredApproverRoles` 与 `approvalKinds`（PR-6），执行以快照为准。
- 没有可修改的 `approvalRequired` 开关；房间不能在中途改变审批人集合（若将来支持，必须作为规则输入并 bump，17）。
- 完成判定按集合而非计数：每个必需角色的唯一参与方在当前 (proposal, cv) 上的最新决定为 approve（DE-4）；ID-4 保证这些参与方是不同用户。禁止 `approvals.length >= N` 式判断。
- 没有审批顺序：三方可以任意顺序批准；最后一票触发执行。

## 3. `decisions.record` 的事务步骤

参数：`{ proposalId, kind: "approve" | "reject" | "withdraw", reasonCode?, note?, notePublic? }`。不接受 userId、roleKey（ID-1）。

| 步 | 动作 | 失败时 |
| --- | --- | --- |
| 1 | 读提案；`requireParticipant(ctx, proposal.roomId, { open: true })` 得到 user、participant、room | `NOT_FOUND` / `UNAUTHENTICATED` / `NOT_A_PARTICIPANT` / `ROOM_CLOSED` |
| 2 | 读 `room.currentRunId` 的 run；要求 `run.status = pending_approval ∧ room.currentProposalId = proposalId` | `PROPOSAL_NOT_CURRENT`（附当前提案版本，供界面跳转） |
| 3 | `participant.roleKey ∈ proposal.requiredApproverRoles` | `NOT_REQUIRED_APPROVER` |
| 4 | `latest = latestDecision(proposalId, room.constraintsVersion, participantId)`；若 `latest.kind = kind` → 返回 `{ status: "unchanged" }`，不写任何东西（DE-5） | — |
| 5 | kind 专属守卫：withdraw 要求 `latest.kind = approve`；reject 要求 reasonCode ∈ 场景拒绝码；note ≤ 500 字符 | `NOTHING_TO_WITHDRAW` / `INVALID_REASON` |
| 6 | approve：`inputs = loadRuleInputs(room.currentConstraintSetId)`，`checks = evaluateProposal(terms, inputs, todayIn(tz))`，必须全部 pass（DE-3） | `NOT_EXECUTABLE { reasonCodes }`（按调用者投影） |
| 7 | `emitEvent(decision_recorded)` 得到 seq；插入决定（`roomSeq = seq`，approvalKind 取自提案快照） | — |
| 8a | reject：`transitionRun(→superseded, endReason = rejected_by_human)`；`startRun(trigger = human_reject, feedback = { roleKey, reasonCode, publicNote? })` | 新 run 守卫失败时以 failed 起步（04 R-0c） |
| 8b | approve：`executeIfReady(ctx, room, run, proposal, inputs, today, user)` | 返回 `executed: false` 时只是"还在等人" |
| 9 | 返回 `{ status: "recorded" \| "executed", executionId? }` | — |

撤回只针对批准：拒绝会立即结束当前 run 并开始新一轮协商（Role A RA-B16 的修正：拒绝不再是死路），因此不存在"撤回拒绝"。界面在拒绝前确认："This rejects v2 for everyone and restarts negotiation."

## 4. `executeIfReady` 的事务步骤（核心 5 的实现，全部在 `decisions.record` 的同一 mutation 内）

```ts
async function executeIfReady(ctx, room, run, proposal, inputs, today, actor) {
  // 1. 完成判定（DE-4）
  const decisionIds = [];
  for (const role of proposal.requiredApproverRoles) {
    const p = await participantByRole(ctx, room._id, role);
    const d = p && await latestDecision(ctx, proposal._id, room.constraintsVersion, p._id);
    if (d?.kind !== "approve") return { executed: false };
    decisionIds.push(d._id);
  }
  // 2. 幂等（EX-1）：状态守卫已在 record 步骤 2 成立；这里再查两道索引
  const prior = await ctx.db.query("executions")
    .withIndex("by_proposalId", q => q.eq("proposalId", proposal._id)).unique();
  if (prior) return { executed: true, executionId: prior._id };
  const operationKey = `exec:${proposal._id}:${room.constraintsVersion}`;
  const sameOp = await ctx.db.query("executions")
    .withIndex("by_operationKey", q => q.eq("operationKey", operationKey)).unique();
  if (sameOp) return { executed: true, executionId: sameOp._id };
  // 3. 重算全部检查（PR-5、EX-2）
  const checks = scenario.rules.evaluate(proposal.terms, inputs, today);
  if (!allPass(checks)) return { executed: false, blockedBy: failing(checks) };
  // 4. 台账断言（CS-4）：不等则抛错，整个事务（含刚写的决定）回滚
  const ledger = await sumCommitments(ctx, room._id);
  if (inputs.finance.brief.externalCommittedCents + ledger !== inputs.committedCents)
    throw new Error("INVARIANT_VIOLATION:CS-4");
  // 5. 派生并写入执行产物（EX-3、EX-4）
  const draft = scenario.rules.deriveExecution(proposal.terms, room.scenarioVersion);
  const number = room.executionSeq + 1;
  const executionId = await db.insert(ctx, "executions", {
    roomId: room._id, runId: run._id, proposalId: proposal._id,
    constraintsVersion: room.constraintsVersion,
    resultingConstraintsVersion: room.constraintsVersion + 1,
    operationKey, number, recordKind: draft.recordKind, decisionIds,
    amountCents: draft.amountCents,
    budgetSnapshot: { capCents: inputs.finance.brief.budgetCapCents,
                      committedBeforeCents: inputs.committedCents,
                      committedAfterCents: inputs.committedCents + draft.amountCents },
    scenarioVersion: room.scenarioVersion, executedByUserId: actor._id,
    isSimulated: proposal.isSimulated, executedAt: Date.now() });
  await db.insert(ctx, "commitments", { roomId: room._id, executionId,
    amountCents: draft.amountCents, isSimulated: proposal.isSimulated, createdAt: Date.now() });
  for (const t of draft.tasks) await db.insert(ctx, "tasks", { roomId: room._id, executionId, ...t,
    status: "todo", isSimulated: proposal.isSimulated, createdAt: Date.now(), updatedAt: Date.now() });
  await db.patchMutable(ctx, "rooms", room._id, { executionSeq: number });
  // 6. 先结束 run（清空 currentRunId / currentProposalId），再 bump，避免复评逻辑误触发
  await transitionRun(ctx, room, run, "executed");
  // 7. 台账变化 → 新约束集（CS-3），committedCents 增加
  await bumpConstraints(ctx, room, { kind: "execution", executionId });
  // 8. 事件（EV-2、EV-3）
  await emitEvent(ctx, room, roomEvent("execution_completed", { number, proposalVersion: proposal.version,
    amountCents: draft.amountCents, taskCount: draft.tasks.length }));
  await emitEvent(ctx, room, participantEvent(financeParticipantId, "execution_budget_detail", {...}));
  return { executed: true, executionId };
}
```
要点：
- 不用 action、不用 scheduler：执行是纯数据库写入，放在最后一票的同一事务里，不存在"全员已批但未执行"的悬空状态（RA-R07）。
- operationKey 由服务端从 (proposalId, constraintsVersion) 派生，客户端不能提供；它既是第二道幂等保险，也是审计键。主防线是状态守卫：执行后 run 已 executed、`currentProposalId` 已清空，任何后续调用在 record 步骤 2 就被拒绝。
- 预算重算读的是**当前**约束集，而 CS-4 保证它与台账一致；EX-5 因此在每次执行后仍成立。
- 执行使约束版本 +1：之后在同一房间开始的新 run（后续变更）以新的已承诺金额为基线。
